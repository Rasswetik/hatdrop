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

  function sync() {
    const sky = root.dataset.sky === 'night' ? 'night' : 'day';
    const usePng = root.dataset.halloween === 'on' && available[sky];
    root.dataset.halloweenArt = usePng ? 'png' : 'svg';
    // Both images stay preloaded. CSS handles the day/night cross-fade.
  }

  function preload(which) {
    const url = '/static/halloween/' + which + '.png';
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      available[which] = true;
      images[which].src = url;
      images[which].dataset.loaded = 'true';
      sync();
    };
    probe.onerror = () => {
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
