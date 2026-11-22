"""Rent Club: renters with CLUB_MIN_RENTALS completed rentals get a badge, a booking discount and a
members-only group chat. Live delivery of the chat is in app/realtime.py (room "club").

Admins can read and post too (moderation).
"""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .chat import MAX_MESSAGE_LEN, ChatError
from .models import CLUB_MIN_RENTALS, ClubMessage, User

ROOM = "club"


def can_access(user: User | None) -> bool:
    return bool(user) and not user.is_suspended and (user.club_member or user.is_admin)


def _member(db: Session, user_id: int) -> User:
    u = db.get(User, user_id)
    if not can_access(u):
        raise ChatError(403, f"The Rent Club chat is for members: complete {CLUB_MIN_RENTALS} rentals to join.")
    return u


def message_out(m: ClubMessage) -> dict:
    s = m.sender
    return {
        "id": m.id,
        "body": m.body,
        "created_at": m.created_at.isoformat() + "Z",
        "sender": {"id": s.id, "name": s.name, "avatar_url": s.avatar_url, "is_admin": s.is_admin, "id_verified": s.id_verified},
    }


def members(db: Session) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .where(or_(User.rental_count >= CLUB_MIN_RENTALS, User.club_granted.is_(True)), User.is_suspended.is_(False))
            .order_by(User.rental_count.desc(), User.name)
        ).all()
    )


def info(db: Session, user: User) -> dict:
    ms = members(db)
    return {
        "is_member": user.club_member,
        "can_chat": can_access(user),
        "rentals": user.rental_count or 0,
        "needed": CLUB_MIN_RENTALS,
        "member_count": len(ms),
        "members": [{"id": u.id, "name": u.name, "avatar_url": u.avatar_url, "rentals": u.rental_count} for u in ms[:30]],
        "unread": unread(db, user),
    }


def history(db: Session, user_id: int, limit: int = 100) -> list[dict]:
    _member(db, user_id)
    rows = db.scalars(select(ClubMessage).order_by(ClubMessage.id.desc()).limit(limit)).all()
    return [message_out(m) for m in reversed(rows)]


def send(db: Session, user_id: int, body: str) -> dict:
    u = _member(db, user_id)
    text = (body or "").strip()
    if not text:
        raise ChatError(400, "Message is empty")
    if len(text) > MAX_MESSAGE_LEN:
        raise ChatError(400, f"Messages can be up to {MAX_MESSAGE_LEN} characters")
    m = ClubMessage(sender_id=u.id, body=text)
    db.add(m)
    db.flush()
    u.club_read_id = m.id  # your own message is read
    db.commit()
    db.refresh(m)
    return message_out(m)


def mark_read(db: Session, user_id: int) -> None:
    u = _member(db, user_id)
    last = db.scalar(select(func.max(ClubMessage.id))) or 0
    if last > (u.club_read_id or 0):
        u.club_read_id = last
        db.commit()


def unread(db: Session, user: User) -> int:
    if not can_access(user):
        return 0
    return (
        db.scalar(
            select(func.count(ClubMessage.id)).where(ClubMessage.id > (user.club_read_id or 0), ClubMessage.sender_id != user.id)
        )
        or 0
    )
