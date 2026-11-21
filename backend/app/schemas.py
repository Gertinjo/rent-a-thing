from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import CATEGORIES


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- users / auth ----------
class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    neighborhood: str = ""

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Enter a valid email")
        return v


class LoginIn(BaseModel):
    email: str
    password: str


class UserBrief(ORM):
    id: int
    name: str
    neighborhood: str
    avatar_url: str | None = None
    # public badges
    club_member: bool = False
    id_verified: bool = False


class UserOut(UserBrief):
    bio: str = ""
    created_at: datetime
    rating_avg: float | None = None
    rating_count: int = 0


class MeOut(UserOut):
    email: str
    is_admin: bool = False
    approval_status: str = "approved"
    approval_note: str = ""
    listings_count: int = 0
    rentals_count: int = 0  # things I rented (completed)
    lendings_count: int = 0  # times my things were rented (completed)
    rental_count: int = 0  # completed rentals counted towards the Rent Club
    id_status: str = "none"  # none | pending | verified | rejected
    id_note: str = ""
    id_required: bool = True


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class DeleteAccountIn(BaseModel):
    password: str


ContactTopic = Literal["general", "booking", "safety", "bug", "feedback"]


class ContactIn(BaseModel):
    topic: ContactTopic = "general"
    message: str = Field(min_length=5, max_length=5000)
    name: str = ""
    email: str = ""
    booking_id: int | None = None


class ContactOut(BaseModel):
    id: int
    received: bool = True


class MeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    neighborhood: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=300)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: MeOut


# ---------- items ----------
Category = Literal[
    "tools", "garden", "camping", "bikes", "photo", "electronics", "party", "sports", "kids", "home", "music", "travel", "other"
]
assert set(CATEGORIES) == set(Category.__args__)  # keep the two lists in sync


class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    label: str = Field(default="", max_length=200)


class LocationOut(BaseModel):
    label: str
    lat: float
    lng: float
    exact: bool  # False = rounded to roughly 500 m to protect the owner's address


class ItemCreate(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    description: str = ""
    category: Category
    price_per_day: float = Field(gt=0, le=10_000)
    deposit: float = Field(default=0, ge=0, le=100_000)
    neighborhood: str | None = None
    location: LocationIn | None = None
    # Must be true — owner agrees to the rental terms before listing.
    terms_accepted: bool = False


class ItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    category: Category | None = None
    price_per_day: float | None = Field(default=None, gt=0, le=10_000)
    deposit: float | None = Field(default=None, ge=0, le=100_000)
    neighborhood: str | None = None
    is_active: bool | None = None
    location: LocationIn | None = None


class PhotoOut(ORM):
    id: int
    url: str


class ItemOut(BaseModel):
    id: int
    title: str
    description: str
    category: str
    price_per_day: float
    deposit: float
    neighborhood: str
    cover_url: str | None
    is_active: bool
    created_at: datetime
    owner: UserOut
    photos: list[PhotoOut]
    spin_frames: list[str]
    has_360: bool
    rating_avg: float | None
    rating_count: int
    location: LocationOut | None
    review_status: str
    review_note: str


class ItemBrief(BaseModel):
    id: int
    title: str
    category: str
    price_per_day: float
    neighborhood: str
    cover_url: str | None
    has_360: bool
    rating_avg: float | None
    rating_count: int
    owner_id: int
    owner_name: str
    location_label: str = ""


# ---------- calendar ----------
class DateRange(BaseModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _order(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class BlackoutIn(DateRange):
    note: str = ""


class CalendarRange(BaseModel):
    start_date: date
    end_date: date
    kind: Literal["booked", "blocked", "pending"]
    id: int  # booking id or blackout id
    note: str = ""


class CalendarOut(BaseModel):
    item_id: int
    start: date
    end: date
    ranges: list[CalendarRange]
    unavailable_days: list[date]  # booked or blocked (pending requests don't block)


# ---------- bookings ----------
class BookingCreate(DateRange):
    item_id: int
    message: str = ""


class BookingOut(BaseModel):
    id: int
    item: ItemBrief
    renter: UserOut
    owner: UserOut
    start_date: date
    end_date: date
    days: int
    total_price: float
    platform_fee: float
    owner_payout: float
    club_discount: float = 0
    status: str
    message: str
    created_at: datetime
    role: Literal["renter", "owner"]
    can_review: bool
    reviewed_by_me: bool


# ---------- reviews ----------
class ReviewCreate(BaseModel):
    booking_id: int
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=2000)


class ReviewOut(ORM):
    id: int
    booking_id: int
    item_id: int
    direction: str
    rating: int
    comment: str
    created_at: datetime
    reviewer: UserBrief
