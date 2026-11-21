"""ID verification.

A user uploads a photo of an ID document (ID card, passport or driving licence) and a selfie.
An admin compares them in the admin console and marks the account verified or rejected.

Privacy:
- Images are re-encoded to JPEG (drops EXIF/GPS data, rejects files that aren't real images) and
  stored in PRIVATE_DIR, which is never served as static files. Only admins can view them, via the API.
- Both images are deleted as soon as an admin decides. Only the outcome is kept.
"""

import uuid
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from fastapi import HTTPException, UploadFile

from .database import PRIVATE_DIR
from .media import IMAGE_EXTS, read_limited
from .models import ID_DOC_TYPES, IdStatus, User

ID_DIR = PRIVATE_DIR / "ids"
MAX_WIDTH = 1600


def _store(upload: UploadFile, user_id: int, label: str) -> str:
    ext = Path(upload.filename or "").suffix.lower()
    if ext and ext not in IMAGE_EXTS and not (upload.content_type or "").startswith("image/"):
        raise HTTPException(400, f"The {label} must be a photo (JPEG or PNG)")
    img = cv2.imdecode(np.frombuffer(read_limited(upload), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, f"Couldn’t read the {label} photo. Try a JPEG or PNG.")
    h, w = img.shape[:2]
    if min(h, w) < 300:
        raise HTTPException(400, f"The {label} photo is too small to read. Take it a bit closer.")
    if w > MAX_WIDTH:
        img = cv2.resize(img, (MAX_WIDTH, int(h * MAX_WIDTH / w)), interpolation=cv2.INTER_AREA)
    out = ID_DIR / str(user_id)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{label}-{uuid.uuid4().hex}.jpg"
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return path.relative_to(PRIVATE_DIR).as_posix()


def delete_files(user: User) -> None:
    for rel in (user.id_front_path, user.id_selfie_path):
        if rel:
            (PRIVATE_DIR / rel).unlink(missing_ok=True)
    user.id_front_path = user.id_selfie_path = None


def submit(user: User, doc_type: str, front: UploadFile, selfie: UploadFile) -> None:
    if doc_type not in ID_DOC_TYPES:
        raise HTTPException(400, "Choose ID card, passport or driving licence")
    if user.id_status == IdStatus.VERIFIED:
        raise HTTPException(400, "Your ID is already verified")
    new_front = _store(front, user.id, "front")
    new_selfie = _store(selfie, user.id, "selfie")
    delete_files(user)  # replace an earlier submission
    user.id_front_path, user.id_selfie_path = new_front, new_selfie
    user.id_doc_type = doc_type
    user.id_status = IdStatus.PENDING
    user.id_note = ""
    user.id_submitted_at = datetime.utcnow()


def decide(user: User, verified: bool, note: str = "") -> None:
    user.id_status = IdStatus.VERIFIED if verified else IdStatus.REJECTED
    user.id_note = "" if verified else (note or "The photos weren’t clear enough to verify.")
    user.id_verified_at = datetime.utcnow() if verified else None
    delete_files(user)


def file_path(user: User, which: str) -> Path | None:
    rel = {"front": user.id_front_path, "selfie": user.id_selfie_path}.get(which)
    if not rel:
        return None
    p = (PRIVATE_DIR / rel).resolve()
    return p if p.is_file() and PRIVATE_DIR.resolve() in p.parents else None


def status_out(user: User, required: bool) -> dict:
    return {
        "status": user.id_status,
        "doc_type": user.id_doc_type,
        "note": user.id_note,
        "submitted_at": user.id_submitted_at.isoformat() + "Z" if user.id_submitted_at else None,
        "verified_at": user.id_verified_at.isoformat() + "Z" if user.id_verified_at else None,
        "required": required,
    }
