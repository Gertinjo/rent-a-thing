"""File storage + 360° spin frame extraction."""

import shutil
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import HTTPException, UploadFile

from .database import MEDIA_DIR

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".3gp", ".webm"}
SPIN_MAX_WIDTH = 900
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB per photo
MAX_VIDEO_BYTES = 150 * 1024 * 1024  # 150 MB per walk-around video
VIDEO_EXT_SAFE = {".mp4", ".mov", ".m4v", ".3gp", ".webm"}


def read_limited(upload: UploadFile, limit: int = MAX_IMAGE_BYTES) -> bytes:
    """Read an upload but refuse anything bigger than `limit` (protects memory and disk)."""
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"{upload.filename or 'File'} is too big (max {limit // (1024 * 1024)} MB)")
    return data


def _ext(upload: UploadFile, default: str) -> str:
    ext = Path(upload.filename or "").suffix.lower()
    return ext or default


def url_for(path: Path) -> str:
    return "/media/" + path.relative_to(MEDIA_DIR).as_posix()


def save_image(upload: UploadFile, subdir: str) -> str:
    """Store an uploaded photo, normalised to JPEG so every client can show it."""
    ext = _ext(upload, ".jpg")
    if ext not in IMAGE_EXTS and not (upload.content_type or "").startswith("image/"):
        raise HTTPException(400, f"{upload.filename}: not an image")
    data = np.frombuffer(read_limited(upload), np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, f"{upload.filename}: could not read image (try JPEG or PNG)")
    return url_for(_write_jpeg(img, MEDIA_DIR / subdir, max_width=1400))


def _write_jpeg(img, out_dir: Path, max_width: int, name: str | None = None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    h, w = img.shape[:2]
    if w > max_width:
        img = cv2.resize(img, (max_width, int(h * max_width / w)), interpolation=cv2.INTER_AREA)
    path = out_dir / (name or f"{uuid.uuid4().hex}.jpg")
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return path


def spin_dir(item_id: int) -> Path:
    return MEDIA_DIR / "spins" / str(item_id)


def reset_spin_dir(item_id: int) -> Path:
    d = spin_dir(item_id)
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)
    return d


def spin_from_video(upload: UploadFile, item_id: int, frames: int = 36) -> list[str]:
    """Turn a walk-around video of the thing into `frames` evenly spaced spin frames.

    The owner films one full circle around the object; frame 0 and the last frame end up
    next to each other, so dragging past the end wraps around seamlessly.
    """
    ext = _ext(upload, ".mp4")
    if ext not in VIDEO_EXTS and not (upload.content_type or "").startswith("video/"):
        raise HTTPException(400, "Upload a video (mp4 / mov)")
    # Only a known video extension is used for the temp file name (never the client's raw name).
    tmp = MEDIA_DIR / "tmp" / f"{uuid.uuid4().hex}{ext if ext in VIDEO_EXT_SAFE else '.mp4'}"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with tmp.open("wb") as f:
        while chunk := upload.file.read(1024 * 1024):
            written += len(chunk)
            if written > MAX_VIDEO_BYTES:
                f.close()
                tmp.unlink(missing_ok=True)
                raise HTTPException(413, f"Video is too big (max {MAX_VIDEO_BYTES // (1024 * 1024)} MB)")
            f.write(chunk)
    try:
        return _extract(tmp, item_id, frames)
    finally:
        tmp.unlink(missing_ok=True)


def _extract(video: Path, item_id: int, frames: int) -> list[str]:
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise HTTPException(400, "Could not open that video")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:  # some containers don't report a count: count by reading
        total = 0
        while cap.grab():
            total += 1
        cap.release()
        cap = cv2.VideoCapture(str(video))
    if total < 2:
        cap.release()
        raise HTTPException(400, "Video is too short")
    frames = min(frames, total)
    # One full loop: spread frames over [0, total) so the last isn't a copy of the first.
    wanted = sorted(set(np.linspace(0, total, frames, endpoint=False).astype(int).tolist()))
    out = reset_spin_dir(item_id)
    urls: list[str] = []
    wanted_set, i = set(wanted), 0
    while len(urls) < len(wanted) and cap.grab():
        if i in wanted_set:
            ok, img = cap.retrieve()
            if ok:
                urls.append(url_for(_write_jpeg(img, out, SPIN_MAX_WIDTH, f"{len(urls):03d}.jpg")))
        i += 1
    cap.release()
    if len(urls) < 8:
        raise HTTPException(400, "Could not read enough frames from that video")
    return urls


def spin_from_images(uploads: list[UploadFile], item_id: int) -> list[str]:
    """Owner took N photos walking around the thing, in order."""
    if len(uploads) < 8:
        raise HTTPException(400, "Take at least 8 photos around the item for a 360° view")
    out = reset_spin_dir(item_id)
    urls = []
    for n, up in enumerate(uploads):
        img = cv2.imdecode(np.frombuffer(read_limited(up), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(400, f"{up.filename}: could not read image")
        urls.append(url_for(_write_jpeg(img, out, SPIN_MAX_WIDTH, f"{n:03d}.jpg")))
    return urls
