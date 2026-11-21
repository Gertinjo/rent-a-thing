"""Address search for the "set pick-up location" field.

Uses Google's Geocoding API when GOOGLE_MAPS_API_KEY is set, otherwise OpenStreetMap's free
Nominatim service (no key; max ~1 request/second, so results are cached and calls are spaced).
"""

import os
import threading
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..deps import get_current_user
from ..models import User

router = APIRouter(prefix="/geo", tags=["location"])

GOOGLE_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
USER_AGENT = "RentAThing/1.0 (neighbourhood rental app)"
_cache: dict[str, list] = {}
_lock = threading.Lock()
_last_call = 0.0


class Place(BaseModel):
    label: str  # "Street, Area, City" — the part before the first comma is treated as private
    lat: float
    lng: float


def _short_label(addr: dict, fallback: str) -> str:
    street = " ".join(x for x in [addr.get("house_number"), addr.get("road")] if x)
    area = addr.get("neighbourhood") or addr.get("suburb") or addr.get("quarter") or addr.get("city_district")
    city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality")
    parts = [p for p in [street or addr.get("amenity") or addr.get("building"), area, city] if p]
    return ", ".join(dict.fromkeys(parts)) or fallback


def _nominatim(path: str, params: dict) -> list | dict:
    global _last_call
    with _lock:  # be polite: at most one request per second
        wait = 1.0 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
    try:
        r = httpx.get(
            f"https://nominatim.openstreetmap.org/{path}",
            params={**params, "format": "jsonv2", "addressdetails": 1},
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError:
        raise HTTPException(502, "Address search is unavailable right now. Try again in a moment.")


def _google(params: dict) -> list[dict]:
    try:
        r = httpx.get("https://maps.googleapis.com/maps/api/geocode/json", params={**params, "key": GOOGLE_KEY}, timeout=10)
        r.raise_for_status()
        return r.json().get("results", [])
    except httpx.HTTPError:
        raise HTTPException(502, "Address search is unavailable right now.")


def _google_place(res: dict) -> Place:
    comps = {t: c["long_name"] for c in res.get("address_components", []) for t in c["types"]}
    street = " ".join(x for x in [comps.get("street_number"), comps.get("route")] if x)
    area = comps.get("neighborhood") or comps.get("sublocality")
    city = comps.get("locality") or comps.get("postal_town")
    label = ", ".join(dict.fromkeys(p for p in [street, area, city] if p)) or res.get("formatted_address", "")
    loc = res["geometry"]["location"]
    return Place(label=label, lat=loc["lat"], lng=loc["lng"])


@router.get("/search", response_model=list[Place])
def search(q: str = Query(min_length=3, max_length=200), _: User = Depends(get_current_user)):
    key = q.strip().lower()
    if key in _cache:
        return _cache[key]
    if GOOGLE_KEY:
        places = [_google_place(r) for r in _google({"address": q})[:5]]
    else:
        rows = _nominatim("search", {"q": q, "limit": 5})
        places = [Place(label=_short_label(r.get("address", {}), r.get("display_name", q)), lat=float(r["lat"]), lng=float(r["lon"])) for r in rows]
    _cache[key] = places
    return places


@router.get("/reverse", response_model=Place)
def reverse(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180), _: User = Depends(get_current_user)):
    if GOOGLE_KEY:
        rows = _google({"latlng": f"{lat},{lng}"})
        if rows:
            p = _google_place(rows[0])
            return Place(label=p.label, lat=lat, lng=lng)
        return Place(label="Pinned location", lat=lat, lng=lng)
    r = _nominatim("reverse", {"lat": lat, "lon": lng, "zoom": 18})
    label = _short_label(r.get("address", {}), "Pinned location") if isinstance(r, dict) else "Pinned location"
    return Place(label=label, lat=lat, lng=lng)
