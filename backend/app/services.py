"""Business logic shared by the routers: availability, ratings, and serializers."""

from datetime import date, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from . import schemas
from .models import AppSetting, Blackout, Booking, BookingStatus, Item, Review, Review_, User

# ---------- availability ----------


def _overlaps(start_col, end_col, start: date, end: date):
    # Inclusive ranges [a, b] and [c, d] overlap when a <= d and c <= b.
    return (start_col <= end) & (end_col >= start)


def conflicts(
    db: Session, item_id: int, start: date, end: date, exclude_booking_id: int | None = None
) -> list[str]:
    """Reasons the range can't be booked: accepted bookings and owner blackouts block it."""
    reasons = []
    q = select(Booking.id).where(
        Booking.item_id == item_id,
        Booking.status.in_([BookingStatus.ACCEPTED, BookingStatus.COMPLETED]),
        _overlaps(Booking.start_date, Booking.end_date, start, end),
    )
    if exclude_booking_id:
        q = q.where(Booking.id != exclude_booking_id)
    if db.scalars(q).first():
        reasons.append("Already booked for some of those days")
    if db.scalars(
        select(Blackout.id).where(
            Blackout.item_id == item_id, _overlaps(Blackout.start_date, Blackout.end_date, start, end)
        )
    ).first():
        reasons.append("The owner has blocked some of those days")
    return reasons


def calendar(db: Session, item_id: int, start: date, end: date) -> schemas.CalendarOut:
    ranges: list[schemas.CalendarRange] = []
    bookings = db.scalars(
        select(Booking).where(
            Booking.item_id == item_id,
            Booking.status.in_([BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.COMPLETED]),
            _overlaps(Booking.start_date, Booking.end_date, start, end),
        )
    ).all()
    for b in bookings:
        kind = "pending" if b.status == BookingStatus.PENDING else "booked"
        ranges.append(schemas.CalendarRange(start_date=b.start_date, end_date=b.end_date, kind=kind, id=b.id))
    for bo in db.scalars(
        select(Blackout).where(
            Blackout.item_id == item_id, _overlaps(Blackout.start_date, Blackout.end_date, start, end)
        )
    ).all():
        ranges.append(
            schemas.CalendarRange(
                start_date=bo.start_date, end_date=bo.end_date, kind="blocked", id=bo.id, note=bo.note
            )
        )

    blocked: set[date] = set()
    for r in ranges:
        if r.kind == "pending":
            continue
        d = max(r.start_date, start)
        while d <= min(r.end_date, end):
            blocked.add(d)
            d += timedelta(days=1)
    ranges.sort(key=lambda r: r.start_date)
    return schemas.CalendarOut(
        item_id=item_id, start=start, end=end, ranges=ranges, unavailable_days=sorted(blocked)
    )


def auto_complete_finished(db: Session) -> None:
    """Accepted rentals whose last day has passed become 'completed' (which unlocks reviews)."""
    db.execute(
        update(Booking)
        .where(Booking.status == BookingStatus.ACCEPTED, Booking.end_date < date.today())
        .values(status=BookingStatus.COMPLETED)
    )
    increment_rental_counts(db)
    db.commit()


# ---------- admin settings ----------

DEFAULT_SETTINGS = {"approve_users": "1", "approve_listings": "1", "platform_fee_percent": "10", "club_discount_percent": "10"}


def get_setting(db: Session, key: str) -> bool:
    row = db.get(AppSetting, key)
    return DEFAULT_SETTINGS.get(key, "0") == "1" if row is None else row.value == "1"


def get_setting_str(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    return DEFAULT_SETTINGS.get(key, "") if row is None else row.value


def set_setting(db: Session, key: str, value: bool) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value="1" if value else "0"))
    else:
        row.value = "1" if value else "0"


def set_setting_str(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def club_discount_percent(db: Session) -> float:
    return float(get_setting_str(db, "club_discount_percent"))


def is_club_member(user: User) -> bool:
    return user.rental_count >= 5


def apply_club_discount(subtotal: float, user: User, db: Session) -> tuple[float, float]:
    """Returns (discount_amount, discounted_total)."""
    if is_club_member(user):
        pct = club_discount_percent(db)
        discount = round(subtotal * pct / 100, 2)
        return discount, round(subtotal - discount, 2)
    return 0.0, subtotal


def increment_rental_counts(db: Session) -> None:
    """After bookings move to COMPLETED, bump each renter's rental_count."""
    completed = db.execute(
        select(Booking.renter_id, func.count(Booking.id)).where(
            Booking.status == BookingStatus.COMPLETED
        ).group_by(Booking.renter_id)
    ).all()
    for renter_id, cnt in completed:
        user = db.get(User, renter_id)
        if user:
            user.rental_count = cnt


# ---------- location privacy ----------

APPROX_GRID = 0.005  # ~550 m: enough to see the neighbourhood, not the front door


def can_see_exact_location(db: Session, item: Item, viewer: User | None) -> bool:
    if viewer is None:
        return False
    if viewer.id == item.owner_id or viewer.is_admin:
        return True
    return (
        db.scalar(
            select(Booking.id).where(
                Booking.item_id == item.id,
                Booking.renter_id == viewer.id,
                Booking.status.in_([BookingStatus.ACCEPTED, BookingStatus.COMPLETED]),
            )
        )
        is not None
    )


def location_out(db: Session, item: Item, viewer: User | None) -> schemas.LocationOut | None:
    if item.lat is None or item.lng is None:
        return None
    if can_see_exact_location(db, item, viewer):
        return schemas.LocationOut(label=item.location_label, lat=item.lat, lng=item.lng, exact=True)
    snap = lambda v: round(round(v / APPROX_GRID) * APPROX_GRID, 4)  # noqa: E731
    # Only the area name (the part after the first comma) is public, never the street address.
    area = item.location_label.split(",", 1)[-1].strip() if "," in item.location_label else item.neighborhood
    return schemas.LocationOut(label=area or item.neighborhood, lat=snap(item.lat), lng=snap(item.lng), exact=False)


# ---------- ratings ----------


def user_rating(db: Session, user_id: int) -> tuple[float | None, int]:
    avg, count = db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(Review.reviewee_id == user_id)
    ).one()
    return (round(avg, 2) if avg is not None else None, count)


def item_rating(db: Session, item_id: int) -> tuple[float | None, int]:
    avg, count = db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(
            Review.item_id == item_id, Review.direction == "renter_to_owner"
        )
    ).one()
    return (round(avg, 2) if avg is not None else None, count)


# ---------- serializers ----------


def user_out(db: Session, user: User) -> schemas.UserOut:
    avg, count = user_rating(db, user.id)
    return schemas.UserOut(
        id=user.id,
        name=user.name,
        neighborhood=user.neighborhood,
        avatar_url=user.avatar_url,
        bio=user.bio,
        created_at=user.created_at,
        rating_avg=avg,
        rating_count=count,
    )


def me_out(db: Session, user: User) -> schemas.MeOut:
    listings = db.scalar(select(func.count(Item.id)).where(Item.owner_id == user.id, Item.is_active.is_(True)))
    rentals = db.scalar(
        select(func.count(Booking.id)).where(Booking.renter_id == user.id, Booking.status == BookingStatus.COMPLETED)
    )
    lendings = db.scalar(
        select(func.count(Booking.id))
        .join(Item)
        .where(Item.owner_id == user.id, Booking.status == BookingStatus.COMPLETED)
    )
    return schemas.MeOut(
        **user_out(db, user).model_dump(),
        email=user.email,
        is_admin=user.is_admin,
        approval_status=user.approval_status,
        approval_note=user.approval_note,
        listings_count=listings or 0,
        rentals_count=rentals or 0,
        lendings_count=lendings or 0,
        club_member=is_club_member(user),
    )


def item_out(db: Session, item: Item, viewer: User | None = None) -> schemas.ItemOut:
    avg, count = item_rating(db, item.id)
    return schemas.ItemOut(
        id=item.id,
        title=item.title,
        description=item.description,
        category=item.category,
        price_per_day=item.price_per_day,
        deposit=item.deposit,
        neighborhood=item.neighborhood,
        cover_url=item.cover_url,
        is_active=item.is_active,
        created_at=item.created_at,
        owner=user_out(db, item.owner),
        photos=[schemas.PhotoOut.model_validate(p) for p in item.photos],
        spin_frames=[f.url for f in item.spin_frames],
        has_360=bool(item.spin_frames),
        rating_avg=avg,
        rating_count=count,
        location=location_out(db, item, viewer),
        review_status=item.review_status,
        review_note=item.review_note,
    )


def item_brief(db: Session, item: Item) -> schemas.ItemBrief:
    avg, count = item_rating(db, item.id)
    return schemas.ItemBrief(
        id=item.id,
        title=item.title,
        category=item.category,
        price_per_day=item.price_per_day,
        neighborhood=item.neighborhood,
        cover_url=item.cover_url,
        has_360=bool(item.spin_frames),
        rating_avg=avg,
        rating_count=count,
        owner_id=item.owner_id,
        owner_name=item.owner.name,
        location_label=location_out(db, item, None).label if item.lat is not None else item.neighborhood,
    )


def booking_out(db: Session, booking: Booking, me: User) -> schemas.BookingOut:
    role = "owner" if booking.item.owner_id == me.id else "renter"
    reviewed = any(r.reviewer_id == me.id for r in booking.reviews)
    subtotal = round(booking.days * booking.item.price_per_day, 2)
    club_discount = round(max(0.0, subtotal - booking.total_price), 2)
    return schemas.BookingOut(
        id=booking.id,
        item=item_brief(db, booking.item),
        renter=user_out(db, booking.renter),
        owner=user_out(db, booking.item.owner),
        start_date=booking.start_date,
        end_date=booking.end_date,
        days=booking.days,
        total_price=booking.total_price,
        platform_fee=booking.platform_fee,
        owner_payout=booking.owner_payout,
        club_discount=club_discount,
        status=booking.status,
        message=booking.message,
        created_at=booking.created_at,
        role=role,
        can_review=booking.status == BookingStatus.COMPLETED and not reviewed,
        reviewed_by_me=reviewed,
    )
