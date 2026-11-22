"""Business logic shared by the routers: availability, ratings, and serializers."""

from datetime import date, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from . import schemas
from . import city
from .models import CLUB_MIN_RENTALS, AppSetting, Blackout, Booking, BookingStatus, Item, Notification, Promotion, Review, Review_, User

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
    # A finished cash rental was paid at pick-up.
    db.execute(
        update(Booking)
        .where(Booking.status == BookingStatus.COMPLETED, Booking.payment_status == "cash_due")
        .values(payment_status="cash_received")
    )
    increment_rental_counts(db)
    db.commit()


# ---------- admin settings ----------

DEFAULT_SETTINGS = {
    "approve_users": "1",
    "approve_listings": "1",
    "platform_fee_percent": "10",
    # Every user must have a verified ID before they can book or list something.
    "require_id": "1",
}


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


# ---------- service fee (normal + special periods) ----------


def _md(d: date) -> tuple[int, int]:
    return (d.month, d.day)


def period_covers(p: "FeePeriod", d: date) -> bool:
    if not p.yearly:
        return p.start_date <= d <= p.end_date
    s, e, k = _md(p.start_date), _md(p.end_date), _md(d)
    return s <= k <= e if s <= e else (k >= s or k <= e)  # e.g. Dec 20 – Jan 5 wraps the new year


def period_length(p: "FeePeriod") -> int:
    if not p.yearly:
        return (p.end_date - p.start_date).days + 1
    s, e = date(2001, *_md(p.start_date)), date(2001, *_md(p.end_date))  # 2001: not a leap year
    return (e - s).days + 1 if s <= e else 365 - (s - e).days + 1


def base_fee_percent(db: Session) -> float:
    return float(get_setting_str(db, "platform_fee_percent"))


def upcoming_fee_periods(db: Session) -> list[dict]:
    """Special fees that are on now or still to come (yearly ones always), soonest first. For the app."""
    from .models import FeePeriod

    today = date.today()
    out = []
    for p in db.scalars(select(FeePeriod)).all():
        if not p.yearly and p.end_date < today:
            continue
        nxt = p.start_date
        if p.yearly:  # next time it starts (or today, if it's on now)
            nxt = today if period_covers(p, today) else next(today + timedelta(days=i) for i in range(1, 367) if period_covers(p, today + timedelta(days=i)))
        out.append({"name": p.name, "start_date": p.start_date.isoformat(), "end_date": p.end_date.isoformat(),
                    "fee_percent": p.fee_percent, "yearly": p.yearly, "active": period_covers(p, today), "_next": max(nxt, today)})
    out.sort(key=lambda x: x.pop("_next"))
    return out


def fee_for(db: Session, start: date) -> tuple[float, str]:
    """(fee %, period name) for a rental starting on `start`. If periods overlap, the shortest wins,
    so a one-day Black Friday inside a month-long November period still applies."""
    from .models import FeePeriod

    hits = [p for p in db.scalars(select(FeePeriod)).all() if period_covers(p, start)]
    if not hits:
        return base_fee_percent(db), ""
    best = min(hits, key=lambda p: (period_length(p), -p.id))
    return best.fee_percent, best.name


def is_club_member(user: User) -> bool:
    return user.club_member


def lender_status_for_new_request(db: Session) -> str:
    """A lender application waits for an admin when "approve_users" is on, otherwise it's approved at once."""
    return Review_.PENDING if get_setting(db, "approve_users") else Review_.APPROVED


def can_lend(user: User) -> bool:
    return user.is_admin or user.approval_status == Review_.APPROVED


LENDER_BLOCK_MESSAGE = {
    "none": "Your account is set up for renting. Apply to lend from Profile and an admin will review it.",
    "pending": "Your lender application is being reviewed. You can list things as soon as it’s approved.",
    "rejected": "Your lender application wasn’t approved. Contact support for help.",
}


def id_required(db: Session, user: User) -> bool:
    """True when this user still has to verify their ID before booking or listing."""
    return get_setting(db, "require_id") and not user.is_admin and not user.id_verified


ID_BLOCK_MESSAGE = {
    "none": "Please verify your ID first. It takes a minute: Profile → Verify your ID.",
    "pending": "Your ID is being checked. You can continue as soon as it’s verified (usually within a day).",
    "rejected": "Your ID couldn’t be verified. Please send a new photo: Profile → Verify your ID.",
}


def increment_rental_counts(db: Session) -> list[int]:
    """After bookings move to COMPLETED, refresh each renter's rental_count.
    Returns the ids of users who just joined the Rent Club (a welcome notification is stored for them)."""
    db.flush()  # the session doesn't autoflush: make sure just-completed bookings are counted
    completed = db.execute(
        select(Booking.renter_id, func.count(Booking.id)).where(
            Booking.status == BookingStatus.COMPLETED
        ).group_by(Booking.renter_id)
    ).all()
    joined: list[int] = []
    for renter_id, cnt in completed:
        user = db.get(User, renter_id)
        if user:
            was_member = user.club_member
            user.rental_count = cnt
            if user.club_member and not was_member:
                joined.append(user.id)
                db.add(
                    Notification(
                        user_id=user.id,
                        kind="club_joined",
                        title="Welcome to the Rent Club 🎉",
                        body=f"{CLUB_MIN_RENTALS} rentals done! You get the club badge and the members’ chat.",
                    )
                )
    return joined


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
        club_member=user.club_member,
        id_verified=user.id_verified,
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
        rental_count=user.rental_count or 0,
        id_status=user.id_status,
        id_note=user.id_note,
        id_required=get_setting(db, "require_id") and not user.is_admin,
    )


def item_out(db: Session, item: Item, viewer: User | None = None) -> schemas.ItemOut:
    avg, count = item_rating(db, item.id)
    return schemas.ItemOut(
        id=item.id,
        in_home_city=city.item_in_city(item),
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
        promo_until=item.promo_until if is_promoted(item) else None,
        promo_tagline=item.promo_tagline,
        **(dict(zip(("promo_review", "promo_review_note"), promo_review(db, item))) if viewer and viewer.id == item.owner_id else {}),
    )


def is_promoted(item: Item) -> bool:
    return item.promo_until is not None and item.promo_until > datetime.utcnow()


def mark_promotion_paid(p: Promotion, intent: str | None) -> bool:
    """Payment went through: the order now waits for an admin. Returns False if it was already paid."""
    if p.status != "unpaid":
        return False
    p.status = "pending"
    p.stripe_payment_intent = intent
    p.paid_at = datetime.utcnow()
    return True


def approve_promotion(p: Promotion) -> None:
    """Admin approved: put the item in the slideshow. Paid days are added to any time still left."""
    now = datetime.utcnow()
    p.status = "approved"
    p.decided_at = now
    p.review_note = ""
    item = p.item
    start = item.promo_until if item.promo_until and item.promo_until > now else now
    item.promo_until = start + timedelta(days=p.days)
    item.promo_tagline = p.tagline


def promo_review(db: Session, item: Item) -> tuple[str, str]:
    """For the owner: ('pending', '') while a paid order waits for review, ('rejected', note) if the
    latest decision was a rejection, else ('none', '')."""
    last = db.scalars(
        select(Promotion).where(Promotion.item_id == item.id, Promotion.status != "unpaid").order_by(Promotion.paid_at.desc()).limit(1)
    ).first()
    if not last or last.status == "approved":
        return "none", ""
    return last.status, last.review_note


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
        in_home_city=city.item_in_city(item),
    )


def booking_out(db: Session, booking: Booking, me: User) -> schemas.BookingOut:
    role = "owner" if booking.item.owner_id == me.id else "renter"
    reviewed = any(r.reviewer_id == me.id for r in booking.reviews)
    subtotal = round(booking.days * booking.item.price_per_day, 2)
    club_discount = round(max(0.0, subtotal - booking.total_price - (booking.discount_amount or 0)), 2)
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
        discount_code=booking.discount_code or "",
        discount_amount=booking.discount_amount or 0,
        fee_label=booking.fee_label or "",
        status=booking.status,
        message=booking.message,
        created_at=booking.created_at,
        role=role,
        payment_method=booking.payment_method,
        payment_status=booking.payment_status,
        paid_at=booking.paid_at,
        can_review=booking.status == BookingStatus.COMPLETED and not reviewed,
        reviewed_by_me=reviewed,
        handover_photos=[handover_photo_out(p, me) for p in booking.handover_photos],
        can_add_handover=can_add_handover(booking),
    )


# ---------- handover photos (condition at pick-up and return) ----------

HANDOVER_STAGES = ("pickup", "return")
HANDOVER_MAX_PER_STAGE = 6  # per person, per stage
HANDOVER_DELETE_MINUTES = 15  # time to remove a wrong photo; after that it stays as a record


def can_add_handover(b: Booking, today: date | None = None) -> bool:
    """From the day before pick-up until 3 days after the last day (rentals auto-complete the day after)."""
    today = today or date.today()
    return b.status in (BookingStatus.ACCEPTED, BookingStatus.COMPLETED) and (
        b.start_date - timedelta(days=1) <= today <= b.end_date + timedelta(days=3)
    )


def handover_photo_out(p, me: User) -> schemas.HandoverPhotoOut:
    fresh = datetime.utcnow() - p.created_at < timedelta(minutes=HANDOVER_DELETE_MINUTES)
    return schemas.HandoverPhotoOut(
        id=p.id, stage=p.stage, url=p.url, uploader_id=p.uploader_id, created_at=p.created_at,
        can_delete=p.uploader_id == me.id and fresh,
    )


def money(v: float) -> str:
    """€12 or €12.50"""
    return f"€{v:.0f}" if float(v).is_integer() else f"€{v:.2f}"
