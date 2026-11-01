"""Deterministic comparisons of explicit assumptions with sourced observations."""
from __future__ import annotations

from datetime import datetime, timezone
import operator
import re

OPS = {"gte": operator.ge, "lte": operator.le, "gt": operator.gt, "lt": operator.lt, "eq": operator.eq}
SYMBOLS = {"gte": "≥", "lte": "≤", "gt": ">", "lt": "<", "eq": "="}


def metric_key(value):
    return re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")


def date_key(value):
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def period_key(value):
    """Order explicit fiscal quarters or calendar period-end dates without guessing a fiscal calendar."""
    text = re.sub(r"\s+", "", str(value or "").upper())
    quarter = re.fullmatch(r"(?:FY)?(\d{4}|\d{2})[-/]?Q([1-4])", text)
    reverse = re.fullmatch(r"Q([1-4])[-/]?(?:FY)?(\d{4}|\d{2})", text)
    if quarter or reverse:
        year, q = quarter.groups() if quarter else tuple(reversed(reverse.groups()))
        year = int(year) + (2000 if len(year) == 2 else 0)
        return "fiscal_quarter", year * 4 + int(q)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        dt = date_key(text)
        return ("calendar_end", dt.toordinal()) if dt else None
    annual = re.fullmatch(r"FY(\d{4}|\d{2})", text)
    if annual:
        year = annual[1]
        return "fiscal_year", int(year) + (2000 if len(year) == 2 else 0)
    return None


def evaluate_conditions(payload: dict, observed: dict | None = None) -> list[dict]:
    # A later monitored version of the same evidence supersedes its curated value only here.
    evidence = {e["id"]: e for e in payload.get("evidence", [])}
    evidence.update(observed or {})
    current_time = datetime.now(timezone.utc)
    rows = []
    for condition in payload.get("thesis_conditions", []):
        candidates = []
        for item in evidence.values():
            published = date_key(item.get("published_at"))
            if (metric_key(item.get("metric")) == metric_key(condition["metric"])
                and (item.get("unit") or "").strip().lower() == condition["unit"].strip().lower()
                and (not condition.get("period") or item.get("period") == condition["period"])
                and bool(item.get("period"))
                and isinstance(item.get("value"), (int, float))
                and published and published <= current_time
                and item.get("quote") and (item.get("source_url") or item.get("document_id"))):
                candidates.append(item)
        periods = {item.get("period") for item in candidates}
        parsed = [period_key(period) for period in periods]
        incomparable = len(periods) > 1 and (any(p is None for p in parsed) or len({p[0] for p in parsed if p}) > 1)
        candidates.sort(key=lambda item: ((period_key(item.get("period")) or ("", 0))[1] if not incomparable else 0,
            date_key(item["published_at"]), date_key(item.get("observed_at")) or date_key(item["published_at"]), item["id"]), reverse=True)
        latest = candidates[0] if candidates else None
        # Conflicting observations published at the same instant are unresolved, not arbitrarily selected.
        conflicting = bool(latest and any(item["value"] != latest["value"] and item.get("period") == latest.get("period")
            and date_key(item["published_at"]) == date_key(latest["published_at"]) for item in candidates[1:]))
        enabled = condition.get("enabled", True)
        status = "unknown"
        if latest and not conflicting and not incomparable and enabled:
            status = "within_threshold" if OPS[condition["operator"]](latest["value"], condition["threshold"]) else "breached"
        reason = ("Monitoring paused" if not enabled else "Fiscal periods cannot be ordered safely; specify a period for this assumption" if incomparable else "Conflicting observations require review" if conflicting else
                  "No comparable sourced observation with a fiscal period and publication date" if latest is None else
                  f"{condition['label']}: {latest['value']:g}{condition['unit']} {'meets' if status == 'within_threshold' else 'breaches'} {SYMBOLS[condition['operator']]} {condition['threshold']:g}{condition['unit']}")
        rows.append({"condition": condition, "condition_id": condition["id"], "status": status, "reason": reason,
                     "value": latest["value"] if latest and not conflicting and not incomparable else None,
                     "previous_value": candidates[1]["value"] if len(candidates) > 1 else None,
                     "evidence": latest if latest and not conflicting and not incomparable else None,
                     "conflicting_evidence": candidates if conflicting else []})
    return rows


def filing_metric_observations(condition: dict, chunk: dict, document: dict) -> list[dict]:
    """Extract only explicit percent statements, never infer units or financial periods."""
    if condition["unit"] != "%" or not document.get("filed_at"):
        return []
    phrase = re.escape(condition["metric"].replace("_", " "))
    pattern = re.compile(rf"\b{phrase}\s*(?:\bwas\b|\bis\b|\bstood at\b|\bof\b|:)\s*(-?\d+(?:\.\d+)?)\s*(?:%|percent\b)", re.I)
    text = chunk["text"]
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        return []
    match = matches[0]
    boundary = text.rfind(". ", 0, match.start())
    start = max(boundary + 2 if boundary >= 0 else 0, text.rfind("\n", 0, match.start()) + 1)
    boundaries = [at for at in (text.find(". ", match.end()), text.find("\n", match.end())) if at >= 0]
    end = min(boundaries) if boundaries else -1
    quote = text[start:end + 1 if end >= 0 else min(len(text), match.end() + 240)].strip()
    if re.search(r"\b(expect|expected|forecast|guidance|target|projected|would|could|will)\b", quote, re.I):
        return []
    return [{"id": f"metric:{document['id']}:{chunk['id']}:{condition['id']}", "claim": f"Reported {condition['label']}",
        "stance": "neutral", "metric": condition["metric"], "value": float(match[1]), "unit": "%",
        "period": document.get("period"), "published_at": document["filed_at"], "document_id": document["id"],
        "page": chunk.get("page_start"), "source_url": document.get("source_url") if (document.get("source_url") or "").startswith(("https://", "http://")) else None, "source_title": document.get("title", ""), "quote": quote}]
