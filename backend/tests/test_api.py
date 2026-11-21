import os
import tempfile
from datetime import date, timedelta
from pathlib import Path

_tmp = Path(tempfile.mkdtemp())
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp / 'test.db'}"
os.environ["MEDIA_DIR"] = str(_tmp / "media")
os.environ["PRIVATE_DIR"] = str(_tmp / "private")
os.environ["AI_DISABLED"] = "1"  # never call the real AI from tests
os.environ["RATE_LIMIT_DISABLED"] = "1"  # re-enabled only in test_rate_limiter

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

# Most tests are about bookings, not moderation: switch approvals off (test_approvals turns them on).
from app import services as _services  # noqa: E402
from app.database import SessionLocal as _Session  # noqa: E402

with _Session() as _db:
    _services.set_setting(_db, "approve_users", False)
    _services.set_setting(_db, "approve_listings", False)
    _services.set_setting(_db, "require_id", False)  # test_id_verification turns it on
    _db.commit()
D = lambda n: (date.today() + timedelta(days=n)).isoformat()  # noqa: E731


def register(name):
    r = client.post("/auth/register", json={"name": name, "email": f"{name}@x.com", "password": "secret123",
                                             "neighborhood": "Elm"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


owner, renter, renter2 = register("owner"), register("renter"), register("renter2")


def make_item():
    r = client.post("/items", headers=owner, json={"title": "Drill", "category": "tools", "price_per_day": 7.5, "terms_accepted": True})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_login_and_me():
    r = client.post("/auth/login", json={"email": "OWNER@x.com", "password": "secret123"})
    assert r.status_code == 200
    assert client.post("/auth/login", json={"email": "owner@x.com", "password": "nope"}).status_code == 401
    assert client.get("/users/me").status_code == 401
    assert client.get("/users/me", headers=owner).json()["email"] == "owner@x.com"


def test_booking_lifecycle_and_calendar():
    item = make_item()
    # renter asks for days 2-4, renter2 for overlapping 3-5
    b1 = client.post("/bookings", headers=renter, json={"item_id": item, "start_date": D(2), "end_date": D(4)})
    assert b1.status_code == 201, b1.text
    assert b1.json()["total_price"] == 22.5 and b1.json()["days"] == 3
    b2 = client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(3), "end_date": D(5)})
    assert b2.status_code == 201

    # owner can't book own item, renter can't accept
    assert client.post("/bookings", headers=owner, json={"item_id": item, "start_date": D(9), "end_date": D(9)}).status_code == 400
    assert client.post(f"/bookings/{b1.json()['id']}/accept", headers=renter).status_code == 403

    # pending requests don't block the calendar
    cal = client.get(f"/items/{item}/calendar").json()
    assert cal["unavailable_days"] == [] and len(cal["ranges"]) == 2

    # accepting b1 auto-declines overlapping b2 and blocks the days
    assert client.post(f"/bookings/{b1.json()['id']}/accept", headers=owner).json()["status"] == "accepted"
    assert client.get(f"/bookings/{b2.json()['id']}", headers=renter2).json()["status"] == "declined"
    cal = client.get(f"/items/{item}/calendar").json()
    assert cal["unavailable_days"] == [D(2), D(3), D(4)]

    # new overlapping request is rejected; adjacent one is fine
    r = client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(4), "end_date": D(6)})
    assert r.status_code == 409
    assert client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(5), "end_date": D(6)}).status_code == 201

    # availability filter on search
    ids = [i["id"] for i in client.get("/items", params={"available_from": D(3), "available_to": D(3)}).json()]
    assert item not in ids

    # can't review or complete before it starts
    assert client.post("/reviews", headers=renter, json={"booking_id": b1.json()["id"], "rating": 5}).status_code == 400
    assert client.post(f"/bookings/{b1.json()['id']}/complete", headers=owner).status_code == 400


def test_blackouts_and_reviews_after_rental():
    item = make_item()
    bo = client.post(f"/items/{item}/blackouts", headers=owner, json={"start_date": D(10), "end_date": D(11), "note": "away"})
    assert bo.status_code == 200
    r = client.post("/bookings", headers=renter, json={"item_id": item, "start_date": D(11), "end_date": D(12)})
    assert r.status_code == 409 and "blocked" in r.json()["detail"]

    # a rental that starts today can be completed by the owner -> reviews unlock
    b = client.post("/bookings", headers=renter, json={"item_id": item, "start_date": D(0), "end_date": D(1)}).json()
    client.post(f"/bookings/{b['id']}/accept", headers=owner)
    done = client.post(f"/bookings/{b['id']}/complete", headers=owner).json()
    assert done["status"] == "completed" and done["can_review"] is True

    assert client.post("/reviews", headers=renter, json={"booking_id": b["id"], "rating": 4, "comment": "good"}).status_code == 201
    assert client.post("/reviews", headers=renter, json={"booking_id": b["id"], "rating": 4}).status_code == 409
    assert client.post("/reviews", headers=owner, json={"booking_id": b["id"], "rating": 5}).status_code == 201
    assert client.post("/reviews", headers=renter2, json={"booking_id": b["id"], "rating": 1}).status_code == 404

    got = client.get(f"/items/{item}").json()
    assert got["rating_avg"] == 4 and got["rating_count"] == 1
    assert len(client.get(f"/items/{item}/reviews").json()) == 1
    me = client.get("/users/me", headers=renter).json()
    assert me["rating_count"] >= 1


def test_spin_from_video():
    item = make_item()
    path = _tmp / "spin.mp4"
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30, (320, 240))
    for i in range(90):
        frame = np.full((240, 320, 3), 255, np.uint8)
        cv2.circle(frame, (int(160 + 100 * np.cos(i / 90 * 6.28)), 120), 30, (0, 0, 255), -1)
        vw.write(frame)
    vw.release()
    with path.open("rb") as f:
        r = client.post(f"/items/{item}/spin/video?frames=24", headers=owner, files={"file": ("spin.mp4", f, "video/mp4")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_360"] and len(body["spin_frames"]) == 24 and body["cover_url"]
    assert client.get(body["spin_frames"][5]).status_code == 200

    # someone else can't replace it
    with path.open("rb") as f:
        assert client.post(f"/items/{item}/spin/video", headers=renter, files={"file": ("s.mp4", f, "video/mp4")}).status_code == 403

    assert client.delete(f"/items/{item}/spin", headers=owner).json()["has_360"] is False


def test_photo_upload():
    item = make_item()
    ok, png = cv2.imencode(".png", np.zeros((50, 80, 3), np.uint8))
    r = client.post(f"/items/{item}/photos", headers=owner, files=[("files", ("a.png", png.tobytes(), "image/png"))])
    assert r.status_code == 200 and len(r.json()["photos"]) == 1
    assert client.post(f"/items/{item}/photos", headers=owner, files=[("files", ("a.png", b"junk", "image/png"))]).status_code == 400


def test_profile_password_contact_and_delete():
    me = register("profile")
    r = client.patch("/users/me", headers=me, json={"name": "New Name", "bio": "Hi", "neighborhood": "Oak"})
    assert r.json()["name"] == "New Name" and r.json()["listings_count"] == 0
    assert client.patch("/users/me", headers=me, json={"bio": "x" * 301}).status_code == 422

    assert client.post("/users/me/password", headers=me, json={"current_password": "nope", "new_password": "abcdefgh"}).status_code == 400
    assert client.post("/users/me/password", headers=me, json={"current_password": "secret123", "new_password": "abcdefgh"}).status_code == 204
    assert client.post("/auth/login", json={"email": "profile@x.com", "password": "abcdefgh"}).status_code == 200

    r = client.post("/support/contact", headers=me, json={"topic": "bug", "message": "Calendar looks odd"})
    assert r.status_code == 201
    assert client.post("/support/contact", json={"topic": "general", "message": "hello there", "email": "a@b.co"}).status_code == 201
    assert client.post("/support/contact", json={"topic": "nope", "message": "hello there"}).status_code == 422

    item = client.post("/items", headers=me, json={"title": "Saw", "category": "tools", "price_per_day": 5, "terms_accepted": True}).json()["id"]
    assert client.request("DELETE", "/users/me", headers=me, json={"password": "wrong"}).status_code == 400
    assert client.request("DELETE", "/users/me", headers=me, json={"password": "abcdefgh"}).status_code == 204
    assert client.get(f"/items/{item}").json()["is_active"] is False
    assert client.post("/auth/login", json={"email": "profile@x.com", "password": "abcdefgh"}).status_code == 401


def test_admin_moderation_flow():
    from app.database import SessionLocal
    from app.models import User

    boss = register("boss")
    with SessionLocal() as db:
        db.query(User).filter(User.email == "boss@x.com").update({"is_admin": True})
        db.commit()
    assert client.get("/users/me", headers=boss).json()["is_admin"] is True

    # non-admins are kept out
    assert client.get("/admin/stats", headers=renter).status_code == 403
    assert client.get("/admin/stats").status_code == 401

    stats = client.get("/admin/stats", headers=boss).json()
    assert stats["users"] >= 4 and len(stats["bookings_per_day"]) == 14

    # hide + restore a listing
    item = make_item()
    r = client.patch(f"/admin/items/{item}", headers=boss, json={"is_active": False, "reason": "Spam"})
    assert r.json()["is_active"] is False
    assert item not in [i["id"] for i in client.get("/items").json()]
    client.patch(f"/admin/items/{item}", headers=boss, json={"is_active": True})

    # suspend the owner: can't log in, listings disappear, pending requests cancelled
    b = client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(30), "end_date": D(31)}).json()
    owner_id = client.get("/users/me", headers=owner).json()["id"]
    r = client.patch(f"/admin/users/{owner_id}", headers=boss, json={"is_suspended": True, "reason": "Fake listings"})
    assert r.status_code == 200 and r.json()["is_suspended"]
    assert client.post("/auth/login", json={"email": "owner@x.com", "password": "secret123"}).status_code == 403
    assert client.get("/users/me", headers=owner).status_code == 403
    assert item not in [i["id"] for i in client.get("/items").json()]
    assert client.get(f"/bookings/{b['id']}", headers=renter2).json()["status"] == "cancelled"
    client.patch(f"/admin/users/{owner_id}", headers=boss, json={"is_suspended": False})
    assert client.post("/auth/login", json={"email": "owner@x.com", "password": "secret123"}).status_code == 200

    # can't lock yourself out
    me_id = client.get("/users/me", headers=boss).json()["id"]
    assert client.patch(f"/admin/users/{me_id}", headers=boss, json={"is_suspended": True}).status_code == 400

    # cancel a booking
    b2 = client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(40), "end_date": D(41)}).json()
    assert client.post(f"/admin/bookings/{b2['id']}/cancel", headers=boss, json={"reason": "Dispute"}).json()["status"] == "cancelled"

    # inbox
    client.post("/support/contact", headers=renter, json={"topic": "bug", "message": "Something broke here"})
    msgs = client.get("/admin/messages", headers=boss).json()
    assert msgs and msgs[0]["status"] == "open"
    m = client.patch(f"/admin/messages/{msgs[0]['id']}", headers=boss, json={"status": "resolved", "admin_note": "Fixed"}).json()
    assert m["status"] == "resolved" and m["resolved_at"]

    # reviews: remove one
    revs = client.get("/admin/reviews", headers=boss).json()
    assert revs
    assert client.delete(f"/admin/reviews/{revs[0]['id']}?reason=abusive", headers=boss).status_code == 204

    # everything above is in the audit log
    actions = [a["action"] for a in client.get("/admin/actions", headers=boss).json()]
    for a in ("hide_item", "restore_item", "suspend_user", "reinstate_user", "cancel_booking", "resolve_message", "remove_review"):
        assert a in actions


def _make_admin(name):
    from app.database import SessionLocal
    from app.models import User

    h = register(name)
    with SessionLocal() as db:
        db.query(User).filter(User.email == f"{name}@x.com").update({"is_admin": True})
        db.commit()
    return h


def test_approvals_and_settings():
    boss = _make_admin("approver")
    other = make_item()  # created while approvals are off, so it's live
    assert client.patch("/admin/settings", headers=boss, json={"approve_users": True, "approve_listings": True}).json() == {
        "approve_users": True,
        "approve_listings": True,
        "require_id": False,
        "platform_fee_percent": 10,
    }
    newbie = register("newbie")
    me = client.get("/users/me", headers=newbie).json()
    assert me["approval_status"] == "pending"

    # pending listing: owner sees it, public doesn't
    it = client.post("/items", headers=newbie, json={"title": "Kayak", "category": "sports", "price_per_day": 30, "terms_accepted": True}).json()
    assert it["review_status"] == "pending"
    assert it["id"] not in [i["id"] for i in client.get("/items").json()]
    assert client.get(f"/items/{it['id']}").status_code == 404
    assert client.get(f"/items/{it['id']}", headers=newbie).status_code == 200

    # pending user can't book
    r = client.post("/bookings", headers=newbie, json={"item_id": other, "start_date": D(50), "end_date": D(51)})
    assert r.status_code == 403 and "reviewed" in r.json()["detail"]

    stats = client.get("/admin/stats", headers=boss).json()
    assert stats["pending_users"] >= 1 and stats["pending_listings"] >= 1
    assert me["id"] in [u["id"] for u in client.get("/admin/users?filter=pending", headers=boss).json()]

    # reject listing with a note -> owner edits -> back to pending -> approve
    r = client.patch(f"/admin/items/{it['id']}", headers=boss, json={"review_status": "rejected", "reason": "Add a photo"}).json()
    assert r["review_status"] == "rejected" and r["review_note"] == "Add a photo"
    assert client.patch(f"/items/{it['id']}", headers=newbie, json={"description": "Two-person kayak"}).json()["review_status"] == "pending"
    client.patch(f"/admin/items/{it['id']}", headers=boss, json={"review_status": "approved"})
    assert it["id"] in [i["id"] for i in client.get("/items").json()]

    # approve the user -> can book
    client.patch(f"/admin/users/{me['id']}", headers=boss, json={"approval_status": "approved"})
    assert client.post("/bookings", headers=newbie, json={"item_id": other, "start_date": D(50), "end_date": D(51)}).status_code == 201

    acts = [a["action"] for a in client.get("/admin/actions", headers=boss).json()]
    for a in ("approve_user", "reject_item", "approve_item", "change_setting"):
        assert a in acts
    client.patch("/admin/settings", headers=boss, json={"approve_users": False, "approve_listings": False})


def test_location_privacy_and_categories():
    loc = {"lat": 37.761234, "lng": -122.421987, "label": "123 Valencia St, Mission, San Francisco"}
    item = client.post("/items", headers=owner, json={"title": "Projector", "category": "electronics", "price_per_day": 12, "location": loc, "terms_accepted": True}).json()
    assert item["location"]["exact"] and item["location"]["lat"] == loc["lat"]

    public = client.get(f"/items/{item['id']}").json()["location"]
    assert public["exact"] is False and public["lat"] != loc["lat"] and abs(public["lat"] - loc["lat"]) < 0.005
    assert "Valencia" not in public["label"] and "Mission" in public["label"]

    # confirmed renter gets the exact pin
    b = client.post("/bookings", headers=renter, json={"item_id": item["id"], "start_date": D(60), "end_date": D(60)}).json()
    assert client.get(f"/items/{item['id']}", headers=renter).json()["location"]["exact"] is False
    client.post(f"/bookings/{b['id']}/accept", headers=owner)
    assert client.get(f"/items/{item['id']}", headers=renter).json()["location"]["exact"] is True

    # old category names are gone
    assert client.post("/items", headers=owner, json={"terms_accepted": True, "title": "Cam", "category": "cameras", "price_per_day": 5}).status_code == 422
    assert "garden" in client.get("/items/categories").json()


def test_ai_features_with_fake_model(monkeypatch):
    import json as _json

    from app import ai

    # disabled: status says so, endpoints refuse politely, nothing is scheduled
    assert client.get("/ai/status").json()["enabled"] is False
    ok, png = cv2.imencode(".png", np.full((40, 40, 3), 200, np.uint8))
    files = [("files", ("a.png", png.tobytes(), "image/png"))]
    assert client.post("/ai/listing-draft", headers=owner, files=files).status_code == 503

    # enabled with a fake model
    monkeypatch.setattr(ai, "enabled", lambda: True)
    monkeypatch.setattr(
        ai,
        "draft_listing",
        lambda imgs, note="": ai.ListingDraft(
            is_rentable_item=True, title="Hedge trimmer", category="garden", description="Cordless trimmer.",
            price_per_day=7, deposit=40, note="",
        ),
    )
    calls = []

    def fake_check(item):
        calls.append(item.id)
        return ai.Precheck(verdict="check", summary="No photos yet.", issues=[ai.PrecheckIssue(severity="medium", text="No photos")], message_to_owner="Please add photos.")

    monkeypatch.setattr(ai, "precheck_listing", fake_check)
    r = client.post("/ai/listing-draft", headers=owner, files=files, data={"note": "battery included"})
    assert r.status_code == 200 and r.json()["category"] == "garden"
    assert client.post("/ai/listing-draft", files=files).status_code == 401

    boss = _make_admin("aiboss")
    client.patch("/admin/settings", headers=boss, json={"approve_listings": True})
    it = client.post("/items", headers=owner, json={"title": "Trimmer", "category": "garden", "price_per_day": 7, "terms_accepted": True}).json()
    assert it["review_status"] == "pending" and calls == [it["id"]]  # background pre-check ran
    row = next(i for i in client.get("/admin/items?status=pending", headers=boss).json() if i["id"] == it["id"])
    assert row["ai_check"]["verdict"] == "check" and row["ai_check"]["message_to_owner"] == "Please add photos."
    assert client.post(f"/admin/items/{it['id']}/ai-check", headers=boss).json()["ai_check"]["verdict"] == "check"
    assert client.post(f"/admin/items/{it['id']}/ai-check", headers=owner).status_code == 403

    # AI errors are stored for the admin instead of crashing
    monkeypatch.setattr(ai, "precheck_listing", lambda item: (_ for _ in ()).throw(ai.AIError("out of credit")))
    assert client.post(f"/admin/items/{it['id']}/ai-check", headers=boss).json()["ai_check"]["error"] == "out of credit"
    client.patch("/admin/settings", headers=boss, json={"approve_listings": False})
    _json  # noqa: B018


def test_free_providers_openai_compatible(monkeypatch):
    """Gemini/Groq path: request shape, provider choice, JSON-mode fallback and error messages."""
    import json as _json

    import httpx

    from app import ai

    monkeypatch.setattr(ai, "_load_env", lambda: None)
    for k in ("AI_DISABLED", "AI_PROVIDER", "AI_MODEL", "GEMINI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert ai.provider() is None and not ai.enabled()

    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("GEMINI_API_KEY", "gem-key")
    assert ai.provider() == "gemini" and ai.model() == "gemini-3.5-flash-lite"  # Gemini wins by default
    monkeypatch.setenv("AI_PROVIDER", "groq")
    assert ai.provider() == "groq" and ai.model() == "qwen/qwen3.8-27b"
    monkeypatch.delenv("AI_PROVIDER")

    draft = {"is_rentable_item": True, "title": "Drill", "category": "tools", "description": "Works.",
             "price_per_day": 6.4, "deposit": 33, "note": ""}
    seen = []

    def handler(req: httpx.Request):
        body = _json.loads(req.content)
        seen.append((str(req.url), req.headers["authorization"], body))
        if body["response_format"]["type"] == "json_schema" and mode["reject_schema"]:
            return httpx.Response(400, json={"error": {"message": "response_format json_schema not supported"}})
        if mode["status"] != 200:
            return httpx.Response(mode["status"], json={"error": {"message": "nope"}})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "```json\n" + _json.dumps(draft) + "\n```"}}]})

    monkeypatch.setattr(ai, "_http_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    img = ai.image_from_bytes(cv2.imencode(".png", np.full((30, 30, 3), 90, np.uint8))[1].tobytes())

    mode = {"reject_schema": False, "status": 200}
    d = ai.draft_listing([img], "two batteries")
    assert d.title == "Drill" and d.price_per_day == 6 and d.deposit == 30
    url, auth, body = seen[-1]
    assert url == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" and auth == "Bearer gem-key"
    assert body["model"] == "gemini-3.5-flash-lite" and body["messages"][0]["role"] == "system"
    parts = body["messages"][1]["content"]
    assert parts[0]["type"] == "image_url" and parts[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    schema = body["response_format"]["json_schema"]["schema"]
    assert body["response_format"]["json_schema"]["strict"] is True and schema["additionalProperties"] is False
    assert set(schema["required"]) == set(draft) and "$defs" not in _json.dumps(schema)

    # nested schema ($defs) is inlined for the pre-check too
    s = ai._strict_schema(ai.Precheck)
    assert "$ref" not in _json.dumps(s) and s["properties"]["issues"]["items"]["additionalProperties"] is False

    # model without strict JSON schema -> falls back to JSON mode with the schema in the prompt
    mode = {"reject_schema": True, "status": 200}
    seen.clear()
    assert ai.draft_listing([img]).category == "tools"
    assert [b["response_format"]["type"] for _, _, b in seen] == ["json_schema", "json_object"]

    # friendly errors
    for status, words in ((429, "limit"), (401, "GEMINI_API_KEY")):
        mode = {"reject_schema": False, "status": status}
        try:
            ai.draft_listing([img])
            raise AssertionError("expected AIError")
        except ai.AIError as e:
            assert words in str(e)


def test_service_fee_is_ten_percent_and_terms_required():
    assert client.get("/config").json()["platform_fee_percent"] == 10
    # listing without accepting the lender terms is refused
    r = client.post("/items", headers=owner, json={"title": "Sander", "category": "tools", "price_per_day": 10})
    assert r.status_code == 400 and "terms" in r.json()["detail"]
    item = client.post("/items", headers=owner, json={"title": "Sander", "category": "tools", "price_per_day": 10, "terms_accepted": True}).json()
    # 1 day x EUR10 -> EUR1 fee; 2 days -> EUR20 -> EUR2 fee. The renter pays the listed price; the owner gets the rest.
    one = client.post("/bookings", headers=renter2, json={"item_id": item["id"], "start_date": D(70), "end_date": D(70)}).json()
    assert (one["total_price"], one["platform_fee"], one["owner_payout"]) == (10, 1, 9)
    two = client.post("/bookings", headers=renter2, json={"item_id": item["id"], "start_date": D(72), "end_date": D(73)}).json()
    assert (two["total_price"], two["platform_fee"], two["owner_payout"]) == (20, 2, 18)


# ---------------------------------------------------------------------------
# chat, notifications, rate limiting, security
# ---------------------------------------------------------------------------


def test_booking_chat_and_notifications():
    item = make_item()
    b = client.post("/bookings", headers=renter, json={"item_id": item, "start_date": D(80), "end_date": D(81), "message": "hi"}).json()
    bid = b["id"]

    # the owner got a live-able notification for the request
    notes = client.get("/notifications", headers=owner).json()
    assert notes["items"][0]["kind"] == "booking_request" and notes["items"][0]["booking_id"] == bid
    assert notes["notifications"] >= 1

    # both sides can chat; outsiders can't see or post
    m = client.post(f"/bookings/{bid}/messages", headers=renter, json={"body": "  Is the battery charged?  "})
    assert m.status_code == 201 and m.json()["body"] == "Is the battery charged?"
    client.post(f"/bookings/{bid}/messages", headers=owner, json={"body": "Yes, two of them."})
    assert client.get(f"/bookings/{bid}/messages", headers=renter2).status_code == 404
    assert client.post(f"/bookings/{bid}/messages", headers=renter2, json={"body": "hey"}).status_code == 404
    assert client.post(f"/bookings/{bid}/messages", headers=renter, json={"body": ""}).status_code == 422
    assert client.post(f"/bookings/{bid}/messages", headers=renter, json={"body": "x" * 2001}).status_code == 422
    hist = client.get(f"/bookings/{bid}/messages", headers=owner).json()
    assert [x["body"] for x in hist] == ["Is the battery charged?", "Yes, two of them."]

    # unread counts + read receipts
    assert client.get("/me/unread", headers=owner).json()["messages"] >= 1
    r = client.post(f"/bookings/{bid}/read", headers=owner).json()
    assert r["read"] == 1
    t = next(t for t in client.get("/chats", headers=owner).json() if t["booking_id"] == bid)
    assert t["unread"] == 0 and t["last_message"]["body"] == "Yes, two of them." and t["other"]["name"] == "renter"

    # accepting notifies the renter; declined/cancelled chats are closed but readable
    client.post(f"/bookings/{bid}/accept", headers=owner)
    kinds = [n["kind"] for n in client.get("/notifications", headers=renter).json()["items"]]
    assert "booking_accepted" in kinds and "message" in kinds
    client.post(f"/bookings/{bid}/cancel", headers=renter)
    assert client.post(f"/bookings/{bid}/messages", headers=owner, json={"body": "ok"}).status_code == 400
    assert len(client.get(f"/bookings/{bid}/messages", headers=owner).json()) == 2
    assert client.post("/notifications/read", headers=renter).json()["notifications"] == 0


def test_rate_limiter(monkeypatch):
    from app import ratelimit

    monkeypatch.setenv("RATE_LIMIT_DISABLED", "0")
    ratelimit.store.reset()
    codes = [client.post("/auth/login", json={"email": "nobody@x.com", "password": "wrongpass"}).status_code for _ in range(12)]
    assert codes[:10] == [401] * 10 and codes[10] == 429
    r = client.post("/auth/login", json={"email": "nobody@x.com", "password": "wrongpass"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    ok = client.get("/health")
    assert ok.status_code == 200 and ok.headers["x-ratelimit-limit"] == "300"  # other routes have their own budget
    ratelimit.store.reset()


def test_security_basics():
    from app import security

    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "SAMEORIGIN"
    assert "frame-ancestors 'none'" in client.get("/admin/").headers.get("content-security-policy", "")
    assert security.SECRET_KEY != "dev-secret-change-me-before-deploying" and len(security.SECRET_KEY) >= 32
    # passwords need 8+ characters
    r = client.post("/auth/register", json={"name": "Short", "email": "short@x.com", "password": "abc12"})
    assert r.status_code == 422
    # oversized uploads are refused before they're decoded
    item = make_item()
    big = b"\xff\xd8" + b"0" * (10 * 1024 * 1024 + 10)
    r = client.post(f"/items/{item}/photos", headers=owner, files=[("files", ("big.jpg", big, "image/jpeg"))])
    assert r.status_code == 413
    # tampered token is rejected
    assert client.get("/users/me", headers={"Authorization": "Bearer " + "x" * 40}).status_code == 401


def _photo(w=640, h=420, shade=120):
    return cv2.imencode(".jpg", np.full((h, w, 3), shade, np.uint8))[1].tobytes()


def test_id_verification():
    from app.database import PRIVATE_DIR, SessionLocal

    admin = _make_admin("idboss")
    with SessionLocal() as db:
        _services.set_setting(db, "require_id", True)
        db.commit()
    try:
        newbie = register("idnewbie")
        me = client.get("/users/me", headers=newbie).json()
        assert me["id_status"] == "none" and me["id_required"] and me["id_verified"] is False

        # unverified users can't book or list
        r = client.post("/items", headers=newbie, json={"title": "Saw", "category": "tools", "price_per_day": 5, "terms_accepted": True})
        assert r.status_code == 403 and "verify your ID" in r.json()["detail"]
        item = client.post("/items", headers=admin, json={"title": "Tent", "category": "camping", "price_per_day": 9, "terms_accepted": True}).json()["id"]
        r = client.post("/bookings", headers=newbie, json={"item_id": item, "start_date": D(3), "end_date": D(3)})
        assert r.status_code == 403

        # bad uploads are refused
        files = {"front": ("id.jpg", b"not an image", "image/jpeg"), "selfie": ("me.jpg", _photo(), "image/jpeg")}
        assert client.post("/me/verification", headers=newbie, data={"doc_type": "passport"}, files=files).status_code == 400
        files = {"front": ("id.jpg", _photo(100, 80), "image/jpeg"), "selfie": ("me.jpg", _photo(), "image/jpeg")}
        assert client.post("/me/verification", headers=newbie, data={"doc_type": "passport"}, files=files).status_code == 400
        files = {"front": ("id.jpg", _photo(), "image/jpeg"), "selfie": ("me.jpg", _photo(), "image/jpeg")}
        assert client.post("/me/verification", headers=newbie, data={"doc_type": "selfie"}, files=files).status_code == 400

        # good upload -> pending, still blocked
        r = client.post("/me/verification", headers=newbie, data={"doc_type": "id_card"}, files=files)
        assert r.status_code == 200 and r.json()["status"] == "pending", r.text
        assert "being checked" in client.post("/bookings", headers=newbie, json={"item_id": item, "start_date": D(3), "end_date": D(3)}).json()["detail"]

        # images are private: not under /media, only admins can fetch them
        uid = client.get("/users/me", headers=newbie).json()["id"]
        assert client.get(f"/admin/verifications/{uid}/front", headers=newbie).status_code == 403
        queue = client.get("/admin/verifications", headers=admin).json()
        row = next(v for v in queue if v["user_id"] == uid)
        assert row["has_front"] and row["has_selfie"] and row["doc_type"] == "id_card"
        img = client.get(f"/admin/verifications/{uid}/selfie", headers=admin)
        assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
        assert client.get("/admin/stats", headers=admin).json()["pending_ids"] >= 1
        assert len(list((PRIVATE_DIR / "ids" / str(uid)).iterdir())) == 2

        # reject -> files deleted, user told why, can resubmit
        r = client.post(f"/admin/verifications/{uid}", headers=admin, json={"decision": "rejected", "note": "Photo is blurry."})
        assert r.json()["id_status"] == "rejected" and not r.json()["has_front"]
        assert list((PRIVATE_DIR / "ids" / str(uid)).iterdir()) == []
        me = client.get("/users/me", headers=newbie).json()
        assert me["id_status"] == "rejected" and me["id_note"] == "Photo is blurry."
        notes = client.get("/notifications", headers=newbie).json()["items"]
        assert notes[0]["kind"] == "id_rejected"

        client.post("/me/verification", headers=newbie, data={"doc_type": "passport"}, files=files)
        r = client.post(f"/admin/verifications/{uid}", headers=admin, json={"decision": "verified"})
        assert r.json()["id_status"] == "verified"
        assert client.get("/users/me", headers=newbie).json()["id_verified"] is True
        # verified: booking works and the badge is public
        b = client.post("/bookings", headers=newbie, json={"item_id": item, "start_date": D(3), "end_date": D(3)})
        assert b.status_code == 201, b.text
        assert b.json()["renter"]["id_verified"] is True
        # can't resubmit once verified
        assert client.post("/me/verification", headers=newbie, data={"doc_type": "passport"}, files=files).status_code == 400
    finally:
        with SessionLocal() as db:
            _services.set_setting(db, "require_id", False)
            db.commit()


def test_rent_club_badge_and_chat():
    from app.database import SessionLocal
    from app.models import CLUB_MIN_RENTALS, Booking, BookingStatus, User

    lender = register("clublender")
    fan = register("clubfan")
    outsider = register("clubout")
    admin = _make_admin("clubboss")
    items = [client.post("/items", headers=lender, json={"title": f"Thing {i}", "category": "tools", "price_per_day": 10, "terms_accepted": True}).json()["id"] for i in range(CLUB_MIN_RENTALS)]

    info = client.get("/club", headers=fan).json()
    assert info["is_member"] is False and info["needed"] == CLUB_MIN_RENTALS and info["rentals"] == 0
    assert client.get("/club/messages", headers=fan).status_code == 403
    assert client.post("/club/messages", headers=fan, json={"body": "let me in"}).status_code == 403

    # complete rentals one by one; the last one makes them a member
    ids = []
    for n, item in enumerate(items):
        b = client.post("/bookings", headers=fan, json={"item_id": item, "start_date": D(1), "end_date": D(1)}).json()
        client.post(f"/bookings/{b['id']}/accept", headers=lender)
        ids.append(b["id"])
    with SessionLocal() as db:  # pretend the rentals already started
        db.query(Booking).filter(Booking.id.in_(ids)).update({"start_date": date.today()}, synchronize_session=False)
        db.commit()
    for n, bid in enumerate(ids):
        assert client.post(f"/bookings/{bid}/complete", headers=lender).status_code == 200
        me = client.get("/users/me", headers=fan).json()
        assert me["club_member"] is (n + 1 >= CLUB_MIN_RENTALS)

    me = client.get("/users/me", headers=fan).json()
    assert me["rental_count"] == CLUB_MIN_RENTALS
    notes = client.get("/notifications", headers=fan).json()["items"]
    assert any(x["kind"] == "club_joined" for x in notes)
    with SessionLocal() as db:
        fan_id = db.query(User).filter(User.email == "clubfan@x.com").one().id
    # the badge shows to others (e.g. on the booking, seen by the lender)
    b = client.get(f"/bookings/{ids[0]}", headers=lender).json()
    assert b["renter"]["club_member"] is True and b["renter"]["id"] == fan_id

    # members' chat
    info = client.get("/club", headers=fan).json()
    assert info["is_member"] and info["can_chat"] and any(m["id"] == fan_id for m in info["members"])
    m = client.post("/club/messages", headers=fan, json={"body": "Hi club!"})
    assert m.status_code == 201 and m.json()["sender"]["name"] == "clubfan"
    assert client.get("/club/messages", headers=outsider).status_code == 403
    # admins can moderate: read + see unread
    assert client.get("/club", headers=admin).json()["unread"] >= 1
    assert client.get("/club/messages", headers=admin).json()[-1]["body"] == "Hi club!"
    assert client.get("/me/unread", headers=admin).json()["club"] >= 1
    client.post("/club/read", headers=admin)
    assert client.get("/me/unread", headers=admin).json()["club"] == 0
    assert client.post("/club/messages", headers=fan, json={"body": "   "}).status_code in (400, 422)


def _accepted_booking(payment_method, day):
    item = make_item()
    b = client.post("/bookings", headers=renter, json={"item_id": item, "start_date": D(day), "end_date": D(day + 1), "payment_method": payment_method})
    assert b.status_code == 201, b.text
    bid = b.json()["id"]
    assert client.post(f"/bookings/{bid}/accept", headers=owner).status_code == 200
    return bid, b.json()


def test_demo_card_payment_and_refund(monkeypatch):
    from app import payments

    monkeypatch.setattr(payments, "_secret", lambda: "")  # no Stripe key -> built-in demo checkout
    assert client.get("/payments/config").json()["mode"] == "simulated"

    item = make_item()
    b = client.post("/bookings", headers=renter, json={"item_id": item, "start_date": D(40), "end_date": D(41), "payment_method": "card"}).json()
    assert b["payment_method"] == "card" and b["payment_status"] == "unpaid"
    # can't pay before the owner confirms; owner can't pay
    assert client.post(f"/bookings/{b['id']}/pay", headers=renter).status_code == 400
    client.post(f"/bookings/{b['id']}/accept", headers=owner)
    assert client.post(f"/bookings/{b['id']}/pay", headers=owner).status_code == 403
    assert client.post(f"/bookings/{b['id']}/pay", headers=renter).json()["mode"] == "simulated"

    card = lambda n, exp="12/39", cvc="123": client.post(f"/bookings/{b['id']}/pay/demo", headers=renter, json={"number": n, "exp": exp, "cvc": cvc})  # noqa: E731
    assert card("4000 0000 0000 0002").json()["detail"] == "Your card was declined."
    assert card("1234 5678 9012 3456").status_code == 402  # only test cards
    assert card("4242 4242 4242 4242", exp="01/20").status_code == 402  # expired
    assert card("4242 4242 4242 4242", cvc="1").status_code == 402
    paid = card("4242 4242 4242 4242")
    assert paid.status_code == 200 and paid.json()["payment_status"] == "paid" and paid.json()["paid_at"]
    assert card("4242 4242 4242 4242").status_code == 400  # already paid
    notes = client.get("/notifications", headers=owner).json()["items"]
    assert notes[0]["kind"] == "payment_received"

    # cancelling a paid booking refunds it
    r = client.post(f"/bookings/{b['id']}/cancel", headers=owner)
    assert r.json()["status"] == "cancelled" and r.json()["payment_status"] == "refunded"
    note = client.get("/notifications", headers=renter).json()["items"][0]
    assert note["kind"] == "booking_cancelled" and "refunded" in note["body"]


def test_cash_payment():
    bid, b = _accepted_booking("cash", 50)
    assert b["payment_status"] == "cash_due"
    assert client.post(f"/bookings/{bid}/pay", headers=renter).status_code == 400  # cash isn't paid online
    assert client.post(f"/bookings/{bid}/cash-received", headers=renter).status_code == 403
    r = client.post(f"/bookings/{bid}/cash-received", headers=owner)
    assert r.json()["payment_status"] == "cash_received"


def test_stripe_test_mode(monkeypatch):
    """Stripe is mocked (no network): checks we create Checkout correctly, confirm, and refund."""
    import stripe

    from app import payments

    calls = {}

    class FakeSession:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    def create(**params):
        calls["create"] = params
        return FakeSession(id="cs_test_123", url="https://checkout.stripe.com/c/pay/cs_test_123")

    def retrieve(sid, **params):
        calls["retrieve"] = sid
        return FakeSession(id=sid, payment_status="paid", payment_intent="pi_test_abc", metadata={"booking_id": str(calls["bid"])})

    monkeypatch.setattr(stripe.checkout.Session, "create", staticmethod(create))
    monkeypatch.setattr(stripe.checkout.Session, "retrieve", staticmethod(retrieve))
    monkeypatch.setattr(stripe.Refund, "create", staticmethod(lambda **p: calls.setdefault("refund", p)))

    # a live key is ignored: demo only
    monkeypatch.setattr(payments, "_secret", lambda: "sk_live_nope")
    assert payments.mode() == "simulated"
    monkeypatch.setattr(payments, "_secret", lambda: "sk_test_fake")
    assert client.get("/payments/config").json()["mode"] == "stripe"

    bid, b = _accepted_booking("card", 60)
    calls["bid"] = bid
    out = client.post(f"/bookings/{bid}/pay", headers=renter).json()
    assert out == {"mode": "stripe", "url": "https://checkout.stripe.com/c/pay/cs_test_123", "session_id": "cs_test_123"}
    p = calls["create"]
    assert p["mode"] == "payment" and p["metadata"] == {"booking_id": str(bid)}
    assert p["line_items"][0]["price_data"]["currency"] == "eur"
    assert p["line_items"][0]["price_data"]["unit_amount"] == int(round(b["total_price"] * 100))
    assert p["success_url"].endswith(f"/?payment=success&booking={bid}&session_id={{CHECKOUT_SESSION_ID}}")
    # the demo card endpoint is off in Stripe mode
    assert client.post(f"/bookings/{bid}/pay/demo", headers=renter, json={"number": "4242424242424242", "exp": "12/39", "cvc": "123"}).status_code == 400

    r = client.post(f"/bookings/{bid}/pay/confirm", headers=renter, json={"session_id": "cs_test_123"})
    assert r.json()["payment_status"] == "paid"
    # someone else's session can't be used
    calls["bid"] = 999999
    other, _ = _accepted_booking("card", 70)
    assert client.post(f"/bookings/{other}/pay/confirm", headers=renter, json={"session_id": "cs_test_123"}).status_code == 400

    r = client.post(f"/bookings/{bid}/cancel", headers=renter)
    assert r.json()["payment_status"] == "refunded" and calls["refund"]["payment_intent"] == "pi_test_abc"
