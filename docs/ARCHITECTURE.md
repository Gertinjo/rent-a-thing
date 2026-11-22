# Architecture — Rentify

GitHub, VS Code (with a Mermaid extension) and most Markdown viewers render the diagrams below.

## 1. Stack

```mermaid
flowchart LR
  subgraph Client["📱 Phone (Expo app or phone browser)"]
    RN["React Native + react-native-web<br/>React Navigation · expo-blur glass UI"]
    RT["realtime.tsx<br/>socket.io-client"]
  end
  subgraph Admin["🖥️ Desktop admin"]
    AW["admin_web<br/>plain HTML/JS + CSP"]
  end
  subgraph Server["FastAPI server :8000 (uvicorn)"]
    MW["Middleware<br/>security headers → CORS → rate limiter"]
    REST["REST routers<br/>users · items · bookings · chat · admin · geo · ai"]
    SIO["Socket.IO server /ws/socket.io<br/>JWT handshake · rooms user:&lt;id&gt;"]
    SVC["services.py<br/>pricing · 10% fee · availability"]
    MEDIA["media.py<br/>photos · 360° frames (OpenCV)"]
  end
  DB[("SQLite<br/>SQLAlchemy 2")]
  FILES[("/media<br/>photos · spin frames")]
  GM["Google Maps<br/>embed + directions links"]
  OSM["OpenStreetMap<br/>Nominatim geocoding"]
  AI["Gemini / Groq / Claude<br/>(optional AI)"]

  RN -- "HTTPS JSON (Bearer JWT)" --> MW
  RT <-- "WebSocket (live chat + notifications)" --> SIO
  AW -- "HTTPS JSON (admin JWT)" --> MW
  MW --> REST
  REST --> SVC --> DB
  REST --> MEDIA --> FILES
  REST -- "emit to user rooms" --> SIO
  SIO --> DB
  REST --> OSM
  REST --> AI
  RN -. "opens" .-> GM
```

| Layer | Tech |
|---|---|
| App | Expo SDK 58, React Native 0.88, TypeScript, React Navigation, socket.io-client |
| API | FastAPI, Pydantic v2, SQLAlchemy 2, PyJWT (pbkdf2 passwords) |
| Realtime | python-socketio (ASGI), mounted inside FastAPI |
| Data | SQLite file + `/media` folder (Docker volume `/data`) |
| AI | Gemini (free tier) by default; Groq or Claude Haiku optional |
| CI/CD | GitHub Actions → Docker image on GHCR |

## 2. Booking workflow

```mermaid
flowchart TD
  A([Renter finds an item]) --> B[Picks dates on the availability calendar]
  B --> C{Account approved<br/>and dates free?}
  C -- no --> C1[Shown why: pending approval / dates taken]
  C -- yes --> D[POST /bookings → status <b>pending</b>]
  D --> N1[[🔔 Owner: “New booking request” + live banner]]
  D --> CHAT((💬 Chat opens<br/>renter ⇄ owner))
  N1 --> E{Owner decides}
  E -- Decline --> F[status <b>declined</b>] --> N2[[🔔 Renter: declined]] --> X1([Chat closes])
  E -- Accept --> G[status <b>accepted</b><br/>overlapping requests auto-declined]
  G --> N3[[🔔 Renter: accepted<br/>exact pick-up location unlocked]]
  G --> H{Before start date?}
  H -- "Either cancels" --> I[status <b>cancelled</b>] --> N4[[🔔 Other party]] --> X1
  H -- "Rental happens" --> J[Owner taps “Mark as returned”<br/>status <b>completed</b>]
  J --> K[Owner gets price − 10% service fee]
  J --> N5[[🔔 Renter: completed]]
  J --> L[Both can leave a review ★]
  L --> N6[[🔔 Reviewed person]]
```

## 3. Live chat and notifications

```mermaid
sequenceDiagram
  autonumber
  participant R as Renter app
  participant S as Socket.IO (/ws/socket.io)
  participant API as FastAPI + SQLite
  participant O as Owner app

  R->>S: connect {auth: token}
  S->>API: verify JWT, user not suspended
  S-->>R: joined room user:R · unread {messages, notifications}
  O->>S: connect {auth: token}
  S-->>O: joined room user:O · unread

  R->>S: typing {booking_id}
  S-->>O: typing (shows “typing…”)
  R->>S: send_message {booking_id, body}
  S->>S: rate limit (20 / 10 s per user)
  S->>API: participant check · save Message · create Notification
  S-->>R: ack {ok, message}
  S-->>R: message (own echo, other devices)
  S-->>O: message + notification + unread
  Note over O: chat open → bubble appears<br/>elsewhere → glass banner + badge
  O->>S: read {booking_id}
  S->>API: mark messages read
  S-->>R: read (shows “Seen”)

  Note over R,API: No socket? The app falls back to<br/>POST /bookings/{id}/messages, which emits the same events.
```

Booking events (request, accepted, declined, cancelled, completed, review) are saved as notifications and pushed the same way from the REST endpoints.

## 4. CI/CD pipeline

```mermaid
flowchart LR
  P([git push / pull request]) --> B1 & M1
  subgraph backend["Backend job"]
    B1[Python 3.13 + pip cache] --> B2[compileall] --> B3[pytest] --> B4[pip-audit]
  end
  subgraph mobile["App job"]
    M1[Node 24 + npm ci] --> M2[tsc --noEmit] --> M3[npm audit] --> M4[expo export web] --> M5[(web-dist artifact)]
  end
  B4 & M4 --> D1[Docker build<br/>node → python multi-stage]
  D1 --> Q{branch main?}
  Q -- no --> E([✅ checks pass on the PR])
  Q -- yes --> D2[Push ghcr.io/&lt;repo&gt;:latest + :sha] --> D3([Deploy: pull the image,<br/>run with SECRET_KEY + /data volume])
```

## 5. Data model (simplified)

```mermaid
erDiagram
  USER ||--o{ ITEM : owns
  USER ||--o{ BOOKING : rents
  ITEM ||--o{ BOOKING : "is booked in"
  BOOKING ||--o{ MESSAGE : "has chat"
  BOOKING ||--o{ REVIEW : "gets"
  USER ||--o{ NOTIFICATION : receives
  USER ||--o{ MESSAGE : sends
  BOOKING {
    string status "pending · accepted · declined · cancelled · completed"
    float total_price
    float platform_fee "10%"
    float owner_payout
  }
  MESSAGE {
    text body
    datetime read_at
  }
  NOTIFICATION {
    string kind
    bool read
  }
```
