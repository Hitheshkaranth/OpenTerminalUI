from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any

from backend.agent.events import artifact, error, final, phase, role_message, status
from backend.agent.playbook import EVIDENCE_SYNTHESIS
from backend.agent.ensemble.personas import PERSONAS
from backend.agent.ensemble.scorecard import persona_weights, store_signals
from backend.services.llm.base import LLMMessage, LLMProvider


VALID_SIGNALS = {"bullish", "bearish", "neutral"}


async def _call_tool(registry: Any, name: str, args: dict) -> dict | None:
    try:
        result = await asyncio.wait_for(registry.execute(name, args), timeout=20)
        if isinstance(result, dict):
            return result
    except Exception:
        pass
    return None


def _fmt(v, suffix: str = "", digits: int = 2) -> str | None:
    try:
        if v is None:
            return None
        f = float(v)
        if f != f:  # NaN
            return None
        return f"{f:,.{digits}f}{suffix}"
    except (TypeError, ValueError):
        return None


def _build_facts(symbol: str, snapshot: dict | None, technicals: dict | None) -> str:
    """Compact, factual block per symbol using the REAL tool output keys
    (get_stock_snapshot: current_price/pe/forward_pe/pb/roe_pct/rev_growth_pct/…;
    analyze_technicals: trend.ema_*, above_50dma, momentum.rsi_14/roc_20, volatility, volume)."""
    parts = [f"Symbol: {symbol}"]
    snap = snapshot if isinstance(snapshot, dict) else {}
    tech = technicals if isinstance(technicals, dict) else {}

    if snap.get("company_name"):
        parts.append(f"Name: {snap['company_name']}")
    if snap.get("sector"):
        parts.append(f"Sector: {snap['sector']}")
    for label, key, suffix in (
        ("Price", "current_price", ""), ("Change", "change_pct", "%"), ("P/E", "pe", ""), ("Fwd P/E", "forward_pe", ""),
        ("P/B", "pb", ""), ("EV/EBITDA", "ev_ebitda", ""), ("ROE", "roe_pct", "%"), ("Op margin", "op_margin_pct", "%"),
        ("Net margin", "net_margin_pct", "%"), ("Rev growth", "rev_growth_pct", "%"), ("EPS growth", "eps_growth_pct", "%"),
        ("Div yield", "div_yield_pct", "%"), ("Beta", "beta", ""),
    ):
        v = _fmt(snap.get(key), suffix)
        if v is not None:
            parts.append(f"{label}: {v}")
    mcap = _fmt(snap.get("market_cap"), "", 0)
    if mcap is not None:
        parts.append(f"Mkt cap: {mcap}")
    prov = snap.get("provenance") if isinstance(snap.get("provenance"), dict) else None
    if prov:
        parts.append(f"Data quality: {prov.get('quality')} via {prov.get('source')}")

    trend = tech.get("trend") if isinstance(tech.get("trend"), dict) else {}
    mom = tech.get("momentum") if isinstance(tech.get("momentum"), dict) else {}
    vol = tech.get("volatility") if isinstance(tech.get("volatility"), dict) else {}
    volume = tech.get("volume") if isinstance(tech.get("volume"), dict) else {}
    if trend.get("above_50dma") is not None:
        parts.append("Trend: " + ("above" if trend.get("above_50dma") else "below") + " 50DMA, "
                     + ("above" if trend.get("above_200dma") else "below") + " 200DMA")
    for label, key, suffix in (("EMA50", "ema_50", ""), ("EMA200", "ema_200", "")):
        v = _fmt(trend.get(key), suffix)
        if v is not None:
            parts.append(f"{label}: {v}")
    if trend.get("supertrend_dir") is not None:
        parts.append("Supertrend: " + ("up" if trend.get("supertrend_dir", 0) > 0 else "down"))
    for label, key, suffix in (("RSI14", "rsi_14", ""), ("ROC20", "roc_20", "%")):
        v = _fmt(mom.get(key), suffix)
        if v is not None:
            parts.append(f"{label}: {v}")
    v = _fmt(vol.get("atr_pct"), "%")
    if v is not None:
        parts.append(f"ATR: {v}")
    v = _fmt(volume.get("rvol_20"), "x")
    if v is not None:
        parts.append(f"RVOL20: {v}")
    v = _fmt(tech.get("distance_from_20d_high_pct"), "%")
    if v is not None:
        parts.append(f"Below 20d high: {v}")
    setups = tech.get("active_setups")
    if isinstance(setups, list) and setups:
        parts.append("Setups: " + ", ".join(str(x) for x in setups[:4]))
    if len(parts) == 1:
        parts.append("No data returned by the snapshot or technicals tools")

    text = "; ".join(parts)
    if len(text) > 900:
        text = text[:897] + "..."
    return text


def _salvage_signal_objects(text: str) -> list[dict]:
    """Extract every complete `{...}` object inside the (possibly truncated) signals array."""
    out: list[dict] = []
    start = text.find("[")
    if start == -1:
        return out
    depth = 0
    obj_start = None
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and obj_start is not None:
                try:
                    out.append(json.loads(text[obj_start : i + 1]))
                except (json.JSONDecodeError, ValueError):
                    pass
                obj_start = None
    return out


def _parse_signals(response: str, symbols: set[str]) -> list[dict]:
    if response is None:
        return []

    text = response.strip()

    # Strip fenced JSON
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    # Find first { ... last }
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1:
        return []

    try:
        data = json.loads(text[first : last + 1])
    except (json.JSONDecodeError, ValueError):
        # Reasoning models can hit max_tokens mid-object; salvage the complete
        # signal objects that were emitted before the cut.
        data = {"signals": _salvage_signal_objects(text[first:])}

    raw_signals = data.get("signals", []) if isinstance(data, dict) else []
    if not isinstance(raw_signals, list):
        return []

    rows: list[dict] = []
    for item in raw_signals:
        if not isinstance(item, dict):
            continue

        symbol = item.get("symbol")
        if not isinstance(symbol, str) or symbol.strip().upper() not in symbols:
            continue

        signal = item.get("signal")
        if signal not in VALID_SIGNALS:
            continue

        try:
            confidence = int(item.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0
        confidence = max(0, min(100, confidence))

        reason = item.get("reason", "")
        if not isinstance(reason, str):
            reason = str(reason)
        reason = reason.strip()[:100]

        rows.append({
            "symbol": symbol.strip().upper(),
            "signal": signal,
            "confidence": confidence,
            "reason": reason,
        })

    return rows


def _consensus(
    signals: list[dict],
    personas: list[dict],
    weights: dict[str, float],
) -> list[dict]:
    symbol_data: dict[str, dict] = {}
    for sig in signals:
        sym = sig["symbol"]
        if sym not in symbol_data:
            symbol_data[sym] = {"num": 0.0, "den": 0.0, "bullish": 0, "bearish": 0, "neutral": 0}
        p = sig["persona"]
        w = weights.get(p, 0.5)
        c = sig["confidence"]
        d = 1.0 if sig["signal"] == "bullish" else (-1.0 if sig["signal"] == "bearish" else 0.0)
        symbol_data[sym]["num"] += w * c * d
        symbol_data[sym]["den"] += w * c
        if sig["signal"] == "bullish":
            symbol_data[sym]["bullish"] += 1
        elif sig["signal"] == "bearish":
            symbol_data[sym]["bearish"] += 1
        else:
            symbol_data[sym]["neutral"] += 1

    consensus: list[dict] = []
    for sym, d in sorted(symbol_data.items()):
        score = round((d["num"] / d["den"]) * 100, 2) if d["den"] != 0 else 0
        if score >= 25:
            verdict = "BUY"
        elif score <= -25:
            verdict = "SELL"
        else:
            verdict = "HOLD"
        consensus.append({
            "symbol": sym,
            "score": score,
            "verdict": verdict,
            "bullish": d["bullish"],
            "bearish": d["bearish"],
            "neutral": d["neutral"],
        })
    return consensus


class EnsembleOrchestrator:
    def __init__(
        self,
        *,
        provider: LLMProvider,
        registry: Any,
        user_id: str | None,
        max_symbols: int = 12,
    ) -> None:
        self.provider = provider
        self.registry = registry
        self.user_id = user_id
        self.max_symbols = max_symbols

    async def _ask_persona(self, system_prompt: str, user_prompt: str, symbols_set: set[str]) -> list[dict]:
        """One structured call per persona; retry once, tersely, if nothing parseable came back."""
        kwargs = dict(tools=None, temperature=0.2, max_tokens=1500)
        try:
            result = await self.provider.complete(
                [LLMMessage(role="system", content=system_prompt), LLMMessage(role="user", content=user_prompt)],
                disable_thinking=True, **kwargs,
            )
        except TypeError:  # provider without the disable_thinking kwarg
            result = await self.provider.complete(
                [LLMMessage(role="system", content=system_prompt), LLMMessage(role="user", content=user_prompt)], **kwargs,
            )
        rows = _parse_signals(result.content or "", symbols_set)
        if rows:
            return rows
        retry_prompt = user_prompt + "\n\nOutput ONLY the JSON object now, no prose, no analysis."
        try:
            result = await self.provider.complete(
                [LLMMessage(role="system", content=system_prompt), LLMMessage(role="user", content=retry_prompt)],
                disable_thinking=True, **kwargs,
            )
        except TypeError:
            result = await self.provider.complete(
                [LLMMessage(role="system", content=system_prompt), LLMMessage(role="user", content=retry_prompt)], **kwargs,
            )
        return _parse_signals(result.content or "", symbols_set)

    async def run(self, subject: str, *, screen_context: dict | None = None):
        personas = PERSONAS
        persona_map = {p.id: p for p in personas}
        persona_list = [{"id": p.id, "label": p.label} for p in personas]

        # Phase 1: Resolve basket
        yield phase("basket", "Resolving basket")
        symbols: list[str] = []

        subject_stripped = subject.strip()

        if subject_stripped == "portfolio":
            result = await _call_tool(self.registry, "get_portfolio", {})
            if result is None:
                yield error("No portfolio tools available")
                yield final("No portfolio tools available.")
                return
            items = result.get("items", [])
            for item in (items if isinstance(items, list) else []):
                t = item.get("ticker") or item.get("symbol")
                if isinstance(t, str) and t.strip():
                    symbols.append(t.strip().upper())
        elif subject_stripped.startswith("watchlist:"):
            wl_id = subject_stripped[len("watchlist:"):]
            try:
                self.registry.get("get_watchlists")
            except KeyError:
                yield final("No symbols to analyse.")
                return
            result = await _call_tool(self.registry, "get_watchlists", {})
            if result is None:
                yield final("No symbols to analyse.")
                return
            items = result.get("items", [])
            found_symbols: list[str] = []
            for item in (items if isinstance(items, list) else []):
                if isinstance(item, dict) and str(item.get("id", "")) == wl_id:
                    syms = item.get("symbols", [])
                    if isinstance(syms, list):
                        for s in syms:
                            if isinstance(s, str) and s.strip():
                                found_symbols.append(s.strip().upper())
                    break
            if not found_symbols:
                yield status(f"Watchlist '{wl_id}' not found.")
                yield final("No symbols to analyse.")
                return
            symbols = found_symbols
        else:
            parts = [s.strip().upper() for s in subject_stripped.split(",") if s.strip()]
            seen: set[str] = set()
            deduped: list[str] = []
            for s in parts:
                if s not in seen:
                    seen.add(s)
                    deduped.append(s)
            symbols = deduped[: self.max_symbols]

        if not symbols:
            yield final("No symbols to analyse.")
            return

        symbols_set = set(symbols)

        # Phase 2: Fetch facts
        yield status("Fetching facts")
        facts_map: dict[str, str] = {}
        snapshots: dict[str, dict] = {}
        for sym in symbols:
            snapshot = await _call_tool(self.registry, "get_stock_snapshot", {"ticker": sym})
            technicals = await _call_tool(self.registry, "analyze_technicals", {"ticker": sym})
            if isinstance(snapshot, dict):
                snapshots[sym] = snapshot
            facts_map[sym] = _build_facts(sym, snapshot, technicals)

        # Phase 3: Persona signals
        if self.user_id:
            try:
                from backend.shared.db import SessionLocal
                db = SessionLocal()
                try:
                    weights = persona_weights(db, self.user_id)
                finally:
                    db.close()
            except Exception:
                weights = {p.id: 0.5 for p in personas}
        else:
            weights = {p.id: 0.5 for p in personas}

        all_signals: list[dict] = []

        for persona in personas:
            yield phase(persona.id, persona.label)

            facts_block = "\n\n---\n\n".join(
                f"## {sym}\n{facts_map.get(sym, 'No data available')}" for sym in symbols
            )

            user_prompt = f"Analyse the following symbols. Return JSON signals for each.\n\n{facts_block}"

            try:
                rows = await self._ask_persona(persona.system_prompt, user_prompt, symbols_set)
            except Exception:
                yield status(f"{persona.id} unavailable, skipping.")
                continue
            if not rows:
                yield status(f"{persona.id} returned no parseable signals.")

            # Attach persona to rows and store price_at_signal from snapshot
            for row in rows:
                row["persona"] = persona.id
                # Reuse the snapshot fetched in the facts step (no second network call).
                snap = snapshots.get(row["symbol"]) if isinstance(snapshots, dict) else None
                row["price_at_signal"] = (snap.get("current_price") or snap.get("price")) if isinstance(snap, dict) else None

            all_signals.extend(rows)

            bullish = sum(1 for r in rows if r["signal"] == "bullish")
            bearish = sum(1 for r in rows if r["signal"] == "bearish")
            neutral = sum(1 for r in rows if r["signal"] == "neutral")
            yield role_message(
                persona.id,
                f"{len(rows)} signals: {bullish} bullish / {bearish} bearish / {neutral} neutral",
            )

        if self.user_id:
            try:
                from backend.shared.db import SessionLocal
                db = SessionLocal()
                try:
                    store_signals(db, self.user_id, "ensemble_run", all_signals)
                finally:
                    db.close()
            except Exception:
                pass

        # Consensus
        consensus = _consensus(all_signals, personas, weights)

        # Emit signal_table artifact
        as_of = datetime.now(timezone.utc).isoformat()
        persona_weights_out = [
            {"id": p.id, "label": p.label, "weight": weights.get(p.id, 0.5)} for p in personas
        ]
        yield artifact(
            "signal_table",
            "Persona signals",
            {
                "as_of": as_of,
                "basket": symbols,
                "personas": persona_weights_out,
                "signals": [
                    {
                        "symbol": s["symbol"],
                        "persona": s["persona"],
                        "signal": s["signal"],
                        "confidence": s["confidence"],
                        "reason": s["reason"],
                    }
                    for s in all_signals
                ],
                "consensus": consensus,
            },
        )

        # Final markdown
        lines = ["| Symbol | Verdict | Score | Bull / Bear / Neutral |"]
        lines.append("|--------|---------|-------|------------------------|")
        for c in consensus:
            lines.append(
                f"| {c['symbol']} | {c['verdict']} | {c['score']} | {c['bullish']} / {c['bearish']} / {c['neutral']} |"
            )
        lines.append("")

        for p in personas:
            p_signals = [s for s in all_signals if s["persona"] == p.id]
            bl = sum(1 for s in p_signals if s["signal"] == "bullish")
            br = sum(1 for s in p_signals if s["signal"] == "bearish")
            ne = sum(1 for s in p_signals if s["signal"] == "neutral")
            lean = "bullish lean" if bl > br else ("bearish lean" if br > bl else "balanced")
            lines.append(f"- **{p.label}**: {bl}B / {br}B / {ne}N → {lean}")

        lines.append("")
        if consensus:
            avg_score = sum(c["score"] for c in consensus) / len(consensus)
            if avg_score >= 25:
                verdict = "BUY"
            elif avg_score <= -25:
                verdict = "SELL"
            else:
                verdict = "HOLD"
            lines.append(f"**Consensus: {verdict}** (avg score: {round(avg_score, 1)})")
        else:
            lines.append("**Consensus: No signals generated**")

        yield final("\n".join(lines))