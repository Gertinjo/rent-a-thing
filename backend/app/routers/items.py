from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import schemas, services
from ..database import get_db
from ..deps import get_current_user, get_optional_user
from .ai_routes import schedule_precheck
from ..media import save_image, spin_from_images, spin_from_video
from ..models import CATEGORIES, Blackout, Item, ItemPhoto, Review, Review_, SpinFrame, User

router = APIRouter(prefix="/items", tags=["items"])


def _get_item(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    return item


def _apply_location(item: Item, loc: schemas.LocationIn | None) -> None:
    if loc is None:
        item.lat = item.lng = None
        item.location_label = ""
    else:
        item.lat, item.lng, item.location_label = loc.lat, loc.lng, loc.label.strip()


def _get_own_item(db: Session, item_id: int, user: User) -> Item:
    item = _get_item(db, item_id)
    if item.owner_id != user.id:
        raise HTTPException(403, "That's not your item")
    return item


@router.get("/categories", response_model=list[str])
def categories():
    return CATEGORIES


@router.get("", response_model=list[schemas.ItemBrief])
def list_items(
    q: str | None = None,
    category: str | None = None,
    owner_id: int | None = None,
    available_from: date | None = Query(None, description="Only items free for this whole range"),
    available_to: date | None = None,
    has_360: bool | None = None,
    db: Session = Depends(get_db),
):
    stmt = (
        select(Item)
        .join(User, Item.owner_id == User.id)
        .where(Item.is_active.is_(True), Item.review_status == Review_.APPROVED, User.is_suspended.is_(False))
        .order_by(Item.created_at.desc())
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Item.title.ilike(like), Item.description.ilike(like), Item.neighborhood.ilike(like)))
    if category:
        stmt = stmt.where(Item.category == category)
    if owner_id:
        stmt = stmt.where(Item.owner_id == owner_id)
    items = db.scalars(stmt).all()
    if has_360 is not None:
        items = [i for i in items if bool(i.spin_frames) == has_360]
    if available_from:
        end = available_to or available_from
        items = [i for i in items if not services.conflicts(db, i.id, available_from, end)]
    return [services.item_brief(db, i) for i in items]


@router.get("/mine", response_model=list[schemas.ItemOut])
def my_items(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.scalars(select(Item).where(Item.owner_id == user.id).order_by(Item.created_at.desc())).all()
    return [services.item_out(db, i, user) for i in items]


@router.post("", response_model=schemas.ItemOut, status_code=201)
def create_item(
    body: schemas.ItemCreate,
    tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = body.model_dump(exclude={"location"})
    if not body.terms_accepted:
        raise HTTPException(400, "You must accept the rental terms before listing an item.")
    if services.id_required(db, user):
        raise HTTPException(403, services.ID_BLOCK_MESSAGE.get(user.id_status, services.ID_BLOCK_MESSAGE["none"]))
    data["neighborhood"] = (data.get("neighborhood") or user.neighborhood or "").strip()
    item = Item(owner_id=user.id, **data)
    _apply_location(item, body.location)
    needs_review = services.get_setting(db, "approve_listings") and not user.is_admin
    item.review_status = Review_.PENDING if needs_review else Review_.APPROVED
    db.add(item)
    db.commit()
    schedule_precheck(tasks, item)
    return services.item_out(db, item, user)


@router.get("/{item_id}", response_model=schemas.ItemOut)
def get_item(item_id: int, viewer: User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    item = _get_item(db, item_id)
    is_insider = viewer is not None and (viewer.id == item.owner_id or viewer.is_admin)
    if item.review_status != Review_.APPROVED and not is_insider:
        raise HTTPException(404, "Item not found")
    return services.item_out(db, item, viewer)


@router.patch("/{item_id}", response_model=schemas.ItemOut)
def update_item(
    item_id: int,
    body: schemas.ItemUpdate,
    tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_own_item(db, item_id, user)
    changes = body.model_dump(exclude_unset=True, exclude={"location"})
    for k, v in changes.items():
        setattr(item, k, v)
    if "location" in body.model_fields_set:
        _apply_location(item, body.location)
    # Fixing a rejected listing sends it back to the review queue.
    if item.review_status == Review_.REJECTED and (changes.keys() - {"is_active"} or "location" in body.model_fields_set):
        item.review_status = Review_.PENDING
    db.commit()
    schedule_precheck(tasks, item)
    return services.item_out(db, item, user)


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Soft delete: hides the listing but keeps booking history and reviews."""
    item = _get_own_item(db, item_id, user)
    item.is_active = False
    db.commit()


# ---------- photos ----------


@router.post("/{item_id}/photos", response_model=schemas.ItemOut)
def add_photos(
    item_id: int,
    tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_own_item(db, item_id, user)
    start = len(item.photos)
    for n, f in enumerate(files):
        item.photos.append(ItemPhoto(url=save_image(f, f"items/{item.id}"), position=start + n))
    if not item.cover_url and item.photos:
        item.cover_url = item.photos[0].url
    db.commit()
    schedule_precheck(tasks, item)
    return services.item_out(db, item, user)


@router.delete("/{item_id}/photos/{photo_id}", response_model=schemas.ItemOut)
def delete_photo(
    item_id: int, photo_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    item = _get_own_item(db, item_id, user)
    photo = next((p for p in item.photos if p.id == photo_id), None)
    if not photo:
        raise HTTPException(404, "Photo not found")
    item.photos.remove(photo)
    if item.cover_url == photo.url:
        item.cover_url = item.photos[0].url if item.photos else (item.spin_frames[0].url if item.spin_frames else None)
    db.commit()
    return services.item_out(db, item, user)


# ---------- 360° spin ----------


def _replace_spin(db: Session, item: Item, urls: list[str], user: User) -> schemas.ItemOut:
    item.spin_frames.clear()
    db.flush()
    item.spin_frames.extend(SpinFrame(url=u, idx=n) for n, u in enumerate(urls))
    if not item.cover_url:
        item.cover_url = urls[0]
    db.commit()
    return services.item_out(db, item, user)


@router.post("/{item_id}/spin/video", response_model=schemas.ItemOut)
def upload_spin_video(
    item_id: int,
    file: UploadFile = File(..., description="A video walking one full circle around the item"),
    frames: int = Query(36, ge=8, le=120),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_own_item(db, item_id, user)
    return _replace_spin(db, item, spin_from_video(file, item.id, frames), user)


@router.post("/{item_id}/spin/frames", response_model=schemas.ItemOut)
def upload_spin_frames(
    item_id: int,
    files: list[UploadFile] = File(..., description="Photos taken in order around the item"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_own_item(db, item_id, user)
    return _replace_spin(db, item, spin_from_images(files, item.id), user)


@router.delete("/{item_id}/spin", response_model=schemas.ItemOut)
def delete_spin(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = _get_own_item(db, item_id, user)
    spin_urls = {f.url for f in item.spin_frames}
    item.spin_frames.clear()
    if item.cover_url in spin_urls:
        item.cover_url = item.photos[0].url if item.photos else None
    db.commit()
    return services.item_out(db, item, user)


# ---------- availability calendar ----------


@router.get("/{item_id}/calendar", response_model=schemas.CalendarOut)
def item_calendar(
    item_id: int,
    start: date | None = None,
    end: date | None = None,
    db: Session = Depends(get_db),
):
    _get_item(db, item_id)
    start = start or date.today()
    end = end or start + timedelta(days=90)
    if end < start or (end - start).days > 366:
        raise HTTPException(400, "Pick a window of at most one year")
    return services.calendar(db, item_id, start, end)


@router.post("/{item_id}/blackouts", response_model=schemas.CalendarOut)
def add_blackout(
    item_id: int, body: schemas.BlackoutIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    item = _get_own_item(db, item_id, user)
    reasons = services.conflicts(db, item.id, body.start_date, body.end_date)
    if any("booked" in r for r in reasons):
        raise HTTPException(409, "You already accepted a booking on some of those days")
    db.add(Blackout(item_id=item.id, start_date=body.start_date, end_date=body.end_date, note=body.note))
    db.commit()
    return services.calendar(db, item.id, date.today(), date.today() + timedelta(days=120))


@router.delete("/{item_id}/blackouts/{blackout_id}", response_model=schemas.CalendarOut)
def delete_blackout(
    item_id: int, blackout_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    item = _get_own_item(db, item_id, user)
    bo = db.get(Blackout, blackout_id)
    if not bo or bo.item_id != item.id:
        raise HTTPException(404, "Blocked range not found")
    db.delete(bo)
    db.commit()
    return services.calendar(db, item.id, date.today(), date.today() + timedelta(days=120))


# ---------- reviews ----------


@router.get("/{item_id}/reviews", response_model=list[schemas.ReviewOut])
def item_reviews(item_id: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(Review)
        .where(Review.item_id == item_id, Review.direction == "renter_to_owner")
        .order_by(Review.created_at.desc())
    ).all()
