"""Reset the database and fill it with a demo neighborhood.

    python seed.py            # wipe + seed (renders 360° spins the first time, ~1 min)
    python seed.py --upgrade  # keep existing data; add map locations + the review-queue demo data

The demo city is San Francisco. To use your own city, change CITY, NEIGHBOURHOODS and LOCATIONS
below (any lat/lng works; labels are "street, area, city" and only "area, city" is shown publicly).

Demo login:  demo@rentathing.app / demo1234   (also alice@, bob@, carla@ — same password)
"""

import shutil
from pathlib import Path
from datetime import date, datetime, timedelta

from app.database import MEDIA_DIR, Base, SessionLocal, engine
from app.models import Blackout, Booking, BookingStatus, ContactMessage, Item, ItemPhoto, Review, SpinFrame, User
from app.security import hash_password
from seed_render import DEMO_OBJECTS, render, render_spin

PASSWORD = "demo1234"
CITY = "San Francisco"
NEIGHBOURHOODS = {
    "demo@rentathing.app": "Mission",
    "alice@rentathing.app": "Noe Valley",
    "bob@rentathing.app": "Bernal Heights",
    "carla@rentathing.app": "Hayes Valley",
    "admin@rentathing.app": "SoMa",
    "dan@rentathing.app": "Inner Sunset",
    "mia@rentathing.app": "Inner Richmond",
}
LOCATIONS = {  # listing title -> (lat, lng, "street, area, city")
    "Mirrorless camera + 35mm lens": (37.75165, -122.43372, "24th St, Noe Valley, San Francisco"),
    "4-person dome tent": (37.73921, -122.41660, "Cortland Ave, Bernal Heights, San Francisco"),
    "Cordless drill / driver 18V": (37.75872, -122.42141, "Valencia St, Mission, San Francisco"),
    "City bike (size M)": (37.77652, -122.42431, "Hayes St, Hayes Valley, San Francisco"),
    "Aluminium step ladder (6 steps)": (37.74083, -122.41472, "Bonview St, Bernal Heights, San Francisco"),
    "HD projector + 2.5 m screen": (37.76413, -122.46648, "Irving St, Inner Sunset, San Francisco"),
    "Party speaker with wireless mic": (37.75218, -122.43105, "Castro St, Noe Valley, San Francisco"),
}
CACHE = MEDIA_DIR / "_seed_cache"  # rendered frames survive re-seeding


def frames_for(name: str) -> list[str]:
    build, zoom = DEMO_OBJECTS[name]
    out = CACHE / name
    if len(list(out.glob("*.jpg"))) != 36:
        print(f"  rendering 360° spin: {name} …")
        render_spin(build(), out, frames=36, zoom=zoom)
    return [f"/media/_seed_cache/{name}/{i:03d}.jpg" for i in range(36)]


def still_for(name: str, angle: float) -> str:
    build, zoom = DEMO_OBJECTS[name]
    path = CACHE / f"{name}_still_{int(angle)}.jpg"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        render(build(), angle, zoom=zoom).save(path, quality=86)
    return f"/media/_seed_cache/{path.name}"


def place(item: Item) -> None:
    if item.title in LOCATIONS:
        item.lat, item.lng, item.location_label = LOCATIONS[item.title]


SEED_PHOTOS = Path(__file__).resolve().parent / "seed_photos"
# Real product photos (Pexels, see seed_photos/CREDITS.md); first one is the cover.
STOCK = {
    "camera": ["camera_1", "camera_2"],
    "tent": ["tent_1", "tent_2"],
    "drill": ["drill_1", "drill_2"],
    "bike": ["bike_1", "bike_2"],
    "ladder": ["ladder_2", "ladder_1"],
    "projector": ["projector_2", "projector_1"],
    "speaker": ["speaker_1", "speaker_2"],
}


def stock_photos(obj: str) -> list[str]:
    """Copy the stock photos into media/stock and return their URLs ([] if not available)."""
    names = STOCK.get(obj, [])
    if not names or not all((SEED_PHOTOS / f"{n}.jpg").exists() for n in names):
        return []
    dest = MEDIA_DIR / "stock"
    dest.mkdir(parents=True, exist_ok=True)
    for n in names:
        shutil.copyfile(SEED_PHOTOS / f"{n}.jpg", dest / f"{n}.jpg")
    return [f"/media/stock/{n}.jpg" for n in names]


def make_item(db, owner, title, desc, cat, price, deposit, obj, spin=True, created=30, review="approved"):
    item = Item(owner_id=owner.id, title=title, description=desc, category=cat, price_per_day=price, deposit=deposit,
                neighborhood=owner.neighborhood, created_at=datetime.utcnow() - timedelta(days=created),
                review_status=review)
    place(item)
    db.add(item)
    db.flush()
    photos = stock_photos(obj)
    if not photos:  # no real photos available: fall back to rendered stills + a rendered 360° spin
        if spin:
            item.spin_frames = [SpinFrame(url=u, idx=i) for i, u in enumerate(frames_for(obj))]
        photos = [still_for(obj, a) for a in (30, 120, 250)]
    item.photos = [ItemPhoto(url=u, position=i) for i, u in enumerate(photos)]
    item.cover_url = photos[0]
    return item


def add_review_queue(db) -> None:
    """New neighbours and listings waiting for an admin — the approval demo."""
    pw = hash_password(PASSWORD)
    by_email = {u.email: u for u in db.query(User).all()}
    ago = lambda n: datetime.utcnow() - timedelta(hours=n)  # noqa: E731
    if "dan@rentathing.app" not in by_email:
        dan = User(name="Dan Park", email="dan@rentathing.app", password_hash=pw, neighborhood=NEIGHBOURHOODS["dan@rentathing.app"],
                   bio="Movie nights in the park every summer.", approval_status="pending", created_at=ago(5))
        mia = User(name="Mia Lopez", email="mia@rentathing.app", password_hash=pw, neighborhood=NEIGHBOURHOODS["mia@rentathing.app"],
                   bio="", approval_status="pending", created_at=ago(2))
        db.add_all([dan, mia])
        db.flush()
        by_email["dan@rentathing.app"] = dan
    titles = {t for (t,) in db.query(Item.title).all()}
    if "HD projector + 2.5 m screen" not in titles:
        make_item(db, by_email["dan@rentathing.app"], "HD projector + 2.5 m screen",
                  "1080p projector, 3000 lumens, with a 2.5 m pull-up screen, HDMI cable and a small speaker. Great for garden movie nights.",
                  "electronics", 18, 100, "projector", created=0, review="pending")
    if "Party speaker with wireless mic" not in titles and "alice@rentathing.app" in by_email:
        make_item(db, by_email["alice@rentathing.app"], "Party speaker with wireless mic",
                  "Loud battery speaker (10 h) on wheels with a wireless microphone. Bluetooth and aux in.",
                  "party", 14, 60, "speaker", spin=False, created=0, review="pending")


def upgrade():
    """Non-destructive: add locations to the demo listings and the review-queue demo data."""
    db = SessionLocal()
    for u in db.query(User).all():
        if u.email in NEIGHBOURHOODS:
            u.neighborhood = NEIGHBOURHOODS[u.email]
    for item in db.query(Item).all():
        if item.lat is None and item.title in LOCATIONS:
            place(item)
            item.neighborhood = item.owner.neighborhood
    add_review_queue(db)
    db.commit()
    db.close()
    print("Upgraded demo data (existing users, listings and bookings were kept).")


def main():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    for sub in ("spins", "items", "avatars", "tmp"):
        shutil.rmtree(MEDIA_DIR / sub, ignore_errors=True)

    db = SessionLocal()
    today = date.today()
    d = lambda n: today + timedelta(days=n)  # noqa: E731
    ago = lambda n: datetime.utcnow() - timedelta(days=n)  # noqa: E731

    pw = hash_password(PASSWORD)
    demo = User(name="Sam Rivera", email="demo@rentathing.app", password_hash=pw, neighborhood="Mission",
                bio="Weekend DIY-er. I lend my tools, I borrow everything else.", created_at=ago(200))
    alice = User(name="Alice Chen", email="alice@rentathing.app", password_hash=pw, neighborhood="Noe Valley",
                 bio="Photographer. Happy to show you how the camera works.", created_at=ago(320))
    bob = User(name="Bob Okafor", email="bob@rentathing.app", password_hash=pw, neighborhood="Bernal Heights",
               bio="Camping gear hoarder. Everything comes back clean, promise.", created_at=ago(150))
    carla = User(name="Carla Diaz", email="carla@rentathing.app", password_hash=pw, neighborhood="Hayes Valley",
                 bio="Cyclist and occasional hiker.", created_at=ago(90))
    admin = User(name="Robin Admin", email="admin@rentathing.app", password_hash=hash_password("admin1234"),
                 neighborhood="SoMa", bio="Keeping the neighbourhood friendly.", is_admin=True, created_at=ago(400))
    db.add_all([demo, alice, bob, carla, admin])
    db.flush()

    def add_item(owner, title, desc, cat, price, deposit, obj, spin=True, created=30):
        return make_item(db, owner, title, desc, cat, price, deposit, obj, spin=spin, created=created)

    camera = add_item(alice, "Mirrorless camera + 35mm lens",
                      "24MP mirrorless body with a fast 35mm f/1.8 prime. Two batteries, charger and a 64GB card included. Great for events and travel.",
                      "photo", 25, 200, "camera", created=40)
    tent = add_item(bob, "4-person dome tent",
                    "Waterproof 4-person tent, sets up in 10 minutes. Comes with footprint, stakes and a repair kit.",
                    "camping", 15, 50, "tent", created=60)
    drill = add_item(demo, "Cordless drill / driver 18V",
                     "18V drill with 2 batteries, fast charger and a 40-piece bit set. Perfect for shelves and flat-pack furniture.",
                     "tools", 8, 30, "drill", created=20)
    bike = add_item(carla, "City bike (size M)",
                    "Comfy 7-speed city bike with lights, lock and a rear rack. Helmet available on request.",
                    "bikes", 12, 80, "bike", created=10)
    ladder = add_item(bob, "Aluminium step ladder (6 steps)",
                      "Sturdy aluminium step ladder with a tool tray, about 2 m tall. Folds flat and fits in a hatchback.",
                      "tools", 10, 40, "ladder", spin=False, created=5)
    db.flush()

    def book(item, renter, start, end, status, msg="", created=None):
        b = Booking(item_id=item.id, renter_id=renter.id, start_date=start, end_date=end, status=status,
                    total_price=((end - start).days + 1) * item.price_per_day, message=msg,
                    platform_fee=round(((end - start).days + 1) * item.price_per_day * 0.10, 2),
                    owner_payout=round(((end - start).days + 1) * item.price_per_day * 0.90, 2),
                    created_at=created or datetime.utcnow())
        db.add(b)
        db.flush()
        return b

    def review(b, reviewer, rating, comment, days_ago):
        renter_side = reviewer.id == b.renter_id
        db.add(Review(booking_id=b.id, item_id=b.item_id, reviewer_id=reviewer.id,
                      reviewee_id=b.item.owner_id if renter_side else b.renter_id,
                      direction="renter_to_owner" if renter_side else "owner_to_renter",
                      rating=rating, comment=comment, created_at=ago(days_ago)))

    db.refresh(camera)
    # --- history (completed rentals + reviews) ---
    b1 = book(tent, carla, d(-30), d(-27), BookingStatus.COMPLETED, "Weekend at the lake!", ago(35))
    db.refresh(b1)
    review(b1, carla, 5, "Tent was spotless and Bob showed me how to pitch it. Stayed dry through a thunderstorm.", 26)
    review(b1, bob, 5, "Returned clean and dry, perfect renter.", 26)

    b2 = book(camera, bob, d(-20), d(-18), BookingStatus.COMPLETED, "Shooting my cousin's wedding.", ago(25))
    db.refresh(b2)
    review(b2, bob, 4, "Great camera and lens, battery life could be better. Alice gave a quick tutorial.", 17)
    review(b2, alice, 5, "Took great care of it.", 17)

    # Demo user rented the camera and hasn't reviewed it yet -> "Leave a review" shows up.
    b3 = book(camera, demo, d(-9), d(-7), BookingStatus.COMPLETED, "Need it for a product shoot.", ago(12))
    db.refresh(b3)
    review(b3, alice, 5, "Sam was on time both ways. Would rent to again!", 6)

    # Bob rented the demo user's drill; Bob reviewed, demo hasn't yet.
    b4 = book(drill, bob, d(-14), d(-13), BookingStatus.COMPLETED, "Hanging shelves.", ago(16))
    db.refresh(b4)
    review(b4, bob, 5, "Drill is a beast, bits were well organised. Thanks Sam!", 12)

    # --- upcoming ---
    book(camera, carla, d(3), d(5), BookingStatus.ACCEPTED, "Birthday party photos.", ago(2))
    # Two overlapping requests for the demo user's drill: accepting one auto-declines the other.
    book(drill, carla, d(2), d(4), BookingStatus.PENDING, "Building a raised garden bed this weekend!", ago(1))
    book(drill, alice, d(3), d(6), BookingStatus.PENDING, "Need to put up curtain rails.", ago(0))
    # The demo user is waiting on Carla for the bike.
    book(bike, demo, d(7), d(8), BookingStatus.PENDING, "Want to try the Panhandle trail.", ago(0))
    db.add(Blackout(item_id=tent.id, start_date=d(10), end_date=d(14), note="Family camping trip"))
    db.add(Blackout(item_id=drill.id, start_date=d(20), end_date=d(21), note="Renovating my bathroom"))

    # --- support inbox ---
    db.add_all([
        ContactMessage(user_id=bob.id, name=bob.name, email=bob.email, topic="bug", created_at=ago(1),
                       message="The calendar on my phone showed yesterday as available for the tent. Refreshing fixed it."),
        ContactMessage(user_id=carla.id, name=carla.name, email=carla.email, topic="safety", created_at=ago(0),
                       message="Someone asked me to pay a deposit by bank transfer before meeting. Is that allowed?"),
        ContactMessage(name="Jordan", email="jordan@example.com", topic="general", created_at=ago(3), status="resolved",
                       admin_note="Explained how deposits work.", resolved_at=datetime.utcnow() - timedelta(days=2),
                       message="Do I need an account to just look at listings?"),
    ])

    add_review_queue(db)

    db.commit()
    db.close()
    print("Admin login:  admin@rentathing.app / admin1234")
    print("Seeded. Log in with demo@rentathing.app / demo1234")


if __name__ == "__main__":
    import sys

    upgrade() if "--upgrade" in sys.argv else main()
