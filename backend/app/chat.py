"""Booking chat + notifications (database side). Live delivery is in app/realtime.py.

Rules:
- Only the renter and the owner of a booking can read or write its chat.
- Messages can be sent while the booking is pending, accepted or completed (not after it was
  declined or cancelled — the history stays readable).
"""

from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .models import Booking, BookingStatus, Item, Message, Notification, User

MAX_MESSAGE_LEN = 2000
CLOSED = (BookingStatus.DECLINED, BookingStatus.CANCELLED)


class ChatError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def booking_for(db: Session, booking_id: int, user_id: int) -> Booking:
    b = db.get(Booking, booking_id)
    if not b or user_id not in (b.renter_id, b.item.owner_id):
        raise ChatError(404, "Conversation not found")
    return b


def other_party(b: Booking, user_id: int) -> int:
    return b.item.owner_id if user_id == b.renter_id else b.renter_id


def message_out(m: Message) -> dict:
    return {
        "id": m.id,
        "booking_id": m.booking_id,
        "sender_id": m.sender_id,
        "body": m.body,
        "created_at": m.created_at.isoformat() + "Z",
        "read_at": m.read_at.isoformat() + "Z" if m.read_at else None,
    }


def notification_out(n: Notification) -> dict:
    return {
        "id": n.id,
        "kind": n.kind,
        "title": n.title,
        "body": n.body,
        "booking_id": n.booking_id,
        "item_id": n.item_id,
        "read": n.read,
        "created_at": n.created_at.isoformat() + "Z",
    }


def notify(db: Session, user_id: int, kind: str, title: str, body: str = "", booking: Booking | None = None) -> Notification:
    n = Notification(
        user_id=user_id,
        kind=kind,
        title=title[:120],
        body=body[:300],
        booking_id=booking.id if booking else None,
        item_id=booking.item_id if booking else None,
    )
    db.add(n)
    return n


def send_message(db: Session, booking_id: int, sender_id: int, body: str) -> tuple[dict, int, dict]:
    """Store a message. Returns (message, recipient_id, notification) — caller emits them live."""
    text = (body or "").strip()
    if not text:
        raise ChatError(400, "Message is empty")
    if len(text) > MAX_MESSAGE_LEN:
        raise ChatError(400, f"Messages are limited to {MAX_MESSAGE_LEN} characters")
    b = booking_for(db, booking_id, sender_id)
    if b.status in CLOSED:
        raise ChatError(400, f"This booking was {b.status}, so the chat is closed")
    sender = db.get(User, sender_id)
    m = Message(booking_id=b.id, sender_id=sender_id, body=text)
    db.add(m)
    to = other_party(b, sender_id)
    n = notify(db, to, "message", f"{sender.name.split(' ')[0]} · {b.item.title}", text[:140], b)
    db.commit()
    return message_out(m), to, notification_out(n)


def mark_read(db: Session, booking_id: int, user_id: int) -> tuple[int, int]:
    """Mark the other person's messages as read. Returns (count, other_user_id)."""
    b = booking_for(db, booking_id, user_id)
    now = datetime.utcnow()
    msgs = db.scalars(
        select(Message).where(Message.booking_id == b.id, Message.sender_id != user_id, Message.read_at.is_(None))
    ).all()
    for m in msgs:
        m.read_at = now
    # chat notifications for this booking are read too
    for n in db.scalars(
        select(Notification).where(
            Notification.user_id == user_id, Notification.booking_id == b.id, Notification.kind == "message", Notification.read.is_(False)
        )
    ):
        n.read = True
    db.commit()
    return len(msgs), other_party(b, user_id)


def history(db: Session, booking_id: int, user_id: int, limit: int = 200) -> list[dict]:
    b = booking_for(db, booking_id, user_id)
    rows = db.scalars(select(Message).where(Message.booking_id == b.id).order_by(Message.created_at.desc(), Message.id.desc()).limit(limit)).all()
    return [message_out(m) for m in reversed(rows)]


def threads(db: Session, user_id: int) -> list[dict]:
    """Every booking the user is part of, newest activity first, with last message + unread count."""
    bookings = db.scalars(
        select(Booking).join(Item).where(or_(Booking.renter_id == user_id, Item.owner_id == user_id))
    ).all()
    out = []
    for b in bookings:
        last = db.scalar(select(Message).where(Message.booking_id == b.id).order_by(Message.created_at.desc(), Message.id.desc()).limit(1))
        unread = db.scalar(
            select(func.count(Message.id)).where(Message.booking_id == b.id, Message.sender_id != user_id, Message.read_at.is_(None))
        ) or 0
        other = db.get(User, other_party(b, user_id))
        out.append(
            {
                "booking_id": b.id,
                "status": b.status,
                "start_date": b.start_date.isoformat(),
                "end_date": b.end_date.isoformat(),
                "item": {"id": b.item.id, "title": b.item.title, "cover_url": b.item.cover_url},
                "other": {"id": other.id, "name": other.name, "avatar_url": other.avatar_url},
                "role": "owner" if b.item.owner_id == user_id else "renter",
                "last_message": message_out(last) if last else None,
                "unread": unread,
                "activity": (last.created_at if last else b.created_at).isoformat() + "Z",
            }
        )
    out.sort(key=lambda t: t["activity"], reverse=True)
    return out


def unread_counts(db: Session, user_id: int) -> dict:
    msgs = db.scalar(
        select(func.count(Message.id))
        .join(Booking, Booking.id == Message.booking_id)
        .join(Item, Item.id == Booking.item_id)
        .where(or_(Booking.renter_id == user_id, Item.owner_id == user_id), Message.sender_id != user_id, Message.read_at.is_(None))
    ) or 0
    # the bell counts booking events; chat messages have their own badge
    notes = db.scalar(
        select(func.count(Notification.id)).where(Notification.user_id == user_id, Notification.read.is_(False), Notification.kind != "message")
    ) or 0
    return {"messages": msgs, "notifications": notes}
