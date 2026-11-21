import json
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .. import ai
from ..database import SessionLocal
from ..deps import get_current_user
from ..media import read_limited
from ..models import Item, Review_, User

router = APIRouter(prefix="/ai", tags=["ai"])
log = logging.getLogger("rentathing.ai")


class AIStatus(BaseModel):
    enabled: bool
    provider: str | None
    provider_label: str
    model: str


@router.get("/status", response_model=AIStatus)
def status():
    return AIStatus(enabled=ai.enabled(), provider=ai.provider(), provider_label=ai.provider_label(), model=ai.model())


@router.post("/listing-draft", response_model=ai.ListingDraft)
def listing_draft(
    files: list[UploadFile] = File(..., description="1-4 photos of the item"),
    note: str = Form(""),
    user: User = Depends(get_current_user),
):
    """Suggest title, category, description, price and deposit from photos. Nothing is saved."""
    if not ai.enabled():
        raise HTTPException(503, "AI isn’t set up on this server yet.")
    if not files:
        raise HTTPException(400, "Add at least one photo.")
    try:
        ai.check_rate_limit(user.id)
        images = [ai.image_from_bytes(read_limited(f)) for f in files[: ai.MAX_IMAGES]]
        return ai.draft_listing(images, note)
    except ai.AIError as e:
        raise HTTPException(502, str(e))


# ---------------------------------------------------------------------------
# admin pre-check (runs in the background when a listing is waiting for review)
# ---------------------------------------------------------------------------


def run_precheck(item_id: int) -> None:
    with SessionLocal() as db:
        item = db.get(Item, item_id)
        if not item or item.review_status != Review_.PENDING:
            return
        item.ai_check = json.dumps(ai.precheck_payload(item))
        db.commit()


def schedule_precheck(tasks: BackgroundTasks, item: Item) -> None:
    if item.review_status == Review_.PENDING and ai.enabled():
        tasks.add_task(run_precheck, item.id)
