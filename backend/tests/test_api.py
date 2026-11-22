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
os.environ["REMINDERS_DISABLED"] = "1"  # tests call reminders.send_due_reminders() themselves

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


def register(name, lender=True):
    r = client.post("/auth/register", json={"name": name, "email": f"{name}@x.com", "password": "secret123",
                                             "neighborhood": "Elm", "lender": lender})
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

    # a pending lender can't list yet; approve them
    r = client.post("/items", headers=newbie, json={"title": "Kayak", "category": "sports", "price_per_day": 30, "terms_accepted": True})
    assert r.status_code == 403 and "reviewed" in r.json()["detail"]
    assert me["id"] in [u["id"] for u in client.get("/admin/users?filter=pending", headers=boss).json()]
    client.patch(f"/admin/users/{me['id']}", headers=boss, json={"approval_status": "approved"})
    assert client.get("/users/me", headers=newbie).json()["approval_status"] == "approved"

    # pending listing: owner sees it, public doesn't
    it = client.post("/items", headers=newbie, json={"title": "Kayak", "category": "sports", "price_per_day": 30, "terms_accepted": True}).json()
    assert it["review_status"] == "pending"
    assert it["id"] not in [i["id"] for i in client.get("/items").json()]
    assert client.get(f"/items/{it['id']}").status_code == 404
    assert client.get(f"/items/{it['id']}", headers=newbie).status_code == 200

    # a pending lender can still rent
    assert client.post("/bookings", headers=newbie, json={"item_id": other, "start_date": D(40), "end_date": D(41)}).status_code == 201

    # renter-only sign-up: straight in, can book, can't list until a lender application is approved
    shopper = register("shopper", lender=False)
    sme = client.get("/users/me", headers=shopper).json()
    assert sme["approval_status"] == "none"
    assert client.post("/bookings", headers=shopper, json={"item_id": other, "start_date": D(44), "end_date": D(45)}).status_code == 201
    r = client.post("/items", headers=shopper, json={"title": "Tent", "category": "sports", "price_per_day": 9, "terms_accepted": True})
    assert r.status_code == 403 and "renting" in r.json()["detail"]
    assert client.post("/users/me/lender", headers=shopper).json()["approval_status"] == "pending"
    r = client.post("/items", headers=shopper, json={"title": "Tent", "category": "sports", "price_per_day": 9, "terms_accepted": True})
    assert r.status_code == 403 and "reviewed" in r.json()["detail"]
    client.patch(f"/admin/users/{sme['id']}", headers=boss, json={"approval_status": "approved"})
    assert client.post("/items", headers=shopper, json={"title": "Tent", "category": "sports", "price_per_day": 9, "terms_accepted": True}).status_code == 201

    stats = client.get("/admin/stats", headers=boss).json()
    assert stats["pending_listings"] >= 1

    # reject listing with a note -> owner edits -> back to pending -> approve
    r = client.patch(f"/admin/items/{it['id']}", headers=boss, json={"review_status": "rejected", "reason": "Add a photo"}).json()
    assert r["review_status"] == "rejected" and r["review_note"] == "Add a photo"
    assert client.patch(f"/items/{it['id']}", headers=newbie, json={"description": "Two-person kayak"}).json()["review_status"] == "pending"
    client.patch(f"/admin/items/{it['id']}", headers=boss, json={"review_status": "approved"})
    assert it["id"] in [i["id"] for i in client.get("/items").json()]


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

    # main model overloaded (503 "high demand") -> the next free model answers
    monkeypatch.setattr(ai.time, "sleep", lambda s: None)
    overloaded = {"gemini-3.5-flash-lite"}
    plain = handler

    def busy_handler(request):
        if _json.loads(request.content)["model"] in overloaded:
            return httpx.Response(503, json={"error": {"code": 503, "message": "high demand"}})
        return plain(request)

    monkeypatch.setattr(ai, "_http_client", lambda: httpx.Client(transport=httpx.MockTransport(busy_handler)))
    mode = {"reject_schema": False, "status": 200}
    seen.clear()
    assert ai.draft_listing([img]).title == "Drill"
    assert seen[-1][2]["model"] == "gemini-3.1-flash-lite"
    overloaded |= {"gemini-3.1-flash-lite", "gemini-2.5-flash-lite"}
    try:
        ai.draft_listing([img])
        raise AssertionError("expected AIError")
    except ai.AIError as e:
        assert "busy" in str(e) and "{" not in str(e)
    monkeypatch.setattr(ai, "_http_client", lambda: httpx.Client(transport=httpx.MockTransport(plain)))

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


def test_admins_are_auto_verified():
    from app.database import SessionLocal, upgrade_schema
    from app.models import User

    boss = _make_admin("verifyboss")  # made admin directly in the DB (like the seed / an old database)
    upgrade_schema()  # runs at every server start
    me = client.get("/users/me", headers=boss).json()
    assert me["id_status"] == "verified" and me["id_verified"] is True

    # promoting someone in the admin console verifies them at once
    helper = register("newhelper")
    with SessionLocal() as db:
        hid = db.query(User).filter(User.email == "newhelper@x.com").one().id
    assert client.get("/users/me", headers=helper).json()["id_status"] == "none"
    assert client.patch(f"/admin/users/{hid}", headers=boss, json={"is_admin": True}).status_code == 200
    me = client.get("/users/me", headers=helper).json()
    assert me["is_admin"] and me["id_status"] == "verified" and me["id_required"] is False
    # and an admin's verification can't be rejected
    r = client.post(f"/admin/verifications/{hid}", headers=boss, json={"decision": "rejected", "note": "x"})
    assert r.status_code == 400



def test_demo_account_is_auto_verified():
    from app.database import upgrade_schema

    r = client.post("/auth/register", json={"name": "Sam", "email": "demo@rentathing.app", "password": "demo1234", "neighborhood": "Mission"})
    assert r.status_code == 200, r.text
    sam = {"Authorization": f"Bearer {r.json()['access_token']}"}
    upgrade_schema()  # runs at every server start
    me = client.get("/users/me", headers=sam).json()
    assert me["id_status"] == "verified" and me["id_verified"] is True
    assert me["is_admin"] is False  # still a normal user, just already verified


def test_admin_can_grant_rent_club():
    from app.database import SessionLocal
    from app.models import User

    boss = _make_admin("clubgranter")
    vip = register("vipmember")
    with SessionLocal() as db:
        vid = db.query(User).filter(User.email == "vipmember@x.com").one().id
    assert client.get("/club", headers=vip).json()["can_chat"] is False
    r = client.patch(f"/admin/users/{vid}", headers=boss, json={"club_granted": True})
    assert r.status_code == 200 and r.json()["club_member"] and r.json()["club_granted"]
    me = client.get("/users/me", headers=vip).json()
    assert me["club_member"] is True and me["rental_count"] == 0
    info = client.get("/club", headers=vip).json()
    assert info["is_member"] and info["can_chat"] and any(m["id"] == vid for m in info["members"])
    assert client.post("/club/messages", headers=vip, json={"body": "Thanks for the invite!"}).status_code == 201
    assert client.get("/notifications", headers=vip).json()["items"][0]["kind"] == "club_joined"
    # completing rentals later doesn't wipe a granted membership; removing it does
    assert client.patch(f"/admin/users/{vid}", headers=boss, json={"club_granted": False}).json()["club_member"] is False
    assert client.get("/club/messages", headers=vip).status_code == 403


def test_prishtina_items_first_with_flag():
    from app import city

    assert city.contains(42.6581, 21.1559)  # Pejton, Prishtina
    assert not city.contains(37.7587, -122.4214)  # San Francisco
    assert city.contains(None, None, "Rruga Agim Ramadani, Prishtinë") and not city.contains(None, None, "Mission")
    assert client.get("/config").json()["home_city"]["name"] == "Prishtina"

    mk = lambda title, loc: client.post("/items", headers=owner, json={"title": title, "category": "tools", "price_per_day": 5, "terms_accepted": True, "location": loc}).json()  # noqa: E731
    far = mk("Far drill", {"label": "Valencia St, San Francisco", "lat": 37.7587, "lng": -122.4214})
    near = mk("Near drill", {"label": "Pejton, Prishtina", "lat": 42.6581, "lng": 21.1559})
    assert far["in_home_city"] is False and near["in_home_city"] is True

    rows = client.get("/items", params={"q": "drill"}).json()
    flags = [r["in_home_city"] for r in rows]
    assert flags == sorted(flags, reverse=True)  # all Prishtina items before the others
    by_id = {r["id"]: r for r in rows}
    assert by_id[near["id"]]["in_home_city"] and not by_id[far["id"]]["in_home_city"]
    assert client.get(f"/items/{far['id']}").json()["in_home_city"] is False


def test_fee_periods_and_no_club_discount():
    """Special fee periods change the service fee by rental start date; prices never drop; club members pay full price."""
    from app.database import SessionLocal
    from app.models import User

    admin = _make_admin("feeboss")
    item = make_item()  # €7.50/day
    # club member still pays the listed price
    member = register("feeclub")
    with SessionLocal() as db:
        db.query(User).filter(User.email == "feeclub@x.com").update({"club_granted": True})
        db.commit()
    b = client.post("/bookings", headers=member, json={"item_id": item, "start_date": D(60), "end_date": D(61)}).json()
    assert b["total_price"] == 15.0 and b["club_discount"] == 0 and b["platform_fee"] == 1.5 and b["fee_label"] == ""
    assert "discount_percent" not in client.get("/club", headers=member).json()
    assert "club_discount_percent" not in client.get("/config").json()

    # non-admins can't manage periods; bad dates refused
    assert client.get("/admin/fee-periods", headers=renter).status_code == 403
    bad = {"name": "Oops", "start_date": D(10), "end_date": D(5), "fee_percent": 3}
    assert client.post("/admin/fee-periods", headers=admin, json=bad).status_code == 400
    assert client.post("/admin/fee-periods", headers=admin, json={**bad, "end_date": D(12), "fee_percent": 150}).status_code == 422

    # a broad "season" (higher fee) with a one-day sale inside it: the shorter one wins
    season = client.post("/admin/fee-periods", headers=admin, json={"name": "Season", "start_date": D(20), "end_date": D(40), "fee_percent": 15})
    assert season.status_code == 201, season.text
    sale = client.post("/admin/fee-periods", headers=admin, json={"name": "Black Friday", "start_date": D(25), "end_date": D(25), "fee_percent": 3}).json()
    q = lambda d: client.get(f"/admin/fee-periods/quote?start={d}", headers=admin).json()  # noqa: E731
    assert (q(D(21))["fee_percent"], q(D(21))["label"]) == (15, "Season")
    assert (q(D(25))["fee_percent"], q(D(25))["label"]) == (3, "Black Friday")
    assert (q(D(41))["fee_percent"], q(D(41))["label"]) == (10, "")

    r = client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(25), "end_date": D(26)}).json()
    assert r["total_price"] == 15.0  # price unchanged
    assert r["platform_fee"] == 0.45 and r["owner_payout"] == 14.55 and r["fee_label"] == "Black Friday"
    r = client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(30), "end_date": D(30)}).json()
    assert r["platform_fee"] == 1.12 and r["fee_label"] == "Season"  # 15% of 7.50, rounded

    # the app sees upcoming periods; yearly periods that wrap the new year work
    names = [p["name"] for p in client.get("/config").json()["fee_periods"]]
    assert names.index("Season") < names.index("Black Friday")
    xmas = client.post("/admin/fee-periods", headers=admin, json={"name": "Holidays", "start_date": "2020-12-20", "end_date": "2021-01-05", "fee_percent": 12, "yearly": True})
    assert xmas.status_code == 201 and xmas.json()["days"] == 17
    for d, want in [("2031-12-25", 12), ("2032-01-03", 12), ("2031-12-10", 10)]:
        assert q(d)["fee_percent"] == want, d

    # edit + delete are logged
    pid = sale["id"]
    e = client.put(f"/admin/fee-periods/{pid}", headers=admin, json={"name": "Black Friday", "start_date": D(25), "end_date": D(25), "fee_percent": 0})
    assert e.status_code == 200 and q(D(25))["fee_percent"] == 0
    assert client.delete(f"/admin/fee-periods/{pid}", headers=admin).status_code == 204
    assert q(D(25))["label"] == "Season"
    acts = [a["action"] for a in client.get("/admin/actions", headers=admin).json()]
    assert {"add_fee_period", "change_fee_period", "delete_fee_period"} <= set(acts)
    for p in client.get("/admin/fee-periods", headers=admin).json():
        client.delete(f"/admin/fee-periods/{p['id']}", headers=admin)


# ---------------------------------------------------------------------------
# handover photos + pick-up / return reminders
# ---------------------------------------------------------------------------


def test_handover_photos():
    bid, _ = _accepted_booking("cash", 0)  # starts today
    pic = lambda: ("p.jpg", _photo(), "image/jpeg")  # noqa: E731
    r = client.post(f"/bookings/{bid}/handover/pickup", headers=renter, files=[("files", pic()), ("files", pic())])
    assert r.status_code == 200, r.text
    photos = r.json()["handover_photos"]
    assert [p["stage"] for p in photos] == ["pickup", "pickup"] and all(p["can_delete"] for p in photos)
    assert client.get(f"/media{photos[0]['url'].removeprefix('/media')}").status_code == 200
    # the owner sees them (not deletable for them) and gets told
    ob = client.get(f"/bookings/{bid}", headers=owner).json()
    assert len(ob["handover_photos"]) == 2 and not any(p["can_delete"] for p in ob["handover_photos"]) and ob["can_add_handover"]
    assert any(n["kind"] == "handover_photos" for n in client.get("/notifications", headers=owner).json()["items"])
    # owner adds return photos too; outsiders can't
    assert client.post(f"/bookings/{bid}/handover/return", headers=owner, files=[("files", pic())]).status_code == 200
    assert client.post(f"/bookings/{bid}/handover/return", headers=renter2, files=[("files", pic())]).status_code == 404
    assert client.post(f"/bookings/{bid}/handover/lost", headers=owner, files=[("files", pic())]).status_code == 422
    # limit per person and stage
    r = client.post(f"/bookings/{bid}/handover/pickup", headers=renter, files=[("files", pic())] * 5)
    assert r.status_code == 400 and "4 more" in r.json()["detail"]
    # only your own photo can be removed, and only shortly after
    pid = photos[0]["id"]
    assert client.delete(f"/bookings/{bid}/handover/photos/{pid}", headers=owner).status_code == 403
    assert len(client.delete(f"/bookings/{bid}/handover/photos/{pid}", headers=renter).json()["handover_photos"]) == 2
    from app.models import HandoverPhoto

    with _Session() as db:
        p = db.get(HandoverPhoto, photos[1]["id"])
        p.created_at -= timedelta(hours=1)
        db.commit()
    assert client.delete(f"/bookings/{bid}/handover/photos/{photos[1]['id']}", headers=renter).status_code == 403
    # admins see the photos (with who took them) for disputes
    admin = _make_admin("handoveradmin")
    ab = next(x for x in client.get("/admin/bookings", headers=admin).json() if x["id"] == bid)
    assert sorted((p["stage"], p["uploader_role"]) for p in ab["handover_photos"]) == [("pickup", "renter"), ("return", "owner")]
    assert ab["handover_photos"][0]["uploader_name"] == "renter"
    # too early: a booking that starts in a week
    later, _ = _accepted_booking("cash", 7)
    assert client.get(f"/bookings/{later}", headers=renter).json()["can_add_handover"] is False
    assert client.post(f"/bookings/{later}/handover/pickup", headers=renter, files=[("files", pic())]).status_code == 400


def test_pickup_and_return_reminders():
    from datetime import datetime

    from app import reminders

    tomorrow, _ = _accepted_booking("cash", 1)  # pick-up tomorrow, returns the day after
    kinds = lambda who, bid: [n["kind"] for n in client.get("/notifications", headers=who).json()["items"] if n["booking_id"] == bid]  # noqa: E731
    today = date.today()
    assert reminders.send_due_reminders(datetime.combine(today, datetime.min.time()).replace(hour=6)) == 0  # too early
    at9 = datetime.combine(today, datetime.min.time()).replace(hour=9)
    assert reminders.send_due_reminders(at9) >= 2
    assert kinds(renter, tomorrow).count("reminder_pickup") == 1 and kinds(owner, tomorrow).count("reminder_pickup") == 1
    note = next(n for n in client.get("/notifications", headers=renter).json()["items"] if n["kind"] == "reminder_pickup" and n["booking_id"] == tomorrow)
    assert note["title"].startswith("Pick-up tomorrow") and "cash" in note["body"]
    # running again sends nothing new
    reminders.send_due_reminders(at9)
    assert kinds(renter, tomorrow).count("reminder_pickup") == 1
    # on the last day: the return reminder
    last_day = at9 + timedelta(days=2)
    reminders.send_due_reminders(last_day)
    assert kinds(renter, tomorrow).count("reminder_return") == 1 and kinds(owner, tomorrow).count("reminder_return") == 1
    # cancelled bookings get nothing
    later, _ = _accepted_booking("cash", 5)
    assert client.post(f"/bookings/{later}/cancel", headers=renter).status_code == 200
    reminders.send_due_reminders(at9 + timedelta(days=4))
    assert not [k for k in kinds(renter, later) if k.startswith("reminder")]


def _photo_item():
    item = make_item()
    from app.models import Item
    with _Session() as db:
        db.get(Item, item).cover_url = "/media/x.jpg"
        db.commit()
    return item


CARD = {"number": "4242 4242 4242 4242", "exp": "12/39", "cvc": "123"}


def _pay_promo(item, days=7, tagline=""):
    pid = client.post(f"/items/{item}/promote", headers=owner, json={"days": days, "tagline": tagline}).json()["promotion_id"]
    r = client.post(f"/items/{item}/promote/{pid}/demo", headers=owner, json=CARD)
    assert r.status_code == 200, r.text
    return pid, r.json()


def test_promotions_paid_then_approved(monkeypatch):
    from app import payments

    monkeypatch.setattr(payments, "_secret", lambda: "")  # demo checkout, even if backend/.env has a Stripe test key
    boss = _make_admin("promoboss")
    item = make_item()
    # no photo yet
    assert client.post(f"/items/{item}/promote", headers=owner, json={"days": 7}).status_code == 400
    item = _photo_item()
    plans = client.get("/items/promotion-plans").json()
    assert plans["mode"] == "simulated" and {p["days"]: p["price"] for p in plans["plans"]} == {3: 15.0, 7: 29.0, 14: 49.0}
    assert client.post(f"/items/{item}/promote", headers=renter, json={"days": 7}).status_code == 403
    assert client.post(f"/items/{item}/promote", headers=owner, json={"days": 5}).status_code == 422

    order = client.post(f"/items/{item}/promote", headers=owner, json={"days": 3, "tagline": "Black Friday: half price"}).json()
    assert order["mode"] == "simulated" and order["amount"] == 15.0
    pid = order["promotion_id"]
    declined = dict(CARD, number="4000 0000 0000 0002")
    assert client.post(f"/items/{item}/promote/{pid}/demo", headers=owner, json=declined).status_code == 402
    assert client.post(f"/items/{item}/promote/{pid}/demo", headers=renter, json=CARD).status_code == 403
    r = client.post(f"/items/{item}/promote/{pid}/demo", headers=owner, json=CARD)
    # paid, but waiting for an admin: not live yet
    assert r.status_code == 200 and r.json()["promo_until"] is None and r.json()["promo_review"] == "pending"
    assert client.get(f"/items/{item}", headers=renter).json()["promo_review"] == "none"  # only the owner sees review info
    assert client.post(f"/items/{item}/promote/{pid}/demo", headers=owner, json=CARD).status_code == 400  # no double charge
    assert client.get("/items/promoted").json() == []
    assert client.post(f"/items/{item}/promote", headers=owner, json={"days": 7}).status_code == 400  # one waiting at a time

    # admin queue
    assert client.get("/admin/promotions", headers=owner).status_code == 403
    queue = client.get("/admin/promotions", headers=boss).json()
    assert [q["id"] for q in queue] == [pid] and queue[0]["payment"] == "demo" and queue[0]["amount"] == 15.0
    assert client.get("/admin/stats", headers=boss).json()["pending_promotions"] == 1
    r = client.post(f"/admin/promotions/{pid}", headers=boss, json={"decision": "approved"})
    assert r.status_code == 200 and r.json()["status"] == "approved" and r.json()["live_until"]
    assert client.post(f"/admin/promotions/{pid}", headers=boss, json={"decision": "rejected", "reason": "x"}).status_code == 400
    slides = client.get("/items/promoted").json()
    assert [x["id"] for x in slides] == [item] and slides[0]["tagline"] == "Black Friday: half price"
    note = client.get("/notifications", headers=owner).json()["items"][0]
    assert note["kind"] == "promotion_approved"

    # extending adds to the days left, after approval
    first_end = client.get(f"/items/{item}", headers=owner).json()["promo_until"]
    pid2, _ = _pay_promo(item, 7)
    client.post(f"/admin/promotions/{pid2}", headers=boss, json={"decision": "approved"})
    from datetime import datetime as _dt
    second_end = client.get(f"/items/{item}", headers=owner).json()["promo_until"]
    assert (_dt.fromisoformat(second_end) - _dt.fromisoformat(first_end)).days == 7

    # rejecting needs a reason, refunds, and tells the owner why
    pid3, _ = _pay_promo(item, 3, "Cheapest drill in Kosovo!!!")
    assert client.post(f"/admin/promotions/{pid3}", headers=boss, json={"decision": "rejected"}).status_code == 400
    r = client.post(f"/admin/promotions/{pid3}", headers=boss, json={"decision": "rejected", "reason": "Please don't make price claims."})
    assert r.json()["status"] == "rejected"
    me = client.get(f"/items/{item}", headers=owner).json()
    assert me["promo_review"] == "rejected" and me["promo_review_note"] == "Please don't make price claims."
    assert me["promo_tagline"] != "Cheapest drill in Kosovo!!!"  # the rejected headline never went live
    note = client.get("/notifications", headers=owner).json()["items"][0]
    assert note["kind"] == "promotion_rejected" and "refunded" in note["body"]

    assert client.delete(f"/items/{item}/promote", headers=owner).json()["promo_until"] is None
    assert client.get("/items/promoted").json() == []


def test_promotion_stripe_test_mode(monkeypatch):
    import stripe

    from app import payments

    calls = {}

    class FakeSession:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    def create(**params):
        calls["create"] = params
        return FakeSession(id="cs_test_promo", url="https://checkout.stripe.com/c/pay/cs_test_promo")

    def retrieve(sid, **params):
        return FakeSession(id=sid, payment_status=calls.get("status", "paid"), payment_intent="pi_test_promo",
                           metadata={"promotion_id": str(calls["pid"])})

    monkeypatch.setattr(stripe.checkout.Session, "create", staticmethod(create))
    monkeypatch.setattr(stripe.checkout.Session, "retrieve", staticmethod(retrieve))
    monkeypatch.setattr(stripe.Refund, "create", staticmethod(lambda **p: calls.setdefault("refund", p)))
    monkeypatch.setattr(payments, "_secret", lambda: "sk_test_fake")
    boss = _make_admin("promoboss2")

    item = _photo_item()
    out = client.post(f"/items/{item}/promote", headers=owner, json={"days": 14, "tagline": "Shop: Elm Tools"}).json()
    pid = calls["pid"] = out["promotion_id"]
    assert out["mode"] == "stripe" and out["url"].startswith("https://checkout.stripe.com/") and out["amount"] == 49.0
    p = calls["create"]
    assert p["metadata"] == {"promotion_id": str(pid)}
    assert p["line_items"][0]["price_data"]["unit_amount"] == 4900
    assert p["success_url"].endswith(f"/?promo=success&item={item}&promotion={pid}&session_id={{CHECKOUT_SESSION_ID}}")
    # the demo card endpoint is off in Stripe mode
    assert client.post(f"/items/{item}/promote/{pid}/demo", headers=owner, json=CARD).status_code == 400

    calls["status"] = "unpaid"
    assert client.post(f"/items/{item}/promote/{pid}/confirm", headers=owner, json={"session_id": "cs_test_promo"}).status_code == 402
    calls["status"] = "paid"
    r = client.post(f"/items/{item}/promote/{pid}/confirm", headers=owner, json={"session_id": "cs_test_promo"})
    assert r.status_code == 200 and r.json()["promo_review"] == "pending" and r.json()["promo_until"] is None
    queue = client.get("/admin/promotions", headers=boss).json()
    assert [q["payment"] for q in queue if q["id"] == pid] == ["stripe"]
    # rejecting a Stripe payment refunds it through Stripe
    r = client.post(f"/admin/promotions/{pid}", headers=boss, json={"decision": "rejected", "reason": "Wrong photo"})
    assert r.json()["status"] == "rejected" and calls["refund"]["payment_intent"] == "pi_test_promo"
    # a session paid for another order can't be reused
    pid2 = client.post(f"/items/{item}/promote", headers=owner, json={"days": 3}).json()["promotion_id"]
    assert client.post(f"/items/{item}/promote/{pid2}/confirm", headers=owner, json={"session_id": "cs_test_promo"}).status_code == 400


def test_discount_codes():
    from app import payments

    boss = _make_admin("codeboss")
    shopper = register("codeshopper")
    item = make_item()  # €7.50/day
    today = date.today()

    def code_body(**kw):
        return {"code": "blackfriday", "label": "Black Friday", "percent_off": 20, "max_off": 10,
                "starts_on": today.isoformat(), "ends_on": D(8), "featured": True, **kw}

    # admin only, and codes are validated
    assert client.post("/admin/discount-codes", headers=owner, json=code_body()).status_code == 403
    assert client.post("/admin/discount-codes", headers=boss, json=code_body(code="no spaces!")).status_code == 400
    assert client.post("/admin/discount-codes", headers=boss, json=code_body(ends_on=D(-1))).status_code == 400
    r = client.post("/admin/discount-codes", headers=boss, json=code_body())
    assert r.status_code == 201 and r.json()["code"] == "BLACKFRIDAY" and r.json()["status"] == "live"
    cid = r.json()["id"]
    assert client.post("/admin/discount-codes", headers=boss, json=code_body()).status_code == 409
    feat = client.get("/discounts/featured").json()
    assert feat["code"] == "BLACKFRIDAY" and feat["live"] is True and feat["percent_off"] == 20

    # preview: 4 days x 7.50 = 30 -> 20% = 6 off
    body = {"item_id": item, "start_date": D(20), "end_date": D(23)}
    r = client.post("/discounts/check", headers=shopper, json={**body, "code": " blackFriday "})
    assert r.status_code == 200 and r.json() == {"code": "BLACKFRIDAY", "label": "Black Friday", "percent_off": 20.0,
                                                 "subtotal": 30.0, "discount": 6.0, "total": 24.0}
    assert client.post("/discounts/check", headers=shopper, json={**body, "code": "NOPE"}).status_code == 400

    # booking with the code: renter pays less, owner's payout is unchanged (Rentify pays the discount)
    b = client.post("/bookings", headers=shopper, json={**body, "discount_code": "blackfriday"}).json()
    assert b["total_price"] == 24.0 and b["discount_amount"] == 6.0 and b["discount_code"] == "BLACKFRIDAY"
    plain = client.post("/bookings", headers=renter2, json={"item_id": item, "start_date": D(30), "end_date": D(33)}).json()
    assert b["owner_payout"] == plain["owner_payout"] and b["platform_fee"] == plain["platform_fee"]
    assert b["club_discount"] == 0

    # once per person (while that booking is live); declining gives the use back
    r = client.post("/bookings", headers=shopper, json={"item_id": item, "start_date": D(40), "end_date": D(40), "discount_code": "BLACKFRIDAY"})
    assert r.status_code == 400 and "already used" in r.json()["detail"]
    client.post(f"/bookings/{b['id']}/decline", headers=owner)
    assert client.post("/discounts/check", headers=shopper, json={**body, "code": "BLACKFRIDAY"}).status_code == 200

    # the €10 cap: 14 days x 7.50 = 105 -> 20% = 21, capped at 10
    r = client.post("/discounts/check", headers=shopper, json={"item_id": item, "start_date": D(50), "end_date": D(63), "code": "BLACKFRIDAY"})
    assert r.json()["discount"] == 10.0

    # card payment charges the discounted total
    payments_mode = payments.mode
    try:
        payments.mode = lambda: "simulated"
        b2 = client.post("/bookings", headers=shopper, json={**body, "discount_code": "BLACKFRIDAY", "payment_method": "card"}).json()
        client.post(f"/bookings/{b2['id']}/accept", headers=owner)
        out = client.post(f"/bookings/{b2['id']}/pay", headers=shopper).json()
        assert out["amount"] == 24.0
    finally:
        payments.mode = payments_mode

    # admin list shows uses; a used code can't be deleted or renamed, only paused
    row = next(x for x in client.get("/admin/discount-codes", headers=boss).json() if x["id"] == cid)
    assert row["uses"] == 1 and row["given"] == 6.0
    assert client.delete(f"/admin/discount-codes/{cid}", headers=boss).status_code == 400
    assert client.put(f"/admin/discount-codes/{cid}", headers=boss, json=code_body(code="BF2")).status_code == 400
    r = client.put(f"/admin/discount-codes/{cid}", headers=boss, json=code_body(is_active=False))
    assert r.json()["status"] == "paused"
    assert client.post("/discounts/check", headers=renter, json={**body, "code": "BLACKFRIDAY"}).status_code == 400
    assert client.get("/discounts/featured").json() is None

    # scheduled codes say when they start; unused codes can be deleted
    r = client.post("/admin/discount-codes", headers=boss, json=code_body(code="CYBER", starts_on=D(3), ends_on=D(4), featured=False))
    assert r.json()["status"] == "scheduled"
    assert "starts on" in client.post("/discounts/check", headers=renter, json={**body, "code": "cyber"}).json()["detail"]
    assert client.delete(f"/admin/discount-codes/{r.json()['id']}", headers=boss).status_code == 204
