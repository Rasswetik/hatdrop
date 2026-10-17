"""Каталог снаряжения (указатели колеса). default — доступно всем, остальное открывается наградами.
rarity: common / rare / epic / legendary — от редкости зависят свечение и эффекты на колесе."""
RARITIES = {"common": "Обычное", "rare": "Редкое", "epic": "Эпическое", "legendary": "Легендарное"}
WEAPONS = {
    "axe": {"name": "Топор", "default": True, "event": "", "rarity": "common"},
    "staff": {"name": "Посох", "default": True, "event": "", "rarity": "common"},
    "skeleton": {"name": "Рука скелета", "default": False, "event": "halloween", "rarity": "epic"},
    "sword": {"name": "Меч", "default": False, "event": "", "rarity": "rare"},
    "hammer": {"name": "Молот", "default": False, "event": "", "rarity": "rare"},
    "trident": {"name": "Трезубец", "default": False, "event": "", "rarity": "epic"},
    "crystal": {"name": "Кристальный жезл", "default": False, "event": "", "rarity": "legendary"},
    "club": {"name": "Костяная дубина", "default": False, "event": "halloween", "rarity": "rare"},
    "pumpkin": {"name": "Тыквенный посох", "default": False, "event": "halloween", "rarity": "epic"},
    "scythe": {"name": "Коса жнеца", "default": False, "event": "halloween", "rarity": "legendary"},
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


def revoke(user, weapon):
    if weapon not in WEAPONS or WEAPONS[weapon]["default"]:
        raise ValueError("bad_weapon")
    user["weapons"] = [w for w in user.get("weapons", []) if w != weapon]
