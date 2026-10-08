import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import urllib.request
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import parse_qsl

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "data.json"))
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
ADMIN_IDS = {x.strip() for x in os.environ.get("ADMIN_IDS", "").split(",") if x.strip()}
PORTALS_FLOORS_URL = os.environ.get("PORTALS_FLOORS_URL", "")
PORTALS_AUTH = os.environ.get("PORTALS_AUTH", "")

START_BALANCE = 10.0
PROMO_CODES = {"DEMO": 10.0}
MARGIN = 0.05
SELL_SHARE = 0.9
MIN_DEPOSIT = 0.5
SHELL_CUPS = 3
SHELL_HAT_VALUE = 3.0
SHELL_PRICE_SHARE = round(1 / SHELL_CUPS / (1 - MARGIN), 4)
ROUND_TTL = 180
HISTORY_LIMIT = 50
CHANCES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]

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

app = Flask(__name__, static_folder=None)
lock = threading.RLock()
db = {"users": {}, "prices": {}}


def load_db():
    global db
    if os.path.exists(DB_PATH):
        with open(DB_PATH, encoding="utf-8") as f:
            db = json.load(f)
    db.setdefault("prices", {})


def save_db():
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False)
    os.replace(tmp, DB_PATH)


class ApiError(Exception):
    def __init__(self, code, status=400, **extra):
        self.code = code
        self.status = status
        self.extra = extra


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify({"error": e.code, **e.extra}), e.status


def money(x):
    return float(Decimal(repr(float(x))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def ton(x):
    return round(float(x), 6)


def gift_floor(slug):
    return db["prices"].get(slug, GIFTS[slug][1])


def gift_models(slug):
    name, _, _, models = GIFTS[slug]
    floor = gift_floor(slug)
    return [
        {"model": m, "price_ton": money(floor * (1 + MODEL_STEP * i)), "image": gift_image(slug)}
        for i, m in enumerate(models)
    ]


def gift_image(slug):
    return f"/gimg/{slug}.webp?v=2"


def gift_price(slug, model):
    if slug not in GIFTS:
        raise ApiError("gift_unavailable")
    if not model:
        return gift_floor(slug)
    for m in gift_models(slug):
        if m["model"] == model:
            return m["price_ton"]
    raise ApiError("gift_unavailable")


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
    user["seen"] = int(time.time())
    if tg:
        user["username"] = tg.get("username", user["username"])
        user["first_name"] = tg.get("first_name", user["first_name"])
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
    out = {"id": p["id"], "status": p["status"], "tier": p["tier"], "name": p["name"], "image": p.get("image", "")}
    if p["status"] in ("owned", "withdraw_pending"):
        out["sell_ton"] = money(p["value"] * SELL_SHARE)
    return out


def visible_prizes(user):
    return [prize_view(p) for p in reversed(user["prizes"]) if p["status"] != "sold"]


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
        "shell": {
            "enabled": True,
            "tab_name": "Три шляпы",
            "prize_name": TIERS["random"]["name"],
            "cups": SHELL_CUPS,
            "gifts": True,
            "cost_ton": shell_cost_for(SHELL_HAT_VALUE),
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
        },
        "deposit": {"address": os.environ.get("DEPOSIT_ADDRESS", ""), "memo": f"u{user['key']}"},
        "prizes": visible_prizes(user),
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
    if user["bear_given"]:
        return None
    user["bear_given"] = True
    add_prize(user, "bear", "Утешительный мишка", 0.1, "images/bear.svg")
    return {"first": True}


def resolve_target(body, tier):
    if tier == "gift":
        slug = body.get("gift", "")
        model = body.get("model", "")
        price = gift_price(slug, model)
        name = GIFTS[slug][0] + (f" · {model}" if model else "")
        return {"tier": f"gift:{slug}:{model}", "name": name, "value": price, "image": gift_image(slug)}
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
    if not any(abs(chance - c) < 1e-9 for c in CHANCES):
        raise ApiError("bad_request")
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
        target["value"] = SHELL_HAT_VALUE
        cost = shell_cost_for(SHELL_HAT_VALUE)
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


@route("/api/sell")
def sell(user, body):
    prize = next((p for p in user["prizes"] if p["id"] == body.get("prize_id")), None)
    if not prize or prize["status"] not in ("owned", "withdraw_pending"):
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
    return {"prizes": visible_prizes(user), "balance_ton": ton(user["balance"]), "auto_gift": False}


@route("/api/promo")
def promo(user, body):
    code = str(body.get("code", "")).strip().upper()
    amount = PROMO_CODES.get(code)
    if amount is None:
        raise ApiError("not_found")
    user["balance"] = ton(user["balance"] + amount)
    return {"balance_ton": ton(user["balance"]), "amount_ton": amount}


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
        {"slug": s, "name": n, "price_ton": gift_floor(s), "image": gift_image(s), "popular": pop}
        for s, (n, _, pop, _) in GIFTS.items()
    ]
    return {"items": items, "margin": MARGIN, "price_steps": [], "price_base": 1}


@route("/api/gifts/models")
def gifts_models(user, body):
    slug = body.get("slug", "")
    if slug not in GIFTS:
        raise ApiError("gift_unavailable")
    name = GIFTS[slug][0]
    return {"slug": slug, "name": name, "floor": gift_floor(slug), "image": gift_image(slug), "models": gift_models(slug)}


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


def avatar(user):
    return ""


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


def market_rows():
    return [
        {"slug": s, "name": n, "price_ton": gift_floor(s), "default_ton": p, "custom": s in db["prices"]}
        for s, (n, p, _, _) in GIFTS.items()
    ]


@route("/api/admin/market")
def admin_market(user, body):
    require_admin(user)
    return {"rows": market_rows(), "portals_configured": bool(PORTALS_FLOORS_URL)}


@route("/api/admin/market/set")
def admin_market_set(user, body):
    require_admin(user)
    slug = body.get("slug")
    if slug not in GIFTS:
        raise ApiError("not_found", 404)
    try:
        price = float(body.get("price"))
    except (TypeError, ValueError):
        raise ApiError("bad_request")
    if not 0 < price < 1_000_000:
        raise ApiError("bad_request")
    db["prices"][slug] = money(price)
    return {"rows": market_rows()}


def normalize(text):
    return "".join(ch for ch in str(text).lower() if ch.isalnum())


@route("/api/admin/market/refresh")
def admin_market_refresh(user, body):
    require_admin(user)
    if not PORTALS_FLOORS_URL:
        raise ApiError("portals_not_configured")
    headers = {"Accept": "application/json", "User-Agent": "magic-upgrade"}
    if PORTALS_AUTH:
        headers["Authorization"] = PORTALS_AUTH
    try:
        req = urllib.request.Request(PORTALS_FLOORS_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except Exception:
        raise ApiError("portals_unavailable", 502)
    floors = data.get("floors", data) if isinstance(data, dict) else {}
    known = {}
    for slug, (name, _, _, _) in GIFTS.items():
        known[normalize(slug)] = slug
        known[normalize(name)] = slug
    updated = 0
    for key, value in floors.items():
        slug = known.get(normalize(key))
        try:
            price = float(value)
        except (TypeError, ValueError):
            continue
        if slug and 0 < price < 1_000_000:
            db["prices"][slug] = money(price)
            updated += 1
    return {"rows": market_rows(), "updated": updated}


def gift_svg(slug):
    digest = hashlib.sha1(slug.encode()).digest()
    hue = digest[0] * 360 // 256
    hue2 = (hue + 40) % 360
    initials = "".join(ch for ch in slug if ch.isupper())[:2] or slug[:2].upper()
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="hsl({hue},70%,62%)"/><stop offset="1" stop-color="hsl({hue2},65%,38%)"/>'
        "</linearGradient></defs>"
        '<rect x="14" y="14" width="100" height="100" rx="22" fill="url(#g)"/>'
        '<rect x="14" y="14" width="100" height="100" rx="22" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3"/>'
        '<text x="64" y="78" font-family="sans-serif" font-size="40" font-weight="700" '
        f'text-anchor="middle" fill="#fff">{initials}</text></svg>'
    )


@app.get("/gimg/<slug>.webp")
def gimg(slug):
    if slug not in GIFTS:
        return ("", 404)
    resp = app.response_class(gift_svg(slug), mimetype="image/svg+xml")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@app.get("/tonconnect-manifest.json")
def tonconnect_manifest():
    origin = request.host_url.rstrip("/")
    return jsonify({"url": origin, "name": "Magic Upgrade", "iconUrl": f"{origin}/images/hat.png"})


@app.get("/images/<path:name>")
def images(name):
    return send_from_directory(os.path.join(BASE_DIR, "images"), name)


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


load_db()

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8000")), threaded=True)
