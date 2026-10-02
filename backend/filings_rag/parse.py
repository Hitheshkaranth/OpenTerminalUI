from __future__ import annotations

import io
import re
from collections import Counter

from bs4 import BeautifulSoup

# OWNER: agent A.

# Headings recognised without case/whitespace normalisation when matching.
KNOWN_HEADINGS: tuple[str, ...] = (
    "management discussion and analysis",
    "management's discussion and analysis",
    "risk factors",
    "risk factor",
    "directors' report",
    "directors report",
    "board of directors",
    "business overview",
    "business overview",
    "overview",
    "outlook",
    "future outlook",
    "order book",
    "book",
    "financial statements",
    "financial statement",
    "consolidated statement of",
    "statement of",
    "notes to the financial statements",
    "auditors' report",
    "auditors report",
    "letter",
    "annual report",
    "annual report",
    "chairman's",
    "chairman ",
    "corporate information",
    "definitions",
    "glossary",
    "shareholders",
    "key personnel",
    "management",
    "results",
    "earnings",
    "performance",
    "operating",
    "supply chain",
    "concall transcript",
    "questions and answers",
    "q & a",
)

PDF_MAX_PAGES = 1000
HTML_PSEUDO_PAGE_CHARS = 3000
CHUNK_MAX_CHARS = 1200
SECTION_RE = re.compile(r"^\s*(.+?)\s*$")


def _known_heading_lower(text: str) -> str:
    low = re.sub(r"\s+", " ", text.strip().lower())
    if not low:
        return ""
    for heading in KNOWN_HEADINGS:
        candidate = heading.strip().lower()
        if not candidate:
            continue
        if low == candidate:
            return candidate
        if len(candidate) < len(low) and low.startswith(candidate):
            rest = low[len(candidate) :].strip()
            if rest == "":
                return candidate
            extra_words = rest.split()
            if 1 <= len(extra_words) <= 3 and len(low) <= 100:
                return candidate
    return ""


def _looks_like_heading(line: str) -> bool:
    match = SECTION_RE.match(line)
    if not match:
        return False
    text = match.group(1)
    stripped = text.strip()
    if not stripped:
        return False
    if len(stripped) > 120:
        return False
    low = _known_heading_lower(stripped)
    if low:
        return len(stripped) <= 100
    alpha = [c for c in stripped if c.isalpha()]
    if len(alpha) > 1 and len(stripped) <= 100:
        if stripped == stripped.upper():
            words = stripped.split()
            if len(words) >= 1:
                return True
    words = stripped.split()
    if 1 <= len(words) <= 10:
        if all(w[0].isupper() for w in words) and not stripped[-1] in ".!?":
            return True
    return False


def _normalize_heading(line: str) -> str:
    match = SECTION_RE.match(line)
    if not match:
        return line
    text = match.group(1).strip()
    text = re.sub(r"\s+", " ", text)
    if text.endswith((".", ",", ";")):
        text = text.rstrip(",.;")
    return text.strip()


def _dephenylate(lines: list[str]) -> list[str]:
    STOPS = {"the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "and", "or", "with", "as", "is"}
    result: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line.endswith("-") and i + 1 < n:
            before = line[:-1].rstrip()
            nxt = lines[i + 1].strip()
            m = re.match(r"[^\s]+", nxt)
            after_word = m.group(0) if m else ""
            segments = before.split()
            last_word = segments[-1] if segments else before
            if len(last_word) <= 3 or len(after_word) <= 3 or after_word.lower() in STOPS:
                result.append(before + nxt)
                i += 2
                continue
            result.append(before)
            i += 1
            continue
        if line.endswith("-"):
            result.append(line[:-1].rstrip())
        else:
            result.append(line)
        i += 1
    return result


def _clean_lines(lines: list[str]) -> list[str]:
    pgnum = re.compile(r"^\s*\^?\s*(?:page\s+|p\.?\s*)?(\d{1,3})(?:\s*\^?|[\s]*(?:of|to)\s*\d+)?\s*\^?\s*$", re.IGNORECASE)
    kept = [ln for ln in lines if ln.strip()]
    freq = Counter(kept)
    out: list[str] = []
    for ln in lines:
        if not ln.strip():
            out.append("")
            continue
        if pgnum.match(ln):
            continue
        entry = ln.strip()
        if freq[entry] >= 5 and 3 <= len(entry) <= 100 and not re.search(r"\d{4}", entry) and "http" not in entry.lower():
            continue
        out.append(ln)
    out = [re.sub(r"[ \t\f\v]+", " ", ln).strip() for ln in out]
    collapsed: list[str] = []
    blank = False
    for ln in out:
        if ln == "":
            if blank:
                continue
            blank = True
        else:
            blank = False
        collapsed.append(ln)
    while collapsed and collapsed[-1] == "":
        collapsed.pop()
    while collapsed and collapsed[0] == "":
        collapsed.pop(0)
    return collapsed


def clean(text: str) -> str:
    if not text:
        return ""
    as_str = text if isinstance(text, str) else str(text)
    raw_lines = as_str.split("\n")
    dephen = _dephenylate(raw_lines)
    cleaned = _clean_lines(dephen)
    return "\n".join(cleaned)


def pdf_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        page_list = list(reader.pages[:PDF_MAX_PAGES])
    except Exception as exc:  # corrupt / truncated / encrypted PDFs must be a clean 422, not a 500
        raise ValueError("unreadable pdf") from exc
    pages: list[str] = []
    for page in page_list:
        try:
            extracted = page.extract_text() or ""
        except Exception:
            extracted = ""
        pages.append(extracted)
    return pages


def html_pages(data: bytes | str) -> list[str]:
    if isinstance(data, bytes):
        try:
            html = data.decode("utf-8")
        except UnicodeDecodeError:
            html = data.decode("latin-1", errors="replace")
    else:
        html = str(data)
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "noscript", "svg", "link", "meta", "form", "iframe"]):
        tag.decompose()
    # SEC inline-XBRL filings carry a hidden header of machine tags ("true false FALSE 2025 FY 0000059478
    # http://fasb.org/...") that otherwise lands in page 1 and gets "analysed" as prose.
    for tag in soup.find_all(lambda t: t.name and (t.name.lower() in ("ix:header", "ix:hidden")
                                                   or "display:none" in (t.get("style") or "").replace(" ", "").lower())):
        tag.decompose()
    main_tag = soup.find("main") or soup.find("body") or soup
    body_text = main_tag.get_text("\n")
    cleaned = clean(body_text)
    return _pseudo_pages_from_lines(cleaned.split("\n"), HTML_PSEUDO_PAGE_CHARS)


def text_pages(text: str) -> list[str]:
    cleaned = clean(text)
    if not cleaned.strip():
        return []
    split_parts = re.split(r"\n\s*\n", cleaned)
    parts = [p.strip() for p in split_parts if p.strip()]
    if len(parts) > 1:
        return parts
    return [cleaned]


def _pseudo_pages_from_lines(lines: list[str], target: int) -> list[str]:
    cleaned = _clean_lines(lines)
    if not cleaned:
        return []
    paras: list[str] = []
    buf: list[str] = []
    for ln in cleaned:
        if ln.strip() == "":
            if buf:
                paras.append("\n".join(buf).strip())
                buf = []
        else:
            buf.append(ln.strip())
    if buf:
        paras.append("\n".join(buf).strip())
    paras = [p for p in paras if p]
    if len(paras) <= 1:
        paras = [ln.strip() for ln in cleaned if ln.strip()]
    units: list[str] = []
    for para in paras:
        if len(para) <= target:
            units.append(para)
            continue
        # Sentence boundaries first; tables/lists without punctuation fall back to word boundaries.
        pieces = re.split(r"(?<=[.!?;])\s+", para)
        if any(len(x) > target for x in pieces):
            pieces = para.split()
        piece = ""
        for part in pieces:
            if piece and len(piece) + len(part) + 1 > target:
                units.append(piece)
                piece = ""
            piece = f"{piece} {part}".strip()
        if piece:
            units.append(piece)
    paras = units
    out: list[str] = []
    current: list[str] = []
    chars = 0
    for para in paras:
        if _looks_like_heading(para):
            if current:
                out.append("\n".join(current).strip())
                current = []
                chars = 0
            current.append(para)
            chars += len(para) + 1
            continue
        # Never strand a heading on its own page: it travels with its first block of content.
        heading_only = len(current) == 1 and _looks_like_heading(current[0])
        if chars + len(para) > target and current and not heading_only:
            out.append("\n".join(current).strip())
            current = []
            chars = 0
        current.append(para)
        chars += len(para) + 1
    if current:
        out.append("\n".join(current).strip())
    return [p for p in out if p.strip()]


def _page_paragraphs(cleaned_text: str) -> list[str]:
    if not cleaned_text:
        return []
    blocks = re.split(r"\n\s*\n", cleaned_text)
    paras: list[str] = []
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        buffer: list[str] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            if _looks_like_heading(line):
                if buffer:
                    paras.append("\n".join(buffer))
                    buffer = []
                paras.append(line)
                i += 1
                continue
            buffer.append(line)
            i += 1
        if buffer:
            paras.append("\n".join(buffer))
    return paras


def chunk_pages(pages: list[str], chunk_size: int = CHUNK_MAX_CHARS) -> list[dict[str, object]]:
    if not pages:
        return []
    flattened: list[dict[str, object]] = []
    section: str | None = None
    for page_no, page in enumerate(pages, start=1):
        if not page or not page.strip():
            continue
        cleaned = clean(page)
        if not cleaned.strip():
            continue
        for para in _page_paragraphs(cleaned):
            if _looks_like_heading(para):
                section = _normalize_heading(para)
                continue
            flattened.append(
                {
                    "text": para,
                    "page_start": page_no,
                    "page_end": page_no,
                    "section": section,
                }
            )
    if not flattened:
        return []
    chunks: list[dict[str, object]] = []
    i = 0
    n = len(flattened)
    while i < n:
        chosen = [flattened[i]]
        chars = len(flattened[i]["text"])
        j = i + 1
        while j < n and chars + len(flattened[j]["text"]) <= chunk_size:
            chosen.append(flattened[j])
            chars += len(flattened[j]["text"])
            j += 1
        text = "\n".join(c["text"] for c in chosen).strip()
        if text:
            section = chosen[0]["section"]
            for c in chosen:
                if c["section"]:
                    section = c["section"]
                    break
            chunks.append(
                {
                    "ordinal": len(chunks) + 1,
                    "page_start": int(chosen[0]["page_start"]),
                    "page_end": int(chosen[-1]["page_end"]),
                    "section": section,
                    "text": text,
                }
            )
        i = j - 1 if len(chosen) > 1 else j
    return chunks