"""Рисует пиксель-арт оружия: static/weapons/<id>.png (указатель колеса 189x432, ручка по центру)
и <id>-icon.png (превью 300x300). Запуск: python3 tools/make_weapons.py"""
import os
from PIL import Image, ImageDraw

W, H, SCALE = 21, 48, 9
OUT = os.path.join(os.path.dirname(__file__), "..", "static", "weapons")
OUTLINE = (34, 20, 42, 255)

MATS = {  # материал: (свет, база, тень)
    "steel": ((240, 244, 252), (176, 186, 206), (110, 122, 148)),
    "gold": ((255, 224, 120), (255, 190, 50), (200, 130, 30)),
    "wood": ((222, 168, 104), (181, 118, 58), (125, 74, 34)),
    "dark": ((126, 90, 164), (91, 58, 122), (58, 36, 84)),
    "bone": ((255, 255, 250), (233, 228, 214), (170, 160, 150)),
    "pumpkin": ((255, 186, 90), (255, 133, 28), (190, 80, 14)),
    "leaf": ((140, 205, 80), (92, 160, 44), (58, 110, 30)),
    "glow": ((255, 250, 170), (255, 224, 90), (255, 190, 40)),
    "ruby": ((255, 150, 160), (230, 50, 70), (150, 20, 45)),
    "crystal": ((236, 214, 255), (176, 120, 245), (112, 64, 184)),
    "cut": ((50, 30, 50), (34, 20, 42), (34, 20, 42)),
    "petal": ((255, 214, 230), (255, 120, 172), (204, 66, 122)),
    "water": ((200, 238, 255), (92, 182, 242), (40, 112, 192)),
    "iron": ((190, 190, 196), (130, 132, 142), (84, 86, 98)),
    "r1": ((255, 140, 140), (240, 60, 60), (170, 30, 40)),
    "r2": ((255, 210, 140), (255, 150, 40), (200, 100, 20)),
    "r3": ((255, 250, 160), (255, 226, 70), (210, 170, 30)),
    "r4": ((180, 240, 150), (90, 200, 70), (50, 140, 40)),
    "r5": ((170, 220, 255), (70, 150, 240), (40, 90, 190)),
    "r6": ((220, 180, 255), (150, 90, 230), (100, 50, 170)),
}


class Art:
    def __init__(self):
        self.cells = {}  # (x, y) -> material

    def rect(self, x0, y0, x1, y1, mat):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.cells[(x, y)] = mat

    def poly(self, pts, mat):
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon(pts, fill=255)
        for y in range(H):
            for x in range(W):
                if m.getpixel((x, y)):
                    self.cells[(x, y)] = mat

    def ellipse(self, cx, cy, rx, ry, mat):
        for y in range(H):
            for x in range(W):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                    self.cells[(x, y)] = mat

    def render(self):
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        px = img.load()
        for (x, y), mat in self.cells.items():
            if not (0 <= x < W and 0 <= y < H):
                continue
            hi, base, lo = MATS[mat]
            same = lambda dx, dy: self.cells.get((x + dx, y + dy)) == mat
            color = base
            if not same(0, -1) or not same(-1, 0):
                color = hi
            if not same(0, 1) or not same(1, 0):
                color = lo if color == base else base
            px[x, y] = color + (255,)
        out = img.copy()
        op = out.load()
        for y in range(H):
            for x in range(W):
                if px[x, y][3] == 0:
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = x + dx, y + dy
                            if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] and (dx == 0 or dy == 0):
                                op[x, y] = OUTLINE
        return out


def handle(a, y0, y1, mat="wood", wrap=None):
    a.rect(9, y0, 11, y1, mat)
    if wrap:
        for y in range(wrap[0], wrap[1] + 1, 2):
            a.rect(9, y, 11, y, wrap[2])


def sword():
    a = Art()
    a.cells[(10, 1)] = "steel"
    a.rect(9, 2, 11, 3, "steel")
    a.rect(8, 4, 12, 29, "steel")
    a.rect(10, 5, 10, 28, "steel")
    a.rect(3, 30, 17, 32, "gold")
    a.rect(2, 31, 2, 31, "gold"); a.rect(18, 31, 18, 31, "gold")
    a.rect(10, 31, 10, 31, "ruby")
    handle(a, 33, 41, "wood", (34, 40, "gold"))
    a.rect(8, 43, 12, 44, "gold"); a.rect(9, 42, 11, 42, "gold"); a.rect(9, 45, 11, 45, "gold")
    return a


def hammer():
    a = Art()
    a.rect(3, 2, 17, 15, "steel")
    a.rect(1, 4, 2, 13, "gold"); a.rect(18, 4, 19, 13, "gold")
    a.rect(10, 4, 10, 13, "steel")
    handle(a, 16, 43, "wood", (28, 41, "gold"))
    a.rect(8, 44, 12, 46, "gold")
    return a


def scythe():
    a = Art()
    handle(a, 5, 46, "dark", (24, 42, "bone"))
    a.poly([(7, 4), (11, 1), (17, 0), (21, 3), (20, 7), (20, 12), (19, 17), (16, 12), (15, 7), (12, 6), (8, 7)], "steel")
    a.rect(8, 5, 12, 7, "bone")
    a.rect(8, 45, 12, 47, "bone")
    return a


def pumpkin():
    a = Art()
    handle(a, 17, 46, "dark", (30, 42, "bone"))
    a.ellipse(10, 10, 9.5, 7.2, "pumpkin")
    a.rect(9, 2, 11, 4, "leaf")
    a.rect(12, 2, 13, 3, "leaf")
    # лицо
    for pts in ([(5, 9), (8, 9), (6, 6)], [(12, 9), (15, 9), (14, 6)]):
        a.poly(pts, "glow")
    for x, y in [(6, 13), (8, 14), (10, 13), (12, 14), (14, 13)]:
        a.cells[(x, y)] = "glow"
    return a


def trident():
    a = Art()
    a.rect(4, 3, 5, 13, "steel"); a.rect(15, 3, 16, 13, "steel"); a.rect(9, 0, 11, 13, "steel")
    a.rect(4, 12, 16, 14, "steel")
    a.cells[(4, 2)] = "steel"; a.cells[(16, 2)] = "steel"; a.cells[(10, 0)] = "steel"
    handle(a, 15, 43, "wood", (30, 41, "gold"))
    a.rect(8, 44, 12, 46, "gold")
    return a


def crystal():
    a = Art()
    handle(a, 20, 46, "gold", (28, 44, "wood"))
    a.poly([(10, 0), (16, 8), (10, 18), (4, 8)], "crystal")
    a.rect(8, 17, 12, 20, "gold")
    a.rect(3, 9, 4, 13, "gold"); a.rect(16, 9, 17, 13, "gold")
    a.rect(4, 13, 6, 14, "gold"); a.rect(14, 13, 16, 14, "gold")
    return a


def club():
    a = Art()
    handle(a, 20, 44, "bone")
    a.ellipse(10, 9, 6.5, 9.5, "bone")
    a.rect(8, 45, 12, 47, "bone")
    for x, y in [(8, 5), (12, 7), (9, 11), (12, 13)]:
        a.cells[(x, y)] = "cut"
    return a


def shovel():
    a = Art()
    handle(a, 8, 46, "wood", (20, 30, "iron"))
    a.rect(7, 4, 13, 6, "wood"); a.rect(6, 3, 6, 6, "wood"); a.rect(14, 3, 14, 6, "wood")
    a.poly([(4, 22), (16, 22), (15, 30), (10, 34), (5, 30)], "iron")
    a.rect(9, 21, 11, 23, "iron")
    a.rect(10, 24, 10, 31, "steel")
    return a


def pitchfork():
    a = Art()
    handle(a, 14, 46, "wood", (30, 42, "leaf"))
    a.rect(4, 2, 5, 12, "iron"); a.rect(9, 0, 11, 12, "iron"); a.rect(15, 2, 16, 12, "iron")
    a.rect(4, 11, 16, 14, "iron")
    a.rect(8, 15, 12, 16, "gold")
    return a


def flower():
    a = Art()
    handle(a, 14, 46, "leaf", (30, 44, "wood"))
    a.rect(4, 26, 8, 27, "leaf"); a.rect(12, 32, 16, 33, "leaf")
    for cx, cy in ((10, 3), (16, 8), (4, 8), (14, 14), (6, 14)):
        a.ellipse(cx, cy, 4, 4, "petal")
    a.ellipse(10, 9, 4.6, 4.6, "glow")
    return a


def rainbow():
    a = Art()
    handle(a, 18, 46, "wood", (28, 44, "bone"))
    for i, mat in enumerate(("r1", "r2", "r3", "r4", "r5", "r6")):
        r = 9.6 - i * 1.2
        for y in range(H):
            for x in range(W):
                d = ((x - 10) ** 2 + (y - 13) ** 2) ** 0.5
                if r - 1.2 < d <= r and y <= 13:
                    a.cells[(x, y)] = mat
    a.rect(1, 13, 3, 17, "r1"); a.rect(17, 13, 19, 17, "r1")
    a.rect(8, 14, 12, 19, "gold")
    a.ellipse(10, 11, 2.2, 2.2, "glow")
    return a


def butterfly():
    a = Art()
    handle(a, 20, 46, "crystal", (28, 44, "wood"))
    a.ellipse(5, 6, 4.6, 5.4, "water"); a.ellipse(15, 6, 4.6, 5.4, "water")
    a.ellipse(6, 14, 3.4, 4, "petal"); a.ellipse(14, 14, 3.4, 4, "petal")
    a.rect(9, 3, 11, 17, "dark")
    a.cells[(8, 1)] = "dark"; a.cells[(12, 1)] = "dark"; a.cells[(9, 2)] = "dark"; a.cells[(11, 2)] = "dark"
    for x, y in ((4, 5), (16, 5), (6, 13), (14, 13)):
        a.cells[(x, y)] = "bone"
    return a


def sun():
    a = Art()
    handle(a, 20, 46, "gold", (28, 44, "ruby"))
    for ang in range(0, 360, 30):
        import math
        for r in (7.4, 8.4, 9.4):
            x = round(10 + r * math.cos(math.radians(ang))); y = round(10 + r * math.sin(math.radians(ang)))
            a.cells[(x, y)] = "gold"
            if r > 8: a.cells[(x + (1 if x > 10 else -1 if x < 10 else 0), y)] = "gold"
    a.ellipse(10, 10, 6.2, 6.2, "glow")
    a.ellipse(10, 10, 3.6, 3.6, "r2")
    a.rect(8, 19, 12, 21, "gold")
    return a

def pickaxe():
    a = Art()
    handle(a, 9, 46, "wood", (26, 40, "iron"))
    a.rect(2, 3, 18, 5, "iron"); a.rect(1, 5, 3, 8, "iron"); a.rect(17, 5, 19, 8, "iron")
    a.rect(7, 2, 13, 8, "steel"); a.rect(0, 7, 1, 9, "steel"); a.rect(19, 7, 20, 9, "steel")
    return a


def mace():
    a = Art()
    handle(a, 16, 46, "wood", (30, 42, "iron"))
    a.ellipse(10, 8, 7.2, 7.2, "iron")
    a.ellipse(10, 8, 3.6, 3.6, "steel")
    for x, y in ((10, 0), (10, 16), (2, 8), (18, 8), (4, 2), (16, 2), (4, 14), (16, 14)):
        a.cells[(x, y)] = "steel"
    a.rect(9, 0, 11, 1, "steel")
    a.rect(8, 44, 12, 46, "iron")
    return a


def spear():
    a = Art()
    handle(a, 14, 46, "wood", (32, 44, "leaf"))
    a.poly([(10, 0), (15, 8), (10, 14), (5, 8)], "steel")
    a.rect(10, 3, 10, 11, "bone")
    a.rect(5, 14, 15, 15, "gold")
    a.rect(8, 45, 12, 47, "gold")
    return a


def orb():
    a = Art()
    handle(a, 19, 46, "dark", (28, 44, "gold"))
    a.ellipse(10, 9, 7.6, 7.6, "water")
    a.ellipse(10, 9, 4.2, 4.2, "bone")
    a.rect(2, 3, 3, 14, "gold"); a.rect(17, 3, 18, 14, "gold")
    a.rect(5, 16, 15, 19, "gold")
    return a


def frost():
    a = Art()
    a.cells[(10, 0)] = "bone"
    a.rect(9, 1, 11, 3, "water")
    a.rect(8, 4, 12, 29, "water")
    a.rect(10, 4, 10, 28, "bone")
    for y in (8, 14, 20):
        a.rect(5, y, 7, y + 1, "water"); a.rect(13, y, 15, y + 1, "water")
    a.rect(3, 30, 17, 32, "crystal")
    a.rect(2, 29, 3, 29, "crystal"); a.rect(17, 29, 18, 29, "crystal")
    handle(a, 33, 42, "dark", (34, 41, "water"))
    a.ellipse(10, 45, 2.8, 2.8, "bone")
    return a


def flame():
    a = Art()
    handle(a, 22, 46, "dark", (30, 44, "ruby"))
    a.poly([(10, 0), (16, 8), (15, 16), (10, 21), (5, 16), (4, 8)], "r1")
    a.poly([(10, 4), (13, 10), (13, 16), (10, 20), (7, 16), (7, 10)], "r2")
    a.poly([(10, 9), (12, 14), (10, 18), (8, 14)], "r3")
    a.rect(7, 22, 13, 23, "gold")
    return a


def dragon():
    a = Art()
    a.cells[(10, 0)] = "ruby"
    a.rect(9, 1, 11, 3, "ruby")
    a.rect(8, 4, 12, 26, "ruby")
    a.rect(10, 5, 10, 25, "r2")
    a.poly([(0, 24), (8, 28), (12, 28), (20, 24), (20, 31), (14, 33), (6, 33), (0, 31)], "gold")
    a.cells[(10, 30)] = "ruby"
    handle(a, 34, 42, "dark", (35, 41, "gold"))
    a.ellipse(10, 45, 3, 3, "glow")
    return a


def thunder():
    a = Art()
    a.poly([(14, 0), (4, 12), (10, 12), (5, 23), (17, 9), (11, 9), (17, 0)], "r3")
    a.poly([(13, 2), (7, 11), (12, 11), (8, 19), (14, 9), (9, 9), (14, 2)], "glow")
    handle(a, 24, 46, "dark", (30, 44, "gold"))
    a.rect(6, 22, 14, 24, "gold")
    return a


def icon_from(img):
    rot = img.resize((W * SCALE, H * SCALE), Image.NEAREST).rotate(-45, resample=Image.NEAREST, expand=True)
    return fit_square(rot)


def fit_square(img, size=300, pad=14):
    box = img.getbbox()
    img = img.crop(box)
    s = min((size - 2 * pad) / img.width, (size - 2 * pad) / img.height)
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.NEAREST)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


SPIN_COLORS = {"common": (210, 218, 232), "rare": (90, 169, 255), "epic": (180, 107, 255), "legendary": (255, 200, 61)}
SPIN_STYLES = {"plain": "common", "wild": "rare", "roulette": "rare", "turbo": "rare", "spring": "rare",
               "snap": "epic", "pendulum": "epic", "tease": "epic", "swing": "legendary"}


def spin_icons():
    """Иконки типов прокрута для магазина: кольцо со стрелкой и знаком стиля."""
    import math
    for style, rarity in SPIN_STYLES.items():
        col = SPIN_COLORS[rarity] + (255,)
        g = 60
        img = Image.new("RGBA", (g, g), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        d.ellipse((6, 6, 53, 53), outline=col, width=5)
        d.ellipse((12, 12, 47, 47), outline=(40, 26, 56, 255), width=1)
        ang = {"plain": -60, "wild": -20, "roulette": 30, "turbo": -90, "spring": 60, "snap": 140, "pendulum": 200, "tease": 250, "swing": -140}[style]
        cx = cy = 29.5
        tip = (cx + 20 * math.cos(math.radians(ang)), cy + 20 * math.sin(math.radians(ang)))
        d.line((cx, cy, tip[0], tip[1]), fill=col, width=5)
        d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=col)
        if style in ("turbo", "swing", "spring"):
            d.arc((1, 1, 58, 58), start=ang - 70, end=ang - 20, fill=col, width=3)
        if style in ("snap", "tease", "pendulum"):
            for k in range(3):
                d.point((8 + k * 4, 52), fill=col)
        big = img.resize((300, 300), Image.NEAREST)
        big.save(os.path.join(OUT, f"spin_{style}-icon.png"))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (("sword", sword), ("hammer", hammer), ("scythe", scythe), ("pumpkin", pumpkin), ("trident", trident), ("crystal", crystal), ("club", club), ("shovel", shovel), ("pitchfork", pitchfork), ("flower", flower), ("rainbow", rainbow), ("butterfly", butterfly), ("sun", sun), ("pickaxe", pickaxe), ("mace", mace), ("spear", spear), ("orb", orb), ("frost", frost), ("flame", flame), ("dragon", dragon), ("thunder", thunder)):
        art = fn().render()
        art.resize((W * SCALE, H * SCALE), Image.NEAREST).save(os.path.join(OUT, name + ".png"))
        icon_from(art).save(os.path.join(OUT, name + "-icon.png"))
    spin_icons()
    hand = Image.open(os.path.join(OUT, "..", "img", "hand.png")).convert("RGBA")
    fit_square(hand).save(os.path.join(OUT, "skeleton-icon.png"))


if __name__ == "__main__":
    main()
