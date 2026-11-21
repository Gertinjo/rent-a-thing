# Rent a Thing — session handoff (2026-11-21)

48-hour hackathon project. Theme: neighbours rent out tools, cameras, tents, bikes by the day; backend
handles availability calendars + booking requests; reviews after each rental. Extra: 360° view of items.

## Where things are
- Project: `~/Documents/RentAThing/rent-a-thing/` — `backend/` (FastAPI + SQLite), `mobile/` (Expo SDK 58,
  React Native 0.88, TypeScript, React Navigation — not Expo Router), `README.md` (full docs).
- DB: `backend/rentathing.db`. Media: `backend/media/` (demo renders in `media/_seed_cache/`).
- Web admin console: `backend/admin_web/` (plain HTML/CSS/JS, served at `/admin`).

## How to run (user's Mac; IP changes — check with `ipconfig getifaddr en0`, last seen 192.168.223.24)
- API + web app + admin: `cd backend && .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
  (use `python -m uvicorn`; venv was rebuilt after moving the folder).
- Phone app in a browser (user has a **Samsung**, uses Chrome/Samsung Internet): `http://<ip>:8000`
- Web admin: `http://<ip>:8000/admin`
- After changing app code, rebuild the web app: `cd mobile && npx expo export --platform web`
  (FastAPI serves `mobile/dist`). Expo dev server: `npx expo start --port 8082` (Expo Go: scan from inside the app).
- Tests: `cd backend && .venv/bin/python -m pytest -q` (10 passing). Typecheck: `cd mobile && npx tsc --noEmit` (clean).
- Demo data: `python seed.py` wipes + reseeds; `python seed.py --upgrade` adds demo data without wiping.
  The user has their own data in the DB (e.g. listing "Amant", Alice suspended) — don't wipe without asking.

## Logins
- Demo user: demo@rentathing.app / demo1234 (also alice@, bob@, carla@, dan@ (pending), mia@ (pending))
- Admin: admin@rentathing.app / admin1234

## Features built
- Auth (JWT), profiles (photo, name, neighbourhood, bio), change password, delete account.
- Listings with photos + **360° spin view** (owner films a walk-around video → OpenCV cuts 36 frames;
  drag/flick viewer, gyroscope "twist" mode on native). Demo spins rendered by `backend/seed_render.py`.
- 13 categories: tools, garden, camping, bikes, photo, electronics, party, sports, kids, home, music, travel, other.
- Availability calendar, booking requests (pending → accepted → completed / declined / cancelled), owner
  blackout dates, overlap rules, auto-decline overlapping requests, reviews both ways after completion.
- **Locations/maps**: owner sets pick-up spot (address search via backend `/geo/search` → OpenStreetMap
  Nominatim, or "use current location"); item page shows Google Maps embed (keyless) + "Get directions"
  link. Public sees approximate area (~500 m, street hidden); exact pin for owner/admin/confirmed renters.
  Demo city: San Francisco (configurable at top of `backend/seed.py`).
- **Approvals**: new users can't book until approved; new listings hidden until approved; rejections carry
  a reason shown to the user; editing a rejected listing resubmits it. Toggle in admin Settings.
- **Admin**: desktop web console (overview KPIs + chart, approvals queue with bulk approve, users, listings,
  bookings, reviews, support inbox, audit log, settings) and a simple phone admin (Profile → Admin
  dashboard: numbers, approvals, inbox, link to web admin). Suspend/reinstate, make admin, hide listings,
  cancel bookings, remove reviews — all logged in `admin_actions`.
- Support: Contact us (stored in `contact_messages`), Help & FAQ, Terms, Privacy, Rental rules, About
  (texts in `mobile/src/content.ts` — template, not legal advice; support email is a placeholder).
- Design: iOS-style, floating **liquid-glass tab bar** (expo-blur), Light/Dark/Automatic theme + 5 accent
  colours (default tangerine; user disliked green), phone-frame on desktop browsers.
- **AI** — providers: Gemini (free, default `gemini-3.5-flash-lite`), Groq (free, `qwen/qwen3.8-27b`), Claude Haiku 5.5 (paid). Off until a key (`GEMINI_API_KEY` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY`) is in `backend/.env`
  (copy `backend/.env.example`; picked up without restart):
  1. "Fill in with AI" on New listing (photos → title/category/description/price/deposit) — `POST /ai/listing-draft`.
  2. AI pre-check of pending listings for admins (background on submit/edit/photos; `POST /admin/items/{id}/ai-check`),
     shown on approval cards; rejection message pre-filled.
  Code: `backend/app/ai.py`, `backend/app/routers/ai_routes.py`, `mobile/src/components/AIListingHelper.tsx`.
  Uses Anthropic Python SDK 2.12 `client.messages.parse(..., output_format=PydanticModel, output_config={"effort": "low"})`.
  Tested only against a local fake API — **not yet with a real key**. Tests set `AI_DISABLED=1`.

## Fees, currency, terms
- Prices are in euros (`CURRENCY` in `mobile/src/theme.tsx`; `money()` in `backend/admin_web/admin.js`).
- Service fee: 10% of each booking total, paid by the owner (`platform_fee`, `owner_payout` on bookings;
  admin setting `platform_fee_percent`, public `GET /config`). Renters pay the listed price.
- Adding a product shows a lender-terms pop-up (`mobile/src/components/LenderTermsModal.tsx`, text in
  `lenderTerms()` in `mobile/src/content.ts`); the API refuses new listings without `terms_accepted: true`.
- A "Renting Club" discount for frequent renters exists (added in another session; `club_discount_percent`).

## Design history and photos
- The previous app design (iOS glass, original Explore grid) is saved in `design-archive/ios-glass-2026-11-21/`
  with `RESTORE.md`. Since then only the Explore screen was redesigned (location pill, headline, round
  category icons, "Popular near you" photo carousel, "Free this weekend" shelf, list rows; photos first).
- Demo listings use real Pexels photos (`backend/seed_photos/`, credits in `CREDITS.md`, served from
  `media/stock/`). Their blocky 3D 360° spins were removed; 360° stays as an owner feature (record a video).
  `seed.py` uses the stock photos automatically; the 3D renderer is only a fallback.

## Current design: "warm marketplace" (2026-11-21)
- Cream/espresso palette + terracotta accent in `mobile/src/theme.tsx`; per-category pastel colours
  (`categoryColor`, `categoryTile`). White cards with soft warm shadows. Glass tab bar kept.
- Explore: wordmark header, search card + quick filters (This weekend / Under €15 / Top rated), colourful
  category tiles, "List a thing" banner, "Free this weekend" shelf, big photo feed cards.
- Previous designs: `design-archive/ios-glass-2026-11-21/` and `design-archive/explore-v2-2026-11-21/`.
- Test listings without photos and duplicate Canon listings were deleted on request (DB backup kept in scratchpad).

## Chat, notifications, security, CI/CD (2026-11-21, latest)
- Backend: `app/chat.py` (logic), `app/realtime.py` (Socket.IO at /ws/socket.io, JWT in the handshake, rooms `user:<id>`), `app/routers/chat_routes.py` (REST + fallback), new tables `messages` and `notifications`. Booking events notify through `_tell()` in `routers/bookings.py`.
- App: `src/realtime.tsx` (RealtimeProvider + LiveToast banner, wired in App.tsx), `screens/ChatScreen.tsx`, `screens/InboxScreens.tsx` (Messages, Notifications), Message buttons on Bookings, 💬/🔔 badges on Explore, and a Bookings tab badge.
  - Keep the context functions stable. Depending on the whole `useRealtime()` object in a `useCallback`/`useEffect` caused a request loop that tripped the rate limiter.
- `app/ratelimit.py`: per-IP sliding window (set `RATE_LIMIT_DISABLED=1` to turn it off, `TRUST_PROXY=1` behind a proxy); chat is limited to 20 messages per 10 s per user.
- Security: SECRET_KEY from the env or `backend/.secret_key` (this **logged everyone out once**); 7-day tokens; 8-character password minimum; 10 MB photo and 150 MB video caps; headers/CSP. Details in SECURITY.md.
- CI/CD: `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`. The project is not a git repo yet, so CI runs once it's pushed to GitHub.
- Docs: `docs/ARCHITECTURE.md` (mermaid diagrams).
- Verified: 15 backend tests pass; a live two-user socket test on a DB copy covered messages, typing, read receipts, outsider 404, bad token refused, flood limit and the accept notification; checked in the browser.

## Key files
- Backend: `app/main.py` (routers, `/admin` redirect, static mounts), `app/models.py`, `app/schemas.py`,
  `app/services.py` (availability, ratings, location privacy, settings), `app/database.py` (+ `upgrade_schema()`
  adds new columns to existing DBs), `app/routers/{users,items,bookings,admin,geo,ai_routes}.py`, `app/media.py`.
- App: `App.tsx`, `src/api.ts`, `src/theme.tsx`, `src/platform.ts` (web-safe alerts/storage), `src/maps.ts`,
  `src/components/*` (ui, GlassTabBar, SpinViewer, AvailabilityCalendar, MapEmbed(.web), LocationPicker,
  AccountBanner, AIListingHelper), `src/screens/*`.

## User preferences / context
- Wants installs run in their own terminal when possible; slow network (~30–100 KB/s) — avoid big downloads.
- Uses a Samsung phone + Mac; tests mostly in the phone browser and desktop browser.
- Wants a real phone-app feel, iOS-like design, no "AI slop" look.
- Cost-sensitive: chose the cheapest model (Haiku 5.5).

## Possible next steps
- Add the real Anthropic key and try both AI features live.
- Ideas: push notifications for requests, in-app chat per booking, map view of nearby items, payments in
  test mode, lint setup (`npx expo lint` not configured yet).
