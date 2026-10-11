"""Durable, daily game accounting. It never estimates missing historical payouts."""
import math
import secrets
import time
from datetime import datetime, timedelta, timezone

MOSCOW = timezone(timedelta(hours=3))


def day_key(ts):
    return datetime.fromtimestamp(ts, MOSCOW).date().isoformat()


def ensure_analytics(db):
    return db.setdefault("analytics", {"started": int(time.time()), "days": {}, "entries": []})


def blank_metrics():
    return {"games": 0, "wins": 0, "stakes": 0.0, "payouts": 0.0}


def record_round(db, user, kind, cost, payout, win, ts):
    stats = ensure_analytics(db)
    day = stats["days"].setdefault(day_key(ts), {})
    scope = "real" if str(user["id"]).startswith("tg") else "demo"
    row = day.setdefault(scope, {}).setdefault(kind, blank_metrics())
    row["games"] += 1
    row["wins"] += int(bool(win))
    row["stakes"] = round(row["stakes"] + cost, 4)
    row["payouts"] = round(row["payouts"] + payout, 4)


def finance_entry(db, user, body):
    kind = body.get("kind")
    if kind not in ("income", "expense"):
        raise ValueError("bad_request")
    amount = float(body.get("amount"))
    if not math.isfinite(amount) or amount <= 0 or amount > 1_000_000_000:
        raise ValueError("bad_request")
    note = str(body.get("note") or "").strip()[:200]
    if not note:
        raise ValueError("bad_request")
    stats = ensure_analytics(db)
    request_id = str(body.get("request_id") or "")[:64]
    if not request_id:
        raise ValueError("bad_request")
    # Safe retries must not duplicate an operating expense.
    old = next((r for r in stats["entries"] if r.get("request_id") == request_id and r["admin"] == user["id"]), None)
    if old:
        if old["kind"] != kind or old["amount"] != round(amount, 4) or old["note"] != note:
            raise ValueError("bad_request")
        return old
    entry = {"id": secrets.token_hex(8), "ts": int(time.time()), "kind": kind,
             "amount": round(amount, 4), "note": note, "admin": user["id"], "request_id": request_id}
    if entry["amount"] <= 0:
        raise ValueError("bad_request")
    stats["entries"].append(entry)
    return entry


def overview(db, days=30, scope="real", now=None):
    now = now or int(time.time())
    stats = ensure_analytics(db)
    today = datetime.fromtimestamp(now, MOSCOW).date()
    dates = [(today - timedelta(days=n)).isoformat() for n in range(days - 1, -1, -1)]
    totals = blank_metrics()
    modes = {}
    series = []
    journal = {}
    for entry in stats["entries"]:
        key = day_key(entry["ts"])
        row = journal.setdefault(key, {"income": 0, "expense": 0})
        row[entry["kind"]] += entry["amount"]
    total_income = total_expenses = 0
    for date in dates:
        daily = blank_metrics()
        for kind, row in stats["days"].get(date, {}).get(scope, {}).items():
            mode = modes.setdefault(kind, blank_metrics())
            for field in daily:
                value = row.get(field, 0)
                daily[field] += value
                mode[field] += value
        for field in totals:
            totals[field] += daily[field]
        # Operating entries belong to the real bot, not simulated play.
        money = journal.get(date, {}) if scope == "real" else {}
        income, expense = money.get("income", 0), money.get("expense", 0)
        total_income += income
        total_expenses += expense
        series.append({"date": date, **daily, "gross": round(daily["stakes"] - daily["payouts"], 4),
                       "income": round(income, 4), "expense": round(expense, 4),
                       "net": round(daily["stakes"] - daily["payouts"] + income - expense, 4)})
    users = [u for u in db["users"].values() if str(u["id"]).startswith("tg") == (scope == "real")]
    balances = sum(u.get("balance", 0) for u in users)
    inventory = sum(p.get("value", 0) for u in users for p in u.get("prizes", []) if p.get("status") in ("owned", "withdraw_pending", "withdraw_processing"))
    active_stakes = sum((u.get("chest") or {}).get("bet", 0) for u in users)
    requests = [r for r in db.get("withdrawals", {}).values() if str(r.get("uid", "")).startswith("tg") == (scope == "real")]
    pending = [r for r in requests if r.get("status") in ("pending", "approved")]
    selected = set(dates)
    completed = [r for r in requests if r.get("status") == "completed" and day_key(r.get("updated", 0)) in selected]
    gross = round(totals["stakes"] - totals["payouts"], 4)
    totals.update(gross=gross, income=round(total_income, 4), expense=round(total_expenses, 4),
                  net=round(gross + total_income - total_expenses, 4),
                  margin=round(100 * gross / totals["stakes"], 2) if totals["stakes"] else None,
                  rtp=round(100 * totals["payouts"] / totals["stakes"], 2) if totals["stakes"] else None)
    for row in modes.values():
        row["gross"] = round(row["stakes"] - row["payouts"], 4)
    return {"started": stats["started"], "now": now, "scope": scope, "days": days,
            "totals": totals, "series": series, "modes": modes,
            "users": {"total": len(users), "online": sum(u.get("seen", 0) >= now - 300 for u in users),
                      "balances": round(balances, 4), "inventory": round(inventory, 4),
                      "active_stakes": round(active_stakes, 4)},
            "withdrawals": {"pending": len(pending), "pending_value": round(sum(r.get("value_ton", 0) for r in pending), 4),
                            "completed": len(completed), "completed_value": round(sum(r.get("value_ton", 0) for r in completed), 4)},
            "entries": [{k: v for k, v in r.items() if k not in ("request_id", "admin")} for r in reversed(stats["entries"]) if day_key(r["ts"]) in selected][:100] if scope == "real" else [],
            "bot": {"halloween": db["settings"].get("halloween_enabled") is True,
                    "market": db["settings"].get("active_market", "portals")}}
