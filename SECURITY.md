# Security — Rent a Thing

A review of the app before the hackathon demo: what was wrong, what is fixed, and what is still open.

Report a problem privately to the team rather than in a public issue.

## Fixed in this pass

| # | Issue | Risk | Fix | Where |
|---|-------|------|-----|-------|
| 1 | **Hard-coded JWT secret** (default in the code) | Anyone reading the repo could forge a login token for any user, admins included | `SECRET_KEY` from the environment. Without it, a random 48-byte key is generated once and stored in `backend/.secret_key` (git-ignored, mode 600). | `app/security.py` |
| 2 | **30-day login tokens** | A stolen token stays valid for a month | Tokens now last **7 days** | `app/security.py` |
| 3 | **No rate limiting** | Brute-forcing passwords, mass sign-ups, burning the free AI quota, flooding geocoding and chat | Sliding-window limiter on every request (429 + `Retry-After`). See the limits below. | `app/ratelimit.py` |
| 4 | **Unbounded uploads** | One huge "photo" or video could fill the disk or memory | Photos max **10 MB** (read in chunks, rejected past the cap), videos max **150 MB** (streamed to disk), and only known extensions are kept in file names | `app/media.py` |
| 5 | **6-character passwords** | Weak | Minimum **8 characters** on sign-up and password change | `app/schemas.py` |
| 6 | **No security headers** | Clickjacking, MIME sniffing, leaking full URLs in `Referer` | `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options: SAMEORIGIN` on every response. The admin console also gets a strict **Content-Security-Policy** (own scripts only, no inline JS, `frame-ancestors 'none'`) and `Cache-Control: no-store`. | `app/main.py` |
| 7 | **CORS `*` with credentials** | Unsafe combination | `allow_credentials=False`, which is safe because auth is a bearer token and no cookies are used. Origins come from `CORS_ORIGINS` (set it in production). | `app/main.py` |
| 8 | **XSS in the admin console** | A user named `<img onerror=…>` could run script in the admin's browser | Every user-supplied value goes through `esc()` before it is inserted as HTML, and the CSP blocks inline script as a second layer | `admin_web/admin.js` |
| 9 | **Chat authorization** (new feature) | Reading or writing someone else's conversation | Only the renter and the owner of a booking can read, send or mark messages read; anyone else gets **404**, not 403, so they can't tell the booking exists. Chats close when a booking is declined or cancelled. | `app/chat.py` |
| 10 | **Socket.IO authentication** | Anonymous sockets receiving other people's events | The JWT is checked in the handshake, suspended users are refused, and every event goes to the private room `user:<id>`. Nothing is broadcast. | `app/realtime.py` |
| 11 | **Exact home address exposure** | Stalking or theft risk | Public listings show only an approximate spot (snapped to a ~500 m grid). The exact pin is shown only to the renter of a confirmed booking. | `app/services.py` |
| 12 | **AI keys** | Leaking paid keys | Keys live only in `backend/.env` (git-ignored). The AI is optional, and the app works with `AI_DISABLED=1`. | `app/ai.py` |

| 13 | **Identity documents** (new feature) | ID photos are highly sensitive | They're stored outside the public `/media` folder, fetched only by admins with their token (sent `no-store`), re-encoded to strip EXIF/GPS, and deleted once the check is done. Uploads are limited to 5 per hour. | `app/verification.py` |
| 14 | **Club chat access** | Non-members reading the group chat | Server checks membership (or admin) on every read and send, over both HTTP and the socket | `app/club.py` |

| 15 | **Payments** (new feature) | Charging real cards, or faking a payment | Demo only: live Stripe keys are refused. Card numbers never touch our server in Stripe mode, because Stripe hosts the card page. "Paid" is set only after the server checks with Stripe that the session is paid and belongs to that booking, so a URL alone can't mark it paid. Only the renter can pay, and only the owner can confirm cash. | `app/payments.py` |

### Rate limits (per IP, or per user for chat)

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 10 / minute |
| `POST /auth/register` | 10 / hour |
| password change | 5 / 10 minutes |
| `/ai/*` | 20 / minute |
| `/geo/*` (OpenStreetMap geocoding) | 30 / minute |
| `POST /bookings` | 30 / minute |
| contact form | 5 / 10 minutes |
| chat messages (socket + HTTP) | 20 / 10 seconds per user |
| everything else | 300 / minute |

Behind a reverse proxy, set `TRUST_PROXY=1` so the real client IP is read from `X-Forwarded-For`. The limiter is in memory, so with several server processes you would move it to Redis.

## Still open (known risks)

- **Plain HTTP on the local network.** Tokens travel unencrypted on the Wi-Fi. Production must run behind HTTPS (Caddy, nginx, or the host's TLS).
- **Token stored in `localStorage` on web** (AsyncStorage on native). An XSS bug in the app would expose it. React escapes text by default, and the app renders no raw HTML.
- **No token revocation.** Logging out deletes the token on the device only. A server-side deny-list or short tokens with refresh tokens would fix this.
- **No email verification or 2FA.** Admin approval of new users is the current gate.
- **SQLite.** Fine for the demo. Use Postgres for real traffic (`DATABASE_URL`).
- **Uploads are checked by extension and content type, not by decoding.** Re-encoding images server-side would strip EXIF GPS data and reject disguised files.
- **Chat moderation.** Messages are stored in plain text and admins can't review reported chats yet.
- **Dependency audit.** CI runs `pip-audit` (blocking) and `npm audit` (report only) on every push.

## Checklist for production

1. Set `SECRET_KEY` (long, random), `CORS_ORIGINS`, and `TRUST_PROXY=1` behind a proxy.
2. Serve over HTTPS only.
3. Keep `backend/.env`, `.secret_key`, and `rentathing.db` out of git. The `.gitignore` already does this.
4. Rotate any API key that has ever been pasted into a chat or a commit.
