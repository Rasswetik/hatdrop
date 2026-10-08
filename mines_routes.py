import json
import math
import secrets
from flask import jsonify, request

BOARD_SIZE = 25
MAX_BET = 300.0


def register_mines(app, db, get_user, upsert_user):
    def initialize(conn):
        conn.execute("""CREATE TABLE IF NOT EXISTS hatdrop_mines (
            user_id BIGINT PRIMARY KEY,
            session_json TEXT NOT NULL
        )""")

    def state_for(conn, user_id):
        initialize(conn)
        row = conn.execute("SELECT session_json FROM hatdrop_mines WHERE user_id=?", (user_id,)).fetchone()
        return json.loads(row["session_json"]) if row else None

    def visible(s):
        if not s:
            return {"active": False, "cells": [None] * BOARD_SIZE}
        cells = ["gold" if x in s["opened"] else None for x in range(BOARD_SIZE)]
        if not s["active"]:
            cells = ["empty" if x in s["mines"] else ("gold" if x in s["opened"] else None) for x in range(BOARD_SIZE)]
        return {"active": s["active"], "cells": cells, "bet": s["bet"],
                "mines_count": s["mines_count"], "opened": len(s["opened"]),
                "multiplier": round(multiplier(s), 4), "result": s.get("result"),
                "version": s["version"]}

    def multiplier(s):
        opened = len(s["opened"])
        safe = BOARD_SIZE - s["mines_count"]
        product = 1.0
        for i in range(opened):
            product *= (BOARD_SIZE - i) / (safe - i)
        return product * 0.97

    @app.post("/api/mines/state")
    def mines_state():
        user = upsert_user(get_user())
        with db() as conn:
            s = state_for(conn, user["id"])
        return jsonify(visible(s))

    @app.post("/api/mines/start")
    def mines_start():
        data = request.get_json(silent=True) or {}
        try:
            bet = round(float(data.get("bet", 0)), 4)
            mines = int(data.get("mines", 3))
            if not math.isfinite(bet) or not 0.1 <= bet <= MAX_BET or not 1 <= mines <= 20:
                raise ValueError
        except (TypeError, ValueError, OverflowError):
            return jsonify(error="invalid_bet"), 400
        user = upsert_user(get_user())
        with db() as conn:
            old = state_for(conn, user["id"])
            if old and old["active"]:
                return jsonify(error="game_active"), 409
            updated = conn.execute("UPDATE users SET balance=ROUND(balance-?,4) WHERE id=? AND balance>=?",
                                   (bet, user["id"], bet))
            if updated.rowcount != 1:
                return jsonify(error="insufficient_funds"), 400
            selected = secrets.SystemRandom().sample(range(BOARD_SIZE), mines)
            s = {"active": True, "bet": bet, "mines_count": mines, "mines": selected,
                 "opened": [], "version": secrets.token_hex(16)}
            if old:
                conn.execute("UPDATE hatdrop_mines SET session_json=? WHERE user_id=?",
                             (json.dumps(s), user["id"]))
            else:
                conn.execute("INSERT INTO hatdrop_mines(user_id,session_json) VALUES(?,?)",
                             (user["id"], json.dumps(s)))
            balance = conn.execute("SELECT balance FROM users WHERE id=?", (user["id"],)).fetchone()["balance"]
        return jsonify(**visible(s), balance_ton=round(balance, 4))

    @app.post("/api/mines/open")
    def mines_open():
        data = request.get_json(silent=True) or {}
        try:
            cell = int(data.get("cell"))
        except (TypeError, ValueError):
            return jsonify(error="invalid_cell"), 400
        if not 0 <= cell < BOARD_SIZE:
            return jsonify(error="invalid_cell"), 400
        user = upsert_user(get_user())
        with db() as conn:
            s = state_for(conn, user["id"])
            if not s or not s["active"]:
                return jsonify(error="no_active_game"), 409
            if cell in s["opened"]:
                return jsonify(**visible(s))
            if cell in s["mines"]:
                s["active"] = False
                s["result"] = "lose"
            else:
                s["opened"].append(cell)
            old_version = s["version"]
            s["version"] = secrets.token_hex(16)
            if s["active"] and len(s["opened"]) == BOARD_SIZE - s["mines_count"]:
                s["active"] = False
                s["result"] = "win"
                payout = round(s["bet"] * multiplier(s), 4)
            else:
                payout = 0
            old_json = conn.execute("SELECT session_json FROM hatdrop_mines WHERE user_id=?", (user["id"],)).fetchone()["session_json"]
            if json.loads(old_json).get("version") != old_version:
                return jsonify(error="game_conflict"), 409
            res = conn.execute("UPDATE hatdrop_mines SET session_json=? WHERE user_id=? AND session_json=?",
                               (json.dumps(s), user["id"], old_json))
            if res.rowcount != 1:
                return jsonify(error="game_conflict"), 409
            if payout:
                conn.execute("UPDATE users SET balance=ROUND(balance+?,4) WHERE id=?", (payout, user["id"]))
        return jsonify(**visible(s), payout_ton=payout)

    @app.post("/api/mines/cashout")
    def mines_cashout():
        user = upsert_user(get_user())
        with db() as conn:
            s = state_for(conn, user["id"])
            if not s or not s["active"] or not s["opened"]:
                return jsonify(error="cashout_unavailable"), 409
            payout = round(s["bet"] * multiplier(s), 4)
            previous = conn.execute("SELECT session_json FROM hatdrop_mines WHERE user_id=?", (user["id"],)).fetchone()["session_json"]
            s["active"] = False
            s["result"] = "win"
            s["version"] = secrets.token_hex(16)
            res = conn.execute("UPDATE hatdrop_mines SET session_json=? WHERE user_id=? AND session_json=?",
                               (json.dumps(s), user["id"], previous))
            if res.rowcount != 1:
                return jsonify(error="game_conflict"), 409
            conn.execute("UPDATE users SET balance=ROUND(balance+?,4) WHERE id=?", (payout, user["id"]))
        return jsonify(**visible(s), payout_ton=payout)
