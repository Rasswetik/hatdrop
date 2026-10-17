"""Каталог снаряжения (указатели колеса). default — доступно всем, остальное открывается наградами."""
WEAPONS = {
    "axe": {"name": "Топор", "default": True, "event": ""},
    "staff": {"name": "Посох", "default": True, "event": ""},
    "skeleton": {"name": "Рука скелета", "default": True, "event": "halloween"},
    "sword": {"name": "Меч", "default": False, "event": ""},
    "hammer": {"name": "Молот", "default": False, "event": ""},
    "scythe": {"name": "Коса жнеца", "default": False, "event": "halloween"},
    "pumpkin": {"name": "Тыквенный посох", "default": False, "event": "halloween"},
}


def owned(user):
    """Идентификаторы доступного игроку снаряжения."""
    got = user.get("weapons") if isinstance(user.get("weapons"), list) else []
    return sorted({k for k, v in WEAPONS.items() if v["default"]} | {w for w in got if w in WEAPONS})


def grant(user, weapon):
    if weapon not in WEAPONS:
        raise ValueError("bad_weapon")
    have = user.setdefault("weapons", [])
    if weapon not in have:
        have.append(weapon)
