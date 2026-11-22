# Graph Report - rent-a-thing  (2026-11-22)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1888 nodes · 6631 edges · 79 communities (59 shown, 20 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 373 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a3a1ea53`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- backend/admin_web/admin.js
- ios-glass-2026-11-21/backend/admin_web/admin.js
- realtime.py
- User
- package.json
- database.py
- mobile/src/components/ui.tsx
- bookings.py
- ios-glass-2026-11-21/mobile/src/api.ts
- mobile/src/api.ts
- services.py
- explore-v2-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx
- useTheme
- items.py
- explore-v2-2026-11-21/mobile/src/api.ts
- schemas.py
- useTheme
- expo
- expo
- explore-v2-2026-11-21/mobile/App.tsx
- ios-glass-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx
- models.py
- explore-v2-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx
- discounts.py
- PromoteSheet.tsx
- test_api.py
- mobile/src/theme.tsx
- realtime.tsx
- ios-glass-2026-11-21/mobile/src/screens/ExploreScreen.tsx
- explore-v2-2026-11-21/mobile/src/components/ui.tsx
- explore-v2-2026-11-21/mobile/src/theme.tsx
- ios-glass-2026-11-21/mobile/src/theme.tsx
- ios-glass-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx
- payments.py
- ai.py
- explore-v2-2026-11-21/mobile/src/screens/ExploreScreen.tsx
- useTheme
- VerifyIdScreen.tsx
- chat.py
- mobile/src/screens/ExploreScreen.tsx
- mobile/src/screens/ListingEditorScreen.tsx
- react-native
- mobile/src/screens/AdminScreens.tsx
- ios-glass-2026-11-21/mobile/App.tsx
- test_promotion_stripe_test_mode
- main.py
- explore-v2-2026-11-21/mobile/src/screens/BookingsScreen.tsx
- with
- geo.py
- city.py
- docker
- ios-glass-2026-11-21/mobile/src/components/MapEmbed.tsx
- steps
- mobile
- backend
- on
- tsconfig.json
- concurrency
- phone.sh
- verification.py

## God Nodes (most connected - your core abstractions)
1. `User` - 156 edges
2. `useTheme()` - 111 edges
3. `react-native` - 98 edges
4. `react` - 94 edges
5. `useTheme()` - 77 edges
6. `useTheme()` - 74 edges
7. `@expo/vector-icons` - 61 edges
8. `Booking` - 56 edges
9. `Item` - 50 edges
10. `react-native-safe-area-context` - 47 edges

## Surprising Connections (you probably didn't know these)
- `send_with_headers()` --calls--> `send()`  [INFERRED]
  backend/app/main.py → backend/app/club.py
- `threads()` --uses--> `Item`  [INFERRED]
  backend/app/chat.py → backend/app/models.py
- `unread_counts()` --uses--> `Item`  [INFERRED]
  backend/app/chat.py → backend/app/models.py
- `bookings()` --uses--> `Item`  [INFERRED]
  backend/app/routers/admin.py → backend/app/models.py
- `_item_out()` --uses--> `Item`  [INFERRED]
  backend/app/routers/admin.py → backend/app/models.py

## Import Cycles
- 2-file cycle: `backend/app/chat.py -> backend/app/club.py -> backend/app/chat.py`

## Communities (79 total, 20 thin omitted)

### Community 0 - "backend/admin_web/admin.js"
Cohesion: 0.07
Nodes (76): ACT, ACTION, ago(), AI_VERDICT, aiPanel(), api(), $app, applyTheme() (+68 more)

### Community 1 - "ios-glass-2026-11-21/backend/admin_web/admin.js"
Cohesion: 0.08
Nodes (58): ACT, ACTION, ago(), AI_VERDICT, aiPanel(), api(), $app, applyTheme() (+50 more)

### Community 2 - "realtime.py"
Cohesion: 0.06
Nodes (40): ChatError, can_access(), history(), info(), mark_read(), _member(), members(), message_out() (+32 more)

### Community 3 - "User"
Cohesion: 0.07
Nodes (59): AdminAction, FeePeriod, Promotion, ActionOut, actions(), _actions(), add_fee_period(), AdminBookingOut (+51 more)

### Community 4 - "package.json"
Cohesion: 0.05
Nodes (49): dependencies, expo@~58.0.26, expo-blur@~58.0.6, expo-constants@~58.0.16, expo-image-picker@~58.0.10, expo-location@~58.0.22, expo-secure-store@~58.0.3, expo-sensors@~58.0.5 (+41 more)

### Community 5 - "database.py"
Cohesion: 0.10
Nodes (9): _enable_sqlite_fk(), get_db(), require_admin(), push_notification(), due(), _first(), _messages(), send_due_reminders() (+1 more)

### Community 6 - "mobile/src/components/ui.tsx"
Cohesion: 0.12
Nodes (38): ContactTopic, LenderTermsModal(), useStyles, Avatar(), btn, Button(), Field(), ListGroup() (+30 more)

### Community 7 - "bookings.py"
Cohesion: 0.12
Nodes (31): Booking, BookingStatus, accept(), add_handover_photos(), cancel(), cash_received(), check_discount(), complete() (+23 more)

### Community 8 - "ios-glass-2026-11-21/mobile/src/api.ts"
Cohesion: 0.07
Nodes (28): admin, AdminAction, AdminBooking, AdminItem, AdminMessage, AdminReview, AdminStats, AdminUser (+20 more)

### Community 9 - "mobile/src/api.ts"
Cohesion: 0.05
Nodes (44): admin, AdminAction, AdminBooking, AdminItem, AdminMessage, AdminPromotion, AdminReview, AdminStats (+36 more)

### Community 10 - "services.py"
Cohesion: 0.11
Nodes (24): AppSetting, fee_quote(), get_settings(), update_settings(), base_fee_percent(), calendar(), conflicts(), fee_for() (+16 more)

### Community 11 - "explore-v2-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx"
Cohesion: 0.27
Nodes (13): Review, MapEmbed(), MapEmbed(), AreaRing(), MapProps, useMapStyles, SectionTitle(), embedUrl() (+5 more)

### Community 12 - "useTheme"
Cohesion: 0.14
Nodes (28): PaymentMethod, Review, GlassTabBar(), styles, TAB_ICONS, Badge360(), FeaturedCard(), ItemCard() (+20 more)

### Community 13 - "items.py"
Cohesion: 0.11
Nodes (39): Item, Review_, User, schedule_precheck(), ConfirmIn, DemoCard, add_blackout(), add_photos() (+31 more)

### Community 14 - "explore-v2-2026-11-21/mobile/src/api.ts"
Cohesion: 0.07
Nodes (29): admin, AdminAction, AdminBooking, AdminItem, AdminMessage, AdminReview, AdminStats, AdminUser (+21 more)

### Community 15 - "schemas.py"
Cohesion: 0.06
Nodes (52): get_current_user(), get_optional_user(), apply_to_lend(), change_password(), contact_us(), delete_account(), get_user(), login() (+44 more)

### Community 16 - "useTheme"
Cohesion: 0.19
Nodes (33): Button(), ListGroup(), ListRow(), NavHeader(), Segmented(), useListStyles, AdminApprovalsScreen(), AdminHomeScreen() (+25 more)

### Community 17 - "expo"
Cohesion: 0.06
Nodes (33): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, predictiveBackGestureEnabled, expo (+25 more)

### Community 18 - "expo"
Cohesion: 0.06
Nodes (33): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, predictiveBackGestureEnabled, expo (+25 more)

### Community 19 - "explore-v2-2026-11-21/mobile/App.tsx"
Cohesion: 0.12
Nodes (35): App(), frame, PhoneFrame(), Root(), Stack, Tab, Themed(), ContactTopic (+27 more)

### Community 20 - "ios-glass-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx"
Cohesion: 0.15
Nodes (31): ItemBrief, mediaUrl(), Badge360(), FeaturedCard(), ItemCard(), useStyles, mod(), Props (+23 more)

### Community 21 - "models.py"
Cohesion: 0.12
Nodes (19): Base, Blackout, BookingReminder, ContactMessage, HandoverPhoto, ItemPhoto, Review, SpinFrame (+11 more)

### Community 22 - "explore-v2-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx"
Cohesion: 0.15
Nodes (27): api, ListingDraft, LocalFile, AIListingHelper(), COMPAT, toFile(), useStyles, LenderTermsModal() (+19 more)

### Community 23 - "discounts.py"
Cohesion: 0.17
Nodes (16): amount(), check(), featured(), is_live(), normalize(), uses(), DiscountCode, add_discount_code() (+8 more)

### Community 24 - "PromoteSheet.tsx"
Cohesion: 0.10
Nodes (40): DiscountCheck, FeaturedDiscount, Item, PaymentConfig, DiscountCodeField(), loadFeaturedDiscount(), useFeaturedDiscount(), useStyles (+32 more)

### Community 25 - "test_api.py"
Cohesion: 0.11
Nodes (29): upgrade_schema(), _accepted_booking(), _make_admin(), make_item(), _pay_promo(), _photo(), _photo_item(), register() (+21 more)

### Community 26 - "mobile/src/theme.tsx"
Cohesion: 0.14
Nodes (21): Calendar, AvailabilityCalendar(), eachDay(), Legend(), Props, Selection, useStyles, weekend() (+13 more)

### Community 27 - "realtime.tsx"
Cohesion: 0.08
Nodes (50): App(), frame, PhoneFrame(), Root(), Stack, Tab, Tabs(), Themed() (+42 more)

### Community 28 - "ios-glass-2026-11-21/mobile/src/screens/ExploreScreen.tsx"
Cohesion: 0.18
Nodes (25): api, Booking, useAuth(), AccountBanner(), Empty(), LargeHeader(), StatusDot(), useTabBarSpace() (+17 more)

### Community 29 - "explore-v2-2026-11-21/mobile/src/components/ui.tsx"
Cohesion: 0.16
Nodes (20): Tabs(), Item, GlassTabBar(), styles, TAB_ICONS, mod(), Props, SpinViewer() (+12 more)

### Community 30 - "explore-v2-2026-11-21/mobile/src/theme.tsx"
Cohesion: 0.16
Nodes (18): Calendar, AvailabilityCalendar(), eachDay(), Legend(), Props, Selection, useStyles, weekend() (+10 more)

### Community 31 - "ios-glass-2026-11-21/mobile/src/theme.tsx"
Cohesion: 0.13
Nodes (22): Calendar, AvailabilityCalendar(), eachDay(), Legend(), Props, Selection, useStyles, AccentKey (+14 more)

### Community 32 - "ios-glass-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx"
Cohesion: 0.10
Nodes (25): CATEGORIES, Category, Item, ListingDraft, LocalFile, AIListingHelper(), COMPAT, toFile() (+17 more)

### Community 33 - "payments.py"
Cohesion: 0.11
Nodes (20): _load_env(), _check_payable(), check_sim_card(), config(), confirm_promo_stripe(), confirm_stripe(), handle_webhook(), initial_status() (+12 more)

### Community 34 - "ai.py"
Cohesion: 0.08
Nodes (31): AIError, _anthropic_client(), check_rate_limit(), draft_listing(), enabled(), _http_client(), _image_blocks(), image_from_bytes() (+23 more)

### Community 35 - "explore-v2-2026-11-21/mobile/src/screens/ExploreScreen.tsx"
Cohesion: 0.24
Nodes (18): ItemBrief, useAuth(), AccountBanner(), Badge360(), FeaturedCard(), ItemCard(), useStyles, area() (+10 more)

### Community 36 - "useTheme"
Cohesion: 0.27
Nodes (20): Empty(), NavHeader(), Segmented(), AdminApprovalsScreen(), AdminHomeScreen(), AdminInboxScreen(), AdminList(), AICheckPanel() (+12 more)

### Community 37 - "VerifyIdScreen.tsx"
Cohesion: 0.22
Nodes (12): IdDocType, Verification, promoReturn(), usePaymentReturn(), Alert, isWeb, DOCS, Shot (+4 more)

### Community 38 - "chat.py"
Cohesion: 0.14
Nodes (22): booking_for(), history(), mark_read(), message_out(), notification_out(), notify(), other_party(), send_message() (+14 more)

### Community 39 - "mobile/src/screens/ExploreScreen.tsx"
Cohesion: 0.18
Nodes (21): api, AppConfig, FALLBACK, loadConfig(), useAppConfig(), useHomeCity(), useAuth(), AccountBanner() (+13 more)

### Community 40 - "mobile/src/screens/ListingEditorScreen.tsx"
Cohesion: 0.09
Nodes (32): Booking, CATEGORIES, Category, FeePeriod, HandoverPhoto, HandoverStage, ListingDraft, LocalFile (+24 more)

### Community 41 - "react-native"
Cohesion: 0.37
Nodes (10): LocationPicker(), useStyles, MapEmbed(), MapEmbed(), AreaRing(), MapProps, useMapStyles, embedUrl() (+2 more)

### Community 42 - "mobile/src/screens/AdminScreens.tsx"
Cohesion: 0.24
Nodes (19): NavHeader(), Segmented(), AdminApprovalsScreen(), AdminHomeScreen(), AdminInboxScreen(), AdminList(), AICheckPanel(), KV() (+11 more)

### Community 43 - "ios-glass-2026-11-21/mobile/App.tsx"
Cohesion: 0.14
Nodes (20): App(), frame, PhoneFrame(), Root(), Stack, Tab, Tabs(), Themed() (+12 more)

### Community 44 - "test_promotion_stripe_test_mode"
Cohesion: 0.25
Nodes (4): test_promotion_stripe_test_mode(), test_stripe_test_mode(), create(), retrieve()

### Community 45 - "main.py"
Cohesion: 0.13
Nodes (8): config(), admin_console_redirect(), health(), lifespan(), public_config(), SecurityHeadersMiddleware, send_with_headers(), reminder_loop()

### Community 46 - "explore-v2-2026-11-21/mobile/src/screens/BookingsScreen.tsx"
Cohesion: 0.24
Nodes (14): Booking, mediaUrl(), Avatar(), Stars(), StatusDot(), Action, BookingsScreen(), Tab (+6 more)

### Community 47 - "with"
Cohesion: 0.12
Nodes (16): with, cache, cache-dependency-path, cache-from, cache-to, context, name, node-version (+8 more)

### Community 48 - "geo.py"
Cohesion: 0.32
Nodes (7): _google(), _google_place(), _nominatim(), Place, reverse(), search(), _short_label()

### Community 50 - "city.py"
Cohesion: 0.28
Nodes (5): contains(), distance_km(), item_in_city(), viewbox(), test_prishtina_items_first_with_flag()

### Community 51 - "docker"
Cohesion: 0.20
Nodes (10): name, needs, permissions, runs-on, jobs, docker, name, permissions (+2 more)

### Community 53 - "ios-glass-2026-11-21/mobile/src/components/MapEmbed.tsx"
Cohesion: 0.53
Nodes (6): MapEmbed(), MapEmbed(), AreaRing(), MapProps, useMapStyles, embedUrl()

### Community 55 - "steps"
Cohesion: 0.39
Nodes (8): steps, steps, steps, continue-on-error, if, name, run, uses

### Community 56 - "mobile"
Cohesion: 0.29
Nodes (7): defaults, run, mobile, defaults, name, runs-on, working-directory

### Community 57 - "backend"
Cohesion: 0.33
Nodes (6): env, name, runs-on, AI_DISABLED, RATE_LIMIT_DISABLED, backend

### Community 59 - "on"
Cohesion: 0.40
Nodes (5): on, pull_request, push, workflow_dispatch, branches

### Community 60 - "tsconfig.json"
Cohesion: 0.40
Nodes (4): compilerOptions, strict, extends, expo/tsconfig.base

### Community 62 - "concurrency"
Cohesion: 0.67
Nodes (3): concurrency, cancel-in-progress, group

### Community 65 - "verification.py"
Cohesion: 0.10
Nodes (31): _ext(), _extract(), read_limited(), reset_spin_dir(), save_image(), spin_dir(), spin_from_images(), spin_from_video() (+23 more)

## Knowledge Gaps
- **1 isolated node(s):** `expo/tsconfig.base`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 463 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react-native` connect `react-native` to `package.json`, `mobile/src/components/ui.tsx`, `ios-glass-2026-11-21/mobile/src/api.ts`, `mobile/src/api.ts`, `explore-v2-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx`, `useTheme`, `explore-v2-2026-11-21/mobile/src/api.ts`, `useTheme`, `explore-v2-2026-11-21/mobile/App.tsx`, `ios-glass-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx`, `explore-v2-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx`, `PromoteSheet.tsx`, `mobile/src/theme.tsx`, `realtime.tsx`, `ios-glass-2026-11-21/mobile/src/screens/ExploreScreen.tsx`, `explore-v2-2026-11-21/mobile/src/components/ui.tsx`, `explore-v2-2026-11-21/mobile/src/theme.tsx`, `ios-glass-2026-11-21/mobile/src/theme.tsx`, `ios-glass-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx`, `explore-v2-2026-11-21/mobile/src/screens/ExploreScreen.tsx`, `useTheme`, `VerifyIdScreen.tsx`, `mobile/src/screens/ExploreScreen.tsx`, `mobile/src/screens/ListingEditorScreen.tsx`, `mobile/src/screens/AdminScreens.tsx`, `ios-glass-2026-11-21/mobile/App.tsx`, `explore-v2-2026-11-21/mobile/src/screens/BookingsScreen.tsx`, `ios-glass-2026-11-21/mobile/src/components/MapEmbed.tsx`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Are the 133 inferred relationships involving `User` (e.g. with `send_message()` and `threads()`) actually correct?**
  _`User` has 133 INFERRED edges - model-reasoned connections that need verification._
- **What connects `expo/tsconfig.base` to the rest of the system?**
  _1 weakly-connected nodes found - possible missing edges._
- **Should `backend/admin_web/admin.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06635802469135803 - nodes in this community are weakly interconnected._
- **Why does `User` connect `items.py` to `verification.py`, `realtime.py`, `User`, `ai.py`, `database.py`, `chat.py`, `bookings.py`, `services.py`, `schemas.py`, `geo.py`, `models.py`, `discounts.py`, `test_api.py`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Should `ios-glass-2026-11-21/backend/admin_web/admin.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08032786885245902 - nodes in this community are weakly interconnected._
- **Why does `react` connect `react-native` to `package.json`, `mobile/src/components/ui.tsx`, `ios-glass-2026-11-21/mobile/src/api.ts`, `mobile/src/api.ts`, `explore-v2-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx`, `useTheme`, `explore-v2-2026-11-21/mobile/src/api.ts`, `useTheme`, `explore-v2-2026-11-21/mobile/App.tsx`, `ios-glass-2026-11-21/mobile/src/screens/ItemDetailScreen.tsx`, `explore-v2-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx`, `PromoteSheet.tsx`, `mobile/src/theme.tsx`, `realtime.tsx`, `ios-glass-2026-11-21/mobile/src/screens/ExploreScreen.tsx`, `explore-v2-2026-11-21/mobile/src/components/ui.tsx`, `explore-v2-2026-11-21/mobile/src/theme.tsx`, `ios-glass-2026-11-21/mobile/src/theme.tsx`, `ios-glass-2026-11-21/mobile/src/screens/ListingEditorScreen.tsx`, `explore-v2-2026-11-21/mobile/src/screens/ExploreScreen.tsx`, `useTheme`, `VerifyIdScreen.tsx`, `mobile/src/screens/ExploreScreen.tsx`, `mobile/src/screens/ListingEditorScreen.tsx`, `mobile/src/screens/AdminScreens.tsx`, `ios-glass-2026-11-21/mobile/App.tsx`, `explore-v2-2026-11-21/mobile/src/screens/BookingsScreen.tsx`, `ios-glass-2026-11-21/mobile/src/components/MapEmbed.tsx`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._