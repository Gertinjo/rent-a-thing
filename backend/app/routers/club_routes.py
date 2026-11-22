"""Rent Club (badge + members' chat) and ID verification for users."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import chat, club, services, verification
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..ratelimit import chat_allowed
from ..realtime import emit_to_room

router = APIRouter(tags=["rent club & verification"])


def _wrap(fn):
    try:
        return fn()
    except chat.ChatError as e:
        raise HTTPException(e.status, e.detail)


# ---------------------------------------------------------------- Rent Club


class ClubMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=chat.MAX_MESSAGE_LEN)


@router.get("/club")
def club_info(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return club.info(db, user)


@router.get("/club/messages")
def club_messages(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _wrap(lambda: club.history(db, user.id))


@router.post("/club/messages", status_code=201)
def club_post(body: ClubMessageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """HTTP fallback; the app normally sends over Socket.IO ("club_send")."""
    if not chat_allowed(user.id):
        raise HTTPException(429, "You’re sending messages too fast. Wait a few seconds.")
    m = _wrap(lambda: club.send(db, user.id, body.body))
    emit_to_room(club.ROOM, "club_message", {"message": m})
    return m


@router.post("/club/read")
def club_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _wrap(lambda: club.mark_read(db, user.id))
    return chat.unread_counts(db, user.id)


# ---------------------------------------------------------------- ID verification


@router.get("/me/verification")
def my_verification(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return verification.status_out(user, services.id_required(db, user))


@router.post("/me/verification")
def submit_verification(
    doc_type: str = Form(...),
    front: UploadFile = File(..., description="Photo of the ID document (the side with your photo)"),
    selfie: UploadFile = File(..., description="A selfie, so we can match it to the document"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    verification.submit(user, doc_type, front, selfie)
    db.commit()
    return verification.status_out(user, services.id_required(db, user))
