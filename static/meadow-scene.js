(() => {
  'use strict';
  const world = document.getElementById('meadowWorld');
  if (!world) return;
  const fx = world.querySelector('.ms-fx');
  const mk = (cls) => { const d = document.createElement('div'); d.className = cls; fx.appendChild(d); return d; };
  const dayFx = mk('ms-dayfx'), nightFx = mk('ms-nightfx');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const put = (cls, x, y, style = {}, parent = fx) => {
    const e = document.createElement('i');
    e.className = cls; e.style.left = x + '%'; e.style.top = y + '%';
    Object.assign(e.style, style);
    parent.appendChild(e);
    return e;
  };
  // дым: 4 трубы
  for (const [x, y] of [[95.5, 9.4], [74.6, 25.6], [66.8, 31.6], [61.4, 33]]) {
    for (let i = 0; i < 3; i++) put('ms-smoke', x, y, { animationDelay: (i * 1.7) + 's', animationDuration: rnd(4.6, 6) + 's' });
  }
  // блики на озере
  for (let i = 0; i < 9; i++) put('ms-glint', rnd(35.5, 47), rnd(42, 45.6), { animationDelay: rnd(0, 3.2) + 's', animationDuration: rnd(2.6, 4.2) + 's' });
  // бабочки
  const colors = ['#ff8fc0', '#ffd24a', '#7fd7ff'];
  [[24, 62], [58, 70], [80, 56]].forEach(([x, y], i) => {
    const b = put('ms-bfly', x, y, { '--c': colors[i], animationDuration: (20 + i * 5) + 's', animationDelay: (-i * 7) + 's' }, dayFx);
    b.append(document.createElement('i'), document.createElement('i'));
  });
  for (let i = 0; i < 14; i++) put('ms-pollen', rnd(2, 85), rnd(38, 90), { animationDelay: rnd(-14, 0) + 's', animationDuration: rnd(10, 18) + 's' }, dayFx);
  // ночь
  for (let i = 0; i < 18; i++) put('ms-firefly', rnd(4, 94), rnd(52, 92), { animationDelay: rnd(0, 6) + 's', animationDuration: rnd(4.5, 8) + 's' }, nightFx);
  for (let i = 0; i < 16; i++) put('ms-star', rnd(30, 97), rnd(1.5, 21), { animationDelay: rnd(0, 3) + 's', animationDuration: rnd(1.8, 4) + 's' }, nightFx);
  put('ms-lamp', 95.1, 33.6, {}, nightFx);
  for (const [x, y] of [[90, 23.1], [90.2, 34.2], [70.4, 33.2], [70.5, 38.1]]) put('ms-win', x, y, { animationDelay: rnd(0, 3) + 's' }, nightFx);
  // день <-> ночь: общий прогресс 0..1, переключение в любой момент разворачивает движение с текущего места
  const scene = document.getElementById('meadowScene');
  const root = document.documentElement;
  const DURATION = 4.2;
  const still = () => root.dataset.halloween === 'on' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let p = root.dataset.sky === 'night' ? 1 : 0, raf = 0, prev = 0;
  const paint = () => {
    scene.style.setProperty('--ms-n', p.toFixed(3));
    scene.style.setProperty('--ms-day', (1 - p).toFixed(3));
    scene.style.setProperty('--ms-d', Math.max(0, Math.min(1, 1.8 * (1 - Math.abs(2 * p - 1)))).toFixed(3));
  };
  const step = (t) => {
    const target = root.dataset.sky === 'night' ? 1 : 0;
    const dt = prev ? Math.min(0.1, (t - prev) / 1000) : 0.016; prev = t;
    p += Math.sign(target - p) * Math.min(Math.abs(target - p), dt / DURATION);
    paint();
    if (p === target) { raf = 0; prev = 0; return; }
    raf = requestAnimationFrame(step);
  };
  paint();
  new MutationObserver(() => {
    const target = root.dataset.sky === 'night' ? 1 : 0;
    if (still()) { p = target; paint(); return; }
    if (!raf) { prev = 0; raf = requestAnimationFrame(step); }
  }).observe(root, { attributes: true, attributeFilter: ['data-sky'] });
})();
