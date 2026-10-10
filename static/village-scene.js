(() => {
  'use strict';
  const root = document.documentElement;
  const scene = document.getElementById('villageScene');
  if (!scene) return;
  const dusk = scene.querySelector('.v-dusk');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let duskAnimation = null;

  function setSky(mode, instant = false) {
    const sky = mode === 'night' ? 'night' : 'day';
    const changed = root.dataset.sky !== sky;
    scene.classList.toggle('scene-instant', instant || motion.matches);
    root.dataset.sky = sky;
    const button = document.getElementById('skyBtn');
    if (button) button.setAttribute('aria-pressed', String(sky === 'night'));
    if (changed && !instant && !motion.matches) {
      // Restart sunset/sunrise without forcing a layout read.
      dusk.classList.remove('to-night', 'to-day');
      if (duskAnimation) duskAnimation.cancel();
      if (dusk.animate) {
        duskAnimation = dusk.animate([{ opacity: 0 }, { opacity: .85, offset: .5 }, { opacity: 0 }], { duration: 3000, easing: 'ease-in-out' });
      } else {
        dusk.classList.add(sky === 'night' ? 'to-night' : 'to-day');
      }
    }
  }

  function pauseScene() {
    const appActive = window.Telegram?.WebApp?.isActive !== false;
    const paused = document.hidden || !appActive;
    scene.classList.toggle('scene-paused', paused);
    if (duskAnimation?.playState === 'running' && paused) duskAnimation.pause();
    else if (duskAnimation?.playState === 'paused' && !paused) duskAnimation.play();
  }
  window.setSky = mode => setSky(mode);
  // The old alignment hook is used when returning to upgrades; the SVG needs no measurements.
  window.alignBg = () => {};
  let sky = 'day';
  try { sky = localStorage.getItem('sky') || 'day'; } catch {}
  setSky(sky, true);
  document.addEventListener('visibilitychange', pauseScene);
  window.Telegram?.WebApp?.onEvent?.('activated', pauseScene);
  window.Telegram?.WebApp?.onEvent?.('deactivated', pauseScene);
  motion.addEventListener?.('change', () => setSky(root.dataset.sky, true));
  pauseScene();
})();
