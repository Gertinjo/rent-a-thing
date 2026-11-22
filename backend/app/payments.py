"""Payments: card (Stripe, TEST MODE ONLY) or cash on pick-up.

Modes
- "stripe":    STRIPE_SECRET_KEY=sk_test_... in backend/.env -> real Stripe Checkout in test mode.
               Pay with Stripe's test cards (4242 4242 4242 4242, any future date, any CVC).
- "simulated": no key -> a built-in demo checkout. Same flow, nothing leaves the server.
Live keys (sk_live_/rk_live_) are refused on purpose: this is a demo, no real money can move.

Card flow:  booking accepted -> renter pays -> payment_status "paid" -> owner is notified.
            Cancelled after paying -> refunded automatically (Stripe test refund, or simulated).
Cash flow:  payment_status "cash_due" -> owner taps "Cash received" (or marks the item returned).
"""

import logging
import os
import uuid
from datetime import datetime

from fastapi import HTTPException

from .ai import _load_env  # re-reads backend/.env, so adding a key needs no restart
from .models import Booking, Promotion

log = logging.getLogger("rentathing.payments")

CARD, CASH = "card", "cash"
UNPAID, PAID, REFUNDED, CASH_DUE, CASH_RECEIVED = "unpaid", "paid", "refunded", "cash_due", "cash_received"

# Test cards for the simulated checkout (same numbers Stripe uses in test mode).
SIM_CARDS = {
    "4242424242424242": None,  # success
    "4000056655665556": None,  # success (debit)
    "5555555555554444": None,  # success (Mastercard)
    "4000000000000002": "Your card was declined.",
    "4000000000009995": "Your card has insufficient funds.",
    "4000000000000069": "Your card has expired.",
}


def _secret() -> str:
    _load_env()
    return os.getenv("STRIPE_SECRET_KEY", "").strip()


def mode() -> str:
    key = _secret()
    if key.startswith(("sk_test_", "rk_test_")):
        return "stripe"
    if key:
        log.warning("STRIPE_SECRET_KEY is not a test key; ignoring it (demo payments only)")
    return "simulated"


def config() -> dict:
    m = mode()
    return {
        "mode": m,
        "currency": "EUR",
        "demo": True,
        "test_cards": [
            {"number": "4242 4242 4242 4242", "result": "Payment succeeds"},
            {"number": "4000 0000 0000 0002", "result": "Card declined"},
            {"number": "4000 0000 0000 9995", "result": "Insufficient funds"},
        ],
    }


def _stripe():
    import stripe

    stripe.api_key = _secret()
    stripe.max_network_retries = 2
    return stripe


def initial_status(method: str) -> str:
    return CASH_DUE if method == CASH else UNPAID


def _check_payable(b: Booking) -> None:
    if b.payment_method != CARD:
        raise HTTPException(400, "This booking is paid in cash on pick-up")
    if b.payment_status == PAID:
        raise HTTPException(400, "Already paid")
    # "completed" too: the owner can mark a card booking returned before the renter paid, and it still has to be payable.
    if b.status not in ("accepted", "completed"):
        raise HTTPException(400, "You can pay once the owner has confirmed the booking")


def _mark_paid(b: Booking, intent: str | None) -> bool:
    """Returns True if this call changed the booking to paid."""
    if b.payment_status == PAID:
        return False
    b.payment_status = PAID
    b.stripe_payment_intent = intent
    b.paid_at = datetime.utcnow()
    return True


def start_checkout(b: Booking, base_url: str) -> dict:
    """Begin a card payment. Stripe mode returns a hosted Checkout URL to open."""
    _check_payable(b)
    if mode() == "simulated":
        return {"mode": "simulated", "amount": b.total_price, "currency": "EUR"}
    stripe = _stripe()
    base = base_url.rstrip("/")
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": int(round(b.total_price * 100)),
                        "product_data": {
                            "name": f"{b.item.title} · {b.days} day{'s' if b.days > 1 else ''}",
                            "description": f"Rentify booking #{b.id}, {b.start_date:%d %b} – {b.end_date:%d %b}",
                        },
                    },
                }
            ],
            client_reference_id=str(b.id),
            metadata={"booking_id": str(b.id)},
            payment_intent_data={"metadata": {"booking_id": str(b.id)}},
            success_url=f"{base}/?payment=success&booking={b.id}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/?payment=cancelled&booking={b.id}",
        )
    except Exception as e:  # stripe.StripeError and network problems
        log.warning("stripe checkout failed: %s", e)
        raise HTTPException(502, f"Stripe couldn’t start the payment: {getattr(e, 'user_message', None) or e}")
    b.stripe_session_id = session.id
    return {"mode": "stripe", "url": session.url, "session_id": session.id}


def confirm_stripe(b: Booking, session_id: str | None = None) -> bool:
    """Ask Stripe whether the Checkout Session was paid (works without webhooks on a laptop)."""
    if b.payment_status == PAID:
        return False
    sid = session_id or b.stripe_session_id
    if not sid or mode() != "stripe":
        return False
    try:
        s = _stripe().checkout.Session.retrieve(sid)
    except Exception as e:
        log.warning("stripe retrieve failed: %s", e)
        raise HTTPException(502, "Couldn’t reach Stripe to confirm the payment. Try again in a moment.")
    # stripe>=13 objects are not dicts (.get() raises), so convert before reading.
    m = s.metadata
    meta = m.to_dict() if hasattr(m, "to_dict") else dict(m or {})
    if meta.get("booking_id") != str(b.id):
        raise HTTPException(400, "That payment belongs to another booking")
    if s.payment_status != "paid":
        return False
    b.stripe_session_id = sid
    intent = s.payment_intent if isinstance(s.payment_intent, str) else getattr(s.payment_intent, "id", None)
    return _mark_paid(b, intent)


def pay_simulated(b: Booking, card_number: str, exp: str, cvc: str) -> None:
    _check_payable(b)
    check_sim_card(card_number, exp, cvc)
    _mark_paid(b, f"pi_sim_{uuid.uuid4().hex[:16]}")


def check_sim_card(card_number: str, exp: str, cvc: str) -> None:
    """Demo checkout: accept only Stripe's test card numbers. Raises 402 like a real decline."""
    if mode() != "simulated":
        raise HTTPException(400, "Card payments go through Stripe Checkout")
    number = "".join(ch for ch in card_number if ch.isdigit())
    if number not in SIM_CARDS:
        raise HTTPException(402, "Demo mode: use a test card, e.g. 4242 4242 4242 4242")
    if not _valid_expiry(exp):
        raise HTTPException(402, "Enter a future expiry date (MM/YY)")
    if not (cvc.isdigit() and len(cvc) in (3, 4)):
        raise HTTPException(402, "Enter the 3-digit CVC")
    if (err := SIM_CARDS[number]) is not None:
        raise HTTPException(402, err)


def _valid_expiry(exp: str) -> bool:
    try:
        mm, yy = exp.replace(" ", "").split("/")
        month, year = int(mm), 2000 + int(yy[-2:])
    except ValueError:
        return False
    now = datetime.utcnow()
    return 1 <= month <= 12 and (year, month) >= (now.year, now.month)


def refund_if_paid(b: Booking) -> bool:
    """Called when a paid card booking is cancelled. Returns True if money was (test-)refunded."""
    if b.payment_method != CARD or b.payment_status != PAID:
        return False
    intent = b.stripe_payment_intent or ""
    if intent.startswith("pi_") and not intent.startswith("pi_sim_"):
        if mode() != "stripe":
            log.warning("booking %s was paid with Stripe but no test key is configured; marking refunded locally", b.id)
        else:
            try:
                _stripe().Refund.create(payment_intent=intent, metadata={"booking_id": str(b.id)})
            except Exception as e:
                log.warning("stripe refund failed: %s", e)
                raise HTTPException(502, "Stripe couldn’t refund the payment, so the booking wasn’t cancelled. Try again.")
    b.payment_status = REFUNDED
    return True


def handle_webhook(payload: bytes, signature: str | None) -> tuple[str, dict, str | None]:
    """Optional: verify a Stripe webhook. Returns (event type, metadata, payment intent)."""
    _load_env()
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(400, "Webhooks are not configured (set STRIPE_WEBHOOK_SECRET)")
    import stripe

    try:
        event = stripe.Webhook.construct_event(payload, signature, secret)
    except Exception:
        raise HTTPException(400, "Invalid signature")
    obj = event["data"]["object"]
    obj = obj.to_dict() if hasattr(obj, "to_dict") else dict(obj)
    meta = obj.get("metadata") or {}
    meta = meta.to_dict() if hasattr(meta, "to_dict") else dict(meta)
    intent = obj.get("payment_intent")
    return event["type"], meta, intent if isinstance(intent, str) else None


def meta_id(meta: dict, key: str) -> int | None:
    v = str(meta.get(key) or "")
    return int(v) if v.isdigit() else None


# ---------------------------------------------------------------------------
# Promotions (home slideshow), paid by card. Same two modes as bookings.
# ---------------------------------------------------------------------------

# days -> price in EUR
PROMO_PLANS: dict[int, float] = {3: 15.0, 7: 29.0, 14: 49.0}


def start_promo_checkout(p: Promotion, item_title: str, base_url: str) -> dict:
    out = {"promotion_id": p.id, "amount": p.amount, "currency": "EUR"}
    if mode() == "simulated":
        return {**out, "mode": "simulated"}
    stripe = _stripe()
    base = base_url.rstrip("/")
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": int(round(p.amount * 100)),
                        "product_data": {
                            "name": f"Home slideshow promotion · {p.days} days",
                            "description": f"Rentify: promote “{item_title}”",
                        },
                    },
                }
            ],
            client_reference_id=f"promo-{p.id}",
            metadata={"promotion_id": str(p.id)},
            payment_intent_data={"metadata": {"promotion_id": str(p.id)}},
            success_url=f"{base}/?promo=success&item={p.item_id}&promotion={p.id}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/?promo=cancelled&item={p.item_id}&promotion={p.id}",
        )
    except Exception as e:
        log.warning("stripe promo checkout failed: %s", e)
        raise HTTPException(502, f"Stripe couldn’t start the payment: {getattr(e, 'user_message', None) or e}")
    p.stripe_session_id = session.id
    return {**out, "mode": "stripe", "url": session.url, "session_id": session.id}


def confirm_promo_stripe(p: Promotion, session_id: str | None) -> str | None:
    """Returns the payment intent if Stripe says this promotion's Checkout Session is paid."""
    sid = session_id or p.stripe_session_id
    if p.status != UNPAID or not sid or mode() != "stripe":
        return None
    try:
        s = _stripe().checkout.Session.retrieve(sid)
    except Exception as e:
        log.warning("stripe retrieve failed: %s", e)
        raise HTTPException(502, "Couldn’t reach Stripe to confirm the payment. Try again in a moment.")
    m = s.metadata
    meta = m.to_dict() if hasattr(m, "to_dict") else dict(m or {})
    if meta.get("promotion_id") != str(p.id):
        raise HTTPException(400, "That payment belongs to another order")
    if s.payment_status != "paid":
        return None
    p.stripe_session_id = sid
    intent = s.payment_intent if isinstance(s.payment_intent, str) else getattr(s.payment_intent, "id", None)
    return intent or sid


def sim_intent() -> str:
    return f"pi_sim_{uuid.uuid4().hex[:16]}"



def refund_promotion(p: Promotion) -> None:
    """Give the money back for a rejected promotion (Stripe test refund, or simulated)."""
    intent = p.stripe_payment_intent or ""
    if intent.startswith("pi_") and not intent.startswith("pi_sim_"):
        if mode() != "stripe":
            log.warning("promotion %s was paid with Stripe but no test key is configured; marking refunded locally", p.id)
            return
        try:
            _stripe().Refund.create(payment_intent=intent, metadata={"promotion_id": str(p.id)})
        except Exception as e:
            log.warning("stripe promo refund failed: %s", e)
            raise HTTPException(502, "Stripe couldn’t refund the payment, so the promotion wasn’t rejected. Try again.")
