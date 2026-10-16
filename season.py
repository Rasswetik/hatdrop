"""Leaderboard seasons: pure helpers (NFT link parsing, validation). No Flask/app state."""
import html
import re

NFT_LINK_RE = re.compile(r"^https?://(?:www\.)?(?:t\.me|telegram\.me)/nft/([A-Za-z0-9_-]{3,80})(?:[/?#].*)?$", re.I)
MAX_PLACES = 10
MAX_SEASON_HOURS = 24 * 90


def nft_slug(url):
    m = NFT_LINK_RE.match(str(url or "").strip())
    if not m:
        raise ValueError("Ссылка должна быть вида https://t.me/nft/PlushPepe-1234")
    slug = m.group(1).strip("-")
    if not re.search(r"-\d+$", slug):
        raise ValueError("Нужна ссылка на конкретный NFT-подарок с номером, например PlushPepe-1234.")
    return slug


def meta_content(page, key):
    for pattern in (rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)',
                    rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(key)}["\']'):
        m = re.search(pattern, page or "", re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return ""


def traits_from_text(text):
    out = {"model": "", "backdrop": "", "symbol": ""}
    text = html.unescape(str(text or "")).replace("•", "\n")
    for key, label in (("model", "Model"), ("backdrop", "Backdrop"), ("symbol", "Symbol")):
        m = re.search(rf"(?:^|[\n\r])\s*{label}\s*:\s*([^\n\r|]+)", text, re.I) or re.search(rf"\b{label}\s*:\s*([^,;|]+)", text, re.I)
        if m:
            out[key] = re.sub(r"\s+\d+(?:[.,]\d+)?\s*%\s*$", "", m.group(1).strip())[:100]
    return out


def parse_nft_page(page):
    """Из HTML страницы t.me/nft/<slug>: название и атрибуты (модель/фон/символ)."""
    title = meta_content(page, "og:title")
    title = re.sub(r"\s*[–—-]\s*(?:Fragment|Telegram)\s*$", "", title, flags=re.I).strip()
    description = meta_content(page, "twitter:description") or meta_content(page, "og:description")
    return {"title": title, **traits_from_text(description)}


def collection_title(slug):
    base = re.sub(r"-\d+$", "", slug)
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", base).replace("_", " ").replace("-", " ").strip()


def clean_name(value, default="Сезон"):
    return (str(value or "").strip()[:60]) or default


def duration_seconds(body):
    try:
        days = float(body.get("days") or 0)
        hours = float(body.get("hours") or 0)
    except (TypeError, ValueError):
        raise ValueError("bad_duration")
    total = days * 24 + hours
    if not 0 < total <= MAX_SEASON_HOURS:
        raise ValueError("bad_duration")
    return int(total * 3600)


def place_key(value):
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError("bad_place")
    if not 1 <= n <= MAX_PLACES:
        raise ValueError("bad_place")
    return str(n)
