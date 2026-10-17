"""Каталог снаряжения (указатели колеса). default — доступно всем, остальное открывается наградами.
rarity: common / rare / epic / legendary — от редкости зависят свечение и эффекты на колесе."""
RARITIES = {"common": "Обычное", "rare": "Редкое", "epic": "Эпическое", "legendary": "Легендарное"}
WEAPONS = {
    "axe": {"name": "Топор", "default": True, "event": "", "rarity": "common"},
    "staff": {"name": "Посох", "default": False, "event": "", "rarity": "common"},
    "skeleton": {"name": "Рука скелета", "default": False, "event": "halloween", "rarity": "epic", "event_free": True},
    "sword": {"name": "Меч", "default": False, "event": "", "rarity": "rare"},
    "hammer": {"name": "Молот", "default": False, "event": "", "rarity": "rare"},
    "trident": {"name": "Трезубец", "default": False, "event": "", "rarity": "epic"},
    "crystal": {"name": "Кристальный жезл", "default": False, "event": "", "rarity": "legendary"},
    "club": {"name": "Костяная дубина", "default": False, "event": "halloween", "rarity": "rare"},
    "pumpkin": {"name": "Тыквенный посох", "default": False, "event": "halloween", "rarity": "epic"},
    "scythe": {"name": "Коса жнеца", "default": False, "event": "halloween", "rarity": "legendary"},
    # оружие для поляны
    "shovel": {"name": "Лопата фермера", "default": False, "event": "", "rarity": "common"},
    "pitchfork": {"name": "Вилы", "default": False, "event": "", "rarity": "rare"},
    "flower": {"name": "Цветочный жезл", "default": False, "event": "", "rarity": "rare"},
    "rainbow": {"name": "Радужный посох", "default": False, "event": "", "rarity": "epic"},
    "butterfly": {"name": "Жезл бабочки", "default": False, "event": "", "rarity": "epic"},
    "sun": {"name": "Солнечный скипетр", "default": False, "event": "", "rarity": "legendary"},
    "pickaxe": {"name": "Кирка шахтёра", "default": False, "event": "", "rarity": "common"},
    "mace": {"name": "Булава", "default": False, "event": "", "rarity": "common"},
    "spear": {"name": "Копьё", "default": False, "event": "", "rarity": "rare"},
    "orb": {"name": "Жезл мага", "default": False, "event": "", "rarity": "rare"},
    "frost": {"name": "Ледяной клинок", "default": False, "event": "", "rarity": "epic"},
    "flame": {"name": "Огненный жезл", "default": False, "event": "", "rarity": "epic"},
    "dragon": {"name": "Клинок дракона", "default": False, "event": "", "rarity": "legendary"},
    "thunder": {"name": "Молния Зевса", "default": False, "event": "", "rarity": "legendary"},
    # типы прокрута (kind=spin): хранятся и выдаются так же, как оружие
    "spin_plain": {"name": "Прокрут: Обычный", "default": True, "event": "", "rarity": "common", "kind": "spin"},
    "spin_wild": {"name": "Прокрут: Дикий", "default": False, "event": "", "rarity": "rare", "kind": "spin"},
    "spin_roulette": {"name": "Прокрут: Рулетка", "default": False, "event": "", "rarity": "rare", "kind": "spin"},
    "spin_turbo": {"name": "Прокрут: Рывок", "default": False, "event": "", "rarity": "rare", "kind": "spin"},
    "spin_spring": {"name": "Прокрут: Пружина", "default": False, "event": "", "rarity": "rare", "kind": "spin"},
    "spin_snap": {"name": "Прокрут: Замах", "default": False, "event": "", "rarity": "epic", "kind": "spin"},
    "spin_pendulum": {"name": "Прокрут: Маятник", "default": False, "event": "", "rarity": "epic", "kind": "spin"},
    "spin_tease": {"name": "Прокрут: Интрига", "default": False, "event": "", "rarity": "epic", "kind": "spin"},
    "spin_swing": {"name": "Прокрут: Качели", "default": False, "event": "", "rarity": "legendary", "kind": "spin"},
}


ACTIVE_EVENT = ""  # ключ идущего ивента; на время ивента всем доступно снаряжение с event_free


def owned(user):
    """Идентификаторы доступного игроку снаряжения."""
    got = user.get("weapons") if isinstance(user.get("weapons"), list) else []
    free = {k for k, v in WEAPONS.items() if v.get("event_free") and ACTIVE_EVENT and v["event"] == ACTIVE_EVENT}
    return sorted({k for k, v in WEAPONS.items() if v["default"]} | free | {w for w in got if w in WEAPONS})


def grant(user, weapon):
    if weapon not in WEAPONS:
        raise ValueError("bad_weapon")
    have = user.setdefault("weapons", [])
    if weapon not in have:
        have.append(weapon)


def revoke(user, weapon):
    if weapon not in WEAPONS or WEAPONS[weapon]["default"]:
        raise ValueError("bad_weapon")
    user["weapons"] = [w for w in user.get("weapons", []) if w != weapon]


# --- коллекции и награды за сбор (настраиваются в админке, хранятся в settings["weapon_cfg"]) ---
DEFAULT_CFG = {
    "collections": [
        {"id": "halloween", "name": "Хэллоуин", "need": 5, "reward": 1.0, "weapons": ["skeleton", "club", "pumpkin", "scythe"]},
    ],
    "levels": [
        {"id": "l1", "need": 8, "reward": 0.2},
        {"id": "l2", "need": 14, "reward": 0.5},
        {"id": "l3", "need": 20, "reward": 1.0},
    ],
}


def gear_ids():
    return [k for k, v in WEAPONS.items() if v.get("kind") != "spin"]


def clean_cfg(raw):
    """Проверяет настройки коллекций: оружие входит максимум в одну коллекцию, числа в разумных пределах."""
    raw = raw if isinstance(raw, dict) else {}
    used, cols, ids = set(), [], set()
    for c in (raw.get("collections") or [])[:30]:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name") or "").strip()[:40]
        if not name:
            raise ValueError("collection_name")
        cid = str(c.get("id") or "").strip()[:20] or "c" + str(len(cols) + 1)
        while cid in ids:
            cid += "x"
        ids.add(cid)
        ws = []
        for w in c.get("weapons") or []:
            w = str(w)
            if w in WEAPONS and WEAPONS[w].get("kind") != "spin" and w not in used:
                used.add(w)
                ws.append(w)
        try:
            reward = round(max(0.0, min(100000.0, float(c.get("reward") or 0))), 6)
            need = int(c.get("need") or len(ws))
        except (TypeError, ValueError):
            raise ValueError("collection_number")
        cols.append({"id": cid, "name": name, "need": max(1, min(need, max(1, len(ws)))), "reward": reward, "weapons": ws})
    levels, lids = [], set()
    for lv in (raw.get("levels") or [])[:30]:
        if not isinstance(lv, dict):
            continue
        try:
            need = int(lv.get("need") or 0)
            reward = round(max(0.0, min(100000.0, float(lv.get("reward") or 0))), 6)
        except (TypeError, ValueError):
            raise ValueError("level_number")
        if need < 1:
            raise ValueError("level_number")
        lid = str(lv.get("id") or "").strip()[:20] or "l" + str(len(levels) + 1)
        while lid in lids:
            lid += "x"
        lids.add(lid)
        levels.append({"id": lid, "need": need, "reward": reward})
    levels.sort(key=lambda x: x["need"])
    return {"collections": cols, "levels": levels}


def get_cfg(settings):
    cfg = settings.get("weapon_cfg")
    return clean_cfg(cfg) if isinstance(cfg, dict) else clean_cfg(DEFAULT_CFG)


def collection_of(cfg):
    return {w: c["id"] for c in cfg["collections"] for w in c["weapons"]}


def progress(user, cfg):
    have = set(owned(user))
    allg = gear_ids()
    return {
        "total": len(allg), "have": sum(1 for w in allg if w in have),
        "collections": {c["id"]: sum(1 for w in c["weapons"] if w in have) for c in cfg["collections"]},
    }
