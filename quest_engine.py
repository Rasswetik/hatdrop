"""HatDrop quest definitions and server-side progress accounting.

Only trusted server events can advance a quest. No client-supplied progress is accepted.
All calls happen while app.lock is held and are persisted with the app's JSON store.
"""
import math
import time

QUEST_TYPES = {
    "deposit_min": ("Депозиты от указанной суммы", "count"),
    "deposit_total": ("Общая сумма депозитов", "ton"),
    "turnover": ("Суммарный игровой оборот", "ton"),
    "wheel_spins": ("Прокрутить рулетку", "count"),
    "wheel_wins": ("Выиграть в рулетку", "count"),
    "upgrade_wins_min": ("Выиграть апгрейд с шансом от (%)", "count"),
    "upgrade_wins_max": ("Выиграть апгрейд с шансом до (%)", "count"),
    "upgrade_plays_below": ("Сыграть апгрейд с шансом ниже (%)", "count"),
    "upgrade_plays_above": ("Сыграть апгрейд с шансом от (%)", "count"),
    "mines_plays": ("Сыграть в мины", "count"),
    "mines_gift_wins": ("Выиграть подарок в минах", "count"),
    "mines_opened": ("Открыть безопасные клетки в минах", "count"),
}
LIMIT = 150
QUEST_ICONS = ("auto", "wheel", "upgrade", "mines", "gift", "deposit", "turnover", "chest", "star", "trophy", "hatcoin", "moon", "flame")

def icon_for(kind):
    if kind.startswith("deposit"): return "deposit"
    if kind == "turnover": return "turnover"
    if kind.startswith("wheel"): return "wheel"
    if kind.startswith("upgrade"): return "upgrade"
    if kind == "mines_gift_wins": return "gift"
    return "mines"

def auto_title(kind, goal, threshold):
    count = f"{goal:g}" if isinstance(goal, float) else str(goal)
    chance = f"{threshold:g}%"
    return {
        "deposit_min": f"Сделай {count} пополнений от {threshold:g} TON",
        "deposit_total": f"Пополняй баланс на {count} TON",
        "turnover": f"Набери оборот {count} TON",
        "wheel_spins": f"Прокрути рулетку {count} раз",
        "wheel_wins": f"Выиграй в рулетку {count} раз",
        "upgrade_plays_below": f"Сделай апгрейд {count} раз с шансом ниже {chance}",
        "upgrade_plays_above": f"Сделай апгрейд {count} раз с шансом от {chance}",
        "upgrade_wins_min": f"Выиграй апгрейд {count} раз с шансом от {chance}",
        "upgrade_wins_max": f"Выиграй апгрейд {count} раз с шансом до {chance}",
        "mines_plays": f"Сыграй в мины {count} раз",
        "mines_gift_wins": f"Выиграй подарок в минах {count} раз",
        "mines_opened": f"Открой {count} безопасных клеток в минах",
    }[kind]



def _num(value, *, maximum=100000000):
    try:
        value = float(value)
    except (ValueError, TypeError, OverflowError):
        raise ValueError("bad_request")
    if not math.isfinite(value) or value < 0 or value > maximum:
        raise ValueError("bad_request")
    return value


def validate(data, current=None):
    """Validate and normalize a quest (never trust admin form input)."""
    current = current or {}
    kind = str(data.get("kind", current.get("kind", "wheel_spins")))
    if kind not in QUEST_TYPES:
        raise ValueError("bad_request")
    submitted_title = str(data.get("title", "")).strip()[:80]
    title = submitted_title if submitted_title else ("" if data.get("title") is not None or current.get("title_auto") else str(current.get("title", ""))[:80])
    description = str(data.get("description", current.get("description", ""))).strip()[:240]
    goal = _num(data.get("goal", current.get("goal", 1)))
    if goal <= 0:
        raise ValueError("bad_request")
    if QUEST_TYPES[kind][1] == "count":
        if not goal.is_integer():
            raise ValueError("bad_request")
        goal = int(goal)
    threshold = _num(data.get("threshold", current.get("threshold", 20 if kind.startswith("upgrade_") else 5 if kind == "deposit_min" else 0)))
    if kind in ("upgrade_wins_min", "upgrade_wins_max", "upgrade_plays_below", "upgrade_plays_above"):
        if not 0 < threshold <= 100:
            raise ValueError("threshold")
    elif kind == "deposit_min":
        if threshold <= 0:
            raise ValueError("threshold")
    else:
        threshold = 0
    start_at = int(_num(data.get("start_at", current.get("start_at", 0)), maximum=4102444800))
    end_at = int(_num(data.get("end_at", current.get("end_at", 0)), maximum=4102444800))
    if end_at and start_at and end_at <= start_at:
        raise ValueError("bad_request")
    hours = _num(data.get("duration_hours", current.get("duration_hours", 0)), maximum=8760)
    reward_type = str(data.get("reward_type", current.get("reward_type", "ton")))
    if reward_type not in ("ton", "hatcoin"):
        raise ValueError("bad_request")
    reward_amount = _num(data.get("reward_amount", current.get("reward_amount", 0)), maximum=100000)
    if reward_amount <= 0:
        raise ValueError("bad_request")
    icon = str(data.get("icon", current.get("icon", "auto")))
    if icon not in QUEST_ICONS:
        raise ValueError("bad_request")
    title_auto = not bool(title)
    if title_auto:
        title = auto_title(kind, goal, threshold)
    return {
        "title_auto": title_auto, "title": title, "icon": icon, "description": description, "kind": kind,
        "goal": goal, "threshold": threshold,
        "start_at": start_at, "end_at": end_at, "duration_hours": hours,
        "reward_type": reward_type, "reward_amount": round(reward_amount, 6),
        "active": data.get("active", current.get("active", True)) is True,
    }


def definitions(db):
    return db.setdefault("quests", {})


def progress_for(user, quest, now=None):
    """Return a progress snapshot, without mutating player or quest."""
    now = int(now or time.time())
    p = user.get("quest_progress", {}).get(quest["id"], {})
    if p.get("version") != quest.get("version", 1):
        p = {}
    value = min(quest["goal"], p.get("value", 0))
    expiration = (int(p.get("started_at", 0) + quest["duration_hours"] * 3600)
                  if p.get("started_at") and quest["duration_hours"] else 0)
    expired = bool((quest["end_at"] and now > quest["end_at"]) or (expiration and now > expiration))
    return {
        "value": value, "goal": quest["goal"], "completed": value >= quest["goal"],
        "claimed": bool(p.get("claimed")), "expired": expired,
        "started_at": p.get("started_at", 0), "expires_at": expiration,
    }


def listed(db, user, *, admin=False):
    now = int(time.time())
    result = []
    for quest in definitions(db).values():
        if not isinstance(quest, dict) or not quest.get("id") or quest.get("kind") not in QUEST_TYPES:
            continue
        if not admin and (not quest.get("active", True) or quest.get("start_at", 0) and now < quest["start_at"]):
            continue
        row = {"start_at": 0, "end_at": 0, "created": 0, "duration_hours": 0, "threshold": 0,
               "goal": 1, "active": True, "version": 1, **quest}
        result.append({**row, "resolved_icon": icon_for(row["kind"]) if row.get("icon", "auto") == "auto" else row["icon"], "progress": progress_for(user, row, now)})
    result.sort(key=lambda row: (row["end_at"] or 9999999999, row["created"]))
    return result


def _increment(quest, event, amount, chance_pct, gift_awarded):
    kind = quest["kind"]
    if kind == "deposit_min":
        return 1 if event == "deposit" and amount >= quest["threshold"] else 0
    if kind == "deposit_total":
        return amount if event == "deposit" else 0
    if kind == "turnover":
        return amount if event == "turnover" else 0
    if kind == "wheel_spins":
        return 1 if event == "wheel_spin" else 0
    if kind == "wheel_wins":
        return 1 if event == "wheel_win" else 0
    if kind == "upgrade_plays_below":
        return 1 if event == "upgrade_play" and chance_pct < quest["threshold"] else 0
    if kind == "upgrade_plays_above":
        return 1 if event == "upgrade_play" and chance_pct >= quest["threshold"] else 0
    if kind == "upgrade_wins_min":
        return 1 if event == "upgrade_win" and chance_pct >= quest["threshold"] else 0
    if kind == "upgrade_wins_max":
        return 1 if event == "upgrade_win" and chance_pct <= quest["threshold"] else 0
    if kind == "mines_plays":
        return 1 if event == "mines_play" else 0
    if kind == "mines_gift_wins":
        return 1 if event == "mines_win" and gift_awarded else 0
    if kind == "mines_opened":
        return 1 if event == "mines_safe_open" else 0
    return 0


def record_event(db, user, event, *, amount=0, chance_pct=0, gift_awarded=False, ts=None):
    """Call after a successful, trusted server action only. Caller holds app.lock."""
    ts = int(ts or time.time())
    for q in definitions(db).values():
        if not isinstance(q, dict) or q.get("kind") not in QUEST_TYPES or not q.get("active") or q.get("start_at", 0) and ts < q["start_at"] or q.get("end_at", 0) and ts > q["end_at"]:
            continue
        inc = _increment(q, event, amount, chance_pct, gift_awarded)
        if inc <= 0:
            continue
        p = user.setdefault("quest_progress", {}).setdefault(q["id"], {})
        if p.get("version") != q.get("version", 1):
            p.clear()
            p["version"] = q.get("version", 1)
        if p.get("claimed"):
            continue
        if p.get("started_at") and q["duration_hours"] and ts > p["started_at"] + q["duration_hours"] * 3600:
            continue
        p.setdefault("started_at", ts)
        p["value"] = round(min(q["goal"], p.get("value", 0) + inc), 6)
        p["updated_at"] = ts


def record_verified_deposit(db, user, *, amount, payment_id, ts=None):
    """Integration point for a future verified TON payment webhook.

    Require a unique server-verified blockchain payment ID. Never call from
    a promo redemption, balance edit, or an unconfirmed client notification.
    """
    amount = _num(amount)
    payment_id = str(payment_id).strip()
    if amount <= 0 or not payment_id:
        raise ValueError("bad_request")
    seen = db.setdefault("quest_deposit_events", {})
    if payment_id in seen:
        return False
    seen[payment_id] = {"uid": user["id"], "amount": amount, "ts": int(ts or time.time())}
    record_event(db, user, "deposit", amount=amount, ts=ts)
    return True


def claim(db, user, quest_id, *, launched=False):
    """Validate claim under app.lock; mark as claimed before crediting reward."""
    if not launched:
        raise ValueError("quests_not_launched")
    q = definitions(db).get(str(quest_id))
    if not q or not q["active"]:
        raise ValueError("not_found")
    info = progress_for(user, q)
    if info["expired"] or not info["completed"] or info["claimed"]:
        raise ValueError("quest_not_claimable")
    p = user.setdefault("quest_progress", {}).setdefault(q["id"], {})
    p["claimed"] = True
    p["claimed_at"] = int(time.time())
    return q
