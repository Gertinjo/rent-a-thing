"""Live chat + notifications over Socket.IO.

The client connects to  <server>/ws/socket.io  with  auth: {token: "<JWT>"}.
Each user joins the private room "user:<id>"; everything is sent to rooms, never broadcast.

Server -> client events
  message       {booking_id, message}           new chat message (to both people)
  notification  {notification}                  something happened (new request, accepted, ...)
  typing        {booking_id, user_id}           the other person is typing
  read          {booking_id, user_id}           the other person read your messages
  unread        {messages, notifications}       fresh badge counts
Client -> server events (with acknowledgement)
  send_message  {booking_id, body}   -> {ok, message} | {ok: false, error}
  typing        {booking_id}
  read          {booking_id}         -> {ok}
"""

import functools
import logging

import anyio
import socketio

from . import chat
from .database import SessionLocal
from .models import User
from .ratelimit import chat_allowed
from .security import decode_token

log = logging.getLogger("rentathing.realtime")

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", logger=False, engineio_logger=False)
# Mounted by main.py at /ws  ->  the Socket.IO endpoint is /ws/socket.io
sio_app = socketio.ASGIApp(sio, socketio_path="ws/socket.io")


def room(user_id: int) -> str:
    return f"user:{user_id}"


# ---------------------------------------------------------------------------
# helpers usable from the (sync) REST endpoints
# ---------------------------------------------------------------------------


def emit_to_user(user_id: int, event: str, data: dict) -> None:
    """Send an event from synchronous code (FastAPI runs `def` endpoints in a worker thread)."""
    try:
        anyio.from_thread.run(functools.partial(sio.emit, event, data, room=room(user_id)))
    except Exception:  # no event loop (scripts, some tests): live delivery is best-effort
        log.debug("live emit skipped", exc_info=True)


def push_notification(user_id: int, notification: dict) -> None:
    emit_to_user(user_id, "notification", {"notification": notification})
    with SessionLocal() as db:
        emit_to_user(user_id, "unread", chat.unread_counts(db, user_id))


# ---------------------------------------------------------------------------
# socket events
# ---------------------------------------------------------------------------


def _authenticate(token: str | None) -> int | None:
    uid = decode_token(token) if token else None
    if not uid:
        return None
    with SessionLocal() as db:
        u = db.get(User, uid)
        return uid if u and not u.is_suspended else None


@sio.event
async def connect(sid, environ, auth):
    uid = await anyio.to_thread.run_sync(_authenticate, (auth or {}).get("token"))
    if not uid:
        raise socketio.exceptions.ConnectionRefusedError("unauthorized")
    await sio.save_session(sid, {"user_id": uid})
    await sio.enter_room(sid, room(uid))
    counts = await anyio.to_thread.run_sync(lambda: _with_db(chat.unread_counts, uid))
    await sio.emit("unread", counts, to=sid)


def _with_db(fn, *args):
    with SessionLocal() as db:
        return fn(db, *args)


async def _user(sid) -> int | None:
    try:
        return (await sio.get_session(sid)).get("user_id")
    except KeyError:
        return None


@sio.event
async def send_message(sid, data):
    uid = await _user(sid)
    if not uid:
        return {"ok": False, "error": "Not logged in"}
    if not chat_allowed(uid):
        return {"ok": False, "error": "You’re sending messages too fast. Wait a few seconds."}
    try:
        booking_id = int((data or {}).get("booking_id"))
        body = str((data or {}).get("body", ""))
        message, to, note = await anyio.to_thread.run_sync(lambda: _with_db(chat.send_message, booking_id, uid, body))
    except chat.ChatError as e:
        return {"ok": False, "error": e.detail}
    except (TypeError, ValueError):
        return {"ok": False, "error": "Bad request"}
    payload = {"booking_id": booking_id, "message": message}
    await sio.emit("message", payload, room=room(uid))
    await sio.emit("message", payload, room=room(to))
    await sio.emit("notification", {"notification": note}, room=room(to))
    counts = await anyio.to_thread.run_sync(lambda: _with_db(chat.unread_counts, to))
    await sio.emit("unread", counts, room=room(to))
    return {"ok": True, "message": message}


@sio.event
async def typing(sid, data):
    uid = await _user(sid)
    if not uid:
        return
    try:
        booking_id = int((data or {}).get("booking_id"))
        b_other = await anyio.to_thread.run_sync(
            lambda: _with_db(lambda db, bid, u: chat.other_party(chat.booking_for(db, bid, u), u), booking_id, uid)
        )
    except (chat.ChatError, TypeError, ValueError):
        return
    await sio.emit("typing", {"booking_id": booking_id, "user_id": uid}, room=room(b_other))


@sio.event
async def read(sid, data):
    uid = await _user(sid)
    if not uid:
        return {"ok": False}
    try:
        booking_id = int((data or {}).get("booking_id"))
        count, other = await anyio.to_thread.run_sync(lambda: _with_db(chat.mark_read, booking_id, uid))
    except (chat.ChatError, TypeError, ValueError):
        return {"ok": False}
    if count:
        await sio.emit("read", {"booking_id": booking_id, "user_id": uid}, room=room(other))
    counts = await anyio.to_thread.run_sync(lambda: _with_db(chat.unread_counts, uid))
    await sio.emit("unread", counts, room=room(uid))
    return {"ok": True}
