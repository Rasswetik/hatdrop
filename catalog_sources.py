"""RasswetGifts-compatible fallback catalog for HatDrop.

Sources: Rasswetik/RasswetGifts sync_fragment.py and sync_model_prices.py.
Never requires a user MRKT/Portals token, does not fetch dynamic URLs from users.
"""
import html
import json
import re
import urllib.request
from urllib.parse import urljoin

RASSWET_CACHE = "https://raw.githubusercontent.com/Rasswetik/RasswetGifts/main/data/fragment_catalog_cache.json"
FRAGMENT = "https://fragment.com"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def trusted_image(url):
    url = str(url or "").strip()
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = urljoin(FRAGMENT, url)
    if url.startswith((
        "https://fragment.com/file/",
        "https://cdn.changes.tg/",
        "https://cdn.tgmrkt.io/gifts/stickers/thumbnails/"
    )):
        return url
    return ""


def fetch_text(url, timeout=20, max_bytes=12_000_000):
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=timeout) as response:
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("Source catalog too large")
    return data.decode("utf-8-sig", errors="replace")


def positive_ton(v):
    try:
        n = float(v)
        return round(n, 6) if 0 < n < 1_000_000 else 0.0
    except (ValueError, OverflowError, TypeError):
        return 0.0


def parse_rasswet_snapshot(data):
    """The actual structure written by RasswetGifts/sync_fragment.py."""
    gifts = data.get("gifts") or []
    all_models = data.get("models") or {}
    if not isinstance(gifts, list) or not isinstance(all_models, dict):
        raise ValueError("Unexpected RasswetGifts catalog format")
    result = {}
    for gift in gifts:
        if not isinstance(gift, dict):
            continue
        name = str(gift.get("name") or "").strip()
        fragment_slug = str(gift.get("fragment_slug") or "").strip()
        if not name or not fragment_slug:
            continue
        floor = (positive_ton(gift.get("getgems_floor_ton"))
                 or positive_ton(gift.get("fragment_price_ton"))
                 or positive_ton(float(gift.get("value") or 0) / 100)
                 or 0.0)
        models = {}
        for item in (all_models.get(fragment_slug) or []):
            if not isinstance(item, dict):
                continue
            model = str(item.get("model_name") or "").strip()
            if not model:
                continue
            model_floor = positive_ton(item.get("getgems_model_floor_ton"))
            # Collection floor is a fallback estimate, NOT an individual model floor.
            fallback_floor = positive_ton(item.get("getgems_floor_ton")) or floor
            models[model] = {
                "model": model,
                "floor": model_floor or fallback_floor,
                "image": trusted_image(item.get("image")),
                "source": "rasswet-getgems" if model_floor else "fragment-estimate",
            }
        result[name] = {
            "name": name, "short": fragment_slug, "id": "",
            "floor": floor, "pop": 0,
            "models": list(models.values()), "backdrops": {},
            "image": trusted_image(gift.get("image")),
        }
    if not result:
        raise ValueError("No collections in RasswetGifts catalog")
    return result


def fetch_rasswet_snapshot():
    return parse_rasswet_snapshot(json.loads(fetch_text(RASSWET_CACHE, timeout=25)))


def parse_fragment_collections(page):
    """Direct adaptation of the working RasswetGifts Fragment /gifts parser."""
    result = {}
    for match in re.finditer(r'<a\s+href="/gifts/([a-z0-9_-]+)"', page):
        short = match.group(1).lower()
        chunk = page[match.start():match.start() + 800]
        name_match = re.search(r'class="[^"]*tm-main-filters-name[^"]*"[^>]*>([^<]+)', chunk)
        name = html.unescape(name_match.group(1).strip()) if name_match else short
        image_match = re.search(r'<img[^>]+src="([^"]+)"', chunk)
        result[name] = {
            "name": name, "short": short, "id": "",
            "floor": 0, "pop": 0, "models": [], "backdrops": {},
            "image": trusted_image(image_match.group(1) if image_match else ""),
        }
    if not result:
        raise ValueError("Fragment returned no collections")
    return result


def fetch_fragment_catalog():
    return parse_fragment_collections(fetch_text(FRAGMENT + "/gifts", timeout=16))


def parse_fragment_models(page):
    """Adapted from the RasswetGifts js-attribute-item parser."""
    models = {}
    pattern = r'class="[^"]*js-attribute-item[^"]*"[^>]*data-value="([^"]*)"'
    for match in re.finditer(pattern, page):
        chunk = page[match.start():match.start() + 650]
        img = re.search(r'src="([^"]*?/model\.[^"]+)"', chunk)
        if not img:
            continue
        title = re.search(r'class="[^"]*tm-main-filters-name[^"]*"[^>]*>([^<]+)', chunk)
        name = html.unescape(title.group(1).strip() if title else match.group(1).strip())
        if name and name not in models:
            models[name] = {
                "floor": 0, "image": trusted_image(img.group(1)),
                "source": "fragment-no-model-floor"
            }
    return models


def fetch_fragment_models(fragment_slug):
    slug = str(fragment_slug or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{2,80}", slug):
        return {}
    page = fetch_text(FRAGMENT + "/gifts/" + slug, timeout=16, max_bytes=4_000_000)
    return parse_fragment_models(page)
