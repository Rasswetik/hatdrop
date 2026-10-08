import hashlib
import hmac
import html
import json
import os
import secrets
import sqlite3
import threading
import time
import re
import urllib.error
import urllib.request
from math import comb
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import parse_qsl, quote, urlsplit

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "data.json"))  # старый JSON-файл (только для миграции)
SQLITE_PATH = os.environ.get("SQLITE_PATH") or (os.path.splitext(DB_PATH)[0] + ".sqlite3")
_sqlite_lock = threading.Lock()
def _env_first(*names):
    for n in names:
        v = os.environ.get(n, "").strip()
        if v:
            return v
    return ""


# Токен Telegram-бота: проверка входа, аватарки игроков
BOT_TOKEN = _env_first("BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "TG_BOT_TOKEN")
ADMIN_IDS = {x.strip() for x in os.environ.get("ADMIN_IDS", "").split(",") if x.strip()} | {"5257227756"}
# Postgres-ссылка (Neon/Supabase/Render/Railway). Если задана - база живёт там и переживает перезапуски.
# Если задана любая из этих переменных - база живёт в PostgreSQL. Если нет - в локальном SQLite.
DATABASE_URL = _env_first("DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL", "POSTSQL_URL", "POSTSQL",
                          "POSTGRES", "POSTGRESQL", "PG_URL", "POSTGRES_URI")
# Адрес API Portals зашит; менять не нужно. Нужен только ключ (Authorization) - вставляется в админке.
# Хосты Portals перебираются по очереди; рабочий запоминается. Менять не нужно.
PORTALS_HOSTS = [h.strip().rstrip("/") for h in os.environ.get(
    "PORTALS_API", "https://portal-market.com/api,https://portals-market.com/api"
).split(",") if h.strip()]
PORTALS_AUTH = os.environ.get("PORTALS_AUTH", "")
GIFT_IMG_TEMPLATE = os.environ.get(
    "GIFT_IMG_TEMPLATE", "https://cdn.changes.tg/gifts/models/{name}/png/{model}.png"
)
# Запасные источники PNG модели (через запятую в GIFT_IMG_FALLBACKS). Пробуются по очереди.
GIFT_IMG_FALLBACKS = [t.strip() for t in os.environ.get(
    "GIFT_IMG_FALLBACKS",
    "https://cdn.changes.tg/gifts/models/{name}/png/{model}.png,"
    "https://cdn.changes.tg/gifts/models/{name_nospace}/png/{model}.png",
).split(",") if t.strip()]
# Картинка коллекции целиком (когда модель неизвестна)
GIFT_THUMB_TEMPLATES = [
    "https://fragment.com/file/gifts/{slug_lower}/thumb.webp",
    "https://cdn.changes.tg/gifts/originals/{name}/Original.png",
]

START_BALANCE = 10.0
PROMO_CODES = {"DEMO": 10.0}  # legacy codes; new codes use persistent DB
MARGIN = 0.05
SELL_SHARE = 0.9
MIN_DEPOSIT = 0.5
SHELL_CUPS = 3
SHELL_HAT_VALUE = 3.0
SHELL_PRICE_SHARE = round(1 / SHELL_CUPS / (1 - MARGIN), 4)
ROUND_TTL = 180
HISTORY_LIMIT = 50
MIN_CHANCE_PCT, MAX_CHANCE_PCT = 10, 70
CHANCES = [p / 100 for p in range(MIN_CHANCE_PCT, MAX_CHANCE_PCT + 1)]

TIERS = {
    "random": {"value": 3.0, "name": "Шляпа волшебника"},
    "onyx": {"value": 8.0, "name": "Шляпа на ониксе"},
    "black": {"value": 20.0, "name": "Шляпа на блэке"},
}

GIFTS = {
    "WitchHat": ("Witch Hat", 3.0, 95, ["Classic", "Crimson", "Frost"]),
    "MoonCat": ("Moon Cat", 6.5, 80, ["Silver", "Night", "Dawn"]),
    "StarCup": ("Star Cup", 12.0, 70, ["Gold", "Iron", "Glass"]),
    "LuckyClover": ("Lucky Clover", 2.2, 65, ["Meadow", "Mint"]),
    "FireBloom": ("Fire Bloom", 9.4, 60, ["Ember", "Ash", "Spark"]),
    "TinyDragon": ("Tiny Dragon", 24.0, 55, ["Jade", "Ruby", "Onyx"]),
    "CrystalOwl": ("Crystal Owl", 15.5, 50, ["Ice", "Amber"]),
    "PixelFox": ("Pixel Fox", 4.1, 45, ["Red", "Arctic", "Shadow"]),
    "GoldenKey": ("Golden Key", 31.0, 40, ["Old", "Royal"]),
    "MagicBook": ("Magic Book", 7.7, 35, ["Spell", "Rune", "Moon"]),
    "RainCloud": ("Rain Cloud", 1.6, 30, ["Grey", "Blue"]),
    "SunnyMill": ("Sunny Mill", 18.0, 25, ["Wheat", "Rose"]),
}
MODEL_STEP = 0.18

CHEST_CELLS = 25
CHEST_MAX_EMPTY = 20
CHEST_RTP = 0.97
CHEST_MIN_BET = 0.1
CHEST_MAX_BET = 300.0
CHEST_MIN_MULT = 1.01

app = Flask(__name__, static_folder=None)
lock = threading.RLock()
db = {"users": {}, "prices": {}, "settings": {}}


CATALOG = {}
_last_saved = {"db": None, "catalog": None}
_pg_conn = None


def _pg():
    global _pg_conn
    import psycopg2

    if _pg_conn is None or _pg_conn.closed:
        _pg_conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
        _pg_conn.autocommit = True
        with _pg_conn.cursor() as c:
            c.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
    return _pg_conn


def _sqlite_conn():
    d = os.path.dirname(SQLITE_PATH)
    if d:
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(SQLITE_PATH, timeout=15)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.DatabaseError:
        pass
    conn.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
    return conn


def _sqlite_get(key):
    if not os.path.exists(SQLITE_PATH):
        return None
    with _sqlite_lock:
        conn = _sqlite_conn()
        try:
            row = conn.execute("SELECT v FROM kv WHERE k=?", (key,)).fetchone()
        finally:
            conn.close()
    return row[0] if row else None


def store_get(key, path):
    if DATABASE_URL:
        with _pg().cursor() as c:
            c.execute("SELECT v FROM kv WHERE k=%s", (key,))
            row = c.fetchone()
        if row:
            return row[0]
        text = _sqlite_get(key)  # перенос из SQLite, если раньше база была там
        if text:
            return text
    else:
        text = _sqlite_get(key)
        if text:
            return text
    if os.path.exists(path):  # перенос из старого JSON-файла
        with open(path, encoding="utf-8") as f:
            return f.read()
    return None


def store_put(key, path, text):
    global _pg_conn
    if DATABASE_URL:
        for attempt in (1, 2):
            try:
                with _pg().cursor() as c:
                    c.execute(
                        "INSERT INTO kv (k, v) VALUES (%s, %s) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
                        (key, text),
                    )
                return
            except Exception as e:
                _pg_conn = None
                if attempt == 2:
                    print(f"DB save failed: {e}", flush=True)
        return
    try:
        with _sqlite_lock:
            conn = _sqlite_conn()
            try:
                with conn:
                    conn.execute(
                        "INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
                        (key, text),
                    )
            finally:
                conn.close()
    except Exception as e:
        print(f"SQLite save failed: {e}", flush=True)


def load_db():
    global db
    text = store_get("db", DB_PATH)
    if text:
        db = json.loads(text)
        _last_saved["db"] = text
    db.setdefault("users", {})
    db.setdefault("prices", {})
    db.setdefault("settings", {})
    db.setdefault("promocodes", {})
    db.setdefault("withdrawals", {})
    db["settings"].setdefault("active_market", "portals")
    where = "Postgres" if DATABASE_URL else f"SQLite ({SQLITE_PATH})"
    print(f"DB: {where}, users: {len(db['users'])}", flush=True)
    if not DATABASE_URL and not (os.environ.get("DB_PATH") or os.environ.get("SQLITE_PATH")):
        print("WARNING: SQLite лежит в папке приложения - на хостинге без диска она сотрётся при деплое/рестарте. "
              "Задай DATABASE_URL (Postgres) или SQLITE_PATH на постоянном диске.", flush=True)
    # утешительных мишек больше нет: чистим старые у всех игроков
    for u in db["users"].values():
        u["prizes"] = [p for p in u.get("prizes", []) if p.get("tier") != "bear"]


def save_db():
    text = json.dumps(db, ensure_ascii=False)
    if text == _last_saved["db"]:
        return
    store_put("db", DB_PATH, text)
    _last_saved["db"] = text


def load_catalog():
    text = store_get("catalog", DB_PATH + ".catalog")
    if text:
        CATALOG.clear()
        CATALOG.update(json.loads(text))
        _last_saved["catalog"] = text
    # Once-only migration: legacy mixed-source data had duplicate slugs and estimated prices.
    if int(db["settings"].get("catalog_version") or 0) < 3:
        CATALOG.clear()
        db["prices"].clear()
        db["settings"]["catalog_version"] = 3
        save_catalog()
        save_db()


def save_catalog():
    text = json.dumps(CATALOG, ensure_ascii=False)
    if text != _last_saved["catalog"]:
        store_put("catalog", DB_PATH + ".catalog", text)
        _last_saved["catalog"] = text


class ApiError(Exception):
    def __init__(self, code, status=400, **extra):
        self.code = code
        self.status = status
        self.extra = extra


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify({"error": e.code, **e.extra}), e.status


def portals_auth():
    return (db["settings"].get("portals_auth") or PORTALS_AUTH).strip()


def mask_key(key):
    if not key:
        return ""
    return "••••" + key[-4:] if len(key) > 8 else "••••"


def money(x):
    return float(Decimal(repr(float(x))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def ton(x):
    return round(float(x), 6)


def gifts_map():
    """Only show the single verified active marketplace catalog."""
    if CATALOG:
        return CATALOG
    if db.get("settings", {}).get("active_market") in ("portals", "mrkt"):
        return {}
    out = {}
    for slug, (name, floor, pop, models) in GIFTS.items():
        out[slug] = {
            "name": name,
            "floor": floor,
            "pop": pop,
            "models": [{"model": m, "floor": money(floor * (1 + MODEL_STEP * i))} for i, m in enumerate(models)],
        }
    return out


def gift_entry(slug):
    entry = gifts_map().get(slug)
    if not entry:
        raise ApiError("gift_unavailable")
    return entry


def gift_floor(slug):
    entry = gift_entry(slug)
    return db["prices"].get(slug, entry.get("floor", 0))


def gift_models(slug):
    entry = gift_entry(slug)
    floor = gift_floor(slug)
    out = []
    for m in entry.get("models", []):
        price = ton(m.get("floor") or 0)
        if price <= 0 or m.get("source") in ("fragment-estimate", "fragment-no-model-floor"):
            continue  # An unpriced model must not inherit a made-up collection floor.
        out.append({"model": m["model"], "price_ton": price,
                    "image": gift_image(slug, m["model"]),
                    "rarity_per_mille": m.get("rarity_per_mille"),
                    "source": m.get("source", "")})
    return out


def gift_image(slug, model=""):
    entry = gifts_map().get(slug) or {}
    if not model:
        short = str(entry.get("short") or slug).lower()
        # The official collection preview, not a random model.
        return (entry.get("image") or
                f"https://portal-market.com/collection_previews/{quote(short)}.webp")
    for m in entry.get("models", []):
        if m.get("model") == model:
            direct = str(m.get("image") or "")
            if direct.startswith(("https://cdn.tgmrkt.io/", "https://fragment.com/file/", "https://cdn.changes.tg/")):
                return direct
            break
    return ("https://cdn.changes.tg/gifts/models/" +
            quote(entry.get("name", slug), safe="") + "/png/" + quote(model, safe="") + ".png")


def gift_price(slug, model):
    if slug not in gifts_map():
        raise ApiError("gift_unavailable")
    if not model:
        result = gift_floor(slug)
        if result <= 0:
            raise ApiError("gift_price_unavailable")
        return result
    for m in gift_models(slug):
        if m["model"] == model:
            return m["price_ton"]
    raise ApiError("gift_unavailable")


def chest_mult(empties, opened):
    if opened <= 0:
        return 1.0
    fair = comb(CHEST_CELLS, opened) / comb(CHEST_CELLS - empties, opened)
    return max(CHEST_MIN_MULT, money(fair * CHEST_RTP))


CHEST_LADDER = {
    str(m): [chest_mult(m, k) for k in range(1, CHEST_CELLS - m + 1)] for m in range(1, CHEST_MAX_EMPTY + 1)
}


def spin_cost(value, chance):
    return max(0.01, money(value * chance / (1 - MARGIN)))


def shell_cost_for(price):
    return money(price * SHELL_PRICE_SHARE)


def verified_telegram_user(init_data):
    if not (BOT_TOKEN and init_data):
        return None
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received = pairs.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise ApiError("unauthorized", 401)
    try:
        return json.loads(pairs.get("user", "{}"))
    except ValueError:
        raise ApiError("unauthorized", 401)


def current_user():
    body = request.get_json(silent=True) or {}
    tg = verified_telegram_user(body.get("initData", ""))
    if tg and tg.get("id"):
        uid = f"tg{tg['id']}"
    else:
        demo = str(body.get("demoId", "anon"))[:64]
        uid = "demo" + hashlib.sha1(demo.encode()).hexdigest()[:12]
    users = db["users"]
    if uid not in users:
        print(f"new user: {uid}", flush=True)
        users[uid] = {
            "id": uid,
            "key": secrets.token_hex(6),
            "username": (tg or {}).get("username", ""),
            "photo_url": (tg or {}).get("photo_url", ""),
            "first_name": (tg or {}).get("first_name", "") or f"Игрок {uid[-4:]}",
            "wallet": "",
            "anon": False,
            "balance": START_BALANCE,
            "turnover": 0.0,
            "games": 0,
            "bear_given": False,
            "next_prize_id": 1,
            "prizes": [],
            "history": [],
            "round": None,
            "promos": [],
            "seen": 0,
        }
    user = users[uid]
    user.setdefault("chest", None)
    user["seen"] = int(time.time())
    if tg:
        user["username"] = tg.get("username", user["username"])
        user["first_name"] = tg.get("first_name", user["first_name"])
        user["photo_url"] = tg.get("photo_url") or user.get("photo_url", "")
    return user, body


def api(fn):
    def wrapper(*args, **kwargs):
        with lock:
            user, body = current_user()
            result = fn(user, body)
            save_db()
            return jsonify(result)

    wrapper.__name__ = fn.__name__
    return wrapper


def route(path):
    def deco(fn):
        app.add_url_rule(path, fn.__name__, api(fn), methods=["POST"])
        return fn

    return deco


def level_info(turnover):
    level = int((turnover / 5) ** 0.5) + 1
    low = (level - 1) ** 2 * 5
    high = level**2 * 5
    return {
        "level": level,
        "progress": min(1.0, (turnover - low) / (high - low)),
        "next_ton": high,
        "turnover_ton": ton(turnover),
    }


def is_admin(user):
    return user["id"] in ADMIN_IDS or user["id"].removeprefix("tg") in ADMIN_IDS


def display_name(user):
    if user["anon"]:
        return "Аноним"
    return f"@{user['username']}" if user["username"] else user["first_name"]


def best_prize(user):
    won = [p for p in user["prizes"] if p["tier"] != "bear"]
    if not won:
        return None
    p = max(won, key=lambda x: x["value"])
    return {"value_ton": p["value"], "name": p["name"], "tier": p["tier"], "image": p.get("image", "")}


def user_stats(user):
    withdrawn = [p for p in user["prizes"] if p["status"] != "owned" and p["status"] != "sold"]
    return {
        "withdrawn_ton": ton(sum(p["value"] for p in withdrawn)),
        "withdrawn_count": len(withdrawn),
        "turnover_ton": ton(user["turnover"]),
        "games": user["games"],
        "best": best_prize(user),
    }


def prize_view(p):
    out = {"id": p["id"], "status": p["status"], "tier": p["tier"], "name": p["name"], "image": p.get("image", ""),
           "value_ton": money(p["value"])}
    if p["status"] in ("owned", "withdraw_pending"):
        out["sell_ton"] = money(p["value"] * SELL_SHARE)
    return out


def visible_prizes(user):
    return [prize_view(p) for p in reversed(user["prizes"]) if p["status"] != "sold" and p["tier"] != "bear"]


def tier_config(tier):
    value = TIERS[tier]["value"]
    return {
        "chances": [{"chance": c, "cost_ton": spin_cost(value, c)} for c in CHANCES],
        "default_chance": 0.5,
        "prize_name": TIERS[tier]["name"],
    }


def public_config():
    base = tier_config("random")
    return {
        **base,
        "tiers": {t: tier_config(t) for t in TIERS},
        "tier_enabled": True,
        "gift_upgrade": True,
        "min_deposit_ton": MIN_DEPOSIT,
        "gift_deposit": {"enabled": False, "account": "", "share": 0, "hold_days": 0},
        "chests": {
            "enabled": True,
            "cells": CHEST_CELLS,
            "min_bet": CHEST_MIN_BET,
            "max_bet": CHEST_MAX_BET,
            "max_empty": CHEST_MAX_EMPTY,
            "ladder": CHEST_LADDER,
        },
        "shell": {
            "enabled": True,
            "tab_name": "Три шляпы",
            "prize_name": TIERS["random"]["name"],
            "cups": SHELL_CUPS,
            "gifts": True,
            "cost_ton": shell_cost_for(TIERS["random"]["value"]),
            "price_share": SHELL_PRICE_SHARE,
        },
    }


def full_state(user):
    return {
        "balance_ton": ton(user["balance"]),
        "config": public_config(),
        "user": {
            "username": user["username"],
            "first_name": user["first_name"],
            "wallet": user["wallet"],
            "anon": user["anon"],
            "avatar": avatar(user, own=True),
        },
        "deposit": {"address": tonconnect_config()["recipient_address"], "memo": f"u{user['key']}"},
        "prizes": visible_prizes(user),
        "chest_round": chest_view(user),
        "hatcoin": {"balance": 0, "percent": 0},
        "level": level_info(user["turnover"]),
        "stats": user_stats(user),
        "fairness": {"nonce": user["games"]},
        "withdraw_locked_until": 0,
        "server_time": int(time.time()),
        "is_admin": is_admin(user),
    }


def add_prize(user, tier, name, value, image=""):
    prize = {
        "id": user["next_prize_id"],
        "status": "owned",
        "tier": tier,
        "name": name,
        "value": money(value),
        "image": image,
    }
    user["next_prize_id"] += 1
    user["prizes"].append(prize)
    return prize


def record_game(user, kind, cost, win, target, image, bear):
    user["turnover"] += cost
    user["games"] += 1
    user["history"].insert(
        0,
        {"ts": int(time.time()), "kind": kind, "win": win, "bear": bear, "cost_ton": cost, "target": target, "image": image},
    )
    del user["history"][HISTORY_LIMIT:]


def consolation(user):
    return None


def resolve_target(body, tier):
    if tier == "gift":
        slug = body.get("gift", "")
        model = body.get("model", "")
        price = gift_price(slug, model)
        name = gift_entry(slug)["name"] + (f" · {model}" if model else "")
        return {"tier": f"gift:{slug}:{model}", "name": name, "value": price, "image": gift_image(slug, model)}
    if tier not in TIERS:
        raise ApiError("bad_request")
    return {"tier": tier, "name": TIERS[tier]["name"], "value": TIERS[tier]["value"], "image": ""}


@route("/api/state")
def state(user, body):
    return full_state(user)


@route("/api/spin")
def spin(user, body):
    try:
        chance = float(body.get("chance"))
    except (TypeError, ValueError):
        raise ApiError("bad_request")
    pct = chance * 100
    if abs(pct - round(pct)) > 1e-6 or not (MIN_CHANCE_PCT <= round(pct) <= MAX_CHANCE_PCT):
        raise ApiError("bad_request")
    chance = round(pct) / 100
    target = resolve_target(body, body.get("tier", "random"))
    cost = spin_cost(target["value"], chance)
    if body.get("tier") == "gift":
        asked = body.get("cost")
        if not isinstance(asked, (int, float)) or abs(asked - cost) > 0.005:
            raise ApiError("price_changed", price_ton=target["value"], cost_ton=cost)
    if user["balance"] + 1e-9 < cost:
        raise ApiError("insufficient_funds")
    user["balance"] = ton(user["balance"] - cost)
    win = secrets.randbelow(1_000_000) < chance * 1_000_000
    bear = None
    if win:
        add_prize(user, target["tier"], target["name"], target["value"], target["image"])
    else:
        bear = consolation(user)
    record_game(user, "upgrade", cost, win, target["name"], target["image"] or f"tier:{target['tier']}", bool(bear))
    return {"win": win, "balance_ton": ton(user["balance"]), "hatcoin_balance": 0, "consolation": bear}


@route("/api/shell/start")
def shell_start(user, body):
    if body.get("gift"):
        target = resolve_target({"gift": body["gift"], "model": body.get("model", "")}, "gift")
        cost = shell_cost_for(target["value"])
        asked = body.get("cost")
        if not isinstance(asked, (int, float)) or abs(asked - cost) > 0.005:
            raise ApiError("price_changed", price_ton=target["value"], cost_ton=cost)
    else:
        target = resolve_target({}, "random")
        target["value"] = TIERS["random"]["value"]
        cost = shell_cost_for(TIERS["random"]["value"])
    old = user["round"]
    if old:
        user["balance"] = ton(user["balance"] + old["cost"])
        user["round"] = None
    if user["balance"] + 1e-9 < cost:
        raise ApiError("insufficient_funds")
    user["balance"] = ton(user["balance"] - cost)
    user["round"] = {"cost": cost, "target": target, "at": time.time()}
    return {"balance_ton": ton(user["balance"])}


@route("/api/shell/play")
def shell_play(user, body):
    rnd = user["round"]
    if not rnd or time.time() - rnd["at"] > ROUND_TTL:
        if rnd:
            user["balance"] = ton(user["balance"] + rnd["cost"])
            user["round"] = None
        raise ApiError("round_expired")
    pick = body.get("pick")
    if pick not in range(SHELL_CUPS):
        raise ApiError("bad_pick")
    user["round"] = None
    cat = secrets.randbelow(SHELL_CUPS)
    win = cat == pick
    target = rnd["target"]
    bear = None
    if win:
        add_prize(user, target["tier"], target["name"], target["value"], target["image"])
    else:
        bear = consolation(user)
    record_game(user, "shell", rnd["cost"], win, "", target["image"] or f"tier:{target['tier']}", bool(bear))
    return {"win": win, "cat": cat, "hatcoin_balance": 0, "consolation": bear}


def chest_view(user):
    r = user.get("chest")
    if not r:
        return None
    k = len(r["opened"])
    return {
        "bet": r["bet"],
        "empties": r["empties"],
        "opened": r["opened"],
        "source": r["source"],
        "mult": chest_mult(r["empties"], k),
        "next_mult": chest_mult(r["empties"], k + 1) if k < CHEST_CELLS - r["empties"] else None,
    }


@route("/api/chests/start")
def chests_start(user, body):
    if user.get("chest"):
        raise ApiError("round_active", round=chest_view(user))
    try:
        empties = int(body.get("empties"))
    except (TypeError, ValueError):
        raise ApiError("bad_request")
    if not 1 <= empties <= CHEST_MAX_EMPTY:
        raise ApiError("bad_request")
    prize = None
    name = image = ""
    if body.get("prize_id") is not None:
        prize = next((p for p in user["prizes"] if p["id"] == body.get("prize_id")), None)
        if not prize or prize["status"] != "owned" or prize["tier"] == "bear":
            raise ApiError("not_found")
        bet = money(prize["value"])
        name, image, source = prize["name"], prize.get("image", ""), "gift"
    else:
        try:
            bet = money(float(body.get("bet")))
        except (TypeError, ValueError, OverflowError):
            raise ApiError("bad_request")
        source = "ton"
    if not (CHEST_MIN_BET <= bet <= CHEST_MAX_BET):
        raise ApiError("bad_bet", min_ton=CHEST_MIN_BET, max_ton=CHEST_MAX_BET)
    if prize:
        prize["status"] = "sold"
    else:
        if user["balance"] + 1e-9 < bet:
            raise ApiError("insufficient_funds")
        user["balance"] = ton(user["balance"] - bet)
    user["chest"] = {
        "bet": bet,
        "empties": empties,
        "bad": secrets.SystemRandom().sample(range(CHEST_CELLS), empties),
        "opened": [],
        "source": source,
        "tier": prize["tier"] if prize else "",
        "name": name,
        "image": image,
        "at": time.time(),
    }
    return {"balance_ton": ton(user["balance"]), "prizes": visible_prizes(user), "round": chest_view(user)}


def pick_gift_for(payout):
    """Самый дорогой подарок (флор коллекции), который не дороже выплаты."""
    best = None
    for slug in gifts_map():
        value = gift_floor(slug)
        if value <= payout + 1e-9 and (best is None or value > best[0]):
            best = (value, slug)
    return best


def chest_cash(user, extra=None):
    r = user["chest"]
    mult = chest_mult(r["empties"], len(r["opened"]))
    payout = money(r["bet"] * mult)
    gift = None
    if r.get("source") == "gift" and r.get("tier") and payout + 1e-9 >= r["bet"]:
        # ставили подарком - он возвращается, а прибыль идёт в TON
        gift = add_prize(user, r["tier"], r["name"], r["bet"], r.get("image", ""))
    else:
        pick = pick_gift_for(payout)
        if pick:
            value, slug = pick
            gift = add_prize(user, f"gift:{slug}:", gift_entry(slug)["name"], value, gift_image(slug))
    ton_part = money(payout - gift["value"]) if gift else payout
    user["balance"] = ton(user["balance"] + ton_part)
    user["chest"] = None
    label = f"Сундуки · x{mult:g} · +{payout:g}"
    if gift:
        label = f"Сундуки · x{mult:g} · {gift['name']} + {ton_part:g} TON"
    record_game(user, "chests", r["bet"], True, label, "chests:win", False)
    return {
        **(extra or {}),
        "finished": True,
        "win": True,
        "mult": mult,
        "payout_ton": payout,
        "ton_part": ton_part,
        "gift": prize_view(gift) if gift else None,
        "bad": r["bad"],
        "balance_ton": ton(user["balance"]),
        "prizes": visible_prizes(user),
    }


@route("/api/chests/open")
def chests_open(user, body):
    r = user.get("chest")
    if not r:
        raise ApiError("no_round")
    cell = body.get("cell")
    if isinstance(cell, bool) or not isinstance(cell, int) or not 0 <= cell < CHEST_CELLS or cell in r["opened"]:
        raise ApiError("bad_cell")
    if cell in r["bad"]:
        user["chest"] = None
        bear = consolation(user)
        record_game(user, "chests", r["bet"], False, f"Сундуки · {r['empties']} пустых", "chests:lose", bool(bear))
        return {
            "safe": False,
            "finished": True,
            "win": False,
            "cell": cell,
            "bad": r["bad"],
            "balance_ton": ton(user["balance"]),
            "consolation": bear,
            "prizes": visible_prizes(user),
        }
    r["opened"].append(cell)
    if len(r["opened"]) >= CHEST_CELLS - r["empties"]:
        return chest_cash(user, {"safe": True, "cell": cell})
    return {"safe": True, "finished": False, "cell": cell, "round": chest_view(user)}


@route("/api/chests/cashout")
def chests_cashout(user, body):
    r = user.get("chest")
    if not r:
        raise ApiError("no_round")
    if not r["opened"]:
        raise ApiError("nothing_to_cash")
    return chest_cash(user)


@route("/api/sell")
def sell(user, body):
    prize = next((p for p in user["prizes"] if p["id"] == body.get("prize_id")), None)
    if not prize or prize["status"] != "owned":
        raise ApiError("not_sellable")
    payout = money(prize["value"] * SELL_SHARE)
    prize["status"] = "sold"
    user["balance"] = ton(user["balance"] + payout)
    return {"payout_ton": payout, "balance_ton": ton(user["balance"]), "prizes": visible_prizes(user)}


@route("/api/sell_all")
def sell_all(user, body):
    total, count = 0.0, 0
    for prize in user["prizes"]:
        if prize["status"] == "owned":
            prize["status"] = "sold"
            total += money(prize["value"] * SELL_SHARE)
            count += 1
    user["balance"] = ton(user["balance"] + total)
    return {"count": count, "payout_ton": money(total), "balance_ton": ton(user["balance"]), "prizes": visible_prizes(user)}


@route("/api/withdraw")
def withdraw(user, body):
    prize = next((p for p in user["prizes"] if p["id"] == body.get("prize_id")), None)
    if not prize or prize["status"] == "sold":
        raise ApiError("not_found")
    if prize["status"] != "owned":
        raise ApiError("already_requested")
    prize["status"] = "withdraw_pending"
    key = f"{user['id']}:{prize['id']}"
    db.setdefault("withdrawals", {})[key] = {"id": key, "uid": user["id"],
        "prize_id": prize["id"], "status": "pending", "created": int(time.time()),
        "updated": int(time.time()), "name": prize["name"], "image": prize.get("image", ""),
        "value_ton": prize["value"], "tier": prize["tier"]}
    _send_tg_async(user["id"], "🎁 Заявка на вывод подарка «" + prize["name"] + "» получена. Мы сообщим о решении.")
    return {"prizes": visible_prizes(user), "balance_ton": ton(user["balance"]), "auto_gift": False}


@route("/api/promo")
def promo(user, body):
    code = str(body.get("code", "")).strip().upper()
    codes = db.setdefault("promocodes", {})
    item = codes.get(code)
    if item is None:
        raise ApiError("not_found", 404)
    if not item.get("active", True):
        raise ApiError("promo_inactive")
    redeemed = user.setdefault("promos", [])
    if code in redeemed:
        raise ApiError("promo_used")
    if item.get("limit", 0) and item.get("uses", 0) >= item["limit"]:
        raise ApiError("promo_exhausted")
    if item["kind"] == "balance":
        amount = money(item["amount"])
        user["balance"] = ton(user["balance"] + amount)
        result = {"balance_ton": ton(user["balance"]), "amount_ton": amount}
    else:
        slug = item["gift"]
        model = item.get("model", "")
        target = resolve_target({"gift": slug, "model": model}, "gift")
        add_prize(user, target["tier"], target["name"], target["value"], target["image"])
        result = {"balance_ton": ton(user["balance"]), "prizes": visible_prizes(user), "gift": target["name"]}
    redeemed.append(code)
    item["uses"] = item.get("uses", 0) + 1
    return result


def _send_tg_async(uid, message):
    if not BOT_TOKEN or not str(uid).startswith("tg"):
        return
    try:
        chat = int(str(uid)[2:])
    except ValueError:
        return
    def job():
        try:
            tg_api("sendMessage", chat_id=chat, text=message)
        except Exception as e:
            print("Telegram notification failed:", str(e), flush=True)
    threading.Thread(target=job, daemon=True).start()


def withdrawal_record(row):
    u = db["users"].get(row["uid"], {})
    return {**row, "username": u.get("username", ""),
            "user_id": row["uid"], "first_name": u.get("first_name", ""),
            "telegram_id": str(row["uid"])[2:] if str(row["uid"]).startswith("tg") else ""}


@route("/api/admin/withdrawals")
def admin_withdrawals(user, body):
    require_admin(user)
    rows = list(db.setdefault("withdrawals", {}).values())
    # Legacy requests made before this feature existed.
    existing = {r["id"] for r in rows}
    for uid, u in db["users"].items():
        for prize in u.get("prizes", []):
            if prize.get("status") == "withdraw_pending":
                key = f"{uid}:{prize['id']}"
                if key not in existing:
                    rows.append({"id": key, "uid": uid, "prize_id": prize["id"],
                        "status": "pending", "created": 0, "updated": 0,
                        "name": prize["name"], "image": prize.get("image", ""),
                        "value_ton": prize.get("value", 0), "tier": prize.get("tier", "")})
    rows.sort(key=lambda r: r.get("created", 0), reverse=True)
    return {"rows": [withdrawal_record(r) for r in rows[:500]],
            "bot_enabled": bool(BOT_TOKEN),
            "bot_username": db["settings"].get("bot_username", "")}


@route("/api/admin/withdrawals/resolve")
def admin_withdrawals_resolve(user, body):
    require_admin(user)
    key = str(body.get("id") or "")
    action = str(body.get("action") or "")
    if action not in ("approve", "reject", "complete"):
        raise ApiError("bad_request")
    req = db.setdefault("withdrawals", {}).get(key)
    if req is None:
        uid, _, prize_id = key.rpartition(":")
        target = db["users"].get(uid)
        prize = next((p for p in target.get("prizes", []) if str(p["id"]) == prize_id), None) if target else None
        if not prize or prize.get("status") != "withdraw_pending":
            raise ApiError("not_found", 404)
        req = {"id": key, "uid": uid, "prize_id": prize["id"],
               "name": prize["name"], "image": prize.get("image", ""),
               "value_ton": prize.get("value", 0),
               "status": "pending", "created": 0}
        db["withdrawals"][key] = req
    target = db["users"].get(req["uid"])
    prize = next((p for p in target.get("prizes", []) if p.get("id") == req["prize_id"]), None) if target else None
    if not prize:
        raise ApiError("not_found", 404)
    current = req.get("status", "pending")
    if action == "approve" and current == "pending":
        req["status"] = "approved"
        prize["status"] = "withdraw_processing"
        msg = f"✅ Ваш подарок «{prize['name']}» найден. Заявка одобрена, ожидайте отправки."
    elif action == "reject" and current == "pending":
        req["status"] = "rejected"
        prize["status"] = "owned"
        msg = f"❌ Заявка на подарок «{prize['name']}» отклонена. Подарок возвращён в инвентарь."
    elif action == "complete" and current == "approved":
        # Manual confirmation only; no pretend NFT transfer.
        req["status"] = "completed"
        prize["status"] = "withdrawn"
        msg = f"🎉 Вывод подарка «{prize['name']}» отмечен как выполненный администратором."
    else:
        raise ApiError("invalid_status_transition")
    req["updated"] = int(time.time())
    req["moderator"] = user["id"]
    _send_tg_async(req["uid"], msg)
    return {"ok": True, "request": withdrawal_record(req)}


def _bot_reply(chat_id, text):
    if BOT_TOKEN and chat_id:
        try:
            tg_api("sendMessage", chat_id=chat_id, text=text)
        except Exception as e:
            print("Telegram bot reply failed:", str(e), flush=True)


@app.post("/telegram/webhook")
def bot_webhook():
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not secret or not hmac.compare_digest(
            request.headers.get("X-Telegram-Bot-Api-Secret-Token", ""), secret):
        return ("Forbidden", 403)
    payload = request.get_json(silent=True) or {}
    message = payload.get("message") or {}
    sender = message.get("from") or {}
    chat = message.get("chat") or {}
    if not sender.get("id") or chat.get("type") != "private":
        return jsonify({"ok": True})
    text = str(message.get("text") or "").strip()
    if text.startswith("/start"):
        _send_tg_async(f"tg{sender['id']}", "👋 Добро пожаловать в HatDrop! Здесь вы получите уведомления о выводе подарков.")
    elif text.startswith("/help"):
        _send_tg_async(f"tg{sender['id']}", "Для игры откройте приложение HatDrop. Бот сообщит о статусе заявок на вывод.")
    return jsonify({"ok": True})


@route("/api/admin/bot/status")
def admin_bot_status(user, body):
    require_admin(user)
    return {"configured": bool(BOT_TOKEN),
            "webhook_secret_configured": bool(os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")),
            "bot_username": db["settings"].get("bot_username", ""),
            "webhook_path": "/telegram/webhook"}


@route("/api/admin/bot/setup")
def admin_bot_setup(user, body):
    require_admin(user)
    if not BOT_TOKEN:
        raise ApiError("bot_token_missing")
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not secret:
        raise ApiError("webhook_secret_missing")
    host = request.host_url.rstrip("/")
    if not host.startswith("https://"):
        raise ApiError("https_required")
    try:
        result = tg_api("setWebhook", url=host + "/telegram/webhook",
                        secret_token=secret, allowed_updates='["message"]')
        bot = tg_api("getMe")
        db["settings"]["bot_username"] = bot.get("username", "")
    except Exception:
        raise ApiError("telegram_webhook_failed")
    return {"ok": bool(result), "bot_username": db["settings"]["bot_username"]}


@route("/api/admin/promos")
def admin_promos(user, body):
    require_admin(user)
    return {"rows": [{"code": c, **v} for c, v in sorted(db.setdefault("promocodes", {}).items(), reverse=True)]}


@route("/api/admin/promos/create")
def admin_promos_create(user, body):
    require_admin(user)
    code = str(body.get("code") or secrets.token_hex(5)).strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{4,32}", code):
        raise ApiError("bad_code")
    codes = db.setdefault("promocodes", {})
    if code in codes:
        raise ApiError("promo_exists")
    kind = str(body.get("kind") or "balance")
    try:
        limit = int(body.get("limit", 1))
    except (TypeError, ValueError):
        raise ApiError("bad_request")
    if limit < 1 or limit > 100000:
        raise ApiError("bad_request")
    row = {"kind": kind, "limit": limit, "uses": 0, "active": True, "created": int(time.time())}
    if kind == "balance":
        try:
            amount = money(float(body.get("amount")))
        except (ValueError, TypeError, OverflowError):
            raise ApiError("bad_request")
        if not 0 < amount <= 100000:
            raise ApiError("bad_request")
        row["amount"] = amount
    elif kind == "gift":
        slug = str(body.get("gift") or "")
        model = str(body.get("model") or "")
        gift_price(slug, model)
        row.update(gift=slug, model=model, name=gift_entry(slug)["name"])
    else:
        raise ApiError("bad_request")
    codes[code] = row
    return {"code": code, "ok": True}


@route("/api/admin/promos/update")
def admin_promos_update(user, body):
    require_admin(user)
    codes = db.setdefault("promocodes", {})
    code = str(body.get("code", "")).upper()
    if code not in codes:
        raise ApiError("not_found", 404)
    if body.get("delete"):
        del codes[code]
    else:
        codes[code]["active"] = bool(body.get("active"))
    return {"ok": True}


@route("/api/wallet")
def wallet(user, body):
    user["wallet"] = str(body.get("address", ""))[:128]
    return {"ok": True}


@route("/api/settings")
def settings(user, body):
    user["anon"] = bool(body.get("anon"))
    return {"anon": user["anon"]}


@route("/api/history")
def history(user, body):
    return {"rows": user["history"]}


@route("/api/gifts/catalog")
def gifts_catalog(user, body):
    items = [
        {"slug": s, "name": g["name"], "price_ton": gift_floor(s), "image": gift_image(s), "popular": g.get("pop", 0)}
        for s, g in gifts_map().items()
    ]
    return {"items": items, "margin": MARGIN, "price_steps": [], "price_base": 1}


def _models_payload(user, body):
    slug = body.get("slug", "")
    entry = gift_entry(slug)
    return {"slug": slug, "name": entry["name"], "floor": gift_floor(slug), "image": gift_image(slug), "models": gift_models(slug)}


_models_view = api(_models_payload)


@app.post("/api/gifts/models")
def gifts_models():
    slug = (request.get_json(silent=True) or {}).get("slug", "")
    if slug in CATALOG and not CATALOG[slug].get("models"):
        start_models_fetch(slug)
    return _models_view()


@route("/api/gifts/mine")
def gifts_mine(user, body):
    raise ApiError("disabled")


@route("/api/referral/create")
def referral_create(user, body):
    raise ApiError("referral_unavailable")


@route("/api/referral/withdraw")
def referral_withdraw(user, body):
    raise ApiError("below_minimum")


def ranking():
    rows = [u for u in db["users"].values() if u["games"] > 0]
    rows.sort(key=lambda u: u["turnover"], reverse=True)
    return rows


def avatar(user, own=False):
    """Ссылка на аватарку Telegram через наш сервер. В публичных списках аноним без аватарки."""
    if (user.get("anon") and not own) or not str(user["id"]).startswith("tg"):
        return ""
    return f"/avatar/{user['key']}.jpg"


AVATAR_CACHE = {}
AVATAR_OK_TTL = 6 * 3600
AVATAR_FAIL_TTL = 600


def tg_api(method, **params):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    if params:
        url += "?" + "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=8) as resp:
        data = json.load(resp)
    if not data.get("ok"):
        raise ValueError(data.get("description", "telegram error"))
    return data["result"]


def fetch_tg_avatar(tg_id, photo_url):
    """Фото профиля: сначала через бота (getUserProfilePhotos), затем по photo_url из initData."""
    if BOT_TOKEN:
        try:
            photos = tg_api("getUserProfilePhotos", user_id=tg_id, limit=1).get("photos") or []
            if photos:
                sizes = photos[0]
                pick = next((p for p in sizes if p.get("width", 0) >= 160), sizes[-1])
                path = tg_api("getFile", file_id=pick["file_id"])["file_path"]
                return _download_image(f"https://api.telegram.org/file/bot{BOT_TOKEN}/{path}")
        except Exception as e:
            print(f"avatar via bot failed for {tg_id}: {e}", flush=True)
    if photo_url:
        try:
            return _download_image(photo_url)
        except Exception as e:
            print(f"avatar via photo_url failed for {tg_id}: {e}", flush=True)
    return None


@app.get("/avatar/<key>.jpg")
def avatar_image(key):
    key = key[:32]
    now = time.time()
    hit = AVATAR_CACHE.get(key)
    if hit is None or now - hit[1] > (AVATAR_OK_TTL if hit[0] else AVATAR_FAIL_TTL):
        u = next((x for x in list(db["users"].values()) if x.get("key") == key), None)
        data = None
        if u and str(u["id"]).startswith("tg"):
            data = fetch_tg_avatar(str(u["id"])[2:], u.get("photo_url", ""))
        if len(AVATAR_CACHE) > 3000:
            AVATAR_CACHE.clear()
        hit = AVATAR_CACHE[key] = (data, now)
    if not hit[0]:
        resp = app.response_class("", status=404)
        resp.headers["Cache-Control"] = "public, max-age=300"
        return resp
    resp = app.response_class(hit[0][0], mimetype=hit[0][1])
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp


@route("/api/leaderboard")
def leaderboard(user, body):
    rows = ranking()
    since = min([h["ts"] for u in rows for h in u["history"]] or [int(time.time())])
    out = [
        {"rank": i + 1, "name": display_name(u), "avatar": avatar(u), "total_ton": ton(u["turnover"]), "me": u["id"] == user["id"]}
        for i, u in enumerate(rows[:50])
    ]
    place = next((i + 1 for i, u in enumerate(rows) if u["id"] == user["id"]), 0)
    return {
        "since": since,
        "ends": int(time.time()),
        "now": int(time.time()),
        "finished": False,
        "endless": True,
        "alltime": True,
        "rows": out,
        "me": {"excluded": False, "rank": place, "total_ton": ton(user["turnover"])},
        "prizes": [],
    }


@route("/api/levels")
def levels(user, body):
    rows = sorted(db["users"].values(), key=lambda u: u["turnover"], reverse=True)
    rows = [u for u in rows if u["games"] > 0]
    out = [
        {
            "rank": i + 1,
            "key": u["key"],
            "name": display_name(u),
            "avatar": avatar(u),
            "level": level_info(u["turnover"])["level"],
            "me": u["id"] == user["id"],
        }
        for i, u in enumerate(rows[:50])
    ]
    place = next((i + 1 for i, u in enumerate(rows) if u["id"] == user["id"]), 0)
    return {"rows": out, "me": {"excluded": False, "rank": place, "level": level_info(user["turnover"])["level"]}}


@route("/api/player")
def player(user, body):
    other = next((u for u in db["users"].values() if u["key"] == body.get("key")), None)
    if not other:
        raise ApiError("not_found", 404)
    return {
        "player": {
            "name": display_name(other),
            "avatar": avatar(other),
            "level": level_info(other["turnover"]),
            "stats": user_stats(other),
        }
    }


def require_admin(user):
    if not is_admin(user):
        raise ApiError("forbidden", 403)


def find_user(key):
    target = next((u for u in db["users"].values() if u["key"] == key), None)
    if not target:
        raise ApiError("not_found", 404)
    return target


def admin_user_row(u):
    return {
        "key": u["key"],
        "id": u["id"],
        "name": display_name({**u, "anon": False}),
        "username": u["username"],
        "balance_ton": ton(u["balance"]),
        "games": u["games"],
        "seen": u.get("seen", 0),
    }


def admin_user_detail(u):
    return {
        **admin_user_row(u),
        "wallet": u["wallet"],
        "turnover_ton": ton(u["turnover"]),
        "prizes": [
            {"id": p["id"], "name": p["name"], "status": p["status"], "value_ton": p["value"], "tier": p["tier"], "image": p.get("image", "")}
            for p in reversed(u["prizes"])
            if p["status"] != "sold"
        ],
    }


@route("/api/admin/users")
def admin_users(user, body):
    require_admin(user)
    q = str(body.get("q", "")).strip().lower().lstrip("@")
    rows = sorted(db["users"].values(), key=lambda u: u.get("seen", 0), reverse=True)
    if q:
        rows = [
            u for u in rows
            if q in u["id"].lower() or q in u["key"] or q in u["username"].lower() or q in u["first_name"].lower()
        ]
    return {"rows": [admin_user_row(u) for u in rows[:100]], "total": len(db["users"])}


@route("/api/admin/user")
def admin_user(user, body):
    require_admin(user)
    return {"user": admin_user_detail(find_user(body.get("key")))}


@route("/api/admin/balance")
def admin_balance(user, body):
    require_admin(user)
    target = find_user(body.get("key"))
    try:
        amount = float(body.get("amount"))
    except (TypeError, ValueError):
        raise ApiError("bad_request")
    if body.get("mode") == "set":
        if amount < 0:
            raise ApiError("bad_request")
        target["balance"] = ton(amount)
    elif body.get("mode") == "add":
        target["balance"] = ton(max(0.0, target["balance"] + amount))
    else:
        raise ApiError("bad_request")
    return {"user": admin_user_detail(target)}


@route("/api/admin/prize/add")
def admin_prize_add(user, body):
    require_admin(user)
    target = find_user(body.get("key"))
    if body.get("gift"):
        prize = resolve_target({"gift": body["gift"], "model": body.get("model", "")}, "gift")
    else:
        prize = resolve_target({}, body.get("tier", "random"))
    add_prize(target, prize["tier"], prize["name"], prize["value"], prize["image"])
    return {"user": admin_user_detail(target)}


@route("/api/admin/prize/remove")
def admin_prize_remove(user, body):
    require_admin(user)
    target = find_user(body.get("key"))
    prize = next((p for p in target["prizes"] if p["id"] == body.get("prize_id") and p["status"] != "sold"), None)
    if not prize:
        raise ApiError("not_found", 404)
    target["prizes"].remove(prize)
    return {"user": admin_user_detail(target)}


def normalize(text):
    return "".join(ch for ch in str(text).lower() if ch.isalnum())


def market_rows():
    return [
        {"slug": s, "name": g["name"], "price_ton": gift_floor(s),
         "default_ton": g["floor"], "custom": s in db["prices"],
         "models": len([m for m in g.get("models", []) if m.get("floor", 0) > 0]),
         "source": g.get("source", "")}
        for s, g in sorted(gifts_map().items(), key=lambda kv: kv[1]["name"].lower())
    ]


class PortalsError(Exception):
    pass


PORTALS_STATE = {"running": False, "error": "", "updated": 0, "gifts": 0, "models": 0, "source": ""}
MRKT_STATE = {"running": False, "error": "", "updated": 0, "checked": 0, "models": 0, "total": 0, "failed": 0}
MRKT_MODELS_PAYLOAD = {"key": "collectionName"}  # auto-detected successful MRKT request format
_filters_first = {"i": 0}


def portals_status():
    return {
        "active_market": db.get("settings", {}).get("active_market", "portals"),
        "portals_configured": bool(portals_auth()),
        "portals_key_set": bool(portals_auth()),
        "portals_key_mask": mask_key(portals_auth()),
        "portals_refreshing": PORTALS_STATE["running"],
        "portals_error": PORTALS_STATE["error"],
        "portals_updated": PORTALS_STATE["updated"],
        "portals_gifts": len(CATALOG),
        "portals_models": sum(len(g.get("models", [])) for g in CATALOG.values()),
        "catalog_source": PORTALS_STATE.get("source") or "Сохранённый каталог",
        "mrkt_key_mask": mask_key(db.get("settings", {}).get("mrkt_auth", "")),
        "mrkt_refreshing": MRKT_STATE["running"],
        "mrkt_error": MRKT_STATE["error"],
        "mrkt_checked": MRKT_STATE["checked"],
        "mrkt_models": MRKT_STATE["models"],
        "mrkt_total": MRKT_STATE["total"],
        "mrkt_failed": MRKT_STATE["failed"],
        "mrkt_updated": MRKT_STATE["updated"],
        "market_total": len(CATALOG),
        "market_models": sum(len(g.get("models", [])) for g in CATALOG.values()),
    }


def portals_headers(with_auth=True):
    auth = portals_auth() if with_auth else ""
    if auth and not auth.lower().startswith("tma "):
        auth = "tma " + auth
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
        "Origin": "https://portal-market.com",
        "Referer": "https://portal-market.com/",
    }
    if auth:
        headers["Authorization"] = auth
    return headers


_host_first = {"i": 0}


def portals_get(paths, public_ok=False, timeout=20):
    """Перебирает хосты и пути. Если ключ отклонён, коллекции можно взять публично (public_ok)."""
    errors = []
    auth_rejected = False
    order = PORTALS_HOSTS[_host_first["i"]:] + PORTALS_HOSTS[:_host_first["i"]]
    for attempt_auth in ((True, False) if public_ok else (True,)):
        if not attempt_auth and not auth_rejected and portals_auth():
            break
        headers = portals_headers(attempt_auth)
        if attempt_auth and "Authorization" not in headers and not public_ok:
            raise PortalsError("ключ не задан")
        for host in order:
            host_dead = False
            for path in paths:
                try:
                    req = urllib.request.Request(host + path, headers=headers)
                    with urllib.request.urlopen(req, timeout=timeout) as resp:
                        data = json.load(resp)
                    _host_first["i"] = PORTALS_HOSTS.index(host)
                    return data
                except urllib.error.HTTPError as e:
                    if e.code == 429:
                        raise PortalsError("лимит запросов Portals (HTTP 429)")
                    if e.code in (401, 403):
                        auth_rejected = True
                        errors.append(f"ключ отклонён (HTTP {e.code})")
                        break
                    errors.append(f"{host.split('//')[1]}{path.split('?')[0]} -> HTTP {e.code}")
                except urllib.error.URLError as e:
                    errors.append(f"{host.split('//')[1]} недоступен: {e.reason}")
                    host_dead = True
                    break
                except Exception as e:
                    errors.append(f"{host.split('//')[1]}{path.split('?')[0]} -> {type(e).__name__}")
            if host_dead:
                continue
    if auth_rejected:
        raise PortalsError("ключ отклонён - вставь свежий Authorization. " + "; ".join(errors[-2:]))
    raise PortalsError("; ".join(dict.fromkeys(errors)) if errors else "нет ответа")


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    return x if x > 0 else 0.0


def _clean(name):
    """'Classic (1.5%)' -> 'Classic'"""
    return re.sub(r"\s*\([^)]*\)\s*$", "", str(name)).strip()


def _floor_of(v):
    if isinstance(v, dict):
        for k in ("floor_price", "floorPrice", "floor", "price", "min_price", "min"):
            if k in v:
                return _num(v[k])
        return 0.0
    return _num(v)


def parse_collections(data):
    items = data
    if isinstance(data, dict):
        items = data.get("collections") or data.get("items") or data.get("data") or []
    out = []
    for c in items if isinstance(items, list) else []:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name") or c.get("short_name") or "").strip()
        if not name:
            continue
        out.append({
            "name": name,
            "short": str(c.get("short_name") or c.get("shortName") or normalize(name)),
            "id": str(c.get("id") or ""),
            "floor": _floor_of(c.get("floor_price", c.get("floor", 0))),
            "volume": _num(c.get("day_volume") or c.get("volume") or 0),
        })
    return out


def parse_attr_floors(node):
    """Модели/фоны -> {имя: флор}. Модели без листингов не теряются (флор 0 -> берётся флор коллекции)."""
    out = {}
    if isinstance(node, dict):
        for k, v in node.items():
            if str(k).lower() in ("count", "total", "floor_price"):
                continue
            if isinstance(v, (dict, int, float, str)) or v is None:
                name = _clean(k)
                if name:
                    out[name] = _floor_of(v)
    elif isinstance(node, list):
        for v in node:
            if isinstance(v, str):
                if _clean(v):
                    out[_clean(v)] = 0.0
            elif isinstance(v, dict):
                n = v.get("value") or v.get("name") or v.get("model") or v.get("title")
                if n:
                    out[_clean(n)] = _floor_of(v)
    return out


def _find_key(node, names, depth=0):
    if depth > 4:
        return None
    if isinstance(node, dict):
        for n in names:
            if isinstance(node.get(n), (dict, list)) and node[n]:
                return node[n]
        for v in node.values():
            r = _find_key(v, names, depth + 1)
            if r:
                return r
    return None


def parse_filters(data):
    models = parse_attr_floors(_find_key(data, ("models", "model")))
    backdrops = parse_attr_floors(_find_key(data, ("backdrops", "backdrop")))
    return models, backdrops


def parse_search_models(data, acc):
    """Листинги Portals -> минимальная цена по каждой модели. Возвращает число обработанных лотов."""
    items = data
    if isinstance(data, dict):
        items = data.get("results") or data.get("nfts") or data.get("items") or data.get("data") or []
    n = 0
    for r in items if isinstance(items, list) else []:
        if not isinstance(r, dict):
            continue
        n += 1
        model = r.get("model")
        if not model:
            for a in r.get("attributes") or []:
                if isinstance(a, dict) and str(a.get("type", "")).lower() == "model":
                    model = a.get("value")
                    break
        if not model:
            continue
        m = _clean(model)
        price = _num(r.get("price"))
        if m not in acc or (price and (not acc[m] or price < acc[m])):
            acc[m] = price
    return n


def apply_tier_values():
    """Шляпа волшебника = Witch Hat на Portals; оникс/блэк - её флор по фону."""
    hat = CATALOG.get("WitchHat")
    if not hat:
        return
    TIERS["random"]["value"] = gift_floor("WitchHat")
    backdrops = {normalize(k): v for k, v in hat.get("backdrops", {}).items()}
    for tier, keys in (("onyx", ("onyxblack", "onyx")), ("black", ("black",))):
        for k in keys:
            if k in backdrops and backdrops[k] > 0:
                TIERS[tier]["value"] = money(backdrops[k])
                break


def fetch_collection_filters(c, timeout=8):
    """Portals model floor route from RasswetGifts: short_names (plural)."""
    short = str(c.get("short") or "").strip().lower()
    if not short:
        return {}, {}
    raw = portals_get(["/collections/filters?short_names=" + quote(short)],
                      public_ok=True, timeout=timeout)
    if isinstance(raw, dict):
        groups = raw.get("collections")
        if isinstance(groups, dict):
            entry = next((v for k, v in groups.items() if normalize(k) == normalize(short)), None)
            if isinstance(entry, dict):
                raw = entry
        prices = raw.get("floor_prices") if isinstance(raw, dict) else None
        if isinstance(prices, dict):
            entry = next((v for k, v in prices.items() if normalize(k) == normalize(short)), None)
            if isinstance(entry, dict):
                raw = entry
    return parse_filters(raw)


def fetch_models_by_search(c, max_pages=15):
    """Запасной способ: собрать все модели из листингов коллекции (минимальная цена каждой)."""
    acc = {}
    last = None
    for key in [k for k in (c["name"], c["short"], c["id"]) if k]:
        for page in range(max_pages):
            path = (f"/nft/search?offset={page * 100}&limit=100&filter_by_collections={quote(key)}"
                    f"&sort_by=price+asc&status=listed")
            try:
                got = parse_search_models(portals_get([path], public_ok=True, timeout=15), acc)
            except PortalsError as e:
                last = e
                if "429" in str(e):
                    raise
                break
            if got < 100:
                break
        if acc:
            return acc
    if last:
        raise last
    return acc


def mrkt_model_image(key):
    """Build an image URL only for a recognized MRKT thumbnail path."""
    path = str(key or "").lstrip("/")
    if path.startswith("gifts/stickers/thumbnails/") and path.lower().endswith(".webp"):
        return "https://cdn.tgmrkt.io/" + quote(path, safe="/")
    return ""


def _mrkt_post_models(name, field, token, timeout):
    payload = json.dumps({field: name}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "https://api.tgmrkt.io/api/v1/gifts/models", data=payload, method="POST",
        headers={"Authorization": token, "Content-Type": "application/json",
                 "Accept": "application/json", "Origin": "https://cdn.tgmrkt.io",
                 "Referer": "https://cdn.tgmrkt.io/", "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def mrkt_search_models(c, timeout=12):
    """Fetch complete MRKT model catalog, not the first page of sale listings."""
    token = str(db.get("settings", {}).get("mrkt_auth") or "").strip()
    if not token:
        return {}
    name = str(c.get("name") or "").strip()
    if not name:
        return {}
    fields = list(dict.fromkeys([MRKT_MODELS_PAYLOAD["key"], "collectionName",
                                 "collection_id", "collection", "collectionId"]))
    error = None
    for field in fields:
        try:
            data = _mrkt_post_models(normalize(name) if field == "collectionName" else name, field, token, timeout)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403, 429):
                raise PortalsError(f"MRKT /gifts/models -> HTTP {exc.code} (доступ/лимит)")
            error = f"MRKT /gifts/models ({field}) -> HTTP {exc.code}"
            continue
        except (urllib.error.URLError, TimeoutError) as exc:
            raise PortalsError(f"MRKT /gifts/models недоступен: {exc}")
        except (ValueError, json.JSONDecodeError) as exc:
            error = f"MRKT вернул не JSON: {exc}"
            continue

        rows = data if isinstance(data, list) else (
            data.get("models") or data.get("items") or data.get("data") or []
            if isinstance(data, dict) else [])
        if isinstance(rows, dict):
            rows = rows.get("items") or rows.get("models") or []
        if not isinstance(rows, list):
            error = f"MRKT /gifts/models ({field}): неизвестный формат ответа"
            continue
        result = {}
        for item in rows:
            if not isinstance(item, dict):
                continue
            collection_name = str(item.get("collectionName") or item.get("collectionTitle") or "")
            if collection_name and normalize(collection_name) != normalize(name):
                continue
            model = _clean(item.get("modelName") or item.get("modelTitle") or "")
            raw = item.get("floorPriceNanoTons")
            if not model or raw is None:
                continue
            try:
                price = ton(Decimal(str(raw)) / Decimal(1_000_000_000))
            except (ValueError, ArithmeticError, TypeError):
                continue
            if price <= 0:
                continue
            old = result.get(model)
            if old and old["floor"] <= price:
                continue
            rarity = item.get("rarityPerMille")
            result[model] = {
                "floor": price, "source": "mrkt",
                "image": mrkt_model_image(item.get("modelStickerThumbnailKey")),
                "rarity_per_mille": rarity if isinstance(rarity, int) else None
            }
        if result:
            MRKT_MODELS_PAYLOAD["key"] = field
            return result
        error = f"MRKT /gifts/models ({field}) вернул 0 моделей для {name}"
    raise PortalsError(error or f"MRKT не вернул модели коллекции {name}")

def fetch_collection_models(c, search=False, timeout=10):
    source = db.get("settings", {}).get("active_market", "portals")
    if source == "mrkt":
        return mrkt_search_models(c, timeout=min(timeout, 10)), {}
    if source == "portals":
        floors, backs = fetch_collection_filters(c, timeout=min(timeout, 10))
        return {k: {"floor": v, "source": "portals"} for k, v in floors.items() if v > 0}, backs
    return {}, {}

def build_models(models):
    """Keep price, rarity and thumbnail metadata across refreshes."""
    result = []
    for name, item in models.items():
        metadata = item if isinstance(item, dict) else {"floor": item}
        try:
            floor = ton(metadata.get("floor", 0))
        except (ValueError, TypeError, OverflowError):
            floor = 0.0
        result.append({"model": name, "floor": floor,
                       "image": metadata.get("image", ""),
                       "rarity_per_mille": metadata.get("rarity_per_mille"),
                       "source": metadata.get("source", "")})
    return sorted(result, key=lambda x: (x["floor"] <= 0, x["floor"], x["model"].lower()))

MODEL_FAIL = {}
MODEL_LOCKS = {}
MODEL_LOADING = set()


def start_models_fetch(slug):
    if slug not in CATALOG or CATALOG[slug].get("models") or slug in MODEL_LOADING:
        return
    if time.time() - MODEL_FAIL.get(slug, 0) < 45:
        return
    MODEL_LOADING.add(slug)
    def run():
        try:
            ensure_models(slug)
        finally:
            MODEL_LOADING.discard(slug)
    threading.Thread(target=run, daemon=True).start()


def ensure_models(slug):
    """Подгружает модели коллекции прямо сейчас, если их ещё нет. Сеть - вне глобального lock."""
    with lock:
        entry = CATALOG.get(slug)
        if not entry or entry.get("models"):
            return
        if time.time() - MODEL_FAIL.get(slug, 0) < 30:
            return
        c = {"name": entry["name"], "short": entry.get("short") or normalize(entry["name"]), "id": entry.get("id", "")}
        slot = MODEL_LOCKS.setdefault(slug, threading.Lock())
    with slot:
        with lock:
            cur = CATALOG.get(slug)
            if not cur or cur.get("models"):
                return
        try:
            models, backdrops = fetch_collection_models(c, search=False, timeout=8)
        except PortalsError as e:
            PORTALS_STATE["error"] = f"{c['name']}: {e}"
            MODEL_FAIL[slug] = time.time()
            return
        if not models:
            MODEL_FAIL[slug] = time.time()
            return
        with lock:
            cur = CATALOG.get(slug)
            if cur is not None:
                cur["models"] = build_models(models)
                if backdrops:
                    cur["backdrops"] = {b: money(f) for b, f in backdrops.items()}
                if slug == "WitchHat":
                    apply_tier_values()
                save_catalog()
            for k in [k for k in IMG_CACHE if k and k[0] == slug]:
                IMG_CACHE.pop(k, None)


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


def _merge_source_catalog(source):
    """Merge RasswetGifts records and retain existing MRKT/Portals models."""
    with lock:
        for name, fresh in source.items():
            slug = re.sub(r"[^A-Za-z0-9]", "", name) or normalize(name)
            old = CATALOG.get(slug, {})
            merged = dict(old or fresh)
            merged["name"] = name
            merged["short"] = fresh.get("short") or old.get("short") or normalize(name)
            if fresh.get("image"):
                merged["image"] = fresh["image"]
            if fresh.get("floor", 0) > 0 and (not old.get("floor") or old.get("floor") == 1):
                merged["floor"] = fresh["floor"]
            merged.setdefault("floor", 1.0)
            merged.setdefault("pop", 0)
            merged.setdefault("backdrops", {})
            models = {m["model"]: dict(m) for m in fresh.get("models", [])}
            for m in old.get("models", []):
                prior = models.get(m["model"])
                if not prior or m.get("source") == "mrkt" or (
                        m.get("floor", 0) > 0 and not prior.get("floor")):
                    models[m["model"]] = dict(m)
                elif not prior.get("image") and m.get("image"):
                    prior["image"] = m["image"]
            merged["models"] = build_models(models)
            CATALOG[slug] = merged
        apply_tier_values()
        save_catalog()
    IMG_CACHE.clear()


def _canonical_catalog_key(name):
    cleaned = normalize(name)
    canonical = next((slug for slug, (n, *rest) in GIFTS.items()
                      if normalize(n) == cleaned), None)
    return canonical or re.sub(r"[^A-Za-z0-9]", "", name)


def _publish_source_catalog(items, source, generation):
    """Replace, never merge: no duplicate collections or cross-market prices."""
    if db["settings"].get("active_market") != source or db["settings"].get("market_generation", 0) != generation:
        return False
    clean = {}
    for item in items:
        name = str(item.get("name") or "").strip()
        base_floor = ton(item.get("floor") or 0)
        if not name or base_floor <= 0:
            continue
        slug = _canonical_catalog_key(name)
        if not slug:
            continue
        models = [m for m in item.get("models", []) if (m.get("floor") or 0) > 0]
        row = {"name": name, "short": item.get("short") or normalize(name),
               "id": item.get("id") or "", "floor": base_floor,
               "pop": item.get("pop") or 0, "source": source,
               "image": item.get("image") or "",
               "models": models, "backdrops": item.get("backdrops") or {}}
        # Normalize duplicate spelling/slug variants to one stable collection.
        old = clean.get(slug)
        if not old or len(row["models"]) > len(old["models"]):
            clean[slug] = row
    if not clean:
        return False
    with lock:
        if db["settings"].get("active_market") != source or db["settings"].get("market_generation", 0) != generation:
            return False
        CATALOG.clear()
        CATALOG.update(clean)
        db["prices"].clear()
        apply_tier_values()
        save_catalog()
        save_db()
    IMG_CACHE.clear()
    return True


def portals_refresh_worker():
    if PORTALS_STATE["running"] or db["settings"].get("active_market") != "portals":
        return
    PORTALS_STATE.update(running=True, error="", source="Portals")
    generation = db["settings"].get("market_generation", 0)
    try:
        # Unlike the old implementation, this reads Portals itself, not a
        # Fragment/GetGems snapshot with stale/inferred prices.
        response = portals_get(["/collections?limit=5000", "/collections?limit=500"],
                               public_ok=False, timeout=12)
        collections = parse_collections(response)
        if not collections:
            raise PortalsError("Portals вернул 0 коллекций — данные не заменены")
        from concurrent.futures import ThreadPoolExecutor, as_completed
        rows = [{"name": c["name"], "short": c["short"], "id": c["id"],
                 "floor": c["floor"], "pop": c["volume"], "models": [],
                 "image": f"https://portal-market.com/collection_previews/{c['short']}.webp"}
                for c in collections if c["floor"] > 0]
        # Publish the priced collections immediately, so the picker does not
        # wait for every per-model request to complete.
        _publish_source_catalog(rows, "portals", generation)
        by_short = {normalize(row["name"]): row for row in rows}
        errors = []
        def task(c):
            return c, fetch_collection_filters(c, timeout=9)
        if rows:
            with ThreadPoolExecutor(max_workers=8) as executor:
                futures = [executor.submit(task, c) for c in collections if c["floor"] > 0]
                for future in as_completed(futures):
                    try:
                        c, (models, backs) = future.result()
                        target = by_short.get(normalize(c["name"]))
                        if target:
                            target["models"] = build_models({
                                n: {"floor": price, "source": "portals"}
                                for n, price in models.items() if price > 0})
                            target["backdrops"] = backs
                    except Exception as exc:
                        if len(errors) < 3:
                            errors.append(str(exc))
        with_prices = sum(len(r["models"]) for r in rows)
        if with_prices == 0:
            raise PortalsError("Portals: 0 моделей с ценами; " +
                               (errors[0] if errors else "API фильтров пуст"))
        if not _publish_source_catalog(rows, "portals", generation):
            raise PortalsError("Не удалось сохранить новый каталог Portals")
        PORTALS_STATE.update(updated=int(time.time()), gifts=len(CATALOG),
                             models=with_prices, source="Portals",
                             error=("Часть коллекций без моделей: " + errors[0]) if errors else "")
    except Exception as exc:
        PORTALS_STATE["error"] = str(exc)
    finally:
        PORTALS_STATE["running"] = False

def start_portals_refresh():
    if db["settings"].get("active_market") == "portals" and not PORTALS_STATE["running"]:
        PORTALS_STATE["running"] = True
        def run():
            PORTALS_STATE["running"] = False
            portals_refresh_worker()
        threading.Thread(target=run, daemon=True).start()


def portals_loop():
    time.sleep(5)
    while True:
        try:
            portals_refresh_worker()
        except Exception as e:
            print(f"portals loop: {e}", flush=True)
        time.sleep(1800)


@route("/api/admin/market")
def admin_market(user, body):
    require_admin(user)
    return {"rows": market_rows(), **portals_status()}


@route("/api/admin/portals/set")
def admin_portals_set(user, body):
    require_admin(user)
    cfg = db["settings"]
    if body.get("clear_key"):
        cfg["portals_auth"] = ""
    elif str(body.get("auth") or "").strip():
        cfg["portals_auth"] = str(body["auth"]).strip()[:4000]
        start_portals_refresh()
    return {"rows": market_rows(), **portals_status()}


@route("/api/admin/mrkt/set")
def admin_mrkt_set(user, body):
    require_admin(user)
    if body.get("clear_key"):
        db["settings"]["mrkt_auth"] = ""
    elif str(body.get("auth") or "").strip():
        db["settings"]["mrkt_auth"] = str(body["auth"]).strip()[:4000]
        start_mrkt_refresh()
    return {"ok": True, "mrkt_key_mask": mask_key(db["settings"].get("mrkt_auth", ""))}



def mrkt_refresh_worker():
    if MRKT_STATE["running"] or db["settings"].get("active_market") != "mrkt":
        return
    MRKT_STATE.update(running=True, error="", checked=0, models=0, total=0, failed=0)
    generation = db["settings"].get("market_generation", 0)
    try:
        if not db["settings"].get("mrkt_auth"):
            raise PortalsError("Токен MRKT не задан")
        # RasswetGifts supplies collection NAMES only; its prices and artwork
        # never enter the MRKT catalog.
        snapshot = fetch_rasswet_snapshot()
        names = [{"name": name, "short": item.get("short", "")}
                 for name, item in snapshot.items()]
        MRKT_STATE["total"] = len(names)
        from concurrent.futures import ThreadPoolExecutor, as_completed
        rows, errors = [], []
        def task(c):
            return c, mrkt_search_models(c, timeout=10)
        with ThreadPoolExecutor(max_workers=4) as executor:
            for future in as_completed([executor.submit(task, n) for n in names]):
                try:
                    c, found = future.result()
                    if found:
                        entries = build_models(found)
                        floor = min(m["floor"] for m in entries if m["floor"] > 0)
                        rows.append({"name": c["name"], "short": c["short"],
                                     "floor": floor, "models": entries,
                                     "image": next((m.get("image") for m in entries if m.get("image")), "")})
                        MRKT_STATE["models"] += len(entries)
                except Exception as exc:
                    MRKT_STATE["failed"] += 1
                    if len(errors) < 2:
                        errors.append(str(exc))
                finally:
                    MRKT_STATE["checked"] += 1
        if MRKT_STATE["models"] == 0:
            raise PortalsError("MRKT: 0 моделей с ценами; " + (errors[0] if errors else "пустой ответ"))
        if not _publish_source_catalog(rows, "mrkt", generation):
            raise PortalsError("Не удалось сохранить новый каталог MRKT")
        MRKT_STATE["updated"] = int(time.time())
        if errors:
            MRKT_STATE["error"] = f"Недоступно коллекций: {MRKT_STATE['failed']} · {errors[0]}"
    except Exception as exc:
        MRKT_STATE["error"] = str(exc)
    finally:
        MRKT_STATE["running"] = False

def start_mrkt_refresh():
    if db["settings"].get("active_market") == "mrkt" and not MRKT_STATE["running"]:
        MRKT_STATE["running"] = True
        def run():
            MRKT_STATE["running"] = False
            mrkt_refresh_worker()
        threading.Thread(target=run, daemon=True).start()


@route("/api/admin/mrkt/refresh")
def admin_mrkt_refresh(user, body):
    require_admin(user)
    if not db["settings"].get("mrkt_auth"):
        raise ApiError("mrkt_token_missing")
    if db["settings"].get("active_market") != "mrkt":
        raise ApiError("market_not_selected")
    start_mrkt_refresh()
    return {"rows": market_rows(), **portals_status()}


@route("/api/admin/market/source")
def admin_market_source(user, body):
    require_admin(user)
    source = str(body.get("source") or "").lower()
    if source not in ("portals", "mrkt"):
        raise ApiError("invalid_market")
    if source == "mrkt" and not db["settings"].get("mrkt_auth"):
        raise ApiError("mrkt_token_missing")
    cfg = db["settings"]
    if cfg.get("active_market") != source or body.get("clear_cache"):
        cfg["active_market"] = source
        cfg["market_generation"] = int(cfg.get("market_generation", 0)) + 1
        CATALOG.clear()
        db["prices"].clear()
        save_catalog()
        IMG_CACHE.clear()
    if source == "portals":
        start_portals_refresh()
    else:
        start_mrkt_refresh()
    return {"rows": market_rows(), **portals_status()}


@route("/api/admin/market/set")
def admin_market_set(user, body):
    require_admin(user)
    slug = body.get("slug")
    if slug not in gifts_map():
        raise ApiError("not_found", 404)
    try:
        price = float(body.get("price"))
    except (TypeError, ValueError):
        raise ApiError("bad_request")
    if not 0 < price < 1_000_000:
        raise ApiError("bad_request")
    db["prices"][slug] = money(price)
    apply_tier_values()
    return {"rows": market_rows(), **portals_status()}


@route("/api/admin/market/refresh")
def admin_market_refresh(user, body):
    require_admin(user)
    if db["settings"].get("active_market") != "portals":
        raise ApiError("market_not_selected")
    start_portals_refresh()
    return {"rows": market_rows(), "refreshing": True, **portals_status()}


def gift_svg(slug, model=""):
    digest = hashlib.sha1(f"{slug}:{model}".encode()).digest()
    hue = digest[0] * 360 // 256
    hue2 = (hue + 40) % 360
    initials = "".join(ch for ch in slug if ch.isupper())[:2] or slug[:2].upper()
    tag = (model[:8] if model else "").replace("&", "").replace("<", "").replace(">", "")
    label = (
        f'<text x="64" y="104" font-family="sans-serif" font-size="13" font-weight="700" '
        f'text-anchor="middle" fill="rgba(255,255,255,.9)">{tag}</text>'
        if tag else ""
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="hsl({hue},70%,62%)"/><stop offset="1" stop-color="hsl({hue2},65%,38%)"/>'
        "</linearGradient></defs>"
        '<rect x="14" y="14" width="100" height="100" rx="22" fill="url(#g)"/>'
        '<rect x="14" y="14" width="100" height="100" rx="22" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3"/>'
        '<text x="64" y="72" font-family="sans-serif" font-size="40" font-weight="700" '
        f'text-anchor="middle" fill="#fff">{initials}</text>{label}</svg>'
    )


IMG_CACHE = {}
IMG_FAIL_TTL = 600


def _download_image(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "image/png,image/webp,image/*;q=0.8"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = resp.read(3_000_000)
        ctype = resp.headers.get("Content-Type", "image/png").split(";")[0].strip()
    if not data or not (ctype.startswith("image/") or data[:4] == b"\x89PNG" or data[:4] == b"RIFF"):
        raise ValueError("not an image")
    if not ctype.startswith("image/"):
        ctype = "image/png" if data[:4] == b"\x89PNG" else "image/webp"
    return data, ctype


def _first_image(urls):
    seen = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        try:
            return _download_image(url)
        except Exception:
            continue
    return None


def fetch_gift_image(name, model, slug=""):
    """PNG модели подарка. Возвращает (bytes, mimetype) или None."""
    q_name, q_model = quote(name), quote(model)
    ctx = {"name": q_name, "model": q_model, "name_nospace": quote(name.replace(" ", ""))}
    urls = []
    slug_entry = gifts_map().get(slug, {})
    for m in slug_entry.get("models", []):
        if m.get("model") == model:
            img = str(m.get("image", ""))
            if img.startswith(("https://cdn.tgmrkt.io/gifts/stickers/thumbnails/", "https://fragment.com/file/")):
                urls.append(img)
            break
    for tpl in [GIFT_IMG_TEMPLATE] + GIFT_IMG_FALLBACKS:
        try:
            urls.append(tpl.format(**ctx))
        except (KeyError, IndexError):
            continue
    return _first_image(urls)


def fetch_collection_image(name, slug):
    ctx = {"name": quote(name), "slug_lower": slug.lower(), "name_nospace": quote(name.replace(" ", ""))}
    urls = []
    pinned = str(gifts_map().get(slug, {}).get("image") or "")
    if pinned.startswith(("https://fragment.com/file/", "https://cdn.changes.tg/")):
        urls.append(pinned)
    for tpl in GIFT_THUMB_TEMPLATES:
        try:
            urls.append(tpl.format(**ctx))
        except (KeyError, IndexError):
            continue
    return _first_image(urls)


def _cached_image(key, loader):
    now = time.time()
    hit = IMG_CACHE.get(key)
    if hit is not None and (hit[0] is not None or now - hit[1] < IMG_FAIL_TTL):
        return hit[0]
    if len(IMG_CACHE) > 2500:
        IMG_CACHE.clear()
    try:
        data = loader()
    except Exception:
        data = None
    IMG_CACHE[key] = (data, now)
    return data


@app.get("/gimg/<slug>.webp")
def gimg(slug):
    """Legacy image URL: redirect immediately instead of proxying slow CDN downloads."""
    from flask import redirect
    if slug not in gifts_map():
        return ("", 404)
    url = gift_image(slug, request.args.get("m", "")[:128])
    response = redirect(url, code=302)
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


TON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><circle cx="28" cy="28" r="28" fill="#0098EA"/>'
    '<path d="M37.56 15.63H18.44c-3.52 0-5.75 3.79-3.98 6.86l11.8 20.45c.77 1.34 2.7 1.34 3.47 0l11.8-20.45'
    'c1.77-3.06-.46-6.86-3.97-6.86zM26.25 36.81l-2.57-4.98-6.2-11.09c-.41-.71.1-1.62.95-1.62h7.82v17.69zm12.26-16.07'
    'l-6.2 11.1-2.57 4.97V19.12h7.82c.86 0 1.36.91.95 1.62z" fill="#fff"/></svg>'
)
HAT_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">'
    '<rect x="6" y="44" width="52" height="8" fill="#2a1450"/><rect x="8" y="42" width="48" height="6" fill="#5b2bb0"/>'
    '<rect x="20" y="20" width="24" height="24" fill="#4a1fa0"/><rect x="26" y="10" width="14" height="12" fill="#4a1fa0"/>'
    '<rect x="32" y="4" width="8" height="8" fill="#5b2bb0"/><rect x="20" y="36" width="24" height="6" fill="#ffc043"/>'
    '<rect x="29" y="36" width="6" height="6" fill="#fff0b0"/></svg>'
)
CAT_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">'
    '<rect x="14" y="14" width="8" height="12" fill="#2b2b3a"/><rect x="42" y="14" width="8" height="12" fill="#2b2b3a"/>'
    '<rect x="14" y="22" width="36" height="28" fill="#3a3a4e"/><rect x="22" y="30" width="6" height="6" fill="#ffe08a"/>'
    '<rect x="36" y="30" width="6" height="6" fill="#ffe08a"/><rect x="30" y="40" width="4" height="4" fill="#ff8aa8"/></svg>'
)
AXE_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">'
    '<rect x="30" y="14" width="6" height="44" fill="#7a4a26"/><rect x="30" y="14" width="2" height="44" fill="#a8713c"/>'
    '<rect x="14" y="10" width="18" height="22" fill="#9aa3b5"/><rect x="10" y="14" width="6" height="14" fill="#cfd6e4"/>'
    '<rect x="14" y="10" width="18" height="3" fill="#e8edf7"/></svg>'
)
STAFF_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">'
    '<rect x="30" y="22" width="5" height="40" fill="#7a4a26"/><rect x="30" y="22" width="2" height="40" fill="#a8713c"/>'
    '<rect x="22" y="6" width="20" height="18" fill="#8b4cf0"/><rect x="26" y="10" width="8" height="8" fill="#e0c8ff"/>'
    '<rect x="20" y="10" width="2" height="10" fill="#b98bff"/><rect x="42" y="10" width="2" height="10" fill="#b98bff"/></svg>'
)
PLANK_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32" preserveAspectRatio="none" shape-rendering="crispEdges">'
    '<rect width="64" height="32" fill="#8a5429"/><rect width="64" height="4" fill="#b9814a"/>'
    '<rect y="28" width="64" height="4" fill="#4a2a10"/><rect x="0" y="14" width="64" height="2" fill="#7a4a26"/></svg>'
)
SKY_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="none">'
    '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f8fe8"/>'
    '<stop offset="1" stop-color="#d3effd"/></linearGradient></defs><rect width="10" height="10" fill="url(#s)"/></svg>'
)
FALLBACK_ART = {
    "ton": TON_SVG, "gram": TON_SVG, "hatcoin": TON_SVG, "hat": HAT_SVG, "cat": CAT_SVG,
    "axe-icon": AXE_SVG, "staff-icon": STAFF_SVG,
    "plank-left": PLANK_SVG, "plank-mid": PLANK_SVG, "plank-right": PLANK_SVG,
    "sky": SKY_SVG, "sky-onyx": SKY_SVG, "sky-black": SKY_SVG,
}


# TON Connect settings are persisted in the existing DB, not in a new file.
# No private keys or seed phrases are stored here.
def _tonconnect_site_origin():
    return (_env_first("PUBLIC_APP_URL", "APP_URL", "SITE_URL") or request.host_url).rstrip("/")


def tonconnect_config():
    origin = _tonconnect_site_origin()
    defaults = {
        "recipient_address": _env_first("DEPOSIT_ADDRESS"),
        "app_url": origin,
        "app_name": _env_first("TONCONNECT_APP_NAME") or "Magic Upgrade",
        "icon_url": _env_first("TONCONNECT_ICON_URL") or origin + "/images/hat.png",
        "terms_url": _env_first("TONCONNECT_TERMS_URL"),
        "privacy_url": _env_first("TONCONNECT_PRIVACY_URL"),
    }
    saved = db.get("settings", {}).get("tonconnect", {})
    if isinstance(saved, dict):
        for key in defaults:
            value = saved.get(key)
            if isinstance(value, str) and value.strip():
                defaults[key] = value.strip()
    return defaults


def _valid_ton_address(address):
    address = str(address or "").strip()
    if not address:
        return True
    # Friendly base64url mainnet/testnet wallet or raw workchain:64 hex.
    return bool(re.fullmatch(r"(?:[A-Za-z0-9_-]{48}|-?1:[0-9a-fA-F]{64}|0:[0-9a-fA-F]{64})", address))


def _valid_tonconnect_url(value, optional=False, icon=False):
    value = str(value or "").strip()
    if not value:
        return optional
    if len(value) > 512 or any(c.isspace() for c in value):
        return False
    try:
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            return False
        if icon and not parts.path.lower().endswith((".png", ".ico")):
            return False
        return True
    except ValueError:
        return False


@route("/api/admin/tonconnect")
def admin_tonconnect(user, body):
    require_admin(user)
    cfg = tonconnect_config()
    return {
        "config": cfg,
        "using_saved": isinstance(db["settings"].get("tonconnect"), dict),
        "manifest_url": request.host_url.rstrip("/") + "/tonconnect-manifest.json",
        "deposit_ready": bool(cfg["recipient_address"]),
    }


@route("/api/admin/tonconnect/save")
def admin_tonconnect_save(user, body):
    require_admin(user)
    if body.get("reset"):
        db["settings"].pop("tonconnect", None)
    else:
        current = tonconnect_config()
        fields = ("recipient_address", "app_url", "app_name", "icon_url",
                  "terms_url", "privacy_url")
        values = {k: str(body.get(k, current[k]) or "").strip() for k in fields}
        if not _valid_ton_address(values["recipient_address"]):
            raise ApiError("invalid_ton_address")
        if not (1 <= len(values["app_name"]) <= 64):
            raise ApiError("invalid_app_name")
        if not _valid_tonconnect_url(values["app_url"]):
            raise ApiError("invalid_app_url")
        if not _valid_tonconnect_url(values["icon_url"], icon=True):
            raise ApiError("invalid_icon_url")
        if not _valid_tonconnect_url(values["terms_url"], optional=True):
            raise ApiError("invalid_terms_url")
        if not _valid_tonconnect_url(values["privacy_url"], optional=True):
            raise ApiError("invalid_privacy_url")
        db["settings"]["tonconnect"] = values
    cfg = tonconnect_config()
    return {
        "ok": True, "config": cfg,
        "using_saved": isinstance(db["settings"].get("tonconnect"), dict),
        "manifest_url": request.host_url.rstrip("/") + "/tonconnect-manifest.json",
        "deposit_ready": bool(cfg["recipient_address"]),
    }


@app.get("/tonconnect-manifest.json")
def tonconnect_manifest():
    cfg = tonconnect_config()
    result = {"url": cfg["app_url"], "name": cfg["app_name"], "iconUrl": cfg["icon_url"]}
    if cfg["terms_url"]:
        result["termsOfUseUrl"] = cfg["terms_url"]
    if cfg["privacy_url"]:
        result["privacyPolicyUrl"] = cfg["privacy_url"]
    response = jsonify(result)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
    return response


@app.get("/images/<path:name>")
def images(name):
    folder = os.path.join(BASE_DIR, "images")
    if os.path.isfile(os.path.join(folder, name)):
        return send_from_directory(folder, name)
    art = FALLBACK_ART.get(os.path.splitext(os.path.basename(name))[0])
    if art:
        resp = app.response_class(art, mimetype="image/svg+xml")
        resp.headers["Cache-Control"] = "no-cache"
        return resp
    return ("", 404)


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


load_db()
load_catalog()
apply_tier_values()
threading.Thread(target=portals_loop, daemon=True).start()

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8000")), threaded=True)