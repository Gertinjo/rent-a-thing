import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .database import BASE_DIR, MEDIA_DIR, Base, engine, upgrade_schema
from .ratelimit import RateLimitMiddleware
from .realtime import sio_app
from .routers import admin, ai_routes, bookings, chat_routes, geo, items, users

Base.metadata.create_all(bind=engine)
upgrade_schema()

app = FastAPI(
    title="Rent a Thing API",
    description="Neighbors rent out tools, cameras, tents and bikes by the day.",
    version="1.1.0",
)


# ---------------------------------------------------------------------------
# security middleware (outermost first: headers -> CORS -> rate limit -> app)
# ---------------------------------------------------------------------------

# Content-Security-Policy for the admin console: only our own scripts, Google Maps frames.
ADMIN_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https:; connect-src 'self'; "
    "frame-src https://maps.google.com https://www.google.com; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers += [
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"permissions-policy", b"camera=(self), microphone=(self), geolocation=(self)"),
                    (b"x-frame-options", b"SAMEORIGIN"),
                ]
                if path.startswith("/admin"):
                    headers.append((b"content-security-policy", ADMIN_CSP.encode()))
                    headers.append((b"cache-control", b"no-store"))
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(RateLimitMiddleware)
# Login uses bearer tokens (no cookies), so credentials are never sent cross-site.
# Set CORS_ORIGINS="https://app.example.com,https://admin.example.com" in production.
_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(SecurityHeadersMiddleware)

app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
# Live chat + notifications (Socket.IO). Client path: /ws/socket.io
app.mount("/ws", sio_app, name="realtime")

app.include_router(users.router)
app.include_router(items.router)
app.include_router(bookings.router)
app.include_router(chat_routes.router)
app.include_router(admin.router)
app.include_router(geo.router)
app.include_router(ai_routes.router)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/config", tags=["config"])
def public_config():
    """Numbers the app shows to everyone: the service fee owners pay and the currency."""
    from . import services
    from .database import SessionLocal

    with SessionLocal() as db:
        fee = float(services.get_setting_str(db, "platform_fee_percent"))
    return {"platform_fee_percent": fee, "currency": "EUR", "currency_symbol": "€"}


# Desktop admin console (plain HTML/JS, no build step): http://<server>:8000/admin
@app.get("/admin", include_in_schema=False)
def admin_console_redirect():
    # The static mount only matches "/admin/...", so send the bare URL there.
    return RedirectResponse("/admin/")


app.mount("/admin", StaticFiles(directory=BASE_DIR / "admin_web", html=True), name="admin")

# Serve the phone web app from the same address as the API, so a phone browser only needs
# http://<laptop-ip>:8000. Build it with:  cd mobile && npx expo export --platform web
WEB_DIR = BASE_DIR.parent / "mobile" / "dist"
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
