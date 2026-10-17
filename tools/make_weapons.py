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


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (("sword", sword), ("hammer", hammer), ("scythe", scythe), ("pumpkin", pumpkin), ("trident", trident), ("crystal", crystal), ("club", club)):
        art = fn().render()
        art.resize((W * SCALE, H * SCALE), Image.NEAREST).save(os.path.join(OUT, name + ".png"))
        icon_from(art).save(os.path.join(OUT, name + "-icon.png"))
    hand = Image.open(os.path.join(OUT, "..", "img", "hand.png")).convert("RGBA")
    fit_square(hand).save(os.path.join(OUT, "skeleton-icon.png"))


if __name__ == "__main__":
    main()
