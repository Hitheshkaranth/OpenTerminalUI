from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy.orm import Session

from backend.models import AlertORM, VirtualOrder, VirtualOrderStatus, VirtualPortfolio, WatchlistORM
from backend.paper_trading import get_paper_engine

ACTION_TYPES = ("paper_order", "add_to_watchlist", "webhook")
MAX_ACTIONS = 5

logger = logging.getLogger(__name__)


class ActionValidationError(ValueError): ...


def validate_actions(raw: Any) -> list[dict[str, Any]]:
    """Return normalised actions or raise ActionValidationError(reason). `raw` is delivery_config.get("actions").
    None/[] -> []. Not a list -> error. > MAX_ACTIONS -> error. Per type:
      paper_order: portfolio_id non-empty str; side in {"buy","sell"}; quantity float > 0; order_type defaults "market" and must be "market" (only market supported in this round).
      add_to_watchlist: watchlist_id non-empty str.
      webhook: url str starting with http:// or https://; payload None or dict.
    Unknown keys are dropped; unknown type -> error 'unsupported action type: X'."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ActionValidationError("actions must be a list")
    if len(raw) > MAX_ACTIONS:
        raise ActionValidationError(f"too many actions: got {len(raw)}, max {MAX_ACTIONS}")
    if len(raw) == 0:
        return []

    normalised: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ActionValidationError("each action must be a dict")
        action_type = str(item.get("type") or "").strip().lower()
        if action_type not in ACTION_TYPES:
            raise ActionValidationError(f"unsupported action type: {action_type}")

        if action_type == "paper_order":
            portfolio_id = str(item.get("portfolio_id") or "").strip()
            if not portfolio_id:
                raise ActionValidationError("paper_order: portfolio_id is required")
            side = str(item.get("side") or "").strip().lower()
            if side not in ("buy", "sell"):
                raise ActionValidationError("paper_order: side must be buy or sell")
            quantity = item.get("quantity")
            try:
                quantity = float(quantity)
            except (TypeError, ValueError):
                raise ActionValidationError("paper_order: quantity must be a positive number")
            if quantity <= 0:
                raise ActionValidationError("paper_order: quantity must be > 0")
            order_type = str(item.get("order_type") or "market").strip().lower()
            if order_type != "market":
                raise ActionValidationError("paper_order: order_type must be 'market'")
            normalised.append({
                "type": "paper_order",
                "portfolio_id": portfolio_id,
                "side": side,
                "quantity": quantity,
                "order_type": order_type,
            })

        elif action_type == "add_to_watchlist":
            watchlist_id = str(item.get("watchlist_id") or "").strip()
            if not watchlist_id:
                raise ActionValidationError("add_to_watchlist: watchlist_id is required")
            normalised.append({
                "type": "add_to_watchlist",
                "watchlist_id": watchlist_id,
            })

        elif action_type == "webhook":
            url = str(item.get("url") or "").strip()
            if not url.startswith("http://") and not url.startswith("https://"):
                raise ActionValidationError("webhook: url must start with http:// or https://")
            payload = item.get("payload")
            if payload is not None and not isinstance(payload, dict):
                raise ActionValidationError("webhook: payload must be a dict or null")
            normalised.append({
                "type": "webhook",
                "url": url,
                "payload": payload if isinstance(payload, dict) else None,
            })

    return normalised


async def run_actions(
    db: Session,
    alert: AlertORM,
    trigger_context: dict[str, Any],
    *,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    """Execute (or, if dry_run, only check) each action; never raises. Returns [{type, ok, detail}] in order."""
    actions: list[dict[str, Any]] = (alert.delivery_config or {}).get("actions") or []
    results: list[dict[str, Any]] = []

    for action in actions:
        try:
            action_type = action.get("type", "")
            if action_type == "paper_order":
                result = await _run_paper_order(db, alert, action, dry_run)
            elif action_type == "add_to_watchlist":
                result = _run_add_to_watchlist(db, alert, action, dry_run)
            elif action_type == "webhook":
                result = await _run_webhook(db, alert, trigger_context, action, dry_run)
            else:
                result = {"type": action_type, "ok": False, "detail": f"unsupported action type: {action_type}"}
            results.append(result)
        except Exception as exc:
            logger.exception("Action %s failed for alert %s", action.get("type"), alert.id)
            results.append({
                "type": action.get("type", "unknown"),
                "ok": False,
                "detail": str(exc)[:200],
            })

    return results


def _normalise_symbol(symbol: str) -> str:
    """Add NSE: prefix if no exchange colon exists."""
    s = symbol.strip().upper()
    if ":" not in s:
        s = f"NSE:{s}"
    return s


async def _run_paper_order(
    db: Session,
    alert: AlertORM,
    action: dict[str, Any],
    dry_run: bool,
) -> dict[str, Any]:
    portfolio_id = action["portfolio_id"]
    side = action["side"]
    quantity = action["quantity"]

    portfolio = db.query(VirtualPortfolio).filter(
        VirtualPortfolio.id == portfolio_id,
        VirtualPortfolio.user_id == alert.user_id,
    ).first()
    if portfolio is None:
        return {"type": "paper_order", "ok": False, "detail": "portfolio not found"}

    symbol = _normalise_symbol(alert.symbol)

    if dry_run:
        return {
            "type": "paper_order",
            "ok": True,
            "detail": f"would place market {side} {quantity} {symbol} in {portfolio_id}",
        }

    row = VirtualOrder(
        portfolio_id=portfolio_id,
        symbol=symbol,
        side=side,
        order_type="market",
        quantity=quantity,
        limit_price=None,
        sl_price=None,
        status=VirtualOrderStatus.PENDING.value,
        slippage_bps=5.0,
        commission=0.0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    await get_paper_engine().maybe_fill_market_order_now(db, row)
    db.commit()
    db.refresh(row)
    return {"type": "paper_order", "ok": True, "detail": f"order {row.id} {row.status}"}


def _run_add_to_watchlist(
    db: Session,
    alert: AlertORM,
    action: dict[str, Any],
    dry_run: bool,
) -> dict[str, Any]:
    watchlist_id = action["watchlist_id"]

    watchlist = db.query(WatchlistORM).filter(
        WatchlistORM.id == watchlist_id,
        WatchlistORM.user_id == alert.user_id,
    ).first()
    if watchlist is None:
        return {"type": "add_to_watchlist", "ok": False, "detail": "watchlist not found"}

    symbol = alert.symbol.strip().upper()
    # Strip any "EXCHANGE:" prefix
    if ":" in symbol:
        symbol = symbol.split(":", 1)[1].upper()

    if dry_run:
        # Just check ownership — already verified by the query above
        return {"type": "add_to_watchlist", "ok": True, "detail": "would add to watchlist"}

    symbols: list[str] = list(watchlist.symbols_json) if watchlist.symbols_json else []
    if symbol in symbols:
        return {"type": "add_to_watchlist", "ok": True, "detail": "already present"}

    symbols.append(symbol)
    watchlist.symbols_json = symbols  # reassign so SQLAlchemy detects change
    db.commit()
    return {"type": "add_to_watchlist", "ok": True, "detail": "added"}


async def _run_webhook(
    db: Session,
    alert: AlertORM,
    trigger_context: dict[str, Any],
    action: dict[str, Any],
    dry_run: bool,
) -> dict[str, Any]:
    url = action["url"]
    payload = action.get("payload")

    if dry_run:
        return {"type": "webhook", "ok": True, "detail": "url validated, dry-run"}

    message = trigger_context.get("message", "")
    body = {
        "alert_id": alert.id,
        "symbol": alert.symbol,
        "message": message,
        "context": trigger_context,
    }
    if isinstance(payload, dict):
        body.update(payload)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=body)
        ok = 200 <= resp.status_code < 300
        return {
            "type": "webhook",
            "ok": ok,
            "detail": f"status {resp.status_code}" if ok else f"status {resp.status_code}: {resp.text[:200]}",
        }
    except Exception as exc:
        return {"type": "webhook", "ok": False, "detail": str(exc)[:200]}