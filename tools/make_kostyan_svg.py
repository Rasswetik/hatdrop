"""Генерирует анимированные SVG-баннеры лавки Костяна (запасные, пока нет PNG в img/).
Запуск: python3 tools/make_kostyan_svg.py"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "static", "quests")
INK = "#160e2c"


def skeleton(hat=False):
    hat_svg = ""
    if hat:
        hat_svg = f'''<ellipse cx="200" cy="93" rx="38" ry="7" fill="#e9c46a" stroke="{INK}" stroke-width="3"/>
        <path d="M178 93c0-22 8-30 22-30s22 8 22 30z" fill="#f2d98a" stroke="{INK}" stroke-width="3"/>
        <rect x="178" y="85" width="44" height="7" fill="#c0392b" stroke="{INK}" stroke-width="2"/>'''
    return f'''
  <g id="kostyan">
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1.8s" repeatCount="indefinite"/>
    <!-- туловище -->
    <ellipse cx="200" cy="168" rx="26" ry="30" fill="#f5f3ef" stroke="{INK}" stroke-width="3"/>
    <path d="M178 156h44M180 168h40M182 180h36" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>
    <rect x="197" y="140" width="6" height="60" fill="{INK}" opacity=".25"/>
    <!-- левая рука на прилавке -->
    <path d="M176 150c-18 6-30 20-34 40" stroke="{INK}" stroke-width="12" stroke-linecap="round" fill="none"/>
    <path d="M176 150c-18 6-30 20-34 40" stroke="#f5f3ef" stroke-width="6" stroke-linecap="round" fill="none"/>
    <circle cx="142" cy="192" r="7" fill="#f5f3ef" stroke="{INK}" stroke-width="3"/>
    <!-- правая рука машет -->
    <g>
      <animateTransform attributeName="transform" type="rotate" values="0 224 150;-22 224 150;6 224 150;-22 224 150;0 224 150" dur="1.6s" repeatCount="indefinite"/>
      <path d="M224 150c20-6 34-24 38-52" stroke="{INK}" stroke-width="12" stroke-linecap="round" fill="none"/>
      <path d="M224 150c20-6 34-24 38-52" stroke="#f5f3ef" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="263" cy="94" r="8" fill="#f5f3ef" stroke="{INK}" stroke-width="3"/>
      <path d="M260 88l-2-9M264 87l0-10M268 89l3-8" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>
    </g>
    <!-- голова -->
    <g>
      <animateTransform attributeName="transform" type="rotate" values="-2 200 120;2 200 120;-2 200 120" dur="2.6s" repeatCount="indefinite"/>
      <rect x="176" y="92" width="48" height="42" rx="20" fill="#f5f3ef" stroke="{INK}" stroke-width="3"/>
      <rect x="184" y="126" width="32" height="14" rx="3" fill="#f5f3ef" stroke="{INK}" stroke-width="3"/>
      <path d="M192 128v10M200 128v10M208 128v10" stroke="{INK}" stroke-width="2"/>
      <rect x="181" y="103" width="17" height="11" rx="2" fill="#0b0716" stroke="#000" stroke-width="2"/>
      <rect x="202" y="103" width="17" height="11" rx="2" fill="#0b0716" stroke="#000" stroke-width="2"/>
      <rect x="197" y="106" width="6" height="3" fill="#0b0716"/>
      <rect x="184" y="105" width="5" height="2" fill="#7fd1ff"><animate attributeName="opacity" values="1;.2;1" dur="3s" repeatCount="indefinite"/></rect>
      <path d="M200 116l-3 6h6z" fill="{INK}"/>
      {hat_svg}
    </g>
  </g>'''


def counter(goods):
    return f'''
  <rect x="86" y="196" width="228" height="12" fill="#a8713c" stroke="{INK}" stroke-width="3"/>
  <rect x="92" y="208" width="216" height="46" fill="#7b512d" stroke="{INK}" stroke-width="3"/>
  <path d="M120 208v46M160 208v46M200 208v46M240 208v46M280 208v46" stroke="{INK}" stroke-width="2" opacity=".5"/>
  {goods}'''


GOODS = f'''
  <g>
    <rect x="224" y="168" width="6" height="28" fill="#b5763a" stroke="{INK}" stroke-width="2"/>
    <rect x="217" y="160" width="20" height="12" fill="#aab3c6" stroke="{INK}" stroke-width="2"/>
    <rect x="262" y="176" width="14" height="20" rx="3" fill="#e63e5a" stroke="{INK}" stroke-width="2"/><rect x="265" y="170" width="8" height="6" fill="#d9a066" stroke="{INK}" stroke-width="2"/>
    <rect x="282" y="180" width="12" height="16" rx="3" fill="#4fc3f7" stroke="{INK}" stroke-width="2"/><rect x="284" y="175" width="8" height="5" fill="#d9a066" stroke="{INK}" stroke-width="2"/>
    <ellipse cx="108" cy="192" rx="12" ry="4" fill="#ffc83d" stroke="{INK}" stroke-width="2"/><ellipse cx="108" cy="187" rx="12" ry="4" fill="#ffd95e" stroke="{INK}" stroke-width="2"/>
    <rect x="120" y="170" width="6" height="26" fill="#b5763a" stroke="{INK}" stroke-width="2"/><rect x="113" y="163" width="20" height="12" fill="#8a94ad" stroke="{INK}" stroke-width="2"/>
  </g>'''


def sign(text_fill, board, edge):
    return f'''
  <g>
    <animateTransform attributeName="transform" type="rotate" values="-0.6 200 8;0.6 200 8;-0.6 200 8" dur="4s" repeatCount="indefinite"/>
    <path d="M120 4v10M280 4v10" stroke="{INK}" stroke-width="3"/>
    <rect x="70" y="12" width="260" height="38" rx="3" fill="{board}" stroke="{edge}" stroke-width="4"/>
    <text x="200" y="39" text-anchor="middle" font-family="'Courier New',monospace" font-weight="900" font-size="23" letter-spacing="2" fill="{text_fill}" stroke="{INK}" stroke-width="1.2" paint-order="stroke">ЛАВКА КОСТЯНА</text>
  </g>'''


def awning(c1, c2):
    stripes = "".join(f'<rect x="{70 + i * 26}" y="54" width="26" height="24" fill="{c1 if i % 2 == 0 else c2}" stroke="{INK}" stroke-width="2"/>' for i in range(10))
    scal = "".join(f'<path d="M{70 + i * 26} 78a13 9 0 0 0 26 0z" fill="{c1 if i % 2 == 0 else c2}" stroke="{INK}" stroke-width="2"/>' for i in range(10))
    return f'''
  <rect x="78" y="76" width="8" height="180" fill="#7b512d" stroke="{INK}" stroke-width="3"/>
  <rect x="314" y="76" width="8" height="180" fill="#7b512d" stroke="{INK}" stroke-width="3"/>
  {stripes}{scal}'''


def pumpkin(x, y, s, delay):
    return f'''
  <g transform="translate({x} {y}) scale({s})">
    <ellipse cx="0" cy="0" rx="22" ry="18" fill="#ff8a1f" stroke="{INK}" stroke-width="3"/>
    <path d="M-8 -16c-6 8-6 24 0 32M8 -16c6 8 6 24 0 32" stroke="#c4560e" stroke-width="3" fill="none"/>
    <rect x="-3" y="-24" width="6" height="9" fill="#5aa02c" stroke="{INK}" stroke-width="2"/>
    <g fill="#ffe066"><animate attributeName="opacity" values="1;.55;1;.8;1" dur="{2 + delay}s" repeatCount="indefinite"/>
      <path d="M-13 -4l7 0l-3.5 -7z"/><path d="M6 -4l7 0l-3.5 -7z"/><path d="M-11 6l4 4l4-3l4 3l4-3l4 3l3-4z"/></g>
  </g>'''


def halloween():
    bats = "".join(f'''<g><animateTransform attributeName="transform" type="translate" values="-30 {y};430 {y + 14}" dur="{d}s" begin="{b}s" repeatCount="indefinite"/>
      <path d="M0 0l6-5l5 4l5-4l6 5l-6-2l-5 5l-5-5z" fill="{INK}"><animateTransform attributeName="transform" type="scale" values="1 1;1 .55;1 1" dur=".35s" repeatCount="indefinite"/></path></g>''' for y, d, b in ((40, 9, 0), (70, 12, 3), (24, 15, 6)))
    stars = "".join(f'<rect x="{x}" y="{y}" width="2" height="2" fill="#fff"><animate attributeName="opacity" values="1;.2;1" dur="{2 + i % 3}s" repeatCount="indefinite"/></rect>'
                    for i, (x, y) in enumerate([(20, 20), (60, 70), (350, 30), (380, 90), (30, 120), (370, 140), (300, 15)]))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 264" shape-rendering="geometricPrecision">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#150b2e"/><stop offset="1" stop-color="#4a2466"/></linearGradient>
  <radialGradient id="moon"><stop offset="0" stop-color="#fff7d6"/><stop offset="1" stop-color="#f3d98b"/></radialGradient></defs>
  <rect width="400" height="264" fill="url(#sky)"/>{stars}
  <circle cx="338" cy="62" r="30" fill="url(#moon)" opacity=".95"><animate attributeName="opacity" values=".95;.8;.95" dur="5s" repeatCount="indefinite"/></circle>
  <path d="M0 214c40-26 80-6 120-16s90-26 140-8 90 4 140-6v80H0z" fill="#2a1646"/>
  <rect x="0" y="236" width="400" height="28" fill="#1d0f33"/>
  {bats}
  {sign("#ffd28d", "#4a2b17", "#2a170c")}
  {awning("#ff8a1f", "#6b2fa0")}
  <g>
    <animateTransform attributeName="transform" type="rotate" values="-6 130 78;6 130 78;-6 130 78" dur="3s" repeatCount="indefinite"/>
    <path d="M130 78v16" stroke="{INK}" stroke-width="2"/>
    <rect x="122" y="94" width="16" height="20" rx="3" fill="#ffd95e" stroke="{INK}" stroke-width="2"><animate attributeName="fill" values="#ffd95e;#ffb347;#ffd95e" dur="1.4s" repeatCount="indefinite"/></rect>
  </g>
  {skeleton()}
  {counter(GOODS)}
  {pumpkin(48, 236, 1.0, 0)}{pumpkin(354, 240, 1.15, 1)}{pumpkin(26, 250, .7, 2)}
</svg>'''


def meadow():
    clouds = "".join(f'''<g><animateTransform attributeName="transform" type="translate" values="-90 0;450 0" dur="{d}s" begin="-{b}s" repeatCount="indefinite"/>
      <g fill="#fff" stroke="#bcd3e6" stroke-width="2" transform="translate(0 {y})"><ellipse cx="0" cy="0" rx="26" ry="10"/><ellipse cx="-14" cy="-6" rx="14" ry="9"/><ellipse cx="12" cy="-8" rx="16" ry="10"/></g></g>''' for y, d, b in ((60, 40, 5), (96, 55, 30), (34, 70, 12)))
    flowers = "".join(f'<g transform="translate({x} {y})"><rect x="-1" y="0" width="2" height="9" fill="#3b7a1c"/><circle cx="0" cy="-1" r="4" fill="{c}" stroke="{INK}" stroke-width="1.5"/><circle cx="0" cy="-1" r="1.5" fill="#ffe066"/></g>'
                      for x, y, c in [(22, 246, "#ff6b9d"), (46, 252, "#fff"), (66, 244, "#ffd95e"), (336, 248, "#ff6b9d"), (358, 244, "#fff"), (380, 252, "#c77dff")])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 264" shape-rendering="geometricPrecision">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#72c2f0"/><stop offset="1" stop-color="#cdeeff"/></linearGradient></defs>
  <rect width="400" height="264" fill="url(#sky)"/>
  <g><circle cx="342" cy="58" r="26" fill="#ffe066" stroke="#ffb300" stroke-width="3"><animate attributeName="r" values="26;28;26" dur="4s" repeatCount="indefinite"/></circle></g>
  {clouds}
  <path d="M0 200c50-34 100-14 150-22s110-30 160-6 60 10 90 2v90H0z" fill="#79c24a" stroke="#4f9a2c" stroke-width="2"/>
  <rect x="0" y="232" width="400" height="32" fill="#5fae2e"/>
  <path d="M0 246h400" stroke="#4a8f26" stroke-width="2" stroke-dasharray="6 8"/>
  {sign("#fff1d0", "#986438", "#382315")}
  {awning("#e63946", "#fff8e7")}
  {skeleton(hat=True)}
  {counter(GOODS)}
  {flowers}
  <g transform="translate(54 224)"><rect x="-20" y="0" width="40" height="22" fill="#b5763a" stroke="{INK}" stroke-width="3"/><circle cx="-8" cy="-2" r="7" fill="#e63946" stroke="{INK}" stroke-width="2"/><circle cx="6" cy="-3" r="7" fill="#ff8a1f" stroke="{INK}" stroke-width="2"/></g>
</svg>'''


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "kostyan-shop-halloween.svg"), "w", encoding="utf-8").write(halloween())
    open(os.path.join(OUT, "kostyan-shop-meadow.svg"), "w", encoding="utf-8").write(meadow())
