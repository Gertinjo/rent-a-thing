from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import chat, payments, schemas, services
from ..database import get_db
from ..deps import get_current_user
from ..models import Booking, BookingStatus, Item, Notification, Review, User
from ..realtime import push_notification

router = APIRouter(tags=["bookings & reviews"])

MAX_RENTAL_DAYS = 60


def _tell(db: Session, user_id: int, kind: str, title: str, body: str, b: Booking) -> None:
    """Store a notification and push it live (if the person is online)."""
    n = chat.notify(db, user_id, kind, title, body, b)
    db.commit()
    push_notification(user_id, chat.notification_out(n))


def _first(name: str) -> str:
    return name.split(" ")[0]


def _get_booking(db: Session, booking_id: int, user: User) -> Booking:
    b = db.get(Booking, booking_id)
    if not b or user.id not in (b.renter_id, b.item.owner_id):
        raise HTTPException(404, "Booking not found")
    return b


@router.post("/bookings", response_model=schemas.BookingOut, status_code=201)
def request_booking(
    body: schemas.BookingCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    item = db.get(Item, body.item_id)
    if not item or not item.is_active or item.owner.is_suspended or item.review_status != "approved":
        raise HTTPException(404, "Item not found")
    if user.approval_status != "approved":
        raise HTTPException(
            403,
            "Your account is still being reviewed. You can book as soon as it’s approved."
            if user.approval_status == "pending"
            else "Your account wasn’t approved, so you can’t book yet. Contact support for help.",
        )
    if services.id_required(db, user):
        raise HTTPException(403, services.ID_BLOCK_MESSAGE.get(user.id_status, services.ID_BLOCK_MESSAGE["none"]))
    if item.owner_id == user.id:
        raise HTTPException(400, "You can't rent your own item")
    if body.start_date < date.today():
        raise HTTPException(400, "Start date is in the past")
    days = (body.end_date - body.start_date).days + 1
    if days > MAX_RENTAL_DAYS:
        raise HTTPException(400, f"Rentals are limited to {MAX_RENTAL_DAYS} days")
    if reasons := services.conflicts(db, item.id, body.start_date, body.end_date):
        raise HTTPException(409, reasons[0])
    dup = db.scalar(
        select(Booking).where(
            Booking.item_id == item.id,
            Booking.renter_id == user.id,
            Booking.status == BookingStatus.PENDING,
            Booking.start_date <= body.end_date,
            Booking.end_date >= body.start_date,
        )
    )
    if dup:
        raise HTTPException(409, "You already have a pending request for those days")
    subtotal = round(days * item.price_per_day, 2)
    discount, total_price = services.apply_club_discount(subtotal, user, db)
    b = Booking(
        item_id=item.id,
        renter_id=user.id,
        start_date=body.start_date,
        end_date=body.end_date,
        total_price=total_price,
        platform_fee=0.0,
        owner_payout=0.0,
        message=body.message.strip(),
        payment_method=body.payment_method,
        payment_status=payments.initial_status(body.payment_method),
    )
    # Apply platform fee (admin keeps a %, owner gets the rest).
    fee_percent = float(services.get_setting_str(db, "platform_fee_percent"))
    b.platform_fee = round(total_price * fee_percent / 100, 2)
    b.owner_payout = round(total_price - b.platform_fee, 2)
    db.add(b)
    db.commit()
    db.refresh(b)
    _tell(db, item.owner_id, "booking_request", f"New request from {_first(user.name)}",
          f"{item.title} · {b.start_date:%b %d} – {b.end_date:%b %d} · {'card' if b.payment_method == 'card' else 'cash on pick-up'}", b)
    return services.booking_out(db, b, user)


@router.get("/bookings", response_model=list[schemas.BookingOut])
def list_bookings(
    role: Literal["renter", "owner", "all"] = "all",
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    services.auto_complete_finished(db)
    stmt = select(Booking).join(Item).order_by(Booking.start_date.desc())
    if role == "renter":
        stmt = stmt.where(Booking.renter_id == user.id)
    elif role == "owner":
        stmt = stmt.where(Item.owner_id == user.id)
    else:
        stmt = stmt.where((Booking.renter_id == user.id) | (Item.owner_id == user.id))
    if status:
        stmt = stmt.where(Booking.status.in_(status.split(",")))
    return [services.booking_out(db, b, user) for b in db.scalars(stmt).all()]


@router.get("/bookings/{booking_id}", response_model=schemas.BookingOut)
def get_booking(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    services.auto_complete_finished(db)
    return services.booking_out(db, _get_booking(db, booking_id, user), user)


@router.post("/bookings/{booking_id}/accept", response_model=schemas.BookingOut)
def accept(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = _get_booking(db, booking_id, user)
    if b.item.owner_id != user.id:
        raise HTTPException(403, "Only the owner can accept")
    if b.status != BookingStatus.PENDING:
        raise HTTPException(400, f"Booking is {b.status}")
    if reasons := services.conflicts(db, b.item_id, b.start_date, b.end_date, exclude_booking_id=b.id):
        raise HTTPException(409, reasons[0])
    b.status = BookingStatus.ACCEPTED
    declined_renters: list[Booking] = []
    # Other pending requests for overlapping days can no longer happen.
    for other in db.scalars(
        select(Booking).where(
            Booking.item_id == b.item_id,
            Booking.id != b.id,
            Booking.status == BookingStatus.PENDING,
            Booking.start_date <= b.end_date,
            Booking.end_date >= b.start_date,
        )
    ):
        other.status = BookingStatus.DECLINED
        declined_renters.append(other)
    db.commit()
    _tell(db, b.renter_id, "booking_accepted", f"{_first(user.name)} confirmed your booking",
          f"{b.item.title} · {b.start_date:%b %d} – {b.end_date:%b %d}. You can now see the exact pick-up spot.", b)
    for o in declined_renters:
        _tell(db, o.renter_id, "booking_declined", "Those dates were taken", f"{o.item.title} was booked by someone else.", o)
    return services.booking_out(db, b, user)


@router.post("/bookings/{booking_id}/decline", response_model=schemas.BookingOut)
def decline(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = _get_booking(db, booking_id, user)
    if b.item.owner_id != user.id:
        raise HTTPException(403, "Only the owner can decline")
    if b.status != BookingStatus.PENDING:
        raise HTTPException(400, f"Booking is {b.status}")
    b.status = BookingStatus.DECLINED
    db.commit()
    _tell(db, b.renter_id, "booking_declined", f"{_first(user.name)} declined your request", b.item.title, b)
    return services.booking_out(db, b, user)


@router.post("/bookings/{booking_id}/cancel", response_model=schemas.BookingOut)
def cancel(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Either side can cancel before the rental starts."""
    b = _get_booking(db, booking_id, user)
    if b.status not in (BookingStatus.PENDING, BookingStatus.ACCEPTED):
        raise HTTPException(400, f"Booking is {b.status}")
    if b.status == BookingStatus.ACCEPTED and b.start_date <= date.today():
        raise HTTPException(400, "The rental has already started")
    refunded = payments.refund_if_paid(b)  # raises (and keeps the booking) if Stripe can't refund
    b.status = BookingStatus.CANCELLED
    db.commit()
    other = b.item.owner_id if user.id == b.renter_id else b.renter_id
    note = f" · {services.money(b.total_price)} refunded to the card" if refunded else ""
    _tell(db, other, "booking_cancelled", f"{_first(user.name)} cancelled", f"{b.item.title} · {b.start_date:%b %d} – {b.end_date:%b %d}{note}", b)
    if refunded and other != b.renter_id:
        _tell(db, b.renter_id, "payment_refunded", "Refund on its way", f"{services.money(b.total_price)} for {b.item.title} (demo payment)", b)
    return services.booking_out(db, b, user)


@router.post("/bookings/{booking_id}/complete", response_model=schemas.BookingOut)
def complete(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Owner confirms the thing came back. Unlocks reviews for both sides."""
    b = _get_booking(db, booking_id, user)
    if b.item.owner_id != user.id:
        raise HTTPException(403, "Only the owner can mark it returned")
    if b.status != BookingStatus.ACCEPTED:
        raise HTTPException(400, f"Booking is {b.status}")
    if b.start_date > date.today():
        raise HTTPException(400, "The rental hasn't started yet")
    b.status = BookingStatus.COMPLETED
    if b.payment_status == payments.CASH_DUE:  # returned, so the cash was handled at pick-up
        b.payment_status = payments.CASH_RECEIVED
    joined = services.increment_rental_counts(db)
    db.commit()
    if b.renter_id in joined:  # the welcome note was stored by increment_rental_counts; push it live
        n = db.scalar(select(Notification).where(Notification.user_id == b.renter_id).order_by(Notification.id.desc()))
        if n:
            push_notification(b.renter_id, chat.notification_out(n))
    _tell(db, b.renter_id, "booking_completed", "Rental finished — how did it go?", f"Leave a review for {_first(user.name)} · {b.item.title}", b)
    return services.booking_out(db, b, user)


@router.post("/reviews", response_model=schemas.ReviewOut, status_code=201)
def leave_review(body: schemas.ReviewCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = _get_booking(db, body.booking_id, user)
    services.auto_complete_finished(db)
    db.refresh(b)
    if b.status != BookingStatus.COMPLETED:
        raise HTTPException(400, "You can review once the rental is finished")
    if any(r.reviewer_id == user.id for r in b.reviews):
        raise HTTPException(409, "You already reviewed this rental")
    is_renter = user.id == b.renter_id
    review = Review(
        booking_id=b.id,
        item_id=b.item_id,
        reviewer_id=user.id,
        reviewee_id=b.item.owner_id if is_renter else b.renter_id,
        direction="renter_to_owner" if is_renter else "owner_to_renter",
        rating=body.rating,
        comment=body.comment.strip(),
    )
    db.add(review)
    db.commit()
    _tell(db, review.reviewee_id, "review", f"{_first(user.name)} left you a {body.rating}★ review", (body.comment or b.item.title)[:140], b)
    db.refresh(review)
    return review


# ---------------------------------------------------------------------------
# payments (card via Stripe test mode / demo checkout, or cash) — see app/payments.py
# ---------------------------------------------------------------------------


class DemoCard(BaseModel):
    number: str = Field(max_length=30)
    exp: str = Field(max_length=7)
    cvc: str = Field(max_length=4)


class ConfirmIn(BaseModel):
    session_id: str | None = Field(default=None, max_length=255)


def _renter_booking(db: Session, booking_id: int, user: User) -> Booking:
    b = _get_booking(db, booking_id, user)
    if b.renter_id != user.id:
        raise HTTPException(403, "Only the renter pays")
    return b


def _paid(db: Session, b: Booking) -> None:
    _tell(db, b.item.owner_id, "payment_received", f"{_first(b.renter.name)} paid {services.money(b.total_price)}",
          f"{b.item.title} · card (demo payment). You get {services.money(b.owner_payout)}.", b)


@router.get("/payments/config", tags=["payments"])
def payment_config():
    return payments.config()


@router.post("/bookings/{booking_id}/pay", tags=["payments"])
def start_payment(booking_id: int, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Card payment. Stripe mode: returns a Checkout URL (test mode). Simulated mode: use /pay/demo."""
    b = _renter_booking(db, booking_id, user)
    out = payments.start_checkout(b, str(request.base_url))
    db.commit()
    return out


@router.post("/bookings/{booking_id}/pay/confirm", response_model=schemas.BookingOut, tags=["payments"])
def confirm_payment(booking_id: int, body: ConfirmIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """After Stripe Checkout redirects back: check with Stripe that it was paid."""
    b = _renter_booking(db, booking_id, user)
    if payments.confirm_stripe(b, body.session_id):
        db.commit()
        _paid(db, b)
    return services.booking_out(db, b, user)


@router.post("/bookings/{booking_id}/pay/demo", response_model=schemas.BookingOut, tags=["payments"])
def demo_payment(booking_id: int, card: DemoCard, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Built-in demo checkout (no Stripe key): accepts Stripe's test card numbers only."""
    b = _renter_booking(db, booking_id, user)
    payments.pay_simulated(b, card.number, card.exp, card.cvc)
    db.commit()
    _paid(db, b)
    return services.booking_out(db, b, user)


@router.post("/bookings/{booking_id}/cash-received", response_model=schemas.BookingOut, tags=["payments"])
def cash_received(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = _get_booking(db, booking_id, user)
    if b.item.owner_id != user.id:
        raise HTTPException(403, "Only the owner can confirm cash")
    if b.payment_method != payments.CASH or b.status not in (BookingStatus.ACCEPTED, BookingStatus.COMPLETED):
        raise HTTPException(400, "Nothing to confirm")
    if b.payment_status != payments.CASH_RECEIVED:
        b.payment_status = payments.CASH_RECEIVED
        b.paid_at = datetime.utcnow()
        db.commit()
        _tell(db, b.renter_id, "payment_received", "Cash payment confirmed", f"{_first(user.name)} got {services.money(b.total_price)} for {b.item.title}", b)
    return services.booking_out(db, b, user)


@router.post("/payments/webhook", tags=["payments"], include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Optional (needs a public URL, e.g. `stripe listen --forward-to localhost:8000/payments/webhook`)."""
    kind, booking_id, intent = payments.handle_webhook(await request.body(), request.headers.get("stripe-signature"))
    if kind == "checkout.session.completed" and booking_id:
        b = db.get(Booking, booking_id)
        if b and b.payment_method == payments.CARD and payments._mark_paid(b, intent):
            db.commit()
            _paid(db, b)
    return {"received": True}
