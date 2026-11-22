from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas, services
from ..database import get_db
from ..deps import get_current_user, get_optional_user
from ..media import save_image
import secrets
from datetime import date

from ..models import Booking, BookingStatus, ContactMessage, Item, Review, User
from ..security import create_token, hash_password, verify_password

router = APIRouter(tags=["auth & users"])


@router.post("/auth/register", response_model=schemas.TokenOut)
def register(body: schemas.RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "That email is already registered")
    user = User(
        name=body.name.strip(),
        email=body.email,
        password_hash=hash_password(body.password),
        neighborhood=body.neighborhood.strip(),
        # Renters go straight in; lenders need an admin to approve them before they can list.
        approval_status=services.lender_status_for_new_request(db) if body.lender else "none",
    )
    db.add(user)
    db.commit()
    return schemas.TokenOut(access_token=create_token(user.id), user=services.me_out(db, user))


@router.post("/users/me/lender", response_model=schemas.MeOut)
def apply_to_lend(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """A renter-only account asks to become a lender (or asks again after a rejection)."""
    if user.approval_status in ("none", "rejected"):
        user.approval_status = services.lender_status_for_new_request(db)
        user.approval_note = ""
        db.commit()
    return services.me_out(db, user)


@router.post("/auth/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    if user.is_suspended:
        reason = f" Reason: {user.suspended_reason}." if user.suspended_reason else ""
        raise HTTPException(403, f"This account is suspended.{reason} Contact support if you think this is a mistake.")
    return schemas.TokenOut(access_token=create_token(user.id), user=services.me_out(db, user))


@router.get("/users/me", response_model=schemas.MeOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return services.me_out(db, user)


@router.patch("/users/me", response_model=schemas.MeOut)
def update_me(body: schemas.MeUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    return services.me_out(db, user)


@router.post("/users/me/avatar", response_model=schemas.MeOut)
def upload_avatar(
    file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    user.avatar_url = save_image(file, "avatars")
    db.commit()
    return services.me_out(db, user)


@router.post("/users/me/password", status_code=204)
def change_password(
    body: schemas.PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Your current password is wrong")
    user.password_hash = hash_password(body.new_password)
    db.commit()


@router.delete("/users/me", status_code=204)
def delete_account(
    body: schemas.DeleteAccountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Delete the account: hide listings, cancel open requests, anonymise the profile.

    Past bookings and reviews stay (anonymised) so the other side's history still makes sense.
    """
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(400, "Wrong password")
    today = date.today()
    active = db.scalar(
        select(Booking.id)
        .join(Item)
        .where(
            (Booking.renter_id == user.id) | (Item.owner_id == user.id),
            Booking.status == BookingStatus.ACCEPTED,
            Booking.end_date >= today,
        )
    )
    if active:
        raise HTTPException(409, "You have a confirmed rental that hasn't finished yet. Cancel or finish it first.")
    for b in db.scalars(
        select(Booking).join(Item).where(
            (Booking.renter_id == user.id) | (Item.owner_id == user.id), Booking.status == BookingStatus.PENDING
        )
    ):
        b.status = BookingStatus.CANCELLED
    for item in user.items:
        item.is_active = False
    user.name = "Deleted user"
    user.email = f"deleted-{user.id}-{secrets.token_hex(4)}@deleted.invalid"
    user.password_hash = hash_password(secrets.token_hex(16))
    user.bio = ""
    user.neighborhood = ""
    user.avatar_url = None
    db.commit()


@router.post("/support/contact", response_model=schemas.ContactOut, status_code=201, tags=["support"])
def contact_us(
    body: schemas.ContactIn, user: User | None = Depends(get_optional_user), db: Session = Depends(get_db)
):
    msg = ContactMessage(
        user_id=user.id if user else None,
        name=body.name or (user.name if user else ""),
        email=body.email or (user.email if user else ""),
        topic=body.topic,
        message=body.message.strip(),
        booking_id=body.booking_id,
    )
    db.add(msg)
    db.commit()
    return schemas.ContactOut(id=msg.id)


@router.get("/users/{user_id}", response_model=schemas.UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return services.user_out(db, user)


@router.get("/users/{user_id}/reviews", response_model=list[schemas.ReviewOut])
def user_reviews(user_id: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(Review).where(Review.reviewee_id == user_id).order_by(Review.created_at.desc())
    ).all()
