"""REST side of chat + notifications (history, fallbacks when the socket isn't connected)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import chat
from ..database import get_db
from ..deps import get_current_user
from ..models import Notification, User
from ..ratelimit import chat_allowed
from ..realtime import emit_to_user

router = APIRouter(tags=["chat & notifications"])


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=chat.MAX_MESSAGE_LEN)


def _wrap(fn):
    try:
        return fn()
    except chat.ChatError as e:
        raise HTTPException(e.status, e.detail)


@router.get("/chats")
def list_threads(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return chat.threads(db, user.id)


@router.get("/bookings/{booking_id}/messages")
def get_messages(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _wrap(lambda: chat.history(db, booking_id, user.id))


@router.post("/bookings/{booking_id}/messages", status_code=201)
def post_message(booking_id: int, body: MessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not chat_allowed(user.id):
        raise HTTPException(429, "You’re sending messages too fast. Wait a few seconds.")
    message, to, note = _wrap(lambda: chat.send_message(db, booking_id, user.id, body.body))
    payload = {"booking_id": booking_id, "message": message}
    emit_to_user(user.id, "message", payload)
    emit_to_user(to, "message", payload)
    emit_to_user(to, "notification", {"notification": note})
    emit_to_user(to, "unread", chat.unread_counts(db, to))
    return message


@router.post("/bookings/{booking_id}/read")
def read_messages(booking_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count, other = _wrap(lambda: chat.mark_read(db, booking_id, user.id))
    if count:
        emit_to_user(other, "read", {"booking_id": booking_id, "user_id": user.id})
    return {"read": count, **chat.unread_counts(db, user.id)}


@router.get("/notifications")
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc(), Notification.id.desc()).limit(60)
    ).all()
    return {"items": [chat.notification_out(n) for n in rows], **chat.unread_counts(db, user.id)}


@router.post("/notifications/read")
def read_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for n in db.scalars(select(Notification).where(Notification.user_id == user.id, Notification.read.is_(False))):
        n.read = True
    db.commit()
    return chat.unread_counts(db, user.id)


@router.get("/me/unread")
def unread(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return chat.unread_counts(db, user.id)
