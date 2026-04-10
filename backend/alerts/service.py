from __future__ import annotations

import asyncio
import ast
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any

from backend.alerts.delivery import deliver_alert
from backend.alerts.scanner_rules import process_scanner_tick
from backend.shared.db import SessionLocal
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


class DrawingCrossCondition:
    def _normalize_drawing(self, params: dict[str, Any]) -> dict[str, Any] | None:
        drawing = params.get("drawing")
        if not isinstance(drawing, dict):
            chart_context = params.get("chart_context")
            if isinstance(chart_context, dict):
                drawing = chart_context.get("drawing")
        if not isinstance(drawing, dict):
            return None
        return drawing

    @staticmethod
    def _normalize_side(value: Any) -> str:
        text = str(value or "").strip().lower()
        if text in {"cross_above", "above", "up", "bullish"}:
            return "cross_above"
        if text in {"cross_below", "below", "down", "bearish"}:
            return "cross_below"
        return "cross_any"

    @staticmethod
    def _anchor_list(drawing: dict[str, Any]) -> list[dict[str, Any]]:
        anchors = drawing.get("anchors")
        if isinstance(anchors, list):
            return [anchor for anchor in anchors if isinstance(anchor, dict)]
        return []

    @staticmethod
    def _extract_tool_type(drawing: dict[str, Any]) -> str:
        tool = drawing.get("tool")
        if isinstance(tool, dict):
            tool_type = str(tool.get("type") or "").strip().lower()
            if tool_type:
                return tool_type
        return str(drawing.get("toolType") or drawing.get("tool_type") or "").strip().lower()

    def _resolve_level(self, drawing: dict[str, Any], tick: dict[str, Any]) -> float | None:
        tool_type = self._extract_tool_type(drawing)
        alert = drawing.get("alert") if isinstance(drawing.get("alert"), dict) else {}
        alert_level_raw = None
        if isinstance(alert, dict):
            alert_level_raw = alert.get("price") or alert.get("threshold") or alert.get("level")
        alert_level = _safe_float(alert_level_raw)
        if alert_level is not None:
            return alert_level

        threshold = _safe_float(tick.get("threshold"))
        if threshold is not None:
            return threshold

        if tool_type in {"hline", "horizontal_line"}:
            anchor = self._anchor_list(drawing)[:1]
            if anchor:
                return _safe_float(anchor[0].get("price"))
            return _safe_float(drawing.get("price"))

        if tool_type in {"anchored_vwap"}:
            anchor = self._anchor_list(drawing)[:1]
            if anchor:
                return _safe_float(anchor[0].get("price"))
            return _safe_float(drawing.get("anchor_price"))

        if tool_type in {"trendline", "ray"}:
            anchors = self._anchor_list(drawing)
            if len(anchors) < 2:
                return None
            first, second = anchors[0], anchors[1]
            start_time = _safe_float(first.get("time"))
            end_time = _safe_float(second.get("time"))
            start_price = _safe_float(first.get("price"))
            end_price = _safe_float(second.get("price"))
            if None in (start_time, end_time, start_price, end_price) or start_time == end_time:
                return None
            reference_time = _safe_float(tick.get("timestamp"))
            if reference_time is None:
                reference_time = _safe_float(tick.get("ts"))
            if reference_time is None:
                reference_time = _safe_float(tick.get("time"))
            if reference_time is None:
                reference_time = end_time if tool_type == "trendline" else max(start_time, end_time)
            if tool_type == "trendline":
                reference_time = max(min(reference_time, max(start_time, end_time)), min(start_time, end_time))
            else:
                reference_time = max(reference_time, start_time)
            slope = (end_price - start_price) / (end_time - start_time)
            return start_price + slope * (reference_time - start_time)

        return _safe_float(drawing.get("price"))

    def evaluate(
        self,
        tick: dict[str, Any],
        params: dict[str, Any],
        previous_price: float | None = None,
    ) -> tuple[bool, float | None]:
        drawing = self._normalize_drawing(params)
        if not drawing:
            return False, None

        current_price = _safe_float(tick.get("ltp"))
        if current_price is None:
            return False, None
        if previous_price is None:
            previous_price = _safe_float(tick.get("previous_ltp"))

        level = self._resolve_level(drawing, tick)
        if level is None:
            return False, None

        alert_config = drawing.get("alert") if isinstance(drawing.get("alert"), dict) else {}
        condition = params.get("condition") or params.get("cross")
        if condition is None and isinstance(alert_config, dict):
            condition = alert_config.get("condition")
        side = self._normalize_side(condition)
        if side == "cross_above":
            return bool(previous_price is not None and previous_price <= level < current_price), level
        if side == "cross_below":
            return bool(previous_price is not None and previous_price >= level > current_price), level
        if previous_price is None:
            return False, level
        crossed_up = previous_price <= level < current_price
        crossed_down = previous_price >= level > current_price
        return crossed_up or crossed_down, level


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
                now = _utcnow()
                if self._should_expire(alert, now):
                    alert.status = AlertStatus.EXPIRED.value
                    db.commit()
                    continue
                if self._max_triggers_reached(alert):
                    alert.status = AlertStatus.EXPIRED.value
                    db.commit()
                    continue
                if not self._cooldown_ready(alert):
                    continue
                ok, triggered_value = self._evaluate(alert, tick)
                if not ok:
                    continue
                trigger_context = self._build_trigger_context(alert, tick, triggered_value)
                alert.triggered_at = now
                alert.last_triggered_at = now
                alert.last_triggered_value = triggered_value
                alert.trigger_count = int(alert.trigger_count or 0) + 1
                if self._max_triggers_reached(alert):
                    alert.status = AlertStatus.EXPIRED.value
                db.add(
                    AlertTriggerORM(
                        alert_id=alert.id,
                        user_id=alert.user_id,
                        symbol=alert.symbol,
                        condition_type=alert.condition_type,
                        triggered_value=triggered_value,
                        context=trigger_context,
                        triggered_at=now,
                    )
                )
                db.commit()
                message = self._build_delivery_message(alert, triggered_value, now)
                await deliver_alert(alert, message, db=db)
                await self._emit_alert_event(alert, triggered_value, now, trigger_context)
            if self._hub is not None:
                await process_scanner_tick(db, self._hub, tick)
        finally:
            db.close()

    @staticmethod
    def _should_expire(alert: AlertORM, now: datetime) -> bool:
        return bool(alert.expiry_date and alert.expiry_date <= now)

    @staticmethod
    def _max_triggers_reached(alert: AlertORM) -> bool:
        max_triggers = max(0, int(alert.max_triggers or 0))
        return max_triggers > 0 and int(alert.trigger_count or 0) >= max_triggers

    def _cooldown_ready(self, alert: AlertORM) -> bool:
        last_triggered_at = alert.last_triggered_at or alert.triggered_at
        if not last_triggered_at:
            return True
        cooldown_minutes = max(0, int(alert.cooldown_minutes or 0))
        if cooldown_minutes > 0:
            return _utcnow() >= last_triggered_at + timedelta(minutes=cooldown_minutes)
        cooldown = max(0, int(alert.cooldown_seconds or 0))
        if cooldown == 0:
            return True
        return _utcnow() >= last_triggered_at + timedelta(seconds=cooldown)

    def _evaluate(self, alert: AlertORM, tick: dict[str, Any]) -> tuple[bool, float | None]:
        if isinstance(alert.conditions, list) and alert.conditions:
            return self._evaluate_conditions(alert, tick)
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
        if ctype == "drawing_cross":
            history = list(self._price_cache[alert.symbol])
            previous_price = history[-2] if len(history) >= 2 else None
            return DrawingCrossCondition().evaluate(tick, params, previous_price)
        return False, None

    def _evaluate_conditions(self, alert: AlertORM, tick: dict[str, Any]) -> tuple[bool, float | None]:
        conditions = [condition for condition in alert.conditions if isinstance(condition, dict)]
        if not conditions:
            return False, None
        results: list[tuple[bool, float | None]] = [self._evaluate_condition(alert, tick, condition) for condition in conditions]
        logic = str(alert.logic or "AND").strip().upper()
        ok = all(result for result, _ in results) if logic == "AND" else any(result for result, _ in results)
        triggered_value = next((value for result, value in results if result and value is not None), None)
        if triggered_value is None:
            triggered_value = next((value for _, value in results if value is not None), None)
        return ok, triggered_value

    def _evaluate_condition(self, alert: AlertORM, tick: dict[str, Any], condition: dict[str, Any]) -> tuple[bool, float | None]:
        field = str(condition.get("field") or "").strip().lower()
        operator = str(condition.get("operator") or "").strip().lower()
        params = condition.get("params") if isinstance(condition.get("params"), dict) else {}
        value = _safe_float(condition.get("value"))
        history = list(self._price_cache[alert.symbol])
        previous_price = history[-2] if len(history) >= 2 else _safe_float(tick.get("previous_ltp"))
        ltp = _safe_float(tick.get("ltp"))
        change_pct = _safe_float(tick.get("change_pct"))
        volume = _safe_float(tick.get("volume"))
        oi_change = _safe_float(tick.get("oi_change") or tick.get("open_interest_change"))
        iv = _safe_float(tick.get("iv") or tick.get("implied_volatility"))

        if field == "price":
            if operator == "above":
                return bool(ltp is not None and value is not None and ltp > value), ltp
            if operator == "below":
                return bool(ltp is not None and value is not None and ltp < value), ltp
            if operator == "cross_above":
                return bool(previous_price is not None and ltp is not None and value is not None and previous_price <= value < ltp), ltp
            if operator == "cross_below":
                return bool(previous_price is not None and ltp is not None and value is not None and previous_price >= value > ltp), ltp

        if field == "change_pct":
            if operator == "above":
                return bool(change_pct is not None and value is not None and change_pct > value), change_pct
            if operator == "below":
                return bool(change_pct is not None and value is not None and change_pct < value), change_pct

        if field == "volume":
            if operator == "above":
                return bool(volume is not None and value is not None and volume > value), volume
            if operator == "spike":
                lookback = max(2, int(params.get("lookback") or 20))
                multiplier = max(1.0, _safe_float(params.get("multiplier")) or value or 2.0)
                seq = list(self._volume_cache[alert.symbol])[-lookback:]
                if volume is None or len(seq) < 2:
                    return False, volume
                baseline = mean(seq[:-1]) if len(seq) > 1 else mean(seq)
                return bool(baseline > 0 and volume >= baseline * multiplier), volume

        if field == "rsi_14":
            period = max(2, int(params.get("period") or 14))
            rsi = self._calc_rsi(history, period)
            if operator == "above":
                return bool(rsi is not None and value is not None and rsi > value), rsi
            if operator == "below":
                return bool(rsi is not None and value is not None and rsi < value), rsi

        if field == "macd_signal":
            prev = self._calc_macd(history[:-1])
            curr = self._calc_macd(history)
            if prev is None or curr is None:
                return False, None
            prev_macd, prev_signal = prev
            curr_macd, curr_signal = curr
            if operator == "cross_above":
                return bool(prev_macd <= prev_signal and curr_macd > curr_signal), curr_macd
            if operator == "cross_below":
                return bool(prev_macd >= prev_signal and curr_macd < curr_signal), curr_macd

        if field == "ema_cross":
            fast = max(2, int(params.get("fast_period") or 9))
            slow = max(fast + 1, int(params.get("slow_period") or 21))
            if len(history) < slow + 2:
                return False, None
            prev_fast = self._ema(history[:-1], fast)
            prev_slow = self._ema(history[:-1], slow)
            curr_fast = self._ema(history, fast)
            curr_slow = self._ema(history, slow)
            if None in {prev_fast, prev_slow, curr_fast, curr_slow}:
                return False, None
            if operator == "cross_above":
                return bool(prev_fast <= prev_slow and curr_fast > curr_slow), curr_fast - curr_slow
            if operator == "cross_below":
                return bool(prev_fast >= prev_slow and curr_fast < curr_slow), curr_fast - curr_slow

        if field == "oi_change":
            if operator == "above":
                return bool(oi_change is not None and value is not None and oi_change > value), oi_change
            if operator == "below":
                return bool(oi_change is not None and value is not None and oi_change < value), oi_change

        if field == "iv":
            if operator == "above":
                return bool(iv is not None and value is not None and iv > value), iv
            if operator == "below":
                return bool(iv is not None and value is not None and iv < value), iv

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

    @staticmethod
    def _build_trigger_context(alert: AlertORM, tick: dict[str, Any], triggered_value: float | None) -> dict[str, Any]:
        params = alert.parameters if isinstance(alert.parameters, dict) else {}
        chart_context = params.get("chart_context")
        context: dict[str, Any] = {
            "tick": dict(tick),
            "triggered_value": triggered_value,
        }
        if isinstance(alert.conditions, list) and alert.conditions:
            context["conditions"] = alert.conditions
            context["logic"] = alert.logic or "AND"
        if isinstance(chart_context, dict):
            context["chart_context"] = chart_context
            source = chart_context.get("source")
            if isinstance(source, str) and source.strip():
                context["source"] = source
        if "threshold" in params:
            context["threshold"] = params.get("threshold")
        if "note" in params:
            context["note"] = params.get("note")
        return context

    @staticmethod
    def _build_delivery_message(alert: AlertORM, triggered_value: float | None, now: datetime) -> str:
        condition_text = str(alert.condition_type)
        if isinstance(alert.conditions, list) and alert.conditions:
            parts = []
            for condition in alert.conditions:
                if not isinstance(condition, dict):
                    continue
                field = str(condition.get("field") or "").strip()
                operator = str(condition.get("operator") or "").strip()
                value = condition.get("value")
                parts.append(f"{field} {operator} {value}")
            if parts:
                condition_text = f" {str(alert.logic or 'AND').upper()} ".join(parts)
        return (
            f"Alert triggered\n"
            f"Symbol: {alert.symbol}\n"
            f"Condition: {condition_text}\n"
            f"Value: {triggered_value}\n"
            f"Time: {now.isoformat()}"
        )

    @staticmethod
    def _build_event_payload(
        alert: AlertORM,
        triggered_value: float | None,
        now: datetime,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        context = context or AlertEvaluatorService._build_trigger_context(alert, {}, triggered_value)
        chart_context = context.get("chart_context") if isinstance(context.get("chart_context"), dict) else None
        payload: dict[str, Any] = {
            "type": "alert_triggered",
            "alert_id": alert.id,
            "symbol": alert.symbol,
            "condition": str(alert.condition_type),
            "triggered_value": triggered_value,
            "timestamp": now.isoformat(),
        }
        if chart_context:
            source = context.get("source")
            if isinstance(source, str) and source.strip():
                payload["source"] = source
            payload["payload"] = {
                "chart_context": chart_context,
            }
        return payload

    async def _emit_alert_event(
        self,
        alert: AlertORM,
        triggered_value: float | None,
        now: datetime,
        context: dict[str, Any] | None = None,
    ) -> None:
        if not self._hub:
            return
        payload = self._build_event_payload(alert, triggered_value, now, context)
        await self._hub.broadcast_alert(payload)
        await self._hub.broadcast(alert.symbol, payload)

_alert_service = AlertEvaluatorService()


def get_alert_evaluator_service() -> AlertEvaluatorService:
    return _alert_service
