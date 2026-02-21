from __future__ import annotations

import asyncio
import ast
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any

import httpx
from sqlalchemy.orm import Session

from backend.alerts.scanner_rules import process_scanner_tick
from backend.db.database import SessionLocal
from backend.models import AlertConditionType, AlertORM, AlertStatus, AlertTriggerORM
from backend.services.marketdata_hub import MarketDataHub, get_marketdata_hub


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _safe_float(value: Any) -> float | None:
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except (TypeError, ValueError):
        return None


_ALLOWED_AST_NODES = (
    ast.Expression,
    ast.BoolOp,
    ast.BinOp,
    ast.UnaryOp,
    ast.Compare,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Subscript,
    ast.Dict,
    ast.List,
    ast.Tuple,
    ast.And,
    ast.Or,
    ast.Not,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Mod,
    ast.Pow,
    ast.USub,
    ast.UAdd,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.In,
    ast.NotIn,
    ast.Is,
    ast.IsNot,
)


class AlertEvaluatorService:
    def __init__(self) -> None:
        self._started = False
        self._queue: asyncio.Queue[dict[str, Any]] | None = None
        self._worker_task: asyncio.Task | None = None
        self._volume_cache: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=256))
        self._price_cache: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=256))
        self._hub: MarketDataHub | None = None

    def start(self, hub: MarketDataHub | None = None) -> None:
        if self._started:
            return
        self._queue = asyncio.Queue(maxsize=5000)
        self._started = True
        self._hub = hub or get_marketdata_hub()
        self._hub.register_tick_listener(self._on_tick)
        self._worker_task = asyncio.create_task(self._worker(), name="alerts-evaluator-worker")

    async def shutdown(self) -> None:
        self._started = False
        task = self._worker_task
        self._worker_task = None
        self._queue = None
        if task is not None:
            task.cancel()

    def _on_tick(self, tick: dict[str, Any]) -> None:
        if not self._started or self._queue is None:
            return
        try:
            self._queue.put_nowait(tick)
        except asyncio.QueueFull:
            return

    async def _worker(self) -> None:
        while self._started:
            try:
                tick = await self._queue.get()
            except (asyncio.CancelledError, RuntimeError):
                break
            try:
                await self._process_tick(tick)
            except Exception:
                # Keep evaluator resilient.
                continue

    async def _process_tick(self, tick: dict[str, Any]) -> None:
        symbol = str(tick.get("symbol") or "").strip().upper()
        if not symbol:
            return
        ltp = _safe_float(tick.get("ltp"))
        if ltp is None:
            return
        volume = _safe_float(tick.get("volume"))
        if volume is not None:
            self._volume_cache[symbol].append(volume)
        self._price_cache[symbol].append(ltp)

        db = SessionLocal()
        try:
            alerts = (
                db.query(AlertORM)
                .filter(
                    AlertORM.symbol == symbol,
                    AlertORM.status == AlertStatus.ACTIVE.value,
                )
                .all()
            )
            for alert in alerts:
                if not self._cooldown_ready(alert):
                    continue
                ok, triggered_value = self._evaluate(alert, tick)
                if not ok:
                    continue
                now = _utcnow()
                alert.status = AlertStatus.TRIGGERED.value
                alert.triggered_at = now
                alert.last_triggered_value = triggered_value
                db.add(
                    AlertTriggerORM(
                        alert_id=alert.id,
                        user_id=alert.user_id,
                        symbol=alert.symbol,
                        condition_type=alert.condition_type,
                        triggered_value=triggered_value,
                        context=tick,
                        triggered_at=now,
                    )
                )
                db.commit()
                await self._emit_alert_event(alert, triggered_value, now)
                await self._send_telegram_if_configured(alert, triggered_value, now)
            if self._hub is not None:
                await process_scanner_tick(db, self._hub, tick)
        finally:
            db.close()

    def _cooldown_ready(self, alert: AlertORM) -> bool:
        if not alert.triggered_at:
            return True
        cooldown = max(0, int(alert.cooldown_seconds or 0))
        if cooldown == 0:
            return True
        return _utcnow() >= alert.triggered_at + timedelta(seconds=cooldown)

    def _evaluate(self, alert: AlertORM, tick: dict[str, Any]) -> tuple[bool, float | None]:
        ctype = str(alert.condition_type)
        params = alert.parameters if isinstance(alert.parameters, dict) else {}
        ltp = _safe_float(tick.get("ltp"))
        change_pct = _safe_float(tick.get("change_pct"))
        volume = _safe_float(tick.get("volume"))
        if ctype == AlertConditionType.PRICE_ABOVE.value:
            threshold = _safe_float(params.get("threshold"))
            return bool(ltp is not None and threshold is not None and ltp > threshold), ltp
        if ctype == AlertConditionType.PRICE_BELOW.value:
            threshold = _safe_float(params.get("threshold"))
            return bool(ltp is not None and threshold is not None and ltp < threshold), ltp
        if ctype == AlertConditionType.PCT_CHANGE.value:
            threshold = _safe_float(params.get("threshold"))
            direction = str(params.get("direction") or "above").strip().lower()
            if change_pct is None or threshold is None:
                return False, change_pct
            if direction == "below":
                return change_pct < threshold, change_pct
            return change_pct > threshold, change_pct
        if ctype == AlertConditionType.VOLUME_SPIKE.value:
            lookback = max(2, int(params.get("lookback") or 20))
            multiplier = max(1.0, _safe_float(params.get("multiplier")) or 2.0)
            seq = list(self._volume_cache[alert.symbol])[-lookback:]
            if volume is None or len(seq) < 2:
                return False, volume
            baseline = mean(seq[:-1]) if len(seq) > 1 else mean(seq)
            if baseline <= 0:
                return False, volume
            return volume >= baseline * multiplier, volume
        if ctype == AlertConditionType.INDICATOR_CROSSOVER.value:
            return self._evaluate_indicator_crossover(alert.symbol, params), ltp
        if ctype == AlertConditionType.CUSTOM_EXPRESSION.value:
            expr = str(params.get("expression") or "").strip()
            if not expr:
                return False, None
            ctx = {
                "ltp": ltp,
                "volume": volume,
                "change_pct": change_pct,
            }
            return self._eval_custom(expr, ctx), ltp
        return False, None

    def _evaluate_indicator_crossover(self, symbol: str, params: dict[str, Any]) -> bool:
        history = list(self._price_cache[symbol])
        if len(history) < 40:
            return False
        kind = str(params.get("indicator") or "ma").strip().lower()
        direction = str(params.get("direction") or "above").strip().lower()
        if kind == "ma":
            fast = max(2, int(params.get("fast") or 9))
            slow = max(fast + 1, int(params.get("slow") or 21))
            if len(history) < slow + 2:
                return False
            prev_fast = mean(history[-(fast + 1):-1])
            prev_slow = mean(history[-(slow + 1):-1])
            curr_fast = mean(history[-fast:])
            curr_slow = mean(history[-slow:])
            if direction == "below":
                return prev_fast >= prev_slow and curr_fast < curr_slow
            return prev_fast <= prev_slow and curr_fast > curr_slow
        if kind == "rsi":
            level = _safe_float(params.get("level")) or 70.0
            period = max(5, int(params.get("period") or 14))
            prev_rsi = self._calc_rsi(history[:-1], period)
            curr_rsi = self._calc_rsi(history, period)
            if prev_rsi is None or curr_rsi is None:
                return False
            if direction == "below":
                return prev_rsi >= level and curr_rsi < level
            return prev_rsi <= level and curr_rsi > level
        if kind == "macd":
            prev = self._calc_macd(history[:-1])
            curr = self._calc_macd(history)
            if prev is None or curr is None:
                return False
            prev_macd, prev_signal = prev
            curr_macd, curr_signal = curr
            if direction == "below":
                return prev_macd >= prev_signal and curr_macd < curr_signal
            return prev_macd <= prev_signal and curr_macd > curr_signal
        return False

    @staticmethod
    def _calc_rsi(series: list[float], period: int) -> float | None:
        if len(series) < period + 1:
            return None
        gains: list[float] = []
        losses: list[float] = []
        for i in range(-period, 0):
            delta = series[i] - series[i - 1]
            gains.append(max(delta, 0.0))
            losses.append(max(-delta, 0.0))
        avg_gain = mean(gains)
        avg_loss = mean(losses)
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    @staticmethod
    def _ema(values: list[float], period: int) -> float | None:
        if len(values) < period:
            return None
        k = 2.0 / (period + 1.0)
        ema = mean(values[:period])
        for price in values[period:]:
            ema = price * k + ema * (1 - k)
        return ema

    def _calc_macd(self, series: list[float]) -> tuple[float, float] | None:
        if len(series) < 35:
            return None
        macd_series: list[float] = []
        for i in range(26, len(series) + 1):
            window = series[:i]
            ema12 = self._ema(window, 12)
            ema26 = self._ema(window, 26)
            if ema12 is None or ema26 is None:
                continue
            macd_series.append(ema12 - ema26)
        if len(macd_series) < 9:
            return None
        signal = self._ema(macd_series, 9)
        if signal is None:
            return None
        return macd_series[-1], signal

    @staticmethod
    def _eval_custom(expression: str, context: dict[str, Any]) -> bool:
        try:
            tree = ast.parse(expression, mode="eval")
        except SyntaxError:
            return False
        for node in ast.walk(tree):
            if not isinstance(node, _ALLOWED_AST_NODES):
                return False
            if isinstance(node, ast.Call):
                return False
            if isinstance(node, ast.Attribute):
                return False
            if isinstance(node, ast.Name) and node.id not in {"tick", "ltp", "volume", "change_pct", "None", "True", "False"}:
                return False
        safe_globals = {"__builtins__": {}}
        safe_locals = {"tick": context, **context}
        try:
            compiled = compile(tree, "<alert_expr>", "eval")
            result = eval(compiled, safe_globals, safe_locals)  # noqa: S307
            return isinstance(result, bool) and result
        except Exception:
            return False

    async def _emit_alert_event(self, alert: AlertORM, triggered_value: float | None, now: datetime) -> None:
        if not self._hub:
            return
        payload = {
            "type": "alert_triggered",
            "alert_id": alert.id,
            "symbol": alert.symbol,
            "condition": str(alert.condition_type),
            "triggered_value": triggered_value,
            "timestamp": now.isoformat(),
        }
        await self._hub.broadcast_alert(payload)
        await self._hub.broadcast(alert.symbol, payload)

    async def _send_telegram_if_configured(self, alert: AlertORM, triggered_value: float | None, now: datetime) -> None:
        params = alert.parameters if isinstance(alert.parameters, dict) else {}
        token = str(params.get("telegram_bot_token") or "").strip()
        chat_id = str(params.get("telegram_chat_id") or "").strip()
        if not token or not chat_id:
            return
        text = (
            f"Alert triggered\n"
            f"Symbol: {alert.symbol}\n"
            f"Condition: {alert.condition_type}\n"
            f"Value: {triggered_value}\n"
            f"Time: {now.isoformat()}"
        )
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
                await client.post(url, json={"chat_id": chat_id, "text": text})
        except Exception:
            return


_alert_service = AlertEvaluatorService()


def get_alert_evaluator_service() -> AlertEvaluatorService:
    return _alert_service
