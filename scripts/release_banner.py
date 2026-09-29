"""Render the banner image shown at the top of each GitHub release.

    python scripts/release_banner.py --version 0.8.0 --notes notes.md --out release-banner.png

Highlights are the "### " headings of the release notes (first four).
Used by .github/workflows/release-banner.yml.
"""

import argparse
import datetime as dt
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1600, 800
BG = (11, 14, 20)
PANEL = (20, 25, 34)
TEXT = (230, 234, 240)
MUTED = (140, 150, 165)
ACCENT = (255, 159, 26)
SHOTS = ["home.png", "security-hub-india.png", "chart-workstation.png"]

FONT_DIRS = [
    "/usr/share/fonts/truetype/jetbrains-mono",
    str(Path.home() / "Library/Fonts"),
    "/Library/Fonts",
    "/usr/share/fonts/truetype/dejavu",
    "/System/Library/Fonts",
]
FONT_NAMES = {
    "bold": ["JetBrainsMono-ExtraBold.ttf", "JetBrainsMono-Bold.ttf", "DejaVuSansMono-Bold.ttf", "Menlo.ttc"],
    "regular": ["JetBrainsMono-Regular.ttf", "DejaVuSansMono.ttf", "Menlo.ttc"],
}


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    for name in FONT_NAMES[weight]:
        for d in FONT_DIRS:
            if (Path(d) / name).exists():
                return ImageFont.truetype(str(Path(d) / name), size)
    return ImageFont.load_default(size)


def highlights(notes: str) -> list[str]:
    heads = re.findall(r"^###\s+(.+)$", notes, re.M)
    return [re.sub(r"[*_`]", "", h).strip() for h in heads][:4]


def fit(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, width: int) -> str:
    if draw.textlength(text, font=f) <= width:
        return text
    while text and draw.textlength(text + "…", font=f) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def screenshot(name: str, w: int, h: int) -> Image.Image:
    path = ROOT / "assets/screenshots" / name
    img = Image.open(path).convert("RGB") if path.exists() else Image.new("RGB", (w, h), PANEL)
    img.thumbnail((w, 10_000), Image.LANCZOS)
    img = img.crop((0, 0, w, min(h, img.height)))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), 14, fill=255)
    out = Image.new("RGBA", img.size)
    out.paste(img, mask=mask)
    return out


def render(version: str, date: str, items: list[str]) -> Image.Image:
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    # faint grid + accent glow, terminal feel
    for x in range(0, W, 40):
        d.line((x, 0, x, H), fill=(16, 20, 28))
    for y in range(0, H, 40):
        d.line((0, y, W, y), fill=(16, 20, 28))
    glow = Image.new("RGBA", (W, H))
    ImageDraw.Draw(glow).ellipse((-300, -300, 700, 600), fill=(*ACCENT, 38))
    im.paste(glow.filter(ImageFilter.GaussianBlur(160)), mask=glow.filter(ImageFilter.GaussianBlur(160)))
    d = ImageDraw.Draw(im)

    # left column: logo, version, date, highlights
    x0, colw = 80, 640
    logo = Image.open(ROOT / "assets/logo.png").convert("RGBA")
    logo.thumbnail((440, 140), Image.LANCZOS)
    im.paste(logo, (x0 - 10, 70), logo)

    d.text((x0, 250), "RELEASE", font=font("regular", 26), fill=ACCENT)
    d.text((x0 - 4, 280), f"v{version}", font=font("bold", 128), fill=TEXT)
    d.text((x0, 430), date, font=font("regular", 26), fill=MUTED)

    f = font("regular", 28)
    y = 500
    for item in items:
        d.rectangle((x0, y + 12, x0 + 10, y + 22), fill=ACCENT)
        d.text((x0 + 28, y), fit(d, item, f, colw - 28), font=f, fill=TEXT)
        y += 52

    # right column: stacked screenshots
    sx, sw = 800, 720
    back = screenshot(SHOTS[1], sw - 80, 320)
    im.paste(back, (sx + 80, 70), back)
    mid = screenshot(SHOTS[2], sw - 40, 320)
    im.paste(mid, (sx + 40, 230), mid)
    front = screenshot(SHOTS[0], sw, 340)
    shadow = Image.new("RGBA", (W, H))
    ImageDraw.Draw(shadow).rounded_rectangle((sx + 10, 410, sx + sw + 10, 760), 14, fill=(0, 0, 0, 160))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    im.paste(shadow, mask=shadow)
    im.paste(front, (sx, 400), front)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((sx, 400, sx + front.width, 400 + front.height), 14, outline=ACCENT, width=2)

    d.rectangle((0, H - 6, W, H), fill=ACCENT)
    return im


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--version", required=True, help="e.g. 0.8.0 or v0.8.0")
    p.add_argument("--notes", help="release notes markdown file")
    p.add_argument("--date", default=dt.date.today().strftime("%d %b %Y"))
    p.add_argument("--out", default="release-banner.png")
    a = p.parse_args()
    notes = Path(a.notes).read_text() if a.notes else ""
    render(a.version.lstrip("v"), a.date, highlights(notes)).save(a.out, optimize=True)
    print(a.out)


if __name__ == "__main__":
    main()
