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
