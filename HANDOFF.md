# Rentify — session handoff (2026-11-21)

48-hour hackathon project. Theme: neighbours rent out tools, cameras, tents, bikes by the day; backend
handles availability calendars + booking requests; reviews after each rental. Extra: 360° view of items.

## Name: Rentify (2026-11-22)
- "Rent a Thing" was the concept; the product is now **Rentify**. All visible text was renamed (app, admin console, API title, Stripe line items, AI prompts, legal texts, docs); placeholder support email is support@rentify.app.
- Kept on purpose (renaming would break things): folder names, `rentathing.db`, storage keys `rentathing.*` (would sign everyone out), bundle IDs `app.rentathing.mobile`, Expo slug/scheme, demo login emails `*@rentathing.app` (they're in the DB), logger names.

## Where things are
- Project: `~/Documents/RentAThing/rent-a-thing/` — `backend/` (FastAPI + SQLite), `mobile/` (Expo SDK 58,
  React Native 0.88, TypeScript, React Navigation — not Expo Router), `README.md` (full docs).
- DB: `backend/rentathing.db`. Media: `backend/media/` (demo renders in `media/_seed_cache/`).
- Web admin console: `backend/admin_web/` (plain HTML/CSS/JS, served at `/admin`).

## How to run (user's Mac; IP changes — check with `ipconfig getifaddr en0`, last seen 192.168.178.46)
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
- Rent Club members **no longer get a price discount** (removed 2026-11-22 on request); the club keeps the badge and members' chat. Old bookings still show their past "Rent Club −€x".
- **Special fee periods** (2026-11-22): admin page **Service fees** (`#/fees` in `backend/admin_web/admin.js`) sets the normal fee and dated periods (one-off or yearly, may wrap New Year) with presets for Black Friday / Summer / Christmas. Prices never change; only the owner's service fee does.
  - Rule: the period that contains the rental **start date** applies; if several overlap the shortest wins (`services.fee_for`). The fee is fixed when the request is sent and its name stored in `bookings.fee_label`.
  - Model `FeePeriod` (table `fee_periods`), admin routes `/admin/fee-periods` (+ `/quote?start=`), public `GET /config` → `fee_periods` (on now / upcoming). App shows them in the listing editor price hint and on owners' booking cards.
  - Two example periods were created while testing: Black Friday 2026-11-27 at 3% and Summer (Jun 1 – Aug 31, yearly) at 15%. DB backup: `backend/backups/rentathing-before-fee-periods-*.db`.

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

## Phone from anywhere: `./phone.sh` (2026-11-21)
- Starts the API if needed, opens a Cloudflare quick tunnel to :8000 (https://<random>.trycloudflare.com, which serves the web app, the API, /admin and Socket.IO), then runs `EXPO_PUBLIC_API_URL=<tunnel> npx expo start --tunnel --port 8082` for Expo Go.
- Why: `expo start --tunnel` alone only tunnels Metro. Without EXPO_PUBLIC_API_URL the app looked for the API at <expo-tunnel-host>:8000 and failed.
- Tools: cloudflared (brew), @expo/ngrok (npm -g). The tunnel URL changes on every start.

## Payments: card (Stripe test/demo) or cash (2026-11-21, latest)
- `app/payments.py`: mode "stripe" when `STRIPE_SECRET_KEY` starts with sk_test_ (Checkout Session, confirmed by retrieving the session on return; refund via `stripe.Refund.create`), otherwise "simulated" (`/bookings/{id}/pay/demo` accepts Stripe test card numbers). Live keys are refused.
- Booking columns: payment_method, payment_status (unpaid/paid/refunded/cash_due/cash_received), stripe_session_id, stripe_payment_intent, paid_at. Old completed bookings are marked cash_received.
- Routes in `routers/bookings.py`: `/payments/config`, `/bookings/{id}/pay`, `/pay/confirm`, `/pay/demo`, `/cash-received`, `/payments/webhook`. Cancel (user or admin) refunds paid cards.
- App: card/cash choice in the request sheet (ItemDetail), `components/PaymentSheet.tsx`, `paymentReturn.ts` (handles `?payment=success&booking=&session_id=` after Stripe), payment line + Pay / Cash received buttons in Bookings.
- Fixed: the request sheet showed a wrong "25% platform fee" to renters (the 10% fee comes out of the owner's payout). The web app now uses the server it was loaded from (it used to force port 8000, which broke Docker behind 80/443).
- Fixed (2026-11-22): the card form sometimes never appeared. PaymentSheet waited on `GET /payments/config` and spun forever if it failed (slow phone network / rate limiter). It now shows the demo form at once (bundled test cards), fetches the config with retries in the background, and switches to Stripe only if the server says so. Typed card details no longer reset when Bookings reloads. Card bookings marked returned before payment (completed + unpaid) can still be paid.
- 2026-11-22: real Stripe test key added to backend/.env and tested end to end (booking #24, €40, test card 4242 → paid, `pi_…`). Fixed: confirm returned 500 because stripe 17 objects aren't dicts (`.get()` raises) — now uses `.to_dict()` (webhook too). Stripe now returns the renter to the page they paid from (`Origin` header), so the Expo dev server (:8082) works too.
- Stripe library: `stripe` (17.x) in requirements.txt. DB backup: `backend/backups/rentathing-before-payments-*.db`.

## Rent Club + ID verification (2026-11-21, latest)
- Club: `app/club.py`, routes in `app/routers/club_routes.py` (`/club`, `/club/messages`, `/club/read`), Socket.IO events `club_join`/`club_send`/`club_read` → `club_message` in room "club". Threshold `CLUB_MIN_RENTALS = 5` in models.py. A `club_joined` notification is sent on joining.
- ID: `app/verification.py`, `/me/verification` (multipart: doc_type, front, selfie), admin `/admin/verifications` (+ image endpoints and a decide endpoint). Files live in `PRIVATE_DIR` (backend/private, or /data/private in Docker) and are deleted on decision. Setting `require_id` (default on) blocks `POST /bookings` and `POST /items` for unverified non-admins.
- App: `components/Badges.tsx`, `screens/ClubScreen.tsx`, `screens/VerifyIdScreen.tsx`; AccountBanner shows the ID call to action; ItemDetail swaps "Request" for "Verify ID"; Profile has a "Trust & community" group; the Profile tab badge shows unread club messages.
- Fixed: rental_count lagged one booking behind (the session has no autoflush), so membership started one rental late.
- DB backup taken before the new columns: `backend/backups/rentathing-before-club-id-*.db`.
- Existing users (demo, bob, ...) now have to verify their ID, or an admin can verify them under ID checks.

## Chat, notifications, security, CI/CD (2026-11-21, latest)
- Backend: `app/chat.py` (logic), `app/realtime.py` (Socket.IO at /ws/socket.io, JWT in the handshake, rooms `user:<id>`), `app/routers/chat_routes.py` (REST + fallback), new tables `messages` and `notifications`. Booking events notify through `_tell()` in `routers/bookings.py`.
- App: `src/realtime.tsx` (RealtimeProvider + LiveToast banner, wired in App.tsx), `screens/ChatScreen.tsx`, `screens/InboxScreens.tsx` (Messages, Notifications), Message buttons on Bookings, 💬/🔔 badges on Explore, and a Bookings tab badge.
  - Keep the context functions stable. Depending on the whole `useRealtime()` object in a `useCallback`/`useEffect` caused a request loop that tripped the rate limiter.
- `app/ratelimit.py`: per-IP sliding window (set `RATE_LIMIT_DISABLED=1` to turn it off, `TRUST_PROXY=1` behind a proxy); chat is limited to 20 messages per 10 s per user.
- Security: SECRET_KEY from the env or `backend/.secret_key` (this **logged everyone out once**); 7-day tokens; 8-character password minimum; 10 MB photo and 150 MB video caps; headers/CSP. Details in SECURITY.md.
- CI/CD: `.github/workflows/ci.yml`, `Dockerfile`, `.dockerignore`. The project is not a git repo yet, so CI runs once it's pushed to GitHub.
- Docs: `docs/ARCHITECTURE.md` (mermaid diagrams).
- Verified: 15 backend tests pass; a live two-user socket test on a DB copy covered messages, typing, read receipts, outsider 404, bad token refused, flood limit and the accept notification; checked in the browser.

## Handover photos + pick-up/return reminders (2026-11-22)
- **Handover photos**: on each confirmed booking card (Bookings tab) both people can add up to 6 pick-up and 6 return photos each, from the day before pick-up until 3 days after the last day. A photo can be removed by whoever added it within 15 minutes; after that it stays as a record. The other person gets a `handover_photos` notification.
  - Backend: table `handover_photos`, routes `POST /bookings/{id}/handover/{pickup|return}` (multipart `files`) and `DELETE /bookings/{id}/handover/photos/{photo_id}` in `routers/bookings.py`; rules in `services.py` (`can_add_handover`, `HANDOVER_*`); files in `media/handover/<booking_id>/`. `BookingOut` has `handover_photos` + `can_add_handover`.
  - App: `mobile/src/components/HandoverPhotos.tsx` (thumbnails, add tile, full-screen viewer), used in `BookingsScreen.tsx`.
  - Admin console: Bookings shows a camera count next to the item; the booking panel shows the pick-up and return photos with who took them (click opens full size). Data: `handover_photos` on `GET /admin/bookings`.
- **Reminders**: `app/reminders.py`, started by the `lifespan` in `main.py`, runs every 10 min. From 8:00 server time it sends a pick-up reminder (the day before, or on the day if the booking was confirmed late) and a return reminder (on the last day) to renter and owner. Each one is sent once per booking (table `booking_reminders`). Notification kinds `reminder_pickup` / `reminder_return`. `REMINDERS_DISABLED=1` turns it off (tests do).

## Home slideshow + promotions (2026-11-22)
- Explore's old "Your drill is bored." card is now a swipeable, auto-advancing slideshow (`mobile/src/components/PromoCarousel.tsx`):
  Black Friday slide (shown 1 Nov to Cyber Monday, computed each year), promoted listings ("Sponsored"), "Get seen first" (promote), "Your shelf could pay rent" (list a thing).
- Owners promote a live listing with a photo from My things (megaphone button, `PromoteSheet.tsx`): optional headline (80 chars), plan, live preview, then card payment. Max 3 at once.
- **Paid by card** (same Stripe test mode / demo checkout as bookings): 3 days €15, 1 week €29, 2 weeks €49 (`payments.PROMO_PLANS`). Paid days add to time left; stopping early doesn't refund.
- **Admin approval** (2026-11-22): order status unpaid → pending (paid, waiting) → approved (goes live, owner notified) | rejected (reason required, auto refund via Stripe test refund or simulated, owner notified). Only one waiting order per listing. Headline changes only happen through a new (reviewed) order. Admin: web console page "Promotions" (`#/promotions`, badge + Overview link) and the "Promos" tab in the app's Approvals screen. API: `GET /admin/promotions?status=`, `POST /admin/promotions/{id}` {decision, reason}; stats has `pending_promotions`. Old rows with status 'paid' are migrated to 'approved'.
- Backend: `promotions` table (orders: unpaid/paid, Stripe session + intent), `items.promo_until` / `promo_tagline`. Routes: `GET /items/promoted`, `GET /items/promotion-plans`, `POST /items/{id}/promote` (creates order, returns Checkout URL or demo mode), `POST /items/{id}/promote/{pid}/confirm` (after Stripe redirect), `POST /items/{id}/promote/{pid}/demo`, `DELETE /items/{id}/promote`. The Stripe webhook handles `promotion_id` metadata too.
- App: `CardPayment` (in PaymentSheet.tsx) is the shared card form for bookings and promotions; `paymentReturn.ts` handles `?promo=success&item=&promotion=&session_id=`.
- Tests: `test_promotions_paid_then_approved`, `test_promotion_stripe_test_mode`. Tested end to end with Stripe test card 4242 (€15, Sam's Canon) + approval in the web console.

## Promo pop-ups (2026-11-22)
- `mobile/src/components/PromoPopup.tsx`, mounted on Explore. House ads in rotation: Black Friday (in season, every other time), Promote a listing, Rent Club progress (non-members), This weekend, List a thing.
- Frequency: never on someone's first visit, max once per 20 hours, after 8 s on Explore, not while searching/filtering. State in storage key `rentify.promoPopup` (per device/browser).
- Testing: open the web app with `?popup=1` to show one at once (still rotates).

## Discount codes (2026-11-22)
- Renters type a code in the "Request to rent" sheet ("Have a discount code?"; when a featured code is live it says "Black Friday: use BLACKFRIDAY for 20% off" with one-tap apply). `components/DiscountCodeField.tsx`.
- **Rentify pays the discount**: renter's `total_price` is reduced; `platform_fee` and `owner_payout` are worked out on the full price, so owners get their full payout. Booking columns `discount_code`, `discount_amount`. Card payments charge the reduced total; refunds refund what was paid.
- Rules (`app/discounts.py`): % off, optional € cap per booking, minimum rental, first/last day (date the booking is made), total uses, once per person. Uses count only pending/accepted/completed bookings (declined/cancelled give the use back). Used codes can't be renamed or deleted, only paused.
- Admin: web console "Discount codes" page (presets: Black Friday week, Cyber Monday, Welcome 10%; live example; "Show in the app's Black Friday ads" = featured, one at a time). Overview "Platform fees" shows discounts given; booking drawer shows the code. API: `GET|POST /admin/discount-codes`, `PUT|DELETE /admin/discount-codes/{id}`; public `POST /discounts/check`, `GET /discounts/featured`.
- The Black Friday slide and pop-up show the featured code. Created live: **BLACKFRIDAY** 20% off, max €10, 22–30 Nov 2026, once per person, featured.
- Fixed: the app's Black Friday date used "4th Friday of November"; now the day after the 4th Thursday (same as the console). Admin assets bumped to `admin.js?v=12`, `admin.css?v=8`.
- Test: `test_discount_codes`.

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

## Renter vs lender accounts (2026-11-22)
- Sign-up asks "I just want to rent" (default) or "I want to rent and lend" (`RegisterIn.lender`).
- `User.approval_status` now means **lender approval**: `none` = renter only, `pending` / `approved` / `rejected`.
  Renters are never blocked by admin approval; booking only needs the ID check (`require_id`).
- Creating a listing needs an approved lender (`services.can_lend`); renters apply later via `POST /users/me/lender`
  (Profile → Lending, or tapping "List a thing", which shows `LenderGate` in ListingEditorScreen).
- The admin setting `approve_users` now reads "Approve new lenders"; when off, lender applications are approved at once.

## Demo data moved to Kosovo (2026-11-22)
- `backend/seed.py`: demo users live in Prishtina neighbourhoods; 5 demo listings in Prishtina, the tent in Peja and
  the projector in Prizren (outside the home city, so the "outside Prishtina" note shows). `seed.py --upgrade` moves
  old San Francisco demo listings in place. Applied to the live DB; backup in `backend/backups/rentathing-before-kosovo-*.db`.

## Logo and icons (2026-11-22)
- The logo is the Explore header mark: terracotta (#E2572B) rounded square with the white Ionicons "cube".
  In the app it's `mobile/src/components/LogoMark.tsx` (follows the chosen accent colour), used on Explore and Login.
- Generated from that glyph: `mobile/assets/` icon, favicon, splash and Android adaptive layers,
  `mobile/public/apple-touch-icon.png`, `backend/admin_web/favicon.png` + `apple-touch-icon.png` (admin sidebar too).
  Old icons were the Expo defaults. app.json: splash + Android background set, web theme colour now cream (was green).
