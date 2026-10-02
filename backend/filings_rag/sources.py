from __future__ import annotations

# OWNER: agent A. Async ingestion from SEC EDGAR and NSE. Network helpers are module-level
# async functions so tests can monkeypatch them without touching real infra.
import re
from typing import Any

import logging

import httpx

SEC_USER_AGENT = "OpenTerminalUI research <contact@openterminalui.local>"
MAX_FILE_BYTES = 25 * 1024 * 1024

_NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
    "Origin": "https://www.nseindia.com",
}

logger = logging.getLogger(__name__)
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
_TICKER_CACHE: dict[str, int] = {}
# Normalised SEC company title -> primary ticker (first listing wins), for resolving names quoted in filings.
_SEC_NAME_CACHE: dict[str, str] = {}

_NSE_RESULT_RE = re.compile(r"(?:outcome\s+of\s+)?(?:board\s+)?results|financial\s+results|quarterly|quarter[-\s]?end|consolidated\s+results", re.IGNORECASE)
_NSE_TRANSCRIPT_RE = re.compile(r"earnings\s+call|concall|transcript|quarterly\s+concall|annual\s+general", re.IGNORECASE)
_NSE_PRESENTATION_RE = re.compile(r"investor\s presentation|investment\s day|investor\s deck|road\s show|presentation", re.IGNORECASE)
_NSE_ORDER_RE = re.compile(r"\b(order|contract|award|loan\s agreement|loa|purchase\s order|supply\s agreement|mou)\b", re.IGNORECASE)
_NSE_REGULATORY_RE = re.compile(r"(?:us|u\.?s\.?)\s*fda|eir|warning\s letter|form\s 483|import\s alert|approval|regulatory|ce\s mark", re.IGNORECASE)
_NSE_BOARD_RE = re.compile(r"outcome\s+of\s+board|board\s+meeting|directors?\s+meeting", re.IGNORECASE)


def market_for_symbol(symbol: str) -> str:
    text = symbol.strip().upper()
    if text.endswith(".NS") or text.endswith(".BO") or text.endswith(".GA"):
        return "IN"
    if "." in text:
        return "US"
    return "US"


def _is_nse_symbol(symbol: str) -> bool:
    text = symbol.strip().upper()
    return text.endswith(".NS") or text.endswith(".BO") or text.endswith(".GA")


async def _get(
    url: str,
    *,
    timeout: float = 30.0,
    headers: dict[str, str] | None = None,
    allow_redirects: bool = True,
    params: dict[str, Any] | None = None,
) -> httpx.Response | None:
    try:
        # httpx takes follow_redirects; the old allow_redirects= kwarg raised TypeError, which the
        # blanket except turned into None — so every SEC/NSE download silently "failed".
        async with httpx.AsyncClient(timeout=timeout, headers=headers or {}, trust_env=False,
                                     follow_redirects=allow_redirects) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp
    except (httpx.HTTPError, ValueError):
        logger.debug("filings source GET failed: %s", url, exc_info=True)
        return None


async def _get_json(url: str, *, headers: dict[str, str] | None = None, timeout: float = 30.0, params: dict[str, Any] | None = None) -> Any:
    resp = await _get(url, headers=headers, timeout=timeout, params=params)
    if resp is None:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


async def _get_text(url: str, *, headers: dict[str, str] | None = None, timeout: float = 30.0) -> str | None:
    resp = await _get(url, headers=headers, timeout=timeout)
    if resp is None:
        return None
    return resp.text


async def _get_bytes(url: str, *, headers: dict[str, str] | None = None, timeout: float = 30.0) -> bytes | None:
    resp = await _get(url, headers=headers, timeout=timeout)
    if resp is None:
        return None
    return resp.content


def _period_from(report_date: str | None, filed_at: str | None) -> str | None:
    for value in (report_date, filed_at):
        if value:
            return str(value).strip()
    return None


async def sec_documents(symbol: str, limit: int = 5) -> list[dict[str, Any]]:
    symbol_u = symbol.strip().upper()
    if limit <= 0:
        limit = 5

    cik = await _cik_for(symbol_u)
    if not cik:
        return []

    submissions_url = f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json"
    payload = await _get_json(submissions_url, headers={"User-Agent": SEC_USER_AGENT})
    if not isinstance(payload, dict):
        return []

    # filings.recent is a dict of parallel arrays (form[], accessionNumber[], items[], …), newest first —
    # not a list of filing objects. The first version treated it as a list and never returned anything.
    recent = (payload.get("filings") or {}).get("recent") or {}
    if not isinstance(recent, dict):
        return []
    forms = recent.get("form") or []

    def col(name: str, i: int) -> Any:
        values = recent.get(name) or []
        return values[i] if i < len(values) else None

    # Pick by priority, not recency: the latest 10-K first (it is the richest document), then up to
    # two 10-Qs, then earnings 8-Ks — otherwise newer quarterlies filled the limit and the 10-K was dropped.
    picks: list[tuple[int, int, str]] = []  # (priority, index, doc_type)
    ten_q = 0
    for i, form in enumerate(forms):
        if form == "10-K" and not any(p[2] == "annual_report" for p in picks):
            picks.append((0, i, "annual_report"))
        elif form == "10-Q" and ten_q < 2:
            picks.append((1, i, "quarterly_filing"))
            ten_q += 1
        elif form == "8-K" and "2.02" in str(col("items", i) or ""):  # Item 2.02 = results of operations
            picks.append((2, i, "press_release"))
    picks.sort()

    docs: list[dict[str, Any]] = []
    for _prio, i, doc_type in picks:
        if len(docs) >= limit:
            break
        form = forms[i]
        accession = str(col("accessionNumber", i) or "")
        primary = str(col("primaryDocument", i) or "")
        if not accession or not primary:
            continue
        acc_nodash = accession.replace("-", "")
        base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_nodash}"
        doc_name = primary
        if form == "8-K":
            # The 8-K body is a cover page; the earnings release is the Exhibit 99.x document.
            # Exhibit file names are company-specific (e.g. q226lillysalesandearningsp.htm), so read the
            # filing index, which lists each document's declared Type.
            doc_name = await _sec_exhibit_99(base, accession) or primary
        doc_url = f"{base}/{doc_name}"
        data = await _get_bytes(doc_url, headers={"User-Agent": SEC_USER_AGENT})
        if not data:
            continue
        report_date, filing_date = col("reportDate", i), col("filingDate", i)
        period = _period_from(report_date, filing_date)
        label = "8-K earnings release" if form == "8-K" else form
        docs.append(
            {
                "title": f"{label} ({period or filing_date or 'n/d'})",
                "doc_type": doc_type,
                "period": period,
                "source": "sec",
                "source_url": doc_url,  # the document itself, so citations open the filing
                "filed_at": str(filing_date) if filing_date else None,
                "data": data,
                "content_type": "text/html",
            }
        )

    return docs[:limit]



async def _sec_exhibit_99(base: str, accession: str) -> str | None:
    html = await _get_text(f"{base}/{accession}-index.html", headers={"User-Agent": SEC_USER_AGENT})
    if not html:
        return None
    try:
        from bs4 import BeautifulSoup

        for row in BeautifulSoup(html, "html.parser").find_all("tr"):
            cells = [c.get_text(" ", strip=True) for c in row.find_all("td")]
            link = row.find("a")
            if len(cells) >= 4 and re.match(r"EX-99", cells[3], re.I) and link and link.get("href"):
                name = link["href"].rsplit("/", 1)[-1]
                if name.lower().endswith((".htm", ".html")):
                    return name
    except Exception:  # noqa: BLE001 - fall back to the primary document
        return None
    return None

async def _sec_filing_items(cik: int, acc_nodash: str) -> list[str] | None:
    index_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}/{acc_nodash}-idx.htm"
    text = await _get_text(index_url, headers={"User-Agent": SEC_USER_AGENT})
    if not text:
        return None
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(text, "html.parser")
        for row in soup.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            label = cells[0].get_text().strip().rstrip(":").lower()
            if label == "items":
                raw = cells[1].get_text().strip()
                return [item.strip() for item in raw.split(";") if item.strip()]
    except Exception:
        return None
    return None


async def _cik_for(symbol: str) -> int | None:
    # SEC's company_tickers.json is an object keyed "0", "1", … with {"cik_str", "ticker", "title"}.
    # (The first version expected a list and a "cik" key, and rebound the module cache without
    # `global` — so every lookup raised UnboundLocalError or returned None.)
    if symbol.isdigit():
        return int(symbol)
    if not _TICKER_CACHE:
        payload = await _get_json("https://www.sec.gov/files/company_tickers.json", headers={"User-Agent": SEC_USER_AGENT})
        entries = payload.values() if isinstance(payload, dict) else payload if isinstance(payload, list) else []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            ticker = str(entry.get("ticker") or "").upper()
            try:
                _TICKER_CACHE[ticker] = int(entry.get("cik_str", entry.get("cik")))
            except (TypeError, ValueError):
                continue
            title_key = normalize_company_name(str(entry.get("title") or ""))
            if title_key and ticker:
                _SEC_NAME_CACHE.setdefault(title_key, ticker)
    return _TICKER_CACHE.get(symbol.upper())


_CORP_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
    "plc", "llc", "lp", "the", "sa", "ag", "nv", "se", "gmbh", "pvt", "private",
}


def normalize_company_name(name: str) -> str:
    """'Cardinal Health, Inc.' and 'CARDINAL HEALTH INC' both -> 'cardinal health'."""
    tokens = re.findall(r"[a-z0-9]+", (name or "").lower().replace("&", " and "))
    return " ".join(t for t in tokens if t not in _CORP_SUFFIXES)


async def sec_ticker_for_name(name: str) -> str | None:
    """Exact (normalised) SEC company-title match; None for private or unknown companies."""
    if not _SEC_NAME_CACHE:
        await _cik_for("__warm__")
    return _SEC_NAME_CACHE.get(normalize_company_name(name))


async def nse_documents(symbol: str, limit: int = 5) -> list[dict[str, Any]]:
    """Latest annual report + filed concall transcripts / presentations / results / order wins / USFDA updates.

    NSE only serves its JSON API to a session that first loaded the homepage (cookies), so everything runs
    through one client. Real shapes: /api/annual-reports → {"data": [{"fileName": <pdf>, "fromYr", "toYr", …}]};
    /api/corporate-announcements → [{"desc", "attchmntText", "attchmntFile", "an_dt", "sort_date", …}].
    (The first version used a fresh client per request and guessed other field names, so it never fetched anything.)
    """
    symbol_u = symbol.strip().upper()
    limit = limit if limit > 0 else 5
    docs: list[dict[str, Any]] = []
    async with httpx.AsyncClient(headers=_NSE_HEADERS, timeout=40.0, follow_redirects=True, trust_env=False) as client:
        async def get(url: str, **params: Any) -> httpx.Response | None:
            try:
                resp = await client.get(url, params=params or None)
                resp.raise_for_status()
                return resp
            except httpx.HTTPError:
                logger.debug("NSE GET failed: %s", url, exc_info=True)
                return None

        if await get("https://www.nseindia.com/") is None:
            return []

        async def download(url: str) -> bytes | None:
            resp = await get(url)
            if resp is None or len(resp.content) > MAX_DOWNLOAD_BYTES:
                return None
            return resp.content

        reports = await get("https://www.nseindia.com/api/annual-reports", index="equities", symbol=symbol_u)
        rows = ((reports.json() if reports is not None else {}) or {}).get("data") or []
        rows = sorted((r for r in rows if isinstance(r, dict) and str(r.get("fileName", "")).lower().endswith(".pdf")),
                      key=lambda r: str(r.get("toYr") or ""), reverse=True)
        for row in rows[:1]:  # latest annual report only: they run to hundreds of pages
            data = await download(row["fileName"])
            if data:
                fy = f"FY{str(row.get('toYr') or '')[-2:]}" if row.get("toYr") else None
                docs.append({"title": f"Annual Report {row.get('fromYr', '')}-{row.get('toYr', '')}".strip(" -"),
                             "doc_type": "annual_report", "period": fy, "source": "nse", "source_url": row["fileName"],
                             "filed_at": row.get("disseminationDateTime") or row.get("broadcast_dttm"),
                             "data": data, "content_type": "application/pdf"})

        ann = await get("https://www.nseindia.com/api/corporate-announcements", index="equities", symbol=symbol_u)
        items = ann.json() if ann is not None else []
        for item in items if isinstance(items, list) else []:
            if len(docs) >= limit:
                break
            if not isinstance(item, dict):
                continue
            url = str(item.get("attchmntFile") or "")
            if not url.lower().endswith(".pdf"):
                continue
            text = f"{item.get('desc') or ''} {item.get('attchmntText') or ''}"
            doc_type = _nse_attachment_type(text)
            if not doc_type:
                continue
            data = await download(url)
            if not data:
                continue
            docs.append({"title": str(item.get("attchmntText") or item.get("desc") or "NSE filing")[:200],
                         "doc_type": doc_type, "period": None, "source": "nse", "source_url": url,
                         "filed_at": item.get("sort_date") or item.get("an_dt"), "data": data,
                         "content_type": "application/pdf"})
    return docs[:limit]


_NSE_TYPE_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("concall_transcript", re.compile(r"\btranscript\b|\b(earnings|conference) call\b.*\b(transcript|recording)\b", re.I)),
    ("investor_presentation", re.compile(r"\binvestor presentation\b|\banalyst(s)? presentation\b|\bearnings presentation\b", re.I)),
    # Word-boundary, FDA-specific: plain "approval" matched shareholder/postal-ballot approvals.
    ("regulatory", re.compile(r"\b(US ?FDA|USFDA|EIR|Form 483|warning letter|import alert|DCGI|ANDA)\b", re.I)),
    ("press_release", re.compile(r"bagging/receiving of orders|awarding of order|\border (win|inflow)s?\b|\bletter of (award|intent)\b|\bLoA\b|\bwork orders?\b", re.I)),
    ("quarterly_filing", re.compile(r"\b(financial results|outcome of board meeting)\b", re.I)),
]


def _nse_attachment_type(description: str) -> str | None:
    for doc_type, pattern in _NSE_TYPE_RULES:
        if pattern.search(description or ""):
            return doc_type
    return None


