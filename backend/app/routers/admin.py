"""Admin API: dashboard numbers, moderation of users/listings/bookings/reviews, and the support inbox.

Every write is recorded in the `admin_actions` audit log.
"""

import json
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import ai, chat, discounts, payments, schemas, services, verification
from ..database import get_db
from ..deps import require_admin
from ..models import AdminAction, Booking, BookingStatus, ContactMessage, DiscountCode, FeePeriod, IdStatus, Item, Promotion, Review, Review_, SpinFrame, User
from ..realtime import push_notification

router = APIRouter(prefix="/admin", tags=["admin"])


def _log(db: Session, admin: User, action: str, target_type: str, target_id: int, summary: str, reason: str = ""):
    db.add(
        AdminAction(
            admin_id=admin.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            summary=summary[:200],
            reason=(reason or "")[:300],
        )
    )


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ActionOut(BaseModel):
    id: int
    action: str
    target_type: str
    target_id: int
    summary: str
    reason: str
    admin_name: str
    created_at: datetime


class DayCount(BaseModel):
    date: date
    count: int


class StatsOut(BaseModel):
    users: int
    new_users_7d: int
    suspended_users: int
    admins: int
    listings_active: int
    listings_hidden: int
    listings_with_360: int
    bookings: dict[str, int]
    bookings_total: int
    revenue_completed: float
    revenue_upcoming: float
    platform_fees_completed: float
    platform_fees_upcoming: float
    discounts_given: float = 0  # paid by Rentify on pending/accepted/completed bookings
    reviews: int
    avg_rating: float | None
    open_messages: int
    pending_users: int
    pending_ids: int = 0
    pending_listings: int
    pending_promotions: int = 0
    bookings_per_day: list[DayCount]
    recent_actions: list[ActionOut]


class AdminUserOut(BaseModel):
    id: int
    name: str
    email: str
    neighborhood: str
    avatar_url: str | None
    created_at: datetime
    is_admin: bool
    is_suspended: bool
    suspended_reason: str
    approval_status: str
    approval_note: str
    bio: str
    listings_count: int
    bookings_count: int
    rating_avg: float | None
    rating_count: int
    id_status: str = "none"
    rental_count: int = 0
    club_member: bool = False
    club_granted: bool = False


class AdminUserPatch(BaseModel):
    is_suspended: bool | None = None
    is_admin: bool | None = None
    approval_status: Literal["approved", "rejected", "pending"] | None = None
    club_granted: bool | None = None
    reason: str = Field(default="", max_length=200)


class AdminItemOut(BaseModel):
    id: int
    title: str
    category: str
    price_per_day: float
    cover_url: str | None
    is_active: bool
    has_360: bool
    owner_id: int
    owner_name: str
    owner_email: str
    owner_suspended: bool
    owner_approval: str
    bookings_count: int
    rating_avg: float | None
    rating_count: int
    created_at: datetime
    description: str
    deposit: float
    photos: list[str]
    spin_frames: int
    review_status: str
    review_note: str
    location_label: str
    lat: float | None
    lng: float | None
    ai_check: dict | None = None  # see app/ai.py Precheck (or {"error": ...})


class AdminItemPatch(BaseModel):
    is_active: bool | None = None
    review_status: Literal["approved", "rejected", "pending"] | None = None
    reason: str = Field(default="", max_length=300)


class AdminHandoverPhoto(BaseModel):
    stage: str  # pickup | return
    url: str
    uploader_name: str
    uploader_role: str  # renter | owner
    created_at: datetime


class AdminBookingOut(BaseModel):
    id: int
    item_id: int
    item_title: str
    cover_url: str | None
    renter_id: int
    renter_name: str
    owner_id: int
    owner_name: str
    start_date: date
    end_date: date
    days: int
    total_price: float  # what the renter pays
    platform_fee: float  # kept by Rentify
    owner_payout: float  # what the owner receives
    status: str
    message: str
    created_at: datetime
    payment_method: str = "cash"
    payment_status: str = "cash_due"
    paid_at: datetime | None = None
    discount_code: str = ""
    discount_amount: float = 0  # paid by Rentify
    handover_photos: list[AdminHandoverPhoto] = []  # condition at pick-up / return, for disputes


class ReasonIn(BaseModel):
    reason: str = Field(default="", max_length=300)


class AdminReviewOut(BaseModel):
    id: int
    booking_id: int
    item_id: int
    item_title: str
    direction: str
    rating: int
    comment: str
    reviewer: schemas.UserBrief
    reviewee_name: str
    created_at: datetime


class AdminMessageOut(BaseModel):
    id: int
    user_id: int | None
    name: str
    email: str
    topic: str
    message: str
    booking_id: int | None
    status: str
    admin_note: str
    created_at: datetime
    resolved_at: datetime | None


class AdminMessagePatch(BaseModel):
    status: Literal["open", "resolved"] | None = None
    admin_note: str | None = Field(default=None, max_length=5000)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


def _actions(db: Session, limit: int) -> list[ActionOut]:
    rows = db.scalars(select(AdminAction).order_by(AdminAction.created_at.desc(), AdminAction.id.desc()).limit(limit)).all()
    return [
        ActionOut(
            id=a.id,
            action=a.action,
            target_type=a.target_type,
            target_id=a.target_id,
            summary=a.summary,
            reason=a.reason,
            admin_name=a.admin.name if a.admin else "Deleted admin",
            created_at=a.created_at,
        )
        for a in rows
    ]


@router.get("/stats", response_model=StatsOut)
def stats(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    services.auto_complete_finished(db)
    count = lambda stmt: db.scalar(stmt) or 0  # noqa: E731
    by_status = dict(db.execute(select(Booking.status, func.count(Booking.id)).group_by(Booking.status)).all())
    for st in ("pending", "accepted", "declined", "cancelled", "completed"):
        by_status.setdefault(st, 0)

    today = date.today()
    start = today - timedelta(days=13)
    per_day_rows = dict(
        db.execute(
            select(func.date(Booking.created_at), func.count(Booking.id))
            .where(func.date(Booking.created_at) >= start.isoformat())
            .group_by(func.date(Booking.created_at))
        ).all()
    )
    per_day = [
        DayCount(date=start + timedelta(days=i), count=per_day_rows.get((start + timedelta(days=i)).isoformat(), 0))
        for i in range(14)
    ]
    avg = db.scalar(select(func.avg(Review.rating)))
    with_360 = count(
        select(func.count(func.distinct(SpinFrame.item_id))).join(Item, Item.id == SpinFrame.item_id).where(Item.is_active.is_(True))
    )

    return StatsOut(
        users=count(select(func.count(User.id))),
        new_users_7d=count(select(func.count(User.id)).where(User.created_at >= datetime.utcnow() - timedelta(days=7))),
        suspended_users=count(select(func.count(User.id)).where(User.is_suspended.is_(True))),
        admins=count(select(func.count(User.id)).where(User.is_admin.is_(True))),
        listings_active=count(
            select(func.count(Item.id)).where(Item.is_active.is_(True), Item.review_status == Review_.APPROVED)
        ),
        listings_hidden=count(select(func.count(Item.id)).where(Item.is_active.is_(False))),
        listings_with_360=with_360,
        bookings=by_status,
        bookings_total=sum(by_status.values()),
        revenue_completed=float(
            db.scalar(select(func.coalesce(func.sum(Booking.total_price), 0)).where(Booking.status == BookingStatus.COMPLETED))
        ),
        revenue_upcoming=float(
            db.scalar(select(func.coalesce(func.sum(Booking.total_price), 0)).where(Booking.status == BookingStatus.ACCEPTED))
        ),
        platform_fees_completed=float(
            db.scalar(select(func.coalesce(func.sum(Booking.platform_fee), 0)).where(Booking.status == BookingStatus.COMPLETED))
        ),
        platform_fees_upcoming=float(
            db.scalar(select(func.coalesce(func.sum(Booking.platform_fee), 0)).where(Booking.status == BookingStatus.ACCEPTED))
        ),
        reviews=count(select(func.count(Review.id))),
        avg_rating=round(avg, 2) if avg is not None else None,
        open_messages=count(select(func.count(ContactMessage.id)).where(ContactMessage.status == "open")),
        pending_users=count(select(func.count(User.id)).where(User.approval_status == Review_.PENDING)),
        pending_ids=count(select(func.count(User.id)).where(User.id_status == IdStatus.PENDING)),
        pending_listings=count(select(func.count(Item.id)).where(Item.review_status == Review_.PENDING)),
        discounts_given=float(
            db.scalar(
                select(func.coalesce(func.sum(Booking.discount_amount), 0)).where(
                    Booking.status.in_((BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.COMPLETED))
                )
            )
        ),
        pending_promotions=count(select(func.count(Promotion.id)).where(Promotion.status == "pending")),
        bookings_per_day=per_day,
        recent_actions=_actions(db, 8),
    )


@router.get("/actions", response_model=list[ActionOut])
def actions(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return _actions(db, 200)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def _user_out(db: Session, u: User) -> AdminUserOut:
    avg, n = services.user_rating(db, u.id)
    return AdminUserOut(
        id=u.id,
        name=u.name,
        email=u.email,
        neighborhood=u.neighborhood,
        avatar_url=u.avatar_url,
        created_at=u.created_at,
        is_admin=u.is_admin,
        is_suspended=u.is_suspended,
        suspended_reason=u.suspended_reason,
        approval_status=u.approval_status,
        approval_note=u.approval_note,
        bio=u.bio,
        listings_count=db.scalar(select(func.count(Item.id)).where(Item.owner_id == u.id)) or 0,
        bookings_count=db.scalar(select(func.count(Booking.id)).where(Booking.renter_id == u.id)) or 0,
        rating_avg=avg,
        rating_count=n,
        id_status=u.id_status,
        rental_count=u.rental_count or 0,
        club_member=u.club_member,
        club_granted=bool(u.club_granted),
    )


@router.get("/users", response_model=list[AdminUserOut])
def users(
    q: str | None = None,
    filter: Literal["all", "pending", "admins", "suspended", "rejected"] = "all",
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(User).order_by(User.created_at.desc()).limit(300)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.name.ilike(like), User.email.ilike(like), User.neighborhood.ilike(like)))
    if filter == "admins":
        stmt = stmt.where(User.is_admin.is_(True))
    elif filter == "suspended":
        stmt = stmt.where(User.is_suspended.is_(True))
    elif filter in ("pending", "rejected"):
        stmt = stmt.where(User.approval_status == filter)
    return [_user_out(db, u) for u in db.scalars(stmt).all()]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(user_id: int, body: AdminUserPatch, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if u.id == admin.id and (body.is_suspended or body.is_admin is False):
        raise HTTPException(400, "You can’t suspend yourself or remove your own admin rights")

    if body.is_suspended is not None and body.is_suspended != u.is_suspended:
        u.is_suspended = body.is_suspended
        if body.is_suspended:
            u.suspended_reason = body.reason
            # Open requests involving them can't go ahead.
            for b in db.scalars(
                select(Booking)
                .join(Item)
                .where(
                    or_(Booking.renter_id == u.id, Item.owner_id == u.id),
                    Booking.status == BookingStatus.PENDING,
                )
            ):
                b.status = BookingStatus.CANCELLED
            _log(db, admin, "suspend_user", "user", u.id, u.name, body.reason)
        else:
            u.suspended_reason = ""
            _log(db, admin, "reinstate_user", "user", u.id, u.name, body.reason)

    if body.approval_status and body.approval_status != u.approval_status:
        u.approval_status = body.approval_status
        u.approval_note = body.reason if body.approval_status == Review_.REJECTED else ""
        action = {"approved": "approve_user", "rejected": "reject_user", "pending": "reopen_user"}[body.approval_status]
        _log(db, admin, action, "user", u.id, u.name, body.reason)

    if body.is_admin is not None and body.is_admin != u.is_admin:
        u.is_admin = body.is_admin
        _log(db, admin, "grant_admin" if body.is_admin else "revoke_admin", "user", u.id, u.name, body.reason)
        verification.auto_verify(u)  # new admins get the verified badge automatically

    if body.club_granted is not None and body.club_granted != bool(u.club_granted):
        was_member = u.club_member
        u.club_granted = body.club_granted
        _log(db, admin, "grant_club" if body.club_granted else "revoke_club", "user", u.id, u.name, body.reason)
        if u.club_member and not was_member:
            n = chat.notify(db, u.id, "club_joined", "Welcome to the Rent Club 🎉",
                            f"You’ve been made a member: the gold badge and the members’ chat.")
            db.commit()
            push_notification(u.id, chat.notification_out(n))

    db.commit()
    return _user_out(db, u)


# ---------------------------------------------------------------------------
# Listings
# ---------------------------------------------------------------------------


def _item_out(db: Session, i: Item) -> AdminItemOut:
    avg, n = services.item_rating(db, i.id)
    return AdminItemOut(
        id=i.id,
        title=i.title,
        category=i.category,
        price_per_day=i.price_per_day,
        cover_url=i.cover_url,
        is_active=i.is_active,
        has_360=bool(i.spin_frames),
        owner_id=i.owner_id,
        owner_name=i.owner.name,
        owner_email=i.owner.email,
        owner_suspended=i.owner.is_suspended,
        owner_approval=i.owner.approval_status,
        description=i.description,
        deposit=i.deposit,
        photos=[ph.url for ph in i.photos],
        spin_frames=len(i.spin_frames),
        review_status=i.review_status,
        review_note=i.review_note,
        location_label=i.location_label,
        lat=i.lat,
        lng=i.lng,
        ai_check=json.loads(i.ai_check) if i.ai_check else None,
        bookings_count=db.scalar(select(func.count(Booking.id)).where(Booking.item_id == i.id)) or 0,
        rating_avg=avg,
        rating_count=n,
        created_at=i.created_at,
    )


@router.get("/items", response_model=list[AdminItemOut])
def items(
    q: str | None = None,
    status: Literal["all", "active", "hidden", "pending", "rejected"] = "all",
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(Item).join(User, Item.owner_id == User.id).order_by(Item.created_at.desc()).limit(300)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Item.title.ilike(like), Item.description.ilike(like), User.name.ilike(like)))
    if status == "active":
        stmt = stmt.where(Item.is_active.is_(True), Item.review_status == Review_.APPROVED)
    elif status == "hidden":
        stmt = stmt.where(Item.is_active.is_(False))
    elif status in ("pending", "rejected"):
        stmt = stmt.where(Item.review_status == status)
    return [_item_out(db, i) for i in db.scalars(stmt).all()]


@router.patch("/items/{item_id}", response_model=AdminItemOut)
def update_item(item_id: int, body: AdminItemPatch, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    i = db.get(Item, item_id)
    if not i:
        raise HTTPException(404, "Listing not found")
    if body.is_active is not None and i.is_active != body.is_active:
        i.is_active = body.is_active
        _log(db, admin, "restore_item" if body.is_active else "hide_item", "item", i.id, i.title, body.reason)
    if body.review_status and body.review_status != i.review_status:
        i.review_status = body.review_status
        i.review_note = body.reason if body.review_status == Review_.REJECTED else ""
        action = {"approved": "approve_item", "rejected": "reject_item", "pending": "reopen_item"}[body.review_status]
        _log(db, admin, action, "item", i.id, i.title, body.reason)
    db.commit()
    return _item_out(db, i)


@router.post("/items/{item_id}/ai-check", response_model=AdminItemOut)
def run_ai_check(item_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Run (or re-run) the AI pre-check now (free with Gemini/Groq; ~$0.001 with Claude Haiku)."""
    i = db.get(Item, item_id)
    if not i:
        raise HTTPException(404, "Listing not found")
    if not ai.enabled():
        raise HTTPException(503, "AI isn’t set up on this server yet (add GEMINI_API_KEY to backend/.env).")
    i.ai_check = json.dumps(ai.precheck_payload(i))
    db.commit()
    return _item_out(db, i)


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------


def _booking_out(b: Booking) -> AdminBookingOut:
    return AdminBookingOut(
        id=b.id,
        item_id=b.item_id,
        item_title=b.item.title,
        cover_url=b.item.cover_url,
        renter_id=b.renter_id,
        renter_name=b.renter.name,
        owner_id=b.item.owner_id,
        owner_name=b.item.owner.name,
        start_date=b.start_date,
        discount_code=b.discount_code or "",
        discount_amount=b.discount_amount or 0,
        end_date=b.end_date,
        days=b.days,
        total_price=b.total_price,
        platform_fee=b.platform_fee or 0,
        owner_payout=b.owner_payout or 0,
        status=b.status,
        message=b.message,
        created_at=b.created_at,
        payment_method=b.payment_method,
        payment_status=b.payment_status,
        paid_at=b.paid_at,
        handover_photos=[
            AdminHandoverPhoto(
                stage=p.stage,
                url=p.url,
                uploader_name=b.renter.name if p.uploader_id == b.renter_id else b.item.owner.name,
                uploader_role="renter" if p.uploader_id == b.renter_id else "owner",
                created_at=p.created_at,
            )
            for p in b.handover_photos
        ],
    )


@router.get("/bookings", response_model=list[AdminBookingOut])
def bookings(
    status: str | None = None,
    q: str | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    services.auto_complete_finished(db)
    stmt = select(Booking).join(Item).order_by(Booking.created_at.desc()).limit(300)
    if status and status != "all":
        stmt = stmt.where(Booking.status == status)
    if q:
        stmt = stmt.where(Item.title.ilike(f"%{q.strip()}%"))
    return [_booking_out(b) for b in db.scalars(stmt).all()]


@router.post("/bookings/{booking_id}/cancel", response_model=AdminBookingOut)
def cancel_booking(booking_id: int, body: ReasonIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Booking not found")
    if b.status not in (BookingStatus.PENDING, BookingStatus.ACCEPTED):
        raise HTTPException(400, f"Booking is already {b.status}")
    refunded = payments.refund_if_paid(b)
    b.status = BookingStatus.CANCELLED
    _log(db, admin, "cancel_booking", "booking", b.id, f"{b.item.title} · {b.renter.name}" + (" · refunded" if refunded else ""), body.reason)
    db.commit()
    return _booking_out(b)


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------


@router.get("/reviews", response_model=list[AdminReviewOut])
def reviews(
    max_rating: int | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(Review).order_by(Review.created_at.desc()).limit(300)
    if max_rating:
        stmt = stmt.where(Review.rating <= max_rating)
    out = []
    for r in db.scalars(stmt).all():
        reviewee = db.get(User, r.reviewee_id)
        item = db.get(Item, r.item_id)
        out.append(
            AdminReviewOut(
                id=r.id,
                booking_id=r.booking_id,
                item_id=r.item_id,
                item_title=item.title if item else "Deleted listing",
                direction=r.direction,
                rating=r.rating,
                comment=r.comment,
                reviewer=schemas.UserBrief.model_validate(r.reviewer),
                reviewee_name=reviewee.name if reviewee else "Deleted user",
                created_at=r.created_at,
            )
        )
    return out


@router.delete("/reviews/{review_id}", status_code=204)
def delete_review(review_id: int, reason: str = "", admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(Review, review_id)
    if not r:
        raise HTTPException(404, "Review not found")
    _log(db, admin, "remove_review", "review", r.id, f"{r.rating}★ by {r.reviewer.name}", reason)
    db.delete(r)
    db.commit()


# ---------------------------------------------------------------------------
# Support inbox
# ---------------------------------------------------------------------------


@router.get("/messages", response_model=list[AdminMessageOut])
def messages(
    status: Literal["open", "resolved", "all"] = "open",
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(300)
    if status != "all":
        stmt = stmt.where(ContactMessage.status == status)
    return [AdminMessageOut.model_validate(m, from_attributes=True) for m in db.scalars(stmt).all()]


@router.patch("/messages/{message_id}", response_model=AdminMessageOut)
def update_message(
    message_id: int, body: AdminMessagePatch, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    m = db.get(ContactMessage, message_id)
    if not m:
        raise HTTPException(404, "Message not found")
    if body.admin_note is not None:
        m.admin_note = body.admin_note
    if body.status and body.status != m.status:
        m.status = body.status
        m.resolved_at = datetime.utcnow() if body.status == "resolved" else None
        _log(db, admin, "resolve_message" if body.status == "resolved" else "reopen_message", "message", m.id, f"{m.topic} from {m.name or m.email}")
    db.commit()
    return AdminMessageOut.model_validate(m, from_attributes=True)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingsOut(BaseModel):
    approve_users: bool
    approve_listings: bool
    require_id: bool
    platform_fee_percent: int


class SettingsPatch(BaseModel):
    approve_users: bool | None = None
    approve_listings: bool | None = None
    require_id: bool | None = None
    platform_fee_percent: int | None = None


@router.get("/settings", response_model=SettingsOut)
def get_settings(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return SettingsOut(
        approve_users=services.get_setting(db, "approve_users"),
        approve_listings=services.get_setting(db, "approve_listings"),
        require_id=services.get_setting(db, "require_id"),
        platform_fee_percent=int(services.get_setting_str(db, "platform_fee_percent")),
    )


@router.patch("/settings", response_model=SettingsOut)
def update_settings(body: SettingsPatch, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "platform_fee_percent":
            if services.get_setting_str(db, k) != str(v):
                services.set_setting_str(db, k, str(v))
                _log(db, admin, "change_setting", "setting", 0, f"{k} = {v}")
        elif services.get_setting(db, k) != v:
            services.set_setting(db, k, v)
            _log(db, admin, "change_setting", "setting", 0, f"{k} = {'on' if v else 'off'}")
    db.commit()
    return get_settings(admin, db)


# ---------------------------------------------------------------------------
# Fee periods (special service fee on chosen dates)
# ---------------------------------------------------------------------------


class FeePeriodIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    start_date: date
    end_date: date
    fee_percent: float = Field(ge=0, le=100)
    yearly: bool = False


class FeePeriodOut(FeePeriodIn):
    id: int
    active: bool
    days: int


def _period_out(p: FeePeriod) -> FeePeriodOut:
    return FeePeriodOut(id=p.id, name=p.name, start_date=p.start_date, end_date=p.end_date, fee_percent=p.fee_percent,
                        yearly=p.yearly, active=services.period_covers(p, date.today()), days=services.period_length(p))


def _check_period(body: FeePeriodIn) -> None:
    # A yearly period may wrap the new year (Dec 20 – Jan 5); a one-off one may not end before it starts.
    if not body.yearly and body.end_date < body.start_date:
        raise HTTPException(400, "The end date is before the start date")


def _pct(v: float) -> str:
    return f"{v:g}%"


@router.get("/fee-periods", response_model=list[FeePeriodOut])
def fee_periods(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(FeePeriod).order_by(FeePeriod.yearly.desc(), FeePeriod.start_date)).all()
    return [_period_out(p) for p in rows]


@router.get("/fee-periods/quote")
def fee_quote(start: date, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Which fee a booking starting on `start` would get."""
    pct, label = services.fee_for(db, start)
    return {"date": start, "fee_percent": pct, "label": label, "base_fee_percent": services.base_fee_percent(db)}


@router.post("/fee-periods", response_model=FeePeriodOut, status_code=201)
def add_fee_period(body: FeePeriodIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    _check_period(body)
    p = FeePeriod(**body.model_dump())
    db.add(p)
    db.flush()
    _log(db, admin, "add_fee_period", "fee_period", p.id, f"{p.name}: {_pct(p.fee_percent)} fee")
    db.commit()
    return _period_out(p)


@router.put("/fee-periods/{period_id}", response_model=FeePeriodOut)
def edit_fee_period(period_id: int, body: FeePeriodIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    p = db.get(FeePeriod, period_id)
    if not p:
        raise HTTPException(404, "Fee period not found")
    _check_period(body)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    _log(db, admin, "change_fee_period", "fee_period", p.id, f"{p.name}: {_pct(p.fee_percent)} fee")
    db.commit()
    return _period_out(p)


@router.delete("/fee-periods/{period_id}", status_code=204)
def delete_fee_period(period_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    p = db.get(FeePeriod, period_id)
    if not p:
        raise HTTPException(404, "Fee period not found")
    _log(db, admin, "delete_fee_period", "fee_period", p.id, p.name)
    db.delete(p)
    db.commit()


# ---------------------------------------------------------------------------
# ID verification
# ---------------------------------------------------------------------------


class VerificationOut(BaseModel):
    user_id: int
    name: str
    email: str
    avatar_url: str | None
    neighborhood: str
    created_at: datetime
    id_status: str
    doc_type: str
    note: str
    submitted_at: datetime | None
    verified_at: datetime | None
    has_front: bool
    has_selfie: bool


class VerificationDecision(BaseModel):
    decision: Literal["verified", "rejected"]
    note: str = Field(default="", max_length=300)


def _verification_out(u: User) -> VerificationOut:
    return VerificationOut(
        user_id=u.id,
        name=u.name,
        email=u.email,
        avatar_url=u.avatar_url,
        neighborhood=u.neighborhood,
        created_at=u.created_at,
        id_status=u.id_status,
        doc_type=u.id_doc_type,
        note=u.id_note,
        submitted_at=u.id_submitted_at,
        verified_at=u.id_verified_at,
        has_front=verification.file_path(u, "front") is not None,
        has_selfie=verification.file_path(u, "selfie") is not None,
    )


@router.get("/verifications", response_model=list[VerificationOut])
def verifications(
    status: Literal["pending", "verified", "rejected", "none", "all"] = "pending",
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(User).where(User.is_admin.is_(False))
    if status != "all":
        stmt = stmt.where(User.id_status == status)
    stmt = stmt.order_by(User.id_submitted_at.desc().nullslast(), User.created_at.desc()).limit(300)
    return [_verification_out(u) for u in db.scalars(stmt).all()]


@router.get("/verifications/{user_id}/{which}")
def verification_image(user_id: int, which: Literal["front", "selfie"], _: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    path = verification.file_path(u, which) if u else None
    if not path:
        raise HTTPException(404, "No image")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store, private"})


@router.post("/verifications/{user_id}", response_model=VerificationOut)
def decide_verification(user_id: int, body: VerificationDecision, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    ok = body.decision == "verified"
    if verification.is_auto_verified(u) and not ok:
        raise HTTPException(400, "Admins and the demo account are verified automatically")
    verification.decide(u, ok, body.note)
    _log(db, admin, "verify_id" if ok else "reject_id", "user", u.id, f"ID {'verified' if ok else 'rejected'}: {u.name}", body.note)
    n = chat.notify(
        db,
        u.id,
        "id_verified" if ok else "id_rejected",
        "Your ID is verified ✓" if ok else "We couldn’t verify your ID",
        "You can now book and list things." if ok else (u.id_note + " Please send new photos from your profile."),
    )
    db.commit()
    push_notification(u.id, chat.notification_out(n))
    return _verification_out(u)


# ---------------------------------------------------------------------------
# Promotions (paid slots in the home slideshow): approve, or reject and refund
# ---------------------------------------------------------------------------


class AdminPromotionOut(BaseModel):
    id: int
    item_id: int
    item_title: str
    item_active: bool
    cover_url: str | None
    price_per_day: float
    owner_id: int
    owner_name: str
    owner_email: str
    days: int
    tagline: str
    amount: float
    status: str
    review_note: str
    payment: str  # "stripe" | "demo"
    created_at: datetime
    paid_at: datetime | None
    decided_at: datetime | None
    live_until: datetime | None  # the item's current slideshow end, if running


class PromotionDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    reason: str = Field(default="", max_length=300)


def _promotion_out(p: Promotion) -> AdminPromotionOut:
    i = p.item
    intent = p.stripe_payment_intent or ""
    return AdminPromotionOut(
        id=p.id,
        item_id=i.id,
        item_title=i.title,
        item_active=i.is_active and i.review_status == Review_.APPROVED,
        cover_url=i.cover_url,
        price_per_day=i.price_per_day,
        owner_id=p.owner_id,
        owner_name=p.owner.name if p.owner else "Deleted user",
        owner_email=p.owner.email if p.owner else "",
        days=p.days,
        tagline=p.tagline,
        amount=p.amount,
        status=p.status,
        review_note=p.review_note,
        payment="stripe" if intent.startswith("pi_") and not intent.startswith("pi_sim_") else "demo",
        created_at=p.created_at,
        paid_at=p.paid_at,
        decided_at=p.decided_at,
        live_until=i.promo_until if services.is_promoted(i) else None,
    )


@router.get("/promotions", response_model=list[AdminPromotionOut])
def promotions(
    status: Literal["pending", "approved", "rejected", "all"] = "pending",
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(Promotion).where(Promotion.status != "unpaid")  # unpaid = checkout abandoned, nothing to review
    if status != "all":
        stmt = stmt.where(Promotion.status == status)
    stmt = stmt.order_by(Promotion.paid_at.asc() if status == "pending" else Promotion.paid_at.desc()).limit(300)
    return [_promotion_out(p) for p in db.scalars(stmt).all()]


@router.post("/promotions/{promotion_id}", response_model=AdminPromotionOut)
def decide_promotion(promotion_id: int, body: PromotionDecision, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    p = db.get(Promotion, promotion_id)
    if not p:
        raise HTTPException(404, "Promotion not found")
    if p.status != "pending":
        raise HTTPException(400, f"This promotion is already {p.status}")
    title = p.item.title
    if body.decision == "approved":
        services.approve_promotion(p)
        _log(db, admin, "approve_promotion", "item", p.item_id, f"{title} · {p.days} days · {services.money(p.amount)}", body.reason)
        n = chat.notify(db, p.owner_id, "promotion_approved", "Your promotion is live",
                        f"{title} is in the Home slideshow for {p.days} days.")
    else:
        if not body.reason.strip():
            raise HTTPException(400, "Write why, so the owner knows what to change")
        payments.refund_promotion(p)  # raises (and keeps it pending) if Stripe can't refund
        p.status = "rejected"
        p.decided_at = datetime.utcnow()
        p.review_note = body.reason.strip()
        _log(db, admin, "reject_promotion", "item", p.item_id, f"{title} · refunded {services.money(p.amount)}", body.reason)
        n = chat.notify(db, p.owner_id, "promotion_rejected", "Promotion not approved",
                        f"{title}: {p.review_note} You were refunded {services.money(p.amount)}.")
    n.item_id = p.item_id
    db.commit()
    push_notification(p.owner_id, chat.notification_out(n))
    return _promotion_out(p)


# ---------------------------------------------------------------------------
# Discount codes (renters type them when booking; Rentify pays the discount)
# ---------------------------------------------------------------------------


class DiscountCodeIn(BaseModel):
    code: str = Field(min_length=3, max_length=30)
    label: str = Field(default="", max_length=60)
    percent_off: float = Field(gt=0, le=90)
    max_off: float = Field(default=0, ge=0)
    min_total: float = Field(default=0, ge=0)
    starts_on: date
    ends_on: date
    max_uses: int = Field(default=0, ge=0)
    once_per_user: bool = True
    is_active: bool = True
    featured: bool = False


class DiscountCodeOut(DiscountCodeIn):
    id: int
    uses: int
    given: float  # euros off so far (live bookings)
    status: Literal["live", "scheduled", "ended", "paused", "used_up"]
    created_at: datetime


def _code_out(db: Session, d: DiscountCode) -> DiscountCodeOut:
    n = discounts.uses(db, d)
    given = db.scalar(
        select(func.coalesce(func.sum(Booking.discount_amount), 0)).where(
            Booking.discount_code == d.code, Booking.status.in_((BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.COMPLETED))
        )
    )
    today = date.today()
    status = (
        "paused" if not d.is_active
        else "ended" if today > d.ends_on
        else "used_up" if d.max_uses and n >= d.max_uses
        else "scheduled" if today < d.starts_on
        else "live"
    )
    return DiscountCodeOut(
        id=d.id, code=d.code, label=d.label, percent_off=d.percent_off, max_off=d.max_off, min_total=d.min_total,
        starts_on=d.starts_on, ends_on=d.ends_on, max_uses=d.max_uses, once_per_user=d.once_per_user,
        is_active=d.is_active, featured=d.featured, uses=n, given=float(given or 0), status=status, created_at=d.created_at,
    )


def _check_code(db: Session, body: DiscountCodeIn, exclude_id: int | None = None) -> str:
    code = discounts.normalize(body.code)
    if not discounts.CODE_RE.match(code):
        raise HTTPException(400, "Codes are 3–30 letters, numbers, - or _ (e.g. BLACKFRIDAY)")
    if body.ends_on < body.starts_on:
        raise HTTPException(400, "The end date is before the start date")
    clash = db.scalar(select(DiscountCode).where(DiscountCode.code == code))
    if clash and clash.id != exclude_id:
        raise HTTPException(409, f"{code} already exists")
    return code


def _describe(d: DiscountCode) -> str:
    cap = f", max €{d.max_off:g}" if d.max_off else ""
    return f"{d.code}: {d.percent_off:g}% off{cap}, {d.starts_on:%d %b} – {d.ends_on:%d %b}"


def _only_one_featured(db: Session, d: DiscountCode) -> None:
    if d.featured:
        for other in db.scalars(select(DiscountCode).where(DiscountCode.featured.is_(True), DiscountCode.id != d.id)).all():
            other.featured = False


@router.get("/discount-codes", response_model=list[DiscountCodeOut])
def discount_codes(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.scalars(select(DiscountCode).order_by(DiscountCode.starts_on.desc())).all()
    return [_code_out(db, d) for d in rows]


@router.post("/discount-codes", response_model=DiscountCodeOut, status_code=201)
def add_discount_code(body: DiscountCodeIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    code = _check_code(db, body)
    d = DiscountCode(**{**body.model_dump(), "code": code})
    db.add(d)
    db.flush()
    _only_one_featured(db, d)
    _log(db, admin, "add_discount_code", "discount_code", d.id, _describe(d))
    db.commit()
    return _code_out(db, d)


@router.put("/discount-codes/{code_id}", response_model=DiscountCodeOut)
def edit_discount_code(code_id: int, body: DiscountCodeIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    d = db.get(DiscountCode, code_id)
    if not d:
        raise HTTPException(404, "Code not found")
    code = _check_code(db, body, exclude_id=d.id)
    if code != d.code and discounts.uses(db, d):
        raise HTTPException(400, "This code has been used, so it can’t be renamed. Make a new one instead.")
    for k, v in {**body.model_dump(), "code": code}.items():
        setattr(d, k, v)
    _only_one_featured(db, d)
    _log(db, admin, "change_discount_code", "discount_code", d.id, _describe(d))
    db.commit()
    return _code_out(db, d)


@router.delete("/discount-codes/{code_id}", status_code=204)
def delete_discount_code(code_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    d = db.get(DiscountCode, code_id)
    if not d:
        raise HTTPException(404, "Code not found")
    if discounts.uses(db, d):
        raise HTTPException(400, "This code is on bookings, so it can’t be deleted. Pause it instead.")
    _log(db, admin, "delete_discount_code", "discount_code", d.id, d.code)
    db.delete(d)
    db.commit()
