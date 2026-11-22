"""Pick-up and return reminders for confirmed bookings.

A loop started by main.py calls send_due_reminders() every few minutes. Each reminder goes out once
per booking (table booking_reminders), to both the renter and the owner, as an in-app notification:

- pick-up: from 8:00 the day before the rental starts (or on the day, if the booking was confirmed late)
- return:  from 8:00 on the last day of the rental
"""

import asyncio
import logging
import os
from datetime import date, datetime, timedelta

import anyio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import chat, services
from .database import SessionLocal
from .models import Booking, BookingReminder, BookingStatus

log = logging.getLogger("rentathing.reminders")

SEND_FROM_HOUR = 8  # no reminders in the middle of the night
INTERVAL_SECONDS = 600


def _first(name: str) -> str:
    return name.split(" ")[0]


def _messages(b: Booking, kind: str, today: date) -> list[tuple[int, str, str, str]]:
    """(user_id, notification kind, title, body) for the renter and the owner."""
    item, owner, renter = b.item.title, _first(b.item.owner.name), _first(b.renter.name)
    if kind == "pickup":
        when = "today" if b.start_date == today else "tomorrow"
        pay = f" Bring {services.money(b.total_price)} in cash." if b.payment_status == "cash_due" else ""
        return [
            (b.renter_id, "reminder_pickup", f"Pick-up {when}: {item}",
             f"From {owner}.{pay} Take a few photos when you get it, so you both have a record."),
            (b.item.owner_id, "reminder_pickup", f"Pick-up {when}: {item}",
             f"{renter} picks it up. Take a few photos at the handover, so you both have a record of its condition."),
        ]
    # the action comes first in titles: long item names get cut off in the list
    return [
        (b.renter_id, "reminder_return", f"Return today: {item}",
         f"{owner} is expecting it back. Add return photos when you hand it over."),
        (b.item.owner_id, "reminder_return", f"Coming back today: {item}",
         f"{renter} returns it today. Check it over, add return photos, then mark it as returned."),
    ]


def due(b: Booking, today: date) -> list[str]:
    """Reminder kinds this booking needs today (before checking what was already sent)."""
    if b.status != BookingStatus.ACCEPTED:
        return []
    kinds = []
    if b.start_date - timedelta(days=1) <= today <= b.start_date:
        kinds.append("pickup")
    if b.end_date == today:
        kinds.append("return")
    return kinds


def send_due_reminders(now: datetime | None = None) -> int:
    """Send whatever is due. Returns how many notifications went out. Safe to call often."""
    from .realtime import push_notification  # imported late: realtime imports a lot

    now = now or datetime.now()
    if now.hour < SEND_FROM_HOUR:
        return 0
    today = now.date()
    sent = 0
    with SessionLocal() as db:
        candidates = db.scalars(
            select(Booking).where(
                Booking.status == BookingStatus.ACCEPTED,
                Booking.end_date >= today,
                Booking.start_date <= today + timedelta(days=1),
            )
        ).all()
        for b in candidates:
            done = set(db.scalars(select(BookingReminder.kind).where(BookingReminder.booking_id == b.id)))
            for kind in due(b, today):
                if kind in done:
                    continue
                db.add(BookingReminder(booking_id=b.id, kind=kind))
                notes = [chat.notify(db, uid, nkind, title, body, b) for uid, nkind, title, body in _messages(b, kind, today)]
                try:
                    db.commit()
                except IntegrityError:  # another worker sent it a moment ago
                    db.rollback()
                    continue
                for n in notes:
                    push_notification(n.user_id, chat.notification_out(n))
                sent += len(notes)
    if sent:
        log.info("sent %d booking reminders", sent)
    return sent


async def reminder_loop() -> None:
    """Runs for the life of the server (started in main.py). Set REMINDERS_DISABLED=1 to turn it off."""
    if os.getenv("REMINDERS_DISABLED") == "1":
        return
    while True:
        try:
            # in a worker thread, so the live push (anyio.from_thread) works like in the REST endpoints
            await anyio.to_thread.run_sync(send_due_reminders)
        except Exception:
            log.exception("reminder run failed")
        await asyncio.sleep(INTERVAL_SECONDS)
