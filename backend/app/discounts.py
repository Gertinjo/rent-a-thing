"""Discount codes (e.g. BLACKFRIDAY): checking a code and working out the discount.

Rentify pays for discounts: the renter pays less, the owner still gets their full payout.
A use counts while the booking is pending, accepted or completed; declined or cancelled
requests give the use back.
"""

import re
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Booking, BookingStatus, DiscountCode, User

CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,29}$")
_LIVE = (BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.COMPLETED)


def normalize(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "")


def uses(db: Session, d: DiscountCode, user: User | None = None) -> int:
    stmt = select(func.count(Booking.id)).where(Booking.discount_code == d.code, Booking.status.in_(_LIVE))
    if user is not None:
        stmt = stmt.where(Booking.renter_id == user.id)
    return db.scalar(stmt) or 0


def is_live(d: DiscountCode, today: date | None = None) -> bool:
    today = today or date.today()
    return d.is_active and d.starts_on <= today <= d.ends_on


def amount(d: DiscountCode, subtotal: float) -> float:
    off = subtotal * d.percent_off / 100
    if d.max_off:
        off = min(off, d.max_off)
    return round(min(off, subtotal), 2)


def check(db: Session, raw: str, user: User, subtotal: float) -> tuple[DiscountCode, float]:
    """Returns (code, euros off) or raises 400 with a message the renter can act on."""
    code = normalize(raw)
    d = db.scalar(select(DiscountCode).where(DiscountCode.code == code)) if code else None
    today = date.today()
    if not d or not d.is_active:
        raise HTTPException(400, "That code doesn’t exist. Check the spelling.")
    if today < d.starts_on:
        raise HTTPException(400, f"{d.code} starts on {d.starts_on:%d %b}.")
    if today > d.ends_on:
        raise HTTPException(400, f"{d.code} ended on {d.ends_on:%d %b}.")
    if d.min_total and subtotal < d.min_total:
        raise HTTPException(400, f"{d.code} is for rentals of €{d.min_total:g} or more.")
    if d.max_uses and uses(db, d) >= d.max_uses:
        raise HTTPException(400, f"{d.code} has been used up.")
    if d.once_per_user and uses(db, d, user) > 0:
        raise HTTPException(400, f"You’ve already used {d.code}.")
    return d, amount(d, subtotal)


def featured(db: Session) -> DiscountCode | None:
    """The code the app's Black Friday ads should show: featured, active, and not over yet."""
    today = date.today()
    return db.scalars(
        select(DiscountCode)
        .where(DiscountCode.featured.is_(True), DiscountCode.is_active.is_(True), DiscountCode.ends_on >= today)
        .order_by(DiscountCode.starts_on)
        .limit(1)
    ).first()
