from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

CATEGORIES = [
    "tools",  # Tools & DIY
    "garden",  # Garden
    "camping",  # Camping & hiking
    "bikes",  # Bikes & scooters
    "photo",  # Photo & video
    "electronics",  # Electronics
    "party",  # Party & events
    "sports",  # Sports & fitness
    "kids",  # Kids & baby
    "home",  # Home & cleaning
    "music",  # Music
    "travel",  # Travel & luggage
    "other",
]
# Old category keys from the first version, mapped to the new ones.
LEGACY_CATEGORIES = {"cameras": "photo", "tents": "camping", "outdoor": "camping"}


class Review_:  # noqa: N801 - namespace for review/approval states
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class BookingStatus:
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    neighborhood: Mapped[str] = mapped_column(String(80), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Suspended users can't log in and their listings are hidden from Explore.
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    suspended_reason: Mapped[str] = mapped_column(String(200), default="")
    # New accounts can be reviewed by an admin before they can book (see the "approve_users" setting).
    approval_status: Mapped[str] = mapped_column(String(20), default=Review_.APPROVED)
    approval_note: Mapped[str] = mapped_column(String(300), default="")
    # Completed rentals as a renter. 5+ makes you a Renting Club member (discount on bookings).
    rental_count: Mapped[int] = mapped_column(Integer, default=0)

    items: Mapped[list["Item"]] = relationship(back_populates="owner")


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(30), index=True)
    price_per_day: Mapped[float] = mapped_column(Float)
    deposit: Mapped[float] = mapped_column(Float, default=0)
    neighborhood: Mapped[str] = mapped_column(String(80), default="")
    cover_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Pick-up location. The exact point is only shown to the owner, admins and confirmed renters.
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_label: Mapped[str] = mapped_column(String(200), default="")
    # Listings can be reviewed by an admin before they appear on Explore (the "approve_listings" setting).
    review_status: Mapped[str] = mapped_column(String(20), default=Review_.APPROVED)
    review_note: Mapped[str] = mapped_column(String(300), default="")
    # Latest AI pre-check for admins (JSON: verdict, summary, issues, message_to_owner) — see app/ai.py
    ai_check: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Owner agreed to the rental terms when creating the listing.
    terms_accepted: Mapped[bool] = mapped_column(Boolean, default=False)

    owner: Mapped[User] = relationship(back_populates="items")
    photos: Mapped[list["ItemPhoto"]] = relationship(
        cascade="all, delete-orphan", order_by="ItemPhoto.position"
    )
    spin_frames: Mapped[list["SpinFrame"]] = relationship(
        cascade="all, delete-orphan", order_by="SpinFrame.idx"
    )
    blackouts: Mapped[list["Blackout"]] = relationship(
        cascade="all, delete-orphan", order_by="Blackout.start_date"
    )
    bookings: Mapped[list["Booking"]] = relationship(back_populates="item", cascade="all, delete-orphan")


class ItemPhoto(Base):
    __tablename__ = "item_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer, default=0)


class SpinFrame(Base):
    """One frame of an item's 360° turntable spin. Frames are shown in `idx` order."""

    __tablename__ = "spin_frames"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(255))
    idx: Mapped[int] = mapped_column(Integer)


class Blackout(Base):
    """Dates the owner has blocked (e.g. they need the thing themselves)."""

    __tablename__ = "blackouts"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(String(200), default="")


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    renter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)  # inclusive
    status: Mapped[str] = mapped_column(String(20), default=BookingStatus.PENDING, index=True)
    total_price: Mapped[float] = mapped_column(Float)
    platform_fee: Mapped[float] = mapped_column(Float, default=0)
    owner_payout: Mapped[float] = mapped_column(Float, default=0)
    message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    item: Mapped[Item] = relationship(back_populates="bookings")
    renter: Mapped[User] = relationship()
    reviews: Mapped[list["Review"]] = relationship(back_populates="booking", cascade="all, delete-orphan")

    @property
    def days(self) -> int:
        return (self.end_date - self.start_date).days + 1


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("booking_id", "reviewer_id", name="uq_one_review_per_side"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reviewee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # "renter_to_owner" reviews the owner + the item; "owner_to_renter" reviews the renter.
    direction: Mapped[str] = mapped_column(String(20))
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    booking: Mapped[Booking] = relationship(back_populates="reviews")
    reviewer: Mapped[User] = relationship(foreign_keys=[reviewer_id])


class ContactMessage(Base):
    """Messages sent from the app's Contact us screen."""

    __tablename__ = "contact_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    topic: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    booking_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | resolved
    admin_note: Mapped[str] = mapped_column(Text, default="")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AdminAction(Base):
    """Audit log: every moderation action an admin takes."""

    __tablename__ = "admin_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(40))  # e.g. suspend_user, hide_item
    target_type: Mapped[str] = mapped_column(String(20))  # user | item | booking | review | message
    target_id: Mapped[int] = mapped_column(Integer)
    summary: Mapped[str] = mapped_column(String(200), default="")  # human-readable target, e.g. "Bob Okafor"
    reason: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    admin: Mapped[User | None] = relationship()


class AppSetting(Base):
    """Small key/value store for admin-controlled switches."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class Message(Base):
    """Chat message between the renter and the owner of one booking."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Notification(Base):
    """In-app notification (also pushed live over Socket.IO)."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # message | booking_request | booking_accepted | ...
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(300), default="")
    booking_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
