/* Анимированный пиксельный фон «Поляна».

   Сцена рисуется кодом на маленьком холсте (120 точек в ширину) и
   растягивается на экран без сглаживания — отсюда пиксели. Двигаются:
   облака, мельница, дым из трубы, крона дерева, цветы, бабочки, фонарь.

   Поверх нарисованной сцены лежит картинка поляны — дневная или ночная
   (assets/bg-day.webp, bg-night.webp), а поверх неё летают бабочки и пыльца
   (ночью — светлячки). Если картинки нет, видна нарисованная сцена.
   Фон лежит в .bg-wide и занимает всё окно, а не только колонку приложения.

   Рисуем ~12 кадров в секунду и только пока вкладка видна. */
(function () {
  'use strict';

  const cv = document.getElementById('bgScene');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  const W = 120;
  let H = 213;
  let overlayOnly = false;      // есть своя картинка — рисуем только облака и бабочек
  let stopped = false;          // есть видео — холст не нужен

  // Повторяемый «случайный» ряд: сцена одинаковая при каждом открытии
  function rnd(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  const r0 = rnd(7);
  const clouds = Array.from({ length: 5 }, (_, i) => ({
    x: r0() * (W + 40), y: 6 + i * 9 + r0() * 6, w: 16 + r0() * 16, sp: 0.6 + r0() * 1.1,
  }));
  const flowers = Array.from({ length: 34 }, () => ({
    x: r0(), y: r0(), c: ['#ffd23f', '#ff6b8a', '#ffffff', '#b98bff', '#ff9a3c'][(r0() * 5) | 0], ph: r0() * 6,
  }));
  const tufts = Array.from({ length: 46 }, () => ({ x: r0(), y: r0() }));
  const flies = Array.from({ length: 4 }, (_, i) => ({
    ax: 0.2 + r0() * 0.6, ay: 0.55 + r0() * 0.3, rx: 10 + r0() * 14, ry: 5 + r0() * 8,
    sp: 0.25 + r0() * 0.3, ph: r0() * 6, c: ['#ffe08a', '#ff9ac1', '#c9f0ff', '#ffffff'][i],
  }));

  const pollen = Array.from({ length: 22 }, (_, i) => ({
    x: r0(), y: r0(), sp: 0.05 + r0() * 0.07, ph: r0(), c: i % 4 === 0 ? '#ffc6dc' : i % 4 === 1 ? '#ffffff' : '#fff3b0',
  }));

  // Холст вдвое подробнее сцены: сцена рисуется с увеличением в FINE раз (вид
  // прежний), а пыльца и бабочки поверх картинки — точками в полразмера.
  const FINE = 2;
  let fine = 1;

  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

  function disc(cx, cy, r, c) {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      px(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  }

  function line(x0, y0, x1, y1, c, t) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0 || 1;
    for (let i = 0; i <= n; i++) px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, t || 1, t || 1, c);
  }

  function cloud(c) {
    const x = c.x - 20, y = c.y, w = c.w;
    px(x + 2, y + 3, w - 4, 4, '#ffffff');
    px(x, y + 5, w, 3, '#ffffff');
    px(x + 5, y + 1, w * 0.35, 3, '#ffffff');
    px(x + w * 0.5, y, w * 0.3, 4, '#ffffff');
    px(x + 1, y + 8, w - 2, 1, '#cfe9ff');
  }

  function drawSky() {
    const hz = Math.round(H * 0.44);
    const bands = ['#2f8fe8', '#3d9bee', '#4ea8f2', '#63b6f5', '#7cc5f8', '#98d4fa', '#b6e2fc', '#d3effd'];
    const bh = Math.ceil(hz / bands.length);
    bands.forEach((c, i) => px(0, i * bh, W, bh + 1, c));
    return hz;
  }

  function drawFar(hz) {
    // Горы со снегом
    for (let x = 0; x < W; x++) {
      const h = 16 + Math.abs(Math.sin(x * 0.075 + 1.2)) * 20 + Math.sin(x * 0.31) * 2;
      px(x, hz - h, 1, h, '#7fa8d6');
      if (h > 26) px(x, hz - h, 1, Math.min(5, h - 26) + 1, '#f4fbff');
    }
    for (let x = 0; x < W; x++) {
      const h = 9 + Math.abs(Math.sin(x * 0.11 + 4)) * 12;
      px(x, hz - h, 1, h, '#5f95c4');
    }
    // Дальний лес и холмы
    for (let x = 0; x < W; x++) {
      const h = 5 + Math.sin(x * 0.09 + 2) * 3 + (x % 3 === 0 ? 2 : 0);
      px(x, hz - h, 1, h + 1, '#3f8f4a');
    }
  }

  function drawMeadow(hz, t) {
    const greens = ['#7fd14f', '#73c846', '#67be3e', '#5cb437', '#52aa31', '#49a02c'];
    const gh = Math.ceil((H - hz) / greens.length);
    greens.forEach((c, i) => px(0, hz + i * gh, W, gh + 1, c));
    // Холм за поляной
    for (let x = 0; x < W; x++) {
      const h = 4 + Math.sin(x * 0.05 + 0.5) * 3;
      px(x, hz - h, 1, h + 1, '#6cc24a');
    }
    // Речка с мостиком
    const ry = hz + Math.round((H - hz) * 0.1);
    for (let x = 22; x < 62; x++) {
      const y = ry + Math.round(Math.sin(x * 0.2) * 1.5);
      px(x, y, 1, 3, '#4fb7ee');
      if ((x + ((t * 6) | 0)) % 5 === 0) px(x, y + 1, 1, 1, '#d8f4ff');
    }
    px(36, ry - 2, 14, 2, '#8a8f9c'); px(38, ry - 3, 10, 1, '#a7acb8');
    px(37, ry, 2, 3, '#6d7280'); px(47, ry, 2, 3, '#6d7280');
    // Тропинка: от низа экрана уходит к дому
    for (let y = hz + 14; y < H; y++) {
      const k = (y - hz) / (H - hz);
      const cx = W * 0.5 + Math.sin(k * 3.1) * 16 - k * 8;
      const w = 5 + k * 22;
      px(cx - w / 2, y, w, 1, '#d9b877');
      px(cx - w / 2, y, 1, 1, '#b8955a'); px(cx + w / 2 - 1, y, 1, 1, '#b8955a');
      if (y % 7 === 0) px(cx - w / 4, y, 2, 1, '#c4a368');
    }
    for (const g of tufts) {
      const x = g.x * W, y = hz + 10 + g.y * (H - hz - 12);
      px(x, y, 1, 2, '#3d8f2a'); px(x + 1, y + 1, 1, 1, '#3d8f2a');
    }
  }

  function drawMill(hz, t) {
    const x = Math.round(W * 0.77), base = hz + 3;
    for (let i = 0; i < 16; i++) px(x - 2 - i * 0.15, base - 16 + i, 5 + i * 0.3, 1, i % 4 === 3 ? '#b98a55' : '#d6a66a');
    px(x - 3, base - 19, 7, 3, '#b0432f'); px(x - 2, base - 21, 5, 2, '#c9553d');
    px(x - 1, base - 6, 2, 4, '#5a3a1e');
    const cx = x, cy = base - 16, a = t * 0.9;
    for (let k = 0; k < 4; k++) {
      const ang = a + k * Math.PI / 2;
      const ex = cx + Math.cos(ang) * 10, ey = cy + Math.sin(ang) * 10;
      line(cx, cy, ex, ey, '#f3e3c0', 1);
      line(cx + Math.cos(ang + 0.25) * 4, cy + Math.sin(ang + 0.25) * 4,
        cx + Math.cos(ang + 0.14) * 10, cy + Math.sin(ang + 0.14) * 10, '#e2cf9f', 1);
    }
    px(cx - 1, cy - 1, 2, 2, '#5a3a1e');
  }

  function drawHouse(hz, t) {
    const x = Math.round(W * 0.76), y = hz + Math.round((H - hz) * 0.2);
    px(x, y, 30, 15, '#ead9b0'); px(x, y + 13, 30, 2, '#cdb98a');
    for (let i = 0; i < 9; i++) px(x - 3 + i, y - 1 - i, 36 - i * 2, 1, i % 2 ? '#c9452f' : '#e0573d');
    px(x + 20, y - 12, 4, 7, '#a8674a'); px(x + 19, y - 13, 6, 1, '#7d4a33');
    px(x + 5, y + 5, 6, 6, '#7ec8ff'); px(x + 7, y + 5, 1, 6, '#5a3a1e'); px(x + 5, y + 7, 6, 1, '#5a3a1e');
    px(x + 17, y + 5, 6, 10, '#7a4a26'); px(x + 21, y + 10, 1, 1, '#ffd23f');
    // Дым
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.35 + i / 4) % 1;
      const sx = x + 21 + Math.sin(k * 5 + i) * 3, sy = y - 14 - k * 22;
      const s = 2 + Math.round(k * 3);
      if (k < 0.92) px(sx, sy, s, s, k > 0.6 ? '#e9f3fb' : '#ffffff');
    }
    // Подсолнухи у стены
    for (let i = 0; i < 3; i++) {
      const fx = x - 6 + i * 4, sw = Math.round(Math.sin(t * 1.4 + i) * 0.6);
      px(fx, y + 6, 1, 9, '#3d8f2a'); px(fx - 1 + sw, y + 3, 3, 3, '#ffd23f'); px(fx + sw, y + 4, 1, 1, '#7a4a26');
    }
  }

  function drawFence(hz) {
    const y = hz + Math.round((H - hz) * 0.36);
    for (let x = 0; x < W; x += 9) {
      if (x > W * 0.4 && x < W * 0.62) continue;        // калитка — там тропинка
      px(x, y, 9, 1, '#a8713c'); px(x, y + 4, 9, 1, '#a8713c');
      px(x + 3, y - 3, 2, 11, '#c08a4d'); px(x + 3, y - 3, 2, 1, '#e0ab68');
    }
  }

  function drawTree(hz, t) {
    const sway = Math.round(Math.sin(t * 0.8) * 1);
    const gx = 4, base = hz + Math.round((H - hz) * 0.46);
    px(gx + 2, hz - 30, 9, base - hz + 30, '#7a4a26'); px(gx + 2, hz - 30, 2, base - hz + 30, '#5c3519');
    px(gx + 9, hz - 30, 2, base - hz + 30, '#93603a');
    px(gx - 1, base - 3, 15, 3, '#5c3519');
    const blobs = [[10, -44, 20], [26, -52, 16], [-2, -56, 16], [14, -66, 18], [32, -36, 12], [-4, -34, 12]];
    for (const [bx, by, r] of blobs) disc(gx + bx + sway, hz + by, r, '#2f8a2f');
    for (const [bx, by, r] of blobs) disc(gx + bx - 2 + sway, hz + by - 3, r - 4, '#46a83a');
    for (const [bx, by, r] of blobs) disc(gx + bx - 5 + sway, hz + by - 6, Math.max(2, r - 10), '#6cc84a');
    // Столб с фонарём
    const lx = 16, ly = hz + Math.round((H - hz) * 0.12);
    px(lx, ly - 4, 2, 34, '#6b4424'); px(lx, ly - 4, 12, 2, '#6b4424');
    px(lx + 9, ly - 2, 1, 4, '#3a2a1a');
    const glow = (Math.sin(t * 5) > 0.2) ? '#ffe9a0' : '#ffd66b';
    px(lx + 7, ly + 2, 5, 6, '#3a2a1a'); px(lx + 8, ly + 3, 3, 4, glow);
  }

  function drawFlowers(hz, t) {
    for (const f of flowers) {
      const y = hz + (H - hz) * (0.42 + f.y * 0.56);
      const x = f.x * W + Math.round(Math.sin(t * 1.6 + f.ph) * 0.7);
      px(f.x * W, y + 1, 1, 3, '#2f7d22');
      px(x - 1, y, 3, 1, f.c); px(x, y - 1, 1, 3, f.c); px(x, y, 1, 1, '#ffb300');
    }
  }

  function drawFlies(t) {
    for (const b of flies) {
      const x = (b.ax * W + Math.sin(t * b.sp + b.ph) * b.rx) * fine;
      const y = (b.ay * H + Math.sin(t * b.sp * 1.7 + b.ph) * b.ry) * fine;
      const open = Math.sin(t * 9 + b.ph) > 0;
      px(x, y, 1, 1, '#3a2a1a');
      if (open) { px(x - 1, y - 1, 1, 2, b.c); px(x + 1, y - 1, 1, 2, b.c); } else px(x, y - 1, 1, 1, b.c);
    }
  }

  function drawPollen(t) {
    for (const p of pollen) {
      const k = (t * p.sp + p.ph) % 1;
      const x = ((p.x * W + k * 26 + Math.sin(t * 1.3 + p.ph * 9) * 3) % W) * fine;
      const y = (H * (0.34 + p.y * 0.6) - k * 14 + Math.sin(t * 0.9 + p.ph * 5) * 2) * fine;
      // появляется и гаснет плавно: в середине пути ярче
      ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9;
      px(x, y, 1, 1, p.c);
      ctx.globalAlpha = 1;
    }
  }

  function draw(ms) {
    const t = ms / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    // Поверх картинки: ночью ничего не летает, днём — пыльца и бабочки
    // вдвое мельче (точка холста = полточки сцены, см. FINE).
    fine = overlayOnly ? FINE : 1;
    if (overlayOnly && document.documentElement.dataset.sky === 'night') return;
    if (!overlayOnly) ctx.setTransform(FINE, 0, 0, FINE, 0, 0);     // сама сцена — в прежнем масштабе
    let hz = Math.round(H * 0.44);
    if (!overlayOnly) {
      hz = drawSky();
    }
    if (overlayOnly) {
      // Поверх своей картинки плоские облака смотрятся чужими — вместо них
      // по поляне летит пыльца и лепестки
      drawPollen(t);
    } else {
      for (const c of clouds) {
        c.x = (c.x + c.sp * 0.06) % (W + 60);
        cloud(c);
      }
    }
    if (!overlayOnly) {
      drawFar(hz);
      drawMeadow(hz, t);
      drawMill(hz, t);
      drawHouse(hz, t);
      drawFence(hz);
      drawTree(hz, t);
      drawFlowers(hz, t);
    }
    drawFlies(t);
  }

  function resize() {
    const box = cv.parentElement.getBoundingClientRect();
    const ratio = box.width > 0 ? box.height / box.width : 16 / 9;
    H = Math.max(160, Math.min(320, Math.round(W * ratio)));
    cv.width = W * FINE;
    cv.height = H * FINE;
    ctx.imageSmoothingEnabled = false;
    draw(performance.now());
  }

  let last = 0;
  function loop(ms) {
    if (stopped) return;
    // в старом дизайне холст скрыт — не рисуем зря
    if (!document.hidden && ms - last > 80 && document.documentElement.dataset.theme === 'meadow') { last = ms; draw(ms); }
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(loop);

  /* Подгонка своей картинки под колесо апгрейда. На ней нарисован пенёк, и
     приз в центре колеса должен парить над ним — на любом телефоне. Поэтому
     картинку ставим не «по центру экрана», а так, чтобы верх пенька
     (BG_ANCHOR, в долях картинки) оказался чуть ниже центра колеса. Если
     для этого картинки не хватает по высоте — немного увеличиваем её.
     Другая картинка с пеньком в другом месте — поменять BG_ANCHOR. */
  // Где на картинке верх пенька (в долях ширины и высоты). У широкой сцены
  // (bg-wide.webp — первый кадр bg.mp4, 1920x1080) и у старой вертикальной
  // картинки пенёк в разных местах.
  const ANCHOR_WIDE = { x: 0.492, y: 0.561 };
  const ANCHOR_TALL = { x: 0.493, y: 0.515 };
  let photoAnchor = ANCHOR_TALL;
  const BG_BELOW_CENTER = 0.2;        // на сколько диаметров колеса пенёк ниже его центра
  let anchorY = 0;                    // куда на экране ставить пенёк; 0 — ещё не знаем

  function alignBg() {
    const stage = cv.parentElement.getBoundingClientRect();
    const wheel = document.querySelector('#view-upgrade .wheel-wrap');
    if (wheel) {
      const r = wheel.getBoundingClientRect();
      // колесо на скрытой вкладке или на уезжающей — размеры не те, берём прошлые
      if (r.width > 0 && Math.abs(r.left + r.width / 2 - (stage.left + stage.width / 2)) < 4) {
        anchorY = r.top + r.height / 2 - stage.top + r.height * BG_BELOW_CENTER;
      }
    }
    if (!anchorY || !stage.width) return;
    window.bgAnchorY = anchorY;         // верх пенька на экране — по нему встают и «Три шляпы»
    for (const el of [document.getElementById('bgPhoto'), document.getElementById('bgVideo')]) {
      if (!el || el.hidden) continue;
      const iw = el.naturalWidth || el.videoWidth, ih = el.naturalHeight || el.videoHeight;
      if (!iw || !ih) continue;
      const A = photoAnchor;
      // Фон закрывает всё окно, а не только колонку приложения: на телефоне
      // видна середина сцены вокруг пенька, на широком экране — вся сцена.
      let h = Math.max(stage.width / iw * ih, anchorY / A.y, (stage.height - anchorY) / (1 - A.y));
      let w = h / ih * iw;
      const left = Math.min(0, Math.max(stage.width - w, stage.width / 2 - w * A.x));
      const top = Math.min(0, Math.max(stage.height - h, anchorY - h * A.y));
      el.style.cssText = `inset:auto;left:${left}px;top:${top}px;width:${w}px;height:${h}px;max-width:none`;
    }
    window.dispatchEvent(new Event('bgaligned'));
  }
  window.alignBg = alignBg;
  window.addEventListener('resize', alignBg);
  window.addEventListener('load', () => { alignBg(); setTimeout(alignBg, 400); setTimeout(alignBg, 1500); });

  /* Фон — неподвижная картинка той же поляны в двух видах: день и ночь
     (assets/bg-day.webp, bg-night.webp, 2000x1125). Переключает кнопка на
     экране апгрейда (app.js → window.setSky). Обе картинки подгружаются
     заранее, чтобы смена была мгновенной. Видео-фон убран: на стыке петли
     он заметно дёргался. */
  const photo = document.getElementById('bgPhoto');
  const SKY = { day: 'assets/bg-day.webp', night: 'assets/bg-night.webp' };
  function setSky(mode) {
    const sky = mode === 'night' ? 'night' : 'day';
    document.documentElement.dataset.sky = sky;
    if (!photo) return;
    photoAnchor = ANCHOR_WIDE;
    photo.onload = () => { photo.hidden = false; overlayOnly = true; alignBg(); };
    photo.src = SKY[sky];
    if (photo.complete && photo.naturalWidth) photo.onload();
  }
  window.setSky = setSky;
  let sky = 'day';
  try { sky = localStorage.getItem('sky') || 'day'; } catch (e) { /* по умолчанию день */ }
  setSky(sky);
  for (const src of Object.values(SKY)) { const pre = new Image(); pre.src = src; }
})();