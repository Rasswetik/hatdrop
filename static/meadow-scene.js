(() => {
  'use strict';
  const world = document.getElementById('meadowWorld');
  if (!world) return;
  const fx = world.querySelector('.ms-fx');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const put = (cls, x, y, style = {}) => {
    const e = document.createElement('i');
    e.className = cls; e.style.left = x + '%'; e.style.top = y + '%';
    Object.assign(e.style, style);
    fx.appendChild(e);
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
    const b = put('ms-bfly', x, y, { '--c': colors[i], animationDuration: (20 + i * 5) + 's', animationDelay: (-i * 7) + 's' });
    b.append(document.createElement('i'), document.createElement('i'));
  });
  for (let i = 0; i < 14; i++) put('ms-pollen', rnd(2, 85), rnd(38, 90), { animationDelay: rnd(-14, 0) + 's', animationDuration: rnd(10, 18) + 's' });
  // ночь
  for (let i = 0; i < 18; i++) put('ms-firefly ms-night', rnd(4, 94), rnd(52, 92), { animationDelay: rnd(0, 6) + 's', animationDuration: rnd(4.5, 8) + 's' });
  for (let i = 0; i < 16; i++) put('ms-star ms-night', rnd(30, 97), rnd(1.5, 21), { animationDelay: rnd(0, 3) + 's', animationDuration: rnd(1.8, 4) + 's' });
  put('ms-lamp ms-night', 95.1, 33.6);
  for (const [x, y] of [[90, 23.1], [90.2, 34.2], [70.4, 33.2], [70.5, 38.1]]) put('ms-win', x, y, { animationDelay: rnd(0, 3) + 's' });
  // закат / рассвет при переключении неба
  const scene = document.getElementById('meadowScene');
  const root = document.documentElement;
  let last = root.dataset.sky, timer = 0;
  new MutationObserver(() => {
    const now = root.dataset.sky;
    if (now === last) return; last = now;
    if (root.dataset.halloween === 'on' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    scene.classList.remove('ms-to-night', 'ms-to-day'); void scene.offsetWidth;
    scene.classList.add(now === 'night' ? 'ms-to-night' : 'ms-to-day');
    clearTimeout(timer); timer = setTimeout(() => scene.classList.remove('ms-to-night', 'ms-to-day'), 4400);
  }).observe(root, { attributes: true, attributeFilter: ['data-sky'] });
})();
