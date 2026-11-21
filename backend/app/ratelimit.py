"""In-memory sliding-window rate limiter (no extra dependencies).

Used as ASGI middleware for the HTTP API and directly by the Socket.IO chat. Limits are per client
IP for HTTP and per user for chat. For several server processes, swap the store for Redis.

Disable with RATE_LIMIT_DISABLED=1 (the test-suite does this, except in its own limiter test).
Behind a reverse proxy set TRUST_PROXY=1 so the client IP is read from X-Forwarded-For.
"""

import json
import os
import threading
import time
from collections import defaultdict, deque


class SlidingWindow:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: float) -> tuple[bool, int, float]:
        """Record one hit. Returns (allowed, remaining, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] >= window:
                q.popleft()
            if len(q) >= limit:
                return False, 0, max(0.0, window - (now - q[0]))
            q.append(now)
            return True, limit - len(q), 0.0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


store = SlidingWindow()

# (method or "*", path prefix, limit, window seconds, name) — first match wins, then the global rule.
RULES = [
    ("POST", "/auth/login", 10, 60, "login"),
    ("POST", "/auth/register", 10, 3600, "register"),
    ("POST", "/users/me/password", 5, 600, "password"),
    ("*", "/ai/", 20, 60, "ai"),
    ("POST", "/admin/items/", 30, 60, "admin-ai"),
    ("*", "/geo/", 30, 60, "geo"),
    ("POST", "/bookings", 30, 60, "bookings-write"),
    ("POST", "/support/contact", 5, 600, "contact"),
]
GLOBAL = (300, 60)  # every other API request
# Static files and the websocket are not limited here.
SKIP_PREFIXES = ("/media/", "/_expo/", "/assets/", "/admin/admin.", "/ws/", "/favicon")

CHAT_LIMIT = (20, 10)  # messages per user per 10 seconds


def disabled() -> bool:
    return os.getenv("RATE_LIMIT_DISABLED") == "1"


def _client_ip(scope) -> str:
    if os.getenv("TRUST_PROXY") == "1":
        for k, v in scope.get("headers", []):
            if k == b"x-forwarded-for":
                return v.decode().split(",")[0].strip()
    client = scope.get("client")
    return client[0] if client else "unknown"


class RateLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or disabled():
            return await self.app(scope, receive, send)
        path, method = scope["path"], scope["method"]
        if method == "OPTIONS" or path.startswith(SKIP_PREFIXES) or "." in path.rsplit("/", 1)[-1]:
            return await self.app(scope, receive, send)

        limit, window, name = GLOBAL[0], GLOBAL[1], "global"
        for m, prefix, lim, win, rule in RULES:
            if (m == "*" or m == method) and path.startswith(prefix):
                limit, window, name = lim, win, rule
                break
        ok, remaining, retry = store.hit(f"{name}:{_client_ip(scope)}", limit, window)
        if not ok:
            body = json.dumps({"detail": f"Too many requests. Try again in {int(retry) + 1} seconds."}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 429,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"retry-after", str(int(retry) + 1).encode()),
                        (b"x-ratelimit-limit", str(limit).encode()),
                        (b"x-ratelimit-remaining", b"0"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"] += [(b"x-ratelimit-limit", str(limit).encode()), (b"x-ratelimit-remaining", str(remaining).encode())]
            await send(message)

        await self.app(scope, receive, send_with_headers)


def chat_allowed(user_id: int) -> bool:
    if disabled():
        return True
    ok, _, _ = store.hit(f"chat:{user_id}", *CHAT_LIMIT)
    return ok
