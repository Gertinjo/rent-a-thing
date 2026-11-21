import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'rentathing.db'}")
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", BASE_DIR / "media"))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
# ID documents: private, never served as static files. Only admins can view them, through the API.
PRIVATE_DIR = Path(os.getenv("PRIVATE_DIR", BASE_DIR / "private"))
PRIVATE_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _enable_sqlite_fk(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# create_all() makes new tables but never adds columns to existing ones. These are the columns
# added after the first release, so an existing rentathing.db keeps working without a reset.
_ADDED_COLUMNS = {
    "users": {
        "is_admin": "BOOLEAN NOT NULL DEFAULT 0",
        "is_suspended": "BOOLEAN NOT NULL DEFAULT 0",
        "suspended_reason": "VARCHAR(200) NOT NULL DEFAULT ''",
        "approval_status": "VARCHAR(20) NOT NULL DEFAULT 'approved'",
        "approval_note": "VARCHAR(300) NOT NULL DEFAULT ''",
        "rental_count": "INTEGER NOT NULL DEFAULT 0",
        "id_status": "VARCHAR(20) NOT NULL DEFAULT 'none'",
        "id_doc_type": "VARCHAR(30) NOT NULL DEFAULT ''",
        "id_note": "VARCHAR(300) NOT NULL DEFAULT ''",
        "id_front_path": "VARCHAR(255)",
        "id_selfie_path": "VARCHAR(255)",
        "id_submitted_at": "DATETIME",
        "id_verified_at": "DATETIME",
        "club_read_id": "INTEGER NOT NULL DEFAULT 0",
    },
    "items": {
        "lat": "FLOAT",
        "lng": "FLOAT",
        "location_label": "VARCHAR(200) NOT NULL DEFAULT ''",
        "review_status": "VARCHAR(20) NOT NULL DEFAULT 'approved'",
        "review_note": "VARCHAR(300) NOT NULL DEFAULT ''",
        "ai_check": "TEXT",
        "terms_accepted": "BOOLEAN NOT NULL DEFAULT 0",
    },
    "bookings": {
        "platform_fee": "FLOAT NOT NULL DEFAULT 0",
        "owner_payout": "FLOAT NOT NULL DEFAULT 0",
        "payment_method": "VARCHAR(10) NOT NULL DEFAULT 'cash'",
        "payment_status": "VARCHAR(20) NOT NULL DEFAULT 'cash_due'",
        "stripe_session_id": "VARCHAR(255)",
        "stripe_payment_intent": "VARCHAR(255)",
        "paid_at": "DATETIME",
    },
    "contact_messages": {
        "status": "VARCHAR(20) NOT NULL DEFAULT 'open'",
        "admin_note": "TEXT NOT NULL DEFAULT ''",
        "resolved_at": "DATETIME",
    },
}


def upgrade_schema() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in _ADDED_COLUMNS.items():
            if not insp.has_table(table):
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        if insp.has_table("bookings"):
            # Rentals that finished before payments existed were settled in person.
            conn.execute(text("UPDATE bookings SET payment_status = 'cash_received' WHERE status = 'completed' AND payment_status = 'cash_due'"))
        if insp.has_table("items"):
            from .models import LEGACY_CATEGORIES

            for old, new in LEGACY_CATEGORIES.items():
                conn.execute(text("UPDATE items SET category = :new WHERE category = :old"), {"new": new, "old": old})
