# Rentify

Neighbors rent out tools, cameras, tents and bikes by the day. The backend handles
availability calendars and booking requests, and both sides review each other after the rental.
**Every listing can have a 360° view:** the owner films one walk-around video and renters drag
(or twist their phone) to look at the thing from every side before they book.

| Layer | Tech |
|---|---|
| App | React Native (Expo SDK 58, TypeScript, React Navigation) |
| API | FastAPI + SQLAlchemy 2 |
| DB | SQLite (`backend/rentathing.db`) |
| 360° | OpenCV cuts a walk-around video into 36 frames; a custom drag/flick/gyro spin viewer in the app |

## Design

- iOS-style UI with a floating **liquid-glass tab bar** (frosted blur, sliding glass lens), glass back
  buttons over photos and a floating glass booking bar.
- **Light, Dark or Automatic** theme plus 5 accent colours (Profile → Appearance), remembered on the device.
- Profile you can customise (photo, name, neighbourhood, bio), stats and reviews.
- Every-app pages: Contact us (saved in the `contact_messages` table), Help & FAQ, Terms of Service,
  Privacy Policy, Rental rules, About, Change password, Delete account.
  Texts live in `mobile/src/content.ts`. They're a starting template, not legal advice: change the
  support email and company details before a real launch.

## Admin

**Web admin console (desktop): `http://<your-mac-ip>:8000/admin`** — log in with
`admin@rentathing.app` / `admin1234` (or the "Use the demo admin account" button).

- **Approvals** — new listings and new users wait here (approve one by one or select several and
  approve together; rejections need a short reason that the person sees in the app).
- **Users**, **Listings**, **Bookings**, **Reviews** — searchable tables; click a row for details and
  actions (approve/reject, suspend/reinstate, make admin, hide/restore, cancel booking, remove review).
- **Support inbox** — Contact-us messages with internal notes, reply by email, resolve / reopen.
- **Audit log** — every admin action with who, what and why. **Settings** — switch approvals on/off.

**On the phone** (Profile → Admin dashboard, admins only) there's a deliberately small version:
key numbers, the approval queue and the support inbox, plus a link to the web console.

How approvals work: new sign-ups can browse and list things but can't book until approved; new
listings are hidden from Explore until approved; editing a rejected listing sends it back for review.
Make someone an admin from the console, or:
`sqlite3 backend/rentathing.db "update users set is_admin=1 where email='you@example.com'"`

## Maps and locations

- Owners set a pick-up location when listing (address search, or "use my current location" on the phone).
- Everyone sees the **approximate area** (rounded to ~500 m, street hidden) on a Google Map; the owner,
  admins and renters with a **confirmed** booking see the exact pin. "Get directions" opens Google Maps.
- No API key needed: maps use Google's embed, directions use Google Maps links, and address search uses
  OpenStreetMap's free geocoder (via the backend, rate-limited to 1 request/second).
- Optional Google key: put `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...` in `mobile/.env` (official Maps Embed
  API, free) and start the backend with `GOOGLE_MAPS_API_KEY=...` (Geocoding API for address search).
  Create the key at console.cloud.google.com → APIs & Services → enable "Maps Embed API" and
  "Geocoding API" → Credentials → Create API key (Google asks for a billing account even for free use).
- Demo data is in San Francisco; change `CITY`/`NEIGHBOURHOODS`/`LOCATIONS` at the top of
  `backend/seed.py` for your city. `python seed.py --upgrade` adds new demo data without wiping yours.

## AI (optional, free with Google Gemini)

Free setup: get a key at https://aistudio.google.com/apikey, `cp backend/.env.example backend/.env`, paste it after `GEMINI_API_KEY=`. Groq (free) and Claude (paid) also work — see `backend/.env.example` and `backend/app/ai.py`.


Two small features, off until you add a key:

1. **Fill in with AI** (My things → List a thing → *Start with photos*): pick 1–4 photos, Claude suggests
   the title, category, description, daily price and deposit. The owner checks and edits before saving;
   the photos are added to the listing automatically.
2. **AI pre-check for admins**: every listing waiting for approval is reviewed against the rental rules
   in the background (on submit, edit and new photos). Approval cards in the web and phone admin show
   *Looks fine / Check this / Likely reject*, the issues found, and a suggested message that pre-fills
   the rejection. The admin always makes the decision; "Run AI check" re-runs it.

Setup: create a key at console.anthropic.com → API Keys (pay-as-you-go prepaid credit), then
`cp backend/.env.example backend/.env` and paste it after `ANTHROPIC_API_KEY=`. No restart needed.
Cost with the default `claude-haiku-5-5`: about $0.001 per fill-in or pre-check (photos are resized
to 768 px). Change `AI_MODEL` in `.env` to switch models. Each user is limited to 30 AI fill-ins per
hour. Only listing photos and text are sent — never names, emails or addresses.

Code: `backend/app/ai.py` (prompts + structured outputs), `backend/app/routers/ai_routes.py`,
`mobile/src/components/AIListingHelper.tsx`. Tests use a fake model and never call the API.

## Categories

Tools & DIY · Garden · Camping · Bikes & scooters · Photo & video · Electronics · Party & events ·
Sports · Kids & baby · Home & cleaning · Music · Travel · Other

## Live chat, notifications, security, CI/CD

- **Chat per booking.** Once someone requests a booking, the renter and the owner can chat. Use the **Message** button on a booking, or the 💬 icon on Explore. It's live over Socket.IO (`/ws/socket.io`), with a typing indicator, *Seen* receipts, quick replies, and an HTTP fallback.
- **Live notifications.** A glass banner slides in for new requests, accept/decline/cancel, returns, reviews and messages. The 🔔 on Explore lists them, and the Bookings tab shows an unread-message badge.
- **Security.** Rate limiter, upload caps, security headers/CSP, an 8-character password minimum and a random secret key. See [SECURITY.md](SECURITY.md).
- **Diagrams.** Stack, booking workflow, chat sequence, CI/CD and data model are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **CI/CD.** `.github/workflows/ci.yml` runs pytest + pip-audit, tsc + the web build, and a Docker build. On `main` it pushes the image to GHCR. Run the image locally with `docker build -t rentathing . && docker run -p 8000:8000 -e SECRET_KEY=change-me -v rat-data:/data rentathing`.

## Rent Club and ID verification

- **Rent Club.** After 5 completed rentals you get a gold **Rent Club** badge (on your profile, listings, bookings and chats) and the **members' group chat**, which is live over Socket.IO. Find it under Profile → Rent Club; non-members see their progress there. Admins can read and post as moderators.
- **ID verification.** Every user uploads a photo of an ID card, passport or driving licence plus a selfie (Profile → ID verification). Booking and listing stay locked until an admin approves the ID in the desktop admin under **ID checks**. The photos are re-encoded, stored outside `/media` in `backend/private/` (git-ignored), viewable only by admins, and deleted as soon as an admin decides. Verified users get a blue shield badge. Admins can switch the requirement off under Settings → *Require ID verification*.

## Payments: card (Stripe, demo) or cash

- When requesting a booking the renter picks **Card** (pay online once the owner confirms) or **Cash** (pay the owner at pick-up).
- **Card, DEMO only.** With no key the app uses a built-in demo checkout that accepts Stripe's test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined. For real **Stripe Checkout in test mode**, put `STRIPE_SECRET_KEY=sk_test_...` in `backend/.env`; no restart is needed. Live keys are ignored on purpose. After paying, Stripe sends the browser back to the app, which confirms the payment with Stripe, so no webhook is needed on a laptop. `/payments/webhook` is optional and needs `STRIPE_WEBHOOK_SECRET`.
- **Refunds.** Cancelling a paid booking, by the renter, the owner or an admin, refunds it automatically (a Stripe test refund).
- **Cash.** The owner taps **Cash received**. Marking the item returned also counts as paid.
- Owners are notified when a card payment arrives. The admin bookings table has a Payment column.

## Run it

### 1. Backend

```bash
cd backend
python3.13 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt   # once
.venv/bin/python seed.py                                                           # demo data + 360° spins
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs: http://localhost:8000/docs (the app itself is at http://localhost:8000 once built, see below)

### 2. App — easiest: in any phone browser

The server also serves the app. Build it once (and again after you change app code):

```bash
cd mobile
npm install                          # once
npx expo export --platform web       # writes mobile/dist, which the server picks up
```

Then on any phone on the same Wi-Fi (Samsung, iPhone…) open **`http://<your-mac-ip>:8000`**
(find the IP with `ipconfig getifaddr en0`). On a laptop browser it shows inside a phone frame.
Restart the server after the first build so it notices `mobile/dist`.

### 2b. App — as a native app with Expo Go

```bash
cd mobile
npx expo start
```

Open **Expo Go** and scan the QR code **from inside Expo Go** (on Android the normal camera opens it in
the browser instead). Phone must be on the same Wi-Fi as your laptop. Press `i` for the iOS simulator
or `a` for an Android emulator. The app finds the API automatically on the laptop's IP at port 8000.
To point it elsewhere (e.g. a tunnel): `EXPO_PUBLIC_API_URL=https://xyz.ngrok.app npx expo start`.

**Demo login:** `demo@rentathing.app` / `demo1234` (there's a one-tap button on the login screen).
Other seeded neighbors: `alice@`, `bob@`, `carla@rentathing.app`, same password.

## 2-minute demo script

1. **Log in as demo** → Explore shows neighbors' things. Tap the **360° view** filter.
2. Open the **camera** → drag across the picture to walk around it, flick it to spin, tap ⛶ for
   fullscreen, then tap the phone icon and **twist your phone** to rotate it.
3. Scroll to **Availability**: grey days are booked/blocked, yellow days have pending requests.
   Pick two free days → **Request** → add a message → send.
4. **Bookings → I'm lending**: two neighbors want your drill on overlapping days. **Accept** Carla's
   → Alice's overlapping request is declined automatically and the days lock on the calendar.
5. **Bookings → I'm renting**: the camera rental is finished → **Review Alice** with stars.
6. **My things → List a thing** → fill details → **Record walk-around video** → 360° view is built
   server-side in a few seconds.

## How it works

### Booking rules (`backend/app/routers/bookings.py`, `services.py`)
- Statuses: `pending → accepted → completed`, or `declined` / `cancelled`.
- A request is rejected if it overlaps an **accepted** booking or an owner **blackout**.
  Pending requests don't block, so several neighbors can ask for the same days.
- Accepting a request re-checks conflicts and **auto-declines** overlapping pending requests.
- Owners can **Mark as returned** once the rental has started; accepted rentals whose last day has
  passed become `completed` automatically. Completion unlocks **one review per side**.
- Item rating = renters' reviews of that item; user rating = all reviews about that person.

### 360° pipeline (`backend/app/media.py`, `mobile/src/components/SpinViewer.tsx`)
1. Owner records a ~15 s video circling the object (or picks 8+ photos in order).
2. `POST /items/{id}/spin/video` → OpenCV samples 36 evenly spaced frames over the loop, resizes
   them to 900px JPEGs and stores them in `media/spins/{id}/`.
3. The app mounts all frames stacked and only shows the current one, so spinning never flickers.
   Horizontal drag = one full turn per screen width, flick has momentum, idle auto-rotate,
   gyroscope "twist to look around" mode in fullscreen.

The seeded demo spins are rendered by a tiny 3D renderer in `backend/seed_render.py` so the
demo works without filming anything.

### API overview

| Method | Path | What |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | returns JWT + user |
| GET/PATCH | `/users/me`, POST `/users/me/avatar` | profile |
| GET | `/users/{id}`, `/users/{id}/reviews` | public profile + reviews |
| GET | `/items?q=&category=&has_360=&available_from=&available_to=` | search |
| POST/GET/PATCH/DELETE | `/items`, `/items/mine`, `/items/{id}` | listings |
| POST | `/items/{id}/photos`, `/items/{id}/spin/video`, `/items/{id}/spin/frames` | media |
| GET | `/items/{id}/calendar?start=&end=` | booked / blocked / pending ranges + unavailable days |
| POST/DELETE | `/items/{id}/blackouts[/{bid}]` | owner blocks dates |
| POST/GET | `/bookings`, `/bookings?role=renter\|owner` | request / list |
| POST | `/bookings/{id}/accept\|decline\|cancel\|complete` | lifecycle |
| POST | `/reviews` | review after a completed rental |

### Tests

```bash
cd backend && .venv/bin/python -m pytest -q
```

Covers auth, overlap rules, auto-decline, blackouts, review gating, photo upload and 360° video extraction.

## Ideas if you have time left
- Push notifications for new requests (`expo-notifications`).
- In-app chat per booking.
- Map view of nearby items (store lat/lng on users).
- Deposit handling with a payment provider's test mode.
