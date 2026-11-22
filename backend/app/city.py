"""The app's home city: Prishtina. Items there are listed first; others get an "outside Prishtina" note.

An item counts as in the city when its pick-up pin is within RADIUS_KM of the centre, or (no pin)
when its location text mentions the city. Change the city with HOME_CITY_* environment variables.
"""

import math
import os

NAME = os.getenv("HOME_CITY_NAME", "Prishtina")
LAT = float(os.getenv("HOME_CITY_LAT", "42.6629"))
LNG = float(os.getenv("HOME_CITY_LNG", "21.1655"))
RADIUS_KM = float(os.getenv("HOME_CITY_RADIUS_KM", "12"))
# Spellings people use for the city (Albanian, Serbian, English), lower-case.
ALIASES = tuple(
    a.strip().lower()
    for a in os.getenv("HOME_CITY_ALIASES", "prishtin,pristin,prištin,priština,prishtinë").split(",")
    if a.strip()
)


def distance_km(lat: float, lng: float, lat2: float = LAT, lng2: float = LNG) -> float:
    """Great-circle distance (haversine)."""
    p1, p2 = math.radians(lat), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def contains(lat: float | None, lng: float | None, *texts: str | None) -> bool:
    if lat is not None and lng is not None:
        return distance_km(lat, lng) <= RADIUS_KM
    blob = " ".join(t for t in texts if t).lower()
    return any(a in blob for a in ALIASES)


def item_in_city(item) -> bool:
    return contains(item.lat, item.lng, item.location_label, item.neighborhood)


def config() -> dict:
    return {"name": NAME, "lat": LAT, "lng": LNG, "radius_km": RADIUS_KM}


def viewbox(km: float = 40) -> str:
    """Nominatim viewbox (left,top,right,bottom) around the city, to prefer local results."""
    dlat = km / 111
    dlng = km / (111 * math.cos(math.radians(LAT)))
    return f"{LNG - dlng},{LAT + dlat},{LNG + dlng},{LAT - dlat}"
