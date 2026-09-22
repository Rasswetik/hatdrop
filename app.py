import os
import hmac
import hashlib
import json
import sqlite3
from urllib.parse import parse_qsl
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)
DB_PATH = os.environ.get("DB_PATH", os.path.join(app.root_path, "data.sqlite3"))
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
BOT_USERNAME = os.environ.get("BOT_USERNAME", "your_bot")
REFERRAL_PERCENT = 2.0
HAT_PRICE = 7.0
TEST_START_BALANCE = 50.0

os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE NOT NULL,
            username TEXT DEFAULT '',
            first_name TEXT DEFAULT '',
            last_name TEXT DEFAULT '',
            photo_url TEXT DEFAULT '',
            balance REAL NOT NULL DEFAULT 0,
            referral_earnings REAL NOT NULL DEFAULT 0,
            referred_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item_type TEXT NOT NULL,
            item_name TEXT NOT NULL,
            item_price REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS upgrades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            price REAL NOT NULL,
            probability REAL NOT NULL,
            won INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
        """)
init_db()


def validate_init_data(init_data: str):
    """Validate Telegram WebApp initData when BOT_TOKEN is configured."""
    if not init_data:
        return None
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = pairs.pop("hash", None)
        if not received_hash:
            return None
        data_check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
        secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, received_hash):
            return None
        user = json.loads(pairs.get("user", "{}"))
        return user or None
    except Exception:
        return None


def get_user():
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user = validate_init_data(init_data) if BOT_TOKEN else None

    # Development/test fallback: the browser sends initDataUnsafe.user.
    payload = request.get_json(silent=True) or {}
    if not user:
        user = payload.get("user")

    if not user or not user.get("id"):
        # Stable demo account for local testing outside Telegram.
        user = {"id": 1, "username": "test_user", "first_name": "Test"}

    return user


def upsert_user(user):
    tg_id = int(user["id"])
    username = user.get("username", "") or ""
    first_name = user.get("first_name", "") or ""
    last_name = user.get("last_name", "") or ""
    photo_url = user.get("photo_url", "") or ""
    start_param = user.get("start_param") or request.args.get("start_param", "")

    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        if row:
            conn.execute("""
                UPDATE users
                SET username=?, first_name=?, last_name=?, photo_url=?
                WHERE tg_id=?
            """, (username, first_name, last_name, photo_url, tg_id))
            return conn.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()

        referred_by = None
        if start_param and start_param.startswith("ref_"):
            try:
                ref_tg_id = int(start_param[4:])
                if ref_tg_id != tg_id:
                    ref = conn.execute("SELECT id FROM users WHERE tg_id=?", (ref_tg_id,)).fetchone()
                    if ref:
                        referred_by = ref["id"]
            except ValueError:
                pass

        # First real/demo user receives the requested test balance.
        user_count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        starting_balance = TEST_START_BALANCE if user_count == 0 else 0.0

        cur = conn.execute("""
            INSERT INTO users
            (tg_id, username, first_name, last_name, photo_url, balance, referred_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (tg_id, username, first_name, last_name, photo_url,
              starting_balance, referred_by))
        return conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()


def user_payload(row):
    with db() as conn:
        refs = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE referred_by=?", (row["id"],)
        ).fetchone()["c"]
        gifts = conn.execute(
            "SELECT COUNT(*) AS c FROM inventory WHERE user_id=?", (row["id"],)
        ).fetchone()["c"]
    return {
        "id": row["id"],
        "tg_id": row["tg_id"],
        "username": row["username"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "photo_url": row["photo_url"],
        "balance": round(row["balance"], 4),
        "referral_earnings": round(row["referral_earnings"], 4),
        "referrals": refs,
        "gifts": gifts,
        "hat_price": HAT_PRICE,
        "referral_percent": REFERRAL_PERCENT,
        "referral_link": f"https://t.me/{BOT_USERNAME}?start=ref_{row['tg_id']}",
    }


@app.get("/")
def index():
    return render_template("index.html", hat_price=HAT_PRICE)


@app.get("/profile")
def profile():
    return render_template("profile.html")


@app.get("/api/state")
def state():
    user = upsert_user(get_user())
    return jsonify({
        "user": user_payload(user),
        "inventory": inventory_for(user["id"])
    })


def inventory_for(user_id):
    with db() as conn:
        rows = conn.execute("""
            SELECT id, item_type, item_name, item_price, created_at
            FROM inventory WHERE user_id=? ORDER BY id DESC
        """, (user_id,)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/upgrade")
def upgrade():
    payload = request.get_json(silent=True) or {}
    try:
        probability = float(payload.get("probability", 25))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Некорректная вероятность"}), 400

    probability = max(10.0, min(50.0, probability))
    price = round(HAT_PRICE * probability / 100.0, 4)

    user = upsert_user(get_user())

    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        if row["balance"] + 1e-9 < price:
            return jsonify({
                "ok": False,
                "error": "Недостаточно TON",
                "balance": round(row["balance"], 4),
                "price": price
            }), 400

        # Server-side result. The client only animates the already decided result.
        import secrets
        won = secrets.randbelow(10000) < int(round(probability * 100))

        new_balance = round(row["balance"] - price, 4)
        conn.execute("UPDATE users SET balance=? WHERE id=?", (new_balance, row["id"]))
        conn.execute("""
            INSERT INTO upgrades(user_id, price, probability, won)
            VALUES (?, ?, ?, ?)
        """, (row["id"], price, probability, int(won)))

        if won:
            conn.execute("""
                INSERT INTO inventory(user_id, item_type, item_name, item_price)
                VALUES (?, 'gift', 'Шляпа волшебника', ?)
            """, (row["id"], HAT_PRICE))

        updated = conn.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()

    return jsonify({
        "ok": True,
        "won": won,
        "probability": probability,
        "price": price,
        "balance": round(updated["balance"], 4),
        "inventory": inventory_for(updated["id"])
    })


@app.post("/api/deposit")
def deposit():
    """Internal/test deposit endpoint. In production, replace with real payment verification."""
    payload = request.get_json(silent=True) or {}
    try:
        amount = float(payload.get("amount", 0))
    except (TypeError, ValueError):
        amount = 0
    if amount <= 0:
        return jsonify({"ok": False, "error": "Некорректная сумма"}), 400

    user = upsert_user(get_user())
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        conn.execute(
            "UPDATE users SET balance=balance+? WHERE id=?", (amount, row["id"])
        )

        # Pay the referrer 2% of the deposit. This is persisted in SQLite.
        if row["referred_by"]:
            bonus = round(amount * REFERRAL_PERCENT / 100.0, 4)
            conn.execute("""
                UPDATE users
                SET balance=balance+?, referral_earnings=referral_earnings+?
                WHERE id=?
            """, (bonus, bonus, row["referred_by"]))

        updated = conn.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()

    return jsonify({"ok": True, "balance": round(updated["balance"], 4)})


@app.get("/api/config")
def config():
    return jsonify({
        "currency": "TON",
        "referral_percent": REFERRAL_PERCENT,
        "hat_price": HAT_PRICE,
        "bot_username": BOT_USERNAME
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
