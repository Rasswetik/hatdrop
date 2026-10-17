/* Optional Halloween background PNGs.
   Upload: static/halloween/day.png and static/halloween/night.png
   Missing PNGs retain the built-in SVG scene. Never block UI rendering. */
(() => {
  'use strict';
  const root = document.documentElement;
  const day = document.getElementById('halloweenDayPng');
  const night = document.getElementById('halloweenNightPng');
  if (!day || !night) return;
  const images = { day, night };
  const available = { day: false, night: false };

  let lastSky = root.dataset.sky, duskTimer = 0;
  function sync() {
    if (root.dataset.sky !== lastSky) {
      lastSky = root.dataset.sky;
      if (root.dataset.halloween === 'on' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        root.classList.remove('hw-dusk'); void root.offsetWidth; root.classList.add('hw-dusk');
        clearTimeout(duskTimer); duskTimer = setTimeout(() => root.classList.remove('hw-dusk'), 3800);
      }
    }
    const sky = root.dataset.sky === 'night' ? 'night' : 'day';
    const usePng = root.dataset.halloween === 'on' && available[sky];
    root.dataset.halloweenArt = usePng ? 'png' : 'svg';
    // Both images stay preloaded. CSS handles the day/night cross-fade.
  }

  function preload(which) {
    const probe = new Image();
    let url = '/static/halloween/' + which + '.svg?v=2';  // анимированная пиксельная сцена
    probe.decoding = 'async';
    let retried = false;
    probe.onload = () => {
      available[which] = true;
      images[which].src = url;
      images[which].dataset.loaded = 'true';
      sync();
    };
    probe.onerror = () => {
      if (!retried) { retried = true; url = '/static/halloween/' + which + '.png'; probe.src = url; return; }
      available[which] = false;
      images[which].dataset.loaded = 'false';
      sync();
    };
    probe.src = url;
  }

  root.dataset.halloweenArt = 'svg';
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-sky','data-halloween'] });
  preload('day');
  preload('night');
  sync();
})();
