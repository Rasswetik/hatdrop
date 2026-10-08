
(() => {
'use strict';

const tg = window.Telegram?.WebApp;
const $ = (id) => document.getElementById(id);


const I18N = window.I18N || { lang: 'ru', tr: (s) => s, tn: (n) => String(n), setLang() {}, langs: [] };
const tr = (key, vars) => I18N.tr(key, vars);
const tn = (n, noun, wordOnly) => I18N.tn(n, noun, wordOnly);


function onLangChange() {
  document.querySelectorAll('#langBtns .lang-btn').forEach((b) => b.classList.toggle('on', b.dataset.lang === I18N.lang));
  const content = document.querySelector('.content');
  const top = content ? content.scrollTop : 0;
  if (state) { try { renderState(state); } catch (e) { console.error('Language redraw', e); } }
  if (content) content.scrollTop = top;
}


function trName(name) {
  const s = String(name || '');
  const any = ' (любая модель)';
  if (s.endsWith(any)) return `${s.slice(0, -any.length)} (${tr('любая модель')})`;
  return tr(s);
}

const RING_R = 120;
const RING_C = 2 * Math.PI * RING_R;

let state = null;
let tonUI = null;
let spinning = false;
let pointerDeg = 0;
let modeIndex = 0;          // позиция ползунка
let modes = [];             // режимы ставки с сервера


function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try { tg.disableVerticalSwipes?.(); } catch {}
  try {
    tg.setHeaderColor?.('#0a0926');
    tg.setBackgroundColor?.('#0a0926');
  } catch {}
}

function haptic(type = 'impact', style = 'medium') {
  try {
    if (type === 'impact') tg?.HapticFeedback?.impactOccurred(style);
    else tg?.HapticFeedback?.notificationOccurred(style);
  } catch {}
}


async function api(path, body = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg?.initData || '', ...body }),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error;
    err.data = data || {};       // подробности отказа, например новая цена
    throw err;
  }
  return data;
}


const fmt = (n, d = 4) => Number(n).toFixed(d).replace(/\.?0+$/, '') || '0';
const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');


function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}



async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

let toastTimer = null;

function setBalance(ton) {
  if (!state || typeof ton !== 'number' || !Number.isFinite(ton)) return;
  state.balance_ton = Math.max(0, ton);
  $('balanceValue').textContent = fmt(state.balance_ton, 4);
}

function toast(text, isError = false, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function makeStars(n = 42) {
  const box = $('stars');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.style.left = `${Math.round(Math.random() * 100)}%`;
    s.style.top = `${Math.round(Math.random() * 62)}%`;
    s.style.animationDelay = `${Math.random() * 3.6}s`;
    const size = Math.random() < 0.2 ? 3 : 2;
    s.style.width = s.style.height = `${size}px`;
    frag.appendChild(s);
  }
  box.appendChild(frag);
}






const TIER_HAT_ASSET = {
  random: '/static/img/hat.png',
  onyx: '/static/img/hat.png',
  black: '/static/img/hat.png',
  bear: '/static/img/hat.png',      // утешительный мишка — тоже лежит в профиле
};
const TIER_ORDER = ['random', 'onyx', 'black', 'gift'];

let currentTier = 'random';


let spinTier = 'random';


let giftCatalog = null;          // { items: [{slug, name, price_ton, image}], margin }

let selectedGift = null;
let giftCatalogAt = 0;
let gpModels = null;             // открытая в выборе коллекция с моделями
let gpFor = 'upgrade';           // для чего открыт список: 'upgrade' или 'shell'

function giftImage(slug) {
  return `/gimg/${slug}.webp?v=2`;  // обложка коллекции без фона, отдаёт наш сервер (v — как IMG_VER)
}


function setGiftImg(img, src, fallback) {
  let tries = 0;
  img.onerror = () => {
    tries += 1;
    if (tries <= 4) setTimeout(() => { img.src = `${src}${src.includes('?') ? '&' : '?'}r=${tries}`; }, 2000 * tries);
    else if (fallback && img.src.indexOf(fallback) < 0) { img.onerror = null; img.src = fallback; }
  };
  img.src = src;
}

function hatAsset(tier) {
  if (String(tier).startsWith('url:')) return tier.slice(4);
  if (String(tier).startsWith('gift:')) return giftImage(tier.slice(5));
  return TIER_HAT_ASSET[tier] || TIER_HAT_ASSET.random;
}


function giftCost(price, chance) {
  const m = giftCatalog ? giftCatalog.margin || 0 : 0;
  return roundTon(price * chance / Math.max(0.01, (1 - m) * giftPriceFactor(price)));
}


function giftPriceFactor(price) {
  if (!giftCatalog) return 1;
  for (const [limit, factor] of giftCatalog.steps || []) {
    if (price > limit) return factor;
  }
  return giftCatalog.base || 1;
}


function roundTon(x) {
  return Number(x.toFixed(2));
}


function tierMeta(cfg) {
  if (currentTier === 'gift' && selectedGift) {
    const base = cfg.chances || [];
    return {
      chances: base.map((m) => ({ chance: m.chance, cost_ton: giftCost(selectedGift.price_ton, m.chance) })),
      default_chance: cfg.default_chance,
      prize_name: `${selectedGift.name} · ${fmt(selectedGift.price_ton, 2)} TON`,
    };
  }
  const t = cfg.tiers && cfg.tiers[currentTier === 'gift' ? 'random' : currentTier];
  if (!t) {
    return { chances: cfg.chances, default_chance: cfg.default_chance, prize_name: cfg.prize_name };
  }
  return { chances: t.chances, default_chance: t.default_chance, prize_name: t.prize_name };
}

function saveTier(tier) {
  try { localStorage.setItem('prizeTier', tier); } catch (e) {  }
}

function loadSavedTier() {
  try {
    const saved = localStorage.getItem('prizeTier');
    
    if (TIER_ORDER.includes(saved) && saved !== 'gift') return saved;
  } catch (e) {  }
  return 'random';
}


function applyBodyTierClass() {
  const onUpgrade = !$('view-upgrade').hidden;
  document.body.classList.remove('tier-onyx', 'tier-black');
  if (onUpgrade && currentTier !== 'random') {
    document.body.classList.add(`tier-${currentTier}`);
  }
}


const SHOW_LEADERS = false;



const HAT_KEY = '__hat__';
const HAT_TIER_KEYS = { [HAT_KEY]: 'random', __onyx__: 'onyx', __black__: 'black' };

const HAT_SLUG = 'WitchHat';


function syncTierButtons() {
  const gifts = state ? !!state.config.gift_upgrade : true;
  
  
  $('tierPicker').hidden = gifts;
  document.querySelectorAll('.tier-btn').forEach((b) => {
    const t = b.dataset.tier;
    if (t === 'random') b.hidden = gifts;
    if (t === 'gift') b.hidden = !gifts;
    b.classList.toggle('active', !b.hidden
      && (t === currentTier || (t === 'gift' && currentTier === 'random')));
  });
}


function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) {  }
}



let needsPick = lsGet('prizeChosen') !== '1' && !lsGet('prizeTier');
let needsPickChecked = false;

function syncPickUI() {
  const giftsOn = !!(state && state.config.gift_upgrade);
  $('centerHat').hidden = needsPick;
  $('hatQuestion').hidden = !needsPick;
  $('hatHint').hidden = !giftsOn || lsGet('hatHintSeen') === '1';
}


function checkNeedsPick() {
  if (needsPickChecked || !state) return;
  needsPickChecked = true;
  needsPick = !!state.config.gift_upgrade
    && lsGet('prizeChosen') !== '1' && !lsGet('prizeTier')
    && !(state.fairness && state.fairness.nonce > 0);
}


function markPrizeChosen() {
  lsSet('prizeChosen', '1');
  needsPick = false;
}


function markHintSeen() {
  lsSet('hatHintSeen', '1');
  $('hatHint').hidden = true;
}


function setTier(tier, save = true) {
  if (!TIER_ORDER.includes(tier)) tier = 'random';
  
  if (tier === 'gift' && !selectedGift) {
    openGiftPicker();
    return;
  }
  currentTier = tier;

  applyBodyTierClass();
  syncTierButtons();

  const hatImg = $('centerHat');
  if (hatImg) {
    if (tier === 'gift') setGiftImg(hatImg, selectedGift.image, giftImage(selectedGift.slug));
    else { hatImg.onerror = null; hatImg.src = hatAsset(tier); }
    hatImg.classList.toggle('is-gift', tier === 'gift');
  }
  if (save) markPrizeChosen();     // выбор сделан руками — вопросик убираем
  syncPickUI();

  if (save) {
    saveTier(tier);
    if (tier === 'gift') {
      try {
        localStorage.setItem('prizeGift', JSON.stringify({ slug: selectedGift.slug, model: selectedGift.model }));
      } catch (e) {  }
    }
  }

  if (state) {
    const meta = tierMeta(state.config);
    $('prizeNameInline').textContent = needsPick ? tr('не выбран') : trName(meta.prize_name);
    buildModes({ chances: meta.chances, default_chance: meta.default_chance });
  }
}



async function loadGiftCatalog(force = false) {
  
  
  if (!force && giftCatalog && giftCatalog.items.length && Date.now() - giftCatalogAt < 60000) return giftCatalog;
  const r = await api('/api/gifts/catalog');
  giftCatalog = { items: r.items || [], margin: r.margin || 0, steps: r.price_steps || [], base: r.price_base || 1 };
  giftCatalogAt = Date.now();
  await refreshSelectedGift();
  return giftCatalog;
}

async function fetchModels(slug) {
  const r = await api('/api/gifts/models', { slug });
  return r;
}


async function refreshSelectedGift() {
  if (!selectedGift) return;
  let fresh = null;
  if (!selectedGift.model) {
    const c = giftCatalog.items.find((g) => g.slug === selectedGift.slug);
    if (c) fresh = { slug: c.slug, model: '', name: c.name, price_ton: c.price_ton, image: c.image };
  } else {
    try {
      const r = await fetchModels(selectedGift.slug);
      const m = (r.models || []).find((x) => x.model === selectedGift.model);
      if (m) fresh = { slug: r.slug, model: m.model, name: `${r.name} · ${m.model}`, price_ton: m.price_ton, image: m.image };
    } catch (e) { fresh = null; }
  }
  if (spinning) return;
  selectedGift = fresh;
  if (currentTier === 'gift') setTier(fresh ? 'gift' : 'random', false);
}

function gpTile(key, name, price, image, active, fallback) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gp-item' + (active ? ' active' : '');
  b.dataset.key = key;
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  
  setGiftImg(img, image, fallback);
  const n = document.createElement('span');
  n.className = 'gp-name';
  n.textContent = name;
  const p = document.createElement('span');
  p.className = 'gp-price';
  p.textContent = `${fmt(price, 2)} TON`;
  b.append(img, n, p);
  return b;
}


function hatPrizeName() {
  return (state && state.config.tiers && state.config.tiers.random
    && trName(state.config.tiers.random.prize_name)) || (state && trName(state.config.prize_name)) || tr('Шляпа волшебника');
}


function hatTierName(tier) {
  if (tier === 'random') return hatPrizeName();
  const t = state && state.config.tiers && state.config.tiers[tier];
  return (t && trName(t.prize_name)) || (tier === 'onyx' ? tr('Шляпа на ониксе') : tr('Шляпа на блэке'));
}

const HAT_TIER_LABEL = { random: tr('по умолчанию'), onyx: tr('фон оникс'), black: tr('фон блэк') };


function hatBackdropsOn() {
  return !!(state && state.config.tier_enabled);
}


function gpHatTile(key, active) {
  const tier = HAT_TIER_KEYS[key];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `gp-item gp-hat gp-hat-${tier}` + (active ? ' active' : '');
  b.dataset.key = key;
  const img = document.createElement('img');
  img.alt = '';
  img.src = TIER_HAT_ASSET[tier];
  const n = document.createElement('span');
  n.className = 'gp-name';
  n.textContent = hatTierName(tier);
  const p = document.createElement('span');
  p.className = 'gp-price';
  p.textContent = HAT_TIER_LABEL[tier];
  b.append(img, n, p);
  return b;
}


const GP_SORTS = ['popular', 'expensive', 'cheap'];
let gpSort = GP_SORTS.includes(lsGet('gpSort')) ? lsGet('gpSort') : 'popular';

function gpSorted(items, isModels) {
  const arr = items.slice();
  const byPrice = (a, b) => a.price_ton - b.price_ton;
  if (gpSort === 'expensive') arr.sort((a, b) => byPrice(b, a));
  else if (gpSort === 'cheap') arr.sort(byPrice);
  else if (!isModels) arr.sort((a, b) => (b.popular || 0) - (a.popular || 0) || byPrice(a, b));
  return arr;
}

function setGpSort(mode) {
  if (!GP_SORTS.includes(mode)) return;
  gpSort = mode;
  lsSet('gpSort', mode);
  renderGiftPicker();
}

function renderGiftPicker() {
  const list = $('gpList');
  const q = $('gpSearch').value.trim().toLowerCase();
  document.querySelectorAll('#gpSort button').forEach((b) => b.classList.toggle('active', b.dataset.sort === gpSort));
  $('gpBack').hidden = !gpModels;
  $('gpTitle').textContent = gpModels ? (gpModels.title || gpModels.name || tr('Загружаю…')) : tr('Выбери подарок');
  $('gpSearch').placeholder = gpModels ? tr('Поиск модели') : tr('Поиск коллекции');
  list.textContent = '';
  list.scrollTop = 0;

  if (gpModels === 'loading') {
    list.innerHTML = `<p class="muted gp-empty">${tr('Загружаю…')}</p>`;
    return;
  }
  
  
  const forShell = gpFor === 'shell';
  const picked = forShell ? shellGift : (currentTier === 'gift' ? selectedGift : null);
  const frag = document.createDocumentFragment();
  let note = '';
  if (gpModels) {
    const sel = picked && picked.slug === gpModels.slug ? picked.model : null;
    
    if (gpModels.slug === HAT_SLUG) {
      for (const key of Object.keys(HAT_TIER_KEYS)) {
        const tier = HAT_TIER_KEYS[key];
        
        if (tier !== 'random' && (forShell || !hatBackdropsOn())) continue;
        const words = `${hatTierName(tier)} ${HAT_TIER_LABEL[tier]}`.toLowerCase();
        const on = forShell ? !shellGift : currentTier === tier;
        if (!q || words.includes(q)) frag.appendChild(gpHatTile(key, on));
      }
    }
    
    if (gpModels.floor != null && (!q || tr('любая модель').includes(q))) {
      frag.appendChild(gpTile('', tr('Любая модель'), gpModels.floor, gpModels.image, sel === ''));
    }
    for (const m of gpSorted(gpModels.models, true)) {
      if (q && !m.model.toLowerCase().includes(q)) continue;
      frag.appendChild(gpTile(m.model, m.model, m.price_ton, m.image, sel === m.model, gpModels.image));
    }
    if (gpModels.loading) note = tr('Загружаю модели…');
    else if (!frag.childNodes.length) note = tr('Ничего не нашлось');
  } else {
    
    
    
    
    const hatOn = (forShell ? !shellGift : currentTier !== 'gift') || (!!picked && picked.slug === HAT_SLUG);
    if (!q || hatPrizeName().toLowerCase().includes(q) || 'witch hat'.includes(q)) {
      frag.appendChild(gpHatTile(HAT_KEY, hatOn));
    }
    let gifts = 0;
    for (const g of gpSorted(giftCatalog ? giftCatalog.items : [], false)) {
      if (g.slug === HAT_SLUG) continue;
      if (q && !g.name.toLowerCase().includes(q)) continue;
      frag.appendChild(gpTile(g.slug, g.name, g.price_ton, g.image, !!picked && picked.slug === g.slug));
      gifts += 1;
    }
    if (!giftCatalog) note = tr('Загружаю подарки…');
    else if (!giftCatalog.items.length) note = tr('Подарки пока недоступны');
    else if (!gifts && !frag.childNodes.length) note = tr('Ничего не нашлось');
  }
  list.appendChild(frag);
  if (note) {
    const p = document.createElement('p');
    p.className = 'muted gp-empty';
    p.textContent = note;
    list.appendChild(p);
  }
}


async function openGiftPicker(forWhat) {
  const shell = forWhat === 'shell';
  if (shell ? shellPhase !== 'idle' : spinning) return;
  gpFor = shell ? 'shell' : 'upgrade';
  gpModels = null;
  $('giftPickModal').hidden = false;
  $('gpSearch').value = '';
  renderGiftPicker();
  try {
    await loadGiftCatalog();
  } catch (e) {
    toast(tr('Не удалось загрузить подарки'), true);
  }
  if (gpModels === null) renderGiftPicker();
}

async function openGiftModels(slug) {
  gpModels = 'loading';
  $('gpSearch').value = '';
  renderGiftPicker();
  try {
    const r = await fetchModels(slug);
    if (gpModels !== 'loading') return true;   // успел нажать «назад»
    gpModels = { slug: r.slug, name: r.name, floor: r.floor, image: r.image, models: r.models || [] };
  } catch (e) {
    gpModels = null;
    renderGiftPicker();
    return false;
  }
  renderGiftPicker();
  return true;
}


async function openHatList() {
  
  
  const view = { slug: HAT_SLUG, title: tr('Шляпы'), name: 'Witch Hat', floor: null, image: '', models: [], loading: false };
  gpModels = view;
  $('gpSearch').value = '';
  const inCatalog = giftCatalog && giftCatalog.items.some((g) => g.slug === HAT_SLUG);
  view.loading = !!inCatalog;
  renderGiftPicker();
  if (!inCatalog) return;
  try {
    const r = await fetchModels(HAT_SLUG);
    Object.assign(view, { name: r.name, floor: r.floor, image: r.image, models: r.models || [] });
  } catch (e) {  }
  view.loading = false;
  if (gpModels === view) renderGiftPicker();      // не ушёл ли игрок из списка
}

function pickHatTier(tier) {
  $('giftPickModal').hidden = true;
  if (gpFor === 'shell') pickShellPrize(null);       // в «Трёх шляпах» — обычная шляпа
  else setTier(tier);
  haptic('impact', 'light');
}


function pickShellPrize(gift) {
  shellGift = gift;  renderShellPrize();
  updateShellButton();
  if (shellPhase === 'idle') shellSetHint(shellIdleHint());
}

function gpBack() {
  gpModels = null;
  $('gpSearch').value = '';
  renderGiftPicker();
}

function onGiftTile(key) {
  if (gpModels === 'loading') return;
  if (key in HAT_TIER_KEYS) {
    
    
    if (!gpModels) openHatList();
    else pickHatTier(HAT_TIER_KEYS[key]);
    return;
  }
  if (!gpModels) {
    openGiftModels(key).then((ok) => { if (!ok) toast(tr('Не удалось загрузить модели'), true); });
    return;
  }
  let gift;
  if (key === '') {
    gift = { slug: gpModels.slug, model: '', name: gpModels.name, price_ton: gpModels.floor, image: gpModels.image };
  } else {
    const m = gpModels.models.find((x) => x.model === key);
    if (!m) return;
    gift = { slug: gpModels.slug, model: m.model, name: `${gpModels.name} · ${m.model}`,
      price_ton: m.price_ton, image: m.image };
  }
  $('giftPickModal').hidden = true;
  if (gpFor === 'shell') {
    pickShellPrize(gift);
  } else {
    selectedGift = gift;
    setTier('gift');
  }
  haptic('impact', 'light');
}


async function restoreSavedGift() {
  let saved = null;
  try {
    if (localStorage.getItem('prizeTier') !== 'gift') return;
    saved = JSON.parse(localStorage.getItem('prizeGift') || 'null');
  } catch (e) { return; }
  if (!saved || !saved.slug) return;
  try {
    await loadGiftCatalog();
  } catch (e) { return; }
  if (currentTier !== 'random' || spinning) return;
  selectedGift = { slug: saved.slug, model: saved.model || '', name: '', price_ton: 0, image: '' };
  await refreshSelectedGift();
  if (selectedGift && currentTier !== 'gift') setTier('gift', false);
}


function currentMode() {
  return modes[modeIndex] || null;
}


function buildModes(cfg) {
  const grid = cfg.chances || [];
  const changed = JSON.stringify(grid) !== JSON.stringify(modes);
  modes = grid;
  if (!modes.length) return;

  const slider = $('modeSlider');
  slider.max = String(modes.length - 1);

  if (changed) {
    let def = modes.findIndex((m) => Math.abs(m.chance - cfg.default_chance) < 1e-9);
    if (def < 0) def = Math.floor(modes.length / 2);
    modeIndex = def;
    slider.value = String(modeIndex);

    $('chanceMin').textContent = `${Math.round(modes[0].chance * 100)}%`;
    $('chanceMax').textContent = `${Math.round(modes[modes.length - 1].chance * 100)}%`;
  }

  applyMode();
}

function selectMode(index) {
  if (spinning) return;
  modeIndex = Math.max(0, Math.min(modes.length - 1, index));
  $('modeSlider').value = String(modeIndex);
  applyMode();
}

const THUMB_W = 24;        // ширина бегунка, как в styles.css (#modeSlider thumb)


function buildWheelScale() {
  const g = $('wheelScale');
  if (!g || g.childNodes.length) return;
  const NS = 'http://www.w3.org/2000/svg';
  const at = (deg, r) => {
    const a = deg * Math.PI / 180;
    return [150 + r * Math.sin(a), 150 - r * Math.cos(a)];
  };
  for (let p = 0; p < 100; p += 5) {
    const deg = p * 3.6;
    if (p % 10 === 0) {
      const [x, y] = at(deg, 148);
      
      const [lx1, ly1] = at(deg, 131);
      const leg = document.createElementNS(NS, 'line');
      leg.setAttribute('class', 'scale-leg');
      leg.setAttribute('x1', lx1.toFixed(1)); leg.setAttribute('y1', ly1.toFixed(1));
      leg.setAttribute('x2', x.toFixed(1)); leg.setAttribute('y2', y.toFixed(1));
      g.appendChild(leg);
      const plate = document.createElementNS(NS, 'rect');
      plate.setAttribute('class', 'scale-plate');
      plate.setAttribute('x', (x - 14).toFixed(1)); plate.setAttribute('y', (y - 9).toFixed(1));
      plate.setAttribute('width', '28'); plate.setAttribute('height', '18'); plate.setAttribute('rx', '5');
      plate.dataset.p = String(p);
      g.appendChild(plate);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x.toFixed(1));
      t.setAttribute('y', y.toFixed(1));
      t.dataset.p = String(p);
      t.textContent = String(p);
      g.appendChild(t);
    } else {
      const [x1, y1] = at(deg, 137);
      const [x2, y2] = at(deg, 145);
      const tick = document.createElementNS(NS, 'line');
      tick.setAttribute('x1', x1.toFixed(1)); tick.setAttribute('y1', y1.toFixed(1));
      tick.setAttribute('x2', x2.toFixed(1)); tick.setAttribute('y2', y2.toFixed(1));
      tick.dataset.p = String(p);
      g.appendChild(tick);
    }
  }
}


function applyMode() {
  const m = currentMode();
  if (!m) return;

  
  $('modeCost').textContent = needsPick ? '—' : fmt(m.cost_ton, 2);
  $('modeChance').textContent = `${Math.round(m.chance * 100)}%`;

  
  
  const ratio = modes.length > 1 ? modeIndex / (modes.length - 1) : 0.5;
  const thumbX = `calc(${THUMB_W / 2}px + (100% - ${THUMB_W}px) * ${ratio})`;
  $('modeTrack').style.setProperty('--thumb-x', thumbX);
  $('modeSlider').style.setProperty('--fill', thumbX);     // зелёная заливка — до середины бегунка

  
  const pct = Math.round(m.chance * 100);
  document.querySelectorAll('#wheelScale [data-p]').forEach((el) => {
    el.classList.toggle('on', Number(el.dataset.p) <= pct);
  });

  
  $('arcWin').setAttribute('stroke-dasharray', `${RING_C * m.chance} ${RING_C}`);
  $('arcLose').setAttribute('stroke-dasharray', `${RING_C} 0`);

  updateSpinButton();
}

function updateSpinButton() {
  const m = currentMode();
  if (!m || !state) return;
  
  
  
  $('spinBtn').disabled = spinning || homing;     // пока стрелка не вернулась на ноль, крутить нельзя
  $('spinBtnText').textContent = 'UP';
  const enough = needsPick || state.balance_ton + 1e-9 >= m.cost_ton;
  $('spinBtn').classList.toggle('low', !enough);
}


function renderState(s) {
  state = s;
  
  if (!s.config.gift_upgrade && currentTier === 'gift' && !spinning) {
    selectedGift = null;
    setTier('random', false);
  }
  checkNeedsPick();
  if (!s.config.gift_upgrade) needsPick = false;      // без списка выбирать нечем
  syncPickUI();
  syncTierButtons();                // «Рандом» или «Подарки» — смотря включён ли апгрейд на подарки
  const _tm = tierMeta(s.config);   // цена/название для выбранного тира приза
  buildModes(_tm);
  renderShell(s.config);
  giftCfg = s.config.gift_deposit || null;
  $('giftDepositBtn').hidden = !(giftCfg && giftCfg.enabled && giftCfg.account);
  setWithdrawLock(s);

  $('balanceValue').textContent = fmt(s.balance_ton, 4);
  $('prizeNameInline').textContent = needsPick ? tr('не выбран') : trName(_tm.prize_name);
  $('depositAmount').min = s.config.min_deposit_ton;

  $('profileName').textContent = s.user.username ? `@${s.user.username}` : (s.user.first_name || tr('Игрок'));
  $('profileWallet').textContent = s.user.wallet ? shortAddr(s.user.wallet) : tr('Кошелёк не подключён');

  $('depAddress').textContent = s.deposit.address || tr('не настроен');
  $('depMemo').textContent = s.deposit.memo;

  syncAnon();
  renderPrizes(s.prizes);
  renderProgress(s);
  if (s.referral) renderReferral(s.referral);
  updateSpinButton();
}


function setCoins(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  if (state && state.hatcoin) state.hatcoin.balance = value;
  $('coinValue').textContent = fmt(value, 2);
}


function renderProgress(s) {
  if (s.hatcoin) {
    $('coinChip').hidden = !(s.hatcoin.percent > 0 || s.hatcoin.balance > 0);
    $('coinValue').textContent = fmt(s.hatcoin.balance, 2);
  }
  const lv = s.level || null;
  if (lv) {
    $('lvlBadge').textContent = `LVL ${lv.level}`;
    $('lvlFill').style.width = `${Math.round(lv.progress * 100)}%`;
    const left = Math.max(0, lv.next_ton - lv.turnover_ton);
    $('lvlNote').textContent = tr('До уровня {level}: ещё {left} TON оборота', { level: lv.level + 1, left: fmt(left, 2) });
  }
  const st = s.stats || null;
  if (st) {
    $('statWithdrawn').textContent = `${fmt(st.withdrawn_ton, 2)} TON`;
    $('statWithdrawnCount').textContent =
      tn(st.withdrawn_count, 'prize');
    $('statTurnover').textContent = `${fmt(st.turnover_ton, 2)} TON`;
    $('statGames').textContent = tn(st.games, 'game');
    const img = $('statBestImg');
    if (st.best) {
      $('statBestValue').textContent = `${fmt(st.best.value_ton, 2)} TON`;
      $('statBestName').textContent = trName(st.best.name);
      const isGift = String(st.best.tier).startsWith('gift:');
      const src = st.best.image || hatAsset(st.best.tier);
      if (img.dataset.src !== src) {            // не перезагружаем картинку на каждом обновлении
        img.dataset.src = src;
        img.classList.toggle('is-gift', isGift);
        if (isGift) setGiftImg(img, src, giftImage(String(st.best.tier).slice(5).split(':')[0]));
        else { img.onerror = null; img.src = src; }
      }
      img.hidden = false;
    } else {
      $('statBestValue').textContent = '—';
      $('statBestName').textContent = tr('пока нет');
      img.hidden = true;
    }
  }
}


function confirmDialog(text) {
  return new Promise((resolve) => {
    try {
      if (tg && tg.showConfirm && (!tg.isVersionAtLeast || tg.isVersionAtLeast('6.2'))) {
        tg.showConfirm(text, (ok) => resolve(!!ok));
        return;
      }
    } catch (e) {  }
    resolve(window.confirm(text));
  });
}


function sellAllCandidates() {
  if (!state) return [];
  return state.prizes.filter((p) => p.status === 'owned' && p.sell_ton !== undefined && !sellingNow.has(p.id));
}

async function sellAll() {
  const mine = sellAllCandidates();
  if (!mine.length) return;
  
  
  const btn = $('sellAllBtn');
  btn.disabled = true;
  try {
    const res = await api('/api/sell_all');
    state.prizes = res.prizes;
    setBalance(res.balance_ton);
    renderPrizes(res.prizes);
    updateSpinButton();
    updateShellButton();
    toast(res.count
      ? tr('Продано {n} шт. на {sum} TON', { n: res.count, sum: fmt(res.payout_ton, 2) })
      : tr('Продавать нечего'), !res.count, 3200);
    haptic('notification', res.count ? 'success' : 'error');
  } catch (e) {
    const messages = {
      too_fast: tr('Слишком быстро, попробуй ещё раз'),
      too_many_requests: tr('Слишком много запросов, подожди немного'),
      sell_disabled: tr('Продажа сейчас отключена'),
    };
    toast(messages[e.code] || tr('Не удалось продать'), true);
    refresh();
  } finally {
    btn.disabled = false;
  }
}


async function activatePromo(e) {
  e.preventDefault();
  const input = $('promoInput');
  const btn = $('promoBtn');
  const code = input.value.trim();
  if (!code || btn.disabled) return;
  btn.disabled = true;
  try {
    const r = await api('/api/promo', { code });
    input.value = '';
    setBalance(r.balance_ton);
    updateSpinButton();
    toast(tr('Промокод активирован: +{sum} TON', { sum: fmt(r.amount_ton, 2) }));
    haptic('notification', 'success');
  } catch (err) {
    const messages = {
      not_found: tr('Такого промокода нет'),
      inactive: tr('Этот промокод больше не действует'),
      exhausted: tr('Этот промокод уже разобрали'),
      already_used: tr('Ты уже активировал этот промокод'),
      too_fast: tr('Слишком много попыток, подожди минуту'),
      too_many_requests: tr('Слишком много запросов, подожди немного'),
    };
    toast(messages[err.code] || tr('Не получилось активировать'), true);
    haptic('notification', 'error');
  } finally {
    btn.disabled = false;
  }
}





let refOpen = false;

function toggleReferral() {
  refOpen = !refOpen;
  $('refBody').hidden = !refOpen;
  $('refToggle').setAttribute('aria-expanded', String(refOpen));
  haptic('impact', 'light');
}

function renderReferral(ref) {
  $('refPercent').textContent = `${fmt(ref.percent, 2)}%`;

  
  const showLink = ref.created && ref.link;
  $('refCreateBtn').hidden = showLink;
  $('refLinkBox').hidden = !showLink;
  if (showLink) $('refLink').textContent = ref.link;

  $('refCount').textContent = ref.count;
  $('refCountLabel').textContent = tn(ref.count, 'referral', true);
  $('refEarned').textContent = fmt(ref.earned_ton, 4);
  $('refBalance').textContent = `${fmt(ref.balance_ton, 4)} TON`;

  const canWithdraw = ref.balance_ton + 1e-9 >= ref.min_withdraw_ton;
  $('refWithdrawBtn').disabled = !canWithdraw;
  
  $('refDot').hidden = !canWithdraw;

  const hint = $('refHint');
  if (ref.pending_ton > 0) {
    hint.textContent = tr('В обработке: {sum} TON', { sum: fmt(ref.pending_ton, 4) });
    hint.classList.add('pending');
  } else {
    hint.textContent = tr('Вывод от {sum} TON', { sum: fmt(ref.min_withdraw_ton, 2) });
    hint.classList.remove('pending');
  }
}

async function createReferral() {
  const btn = $('refCreateBtn');
  btn.disabled = true;
  try {
    const res = await api('/api/referral/create');
    renderReferral(res.referral);
    haptic('notification', 'success');
  } catch (e) {
    toast(e.code === 'referral_unavailable'
      ? tr('Ссылки временно недоступны')
      : tr('Не удалось создать ссылку'), true);
  } finally {
    btn.disabled = false;
  }
}

async function copyReferral() {
  const link = $('refLink').textContent;
  const btn = $('refCopyBtn');
  if (await copyText(link)) {
    btn.textContent = tr('Скопировано');
    btn.classList.add('done');
    haptic('notification', 'success');
    setTimeout(() => {
      btn.textContent = tr('Копировать');
      btn.classList.remove('done');
    }, 1800);
  } else {
    
    const range = document.createRange();
    range.selectNodeContents($('refLink'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast(tr('Выдели ссылку и скопируй вручную'), true);
  }
}

async function withdrawReferral() {
  const btn = $('refWithdrawBtn');
  btn.disabled = true;
  try {
    const res = await api('/api/referral/withdraw');
    renderReferral(res.referral);
    toast(tr('Заявка на вывод создана'));
    haptic('notification', 'success');
  } catch (e) {
    toast(e.code === 'below_minimum'
      ? tr('Минимум для вывода — {sum} TON', { sum: fmt(state?.referral?.min_withdraw_ton ?? 1, 2) })
      : tr('Не удалось создать заявку'), true);
    refresh();
  }
}


const prizeCards = new Map();   // id -> { card, sig }



const sellingNow = new Set();

const flipping = new Map();

function prizeSig(p) {
  return `${I18N.lang}|${p.status}|${p.sell_ton ?? ''}|${p.withdraw_fee_ton ?? ''}|${p.tier}|${p.name}|${withdrawLocked() ? 'L' : ''}`;
}


let lockUntilMs = 0;
let clockSkewMs = 0;

function withdrawLocked() {
  return lockUntilMs > Date.now() + clockSkewMs;
}

function lockLeftText() {
  const left = Math.max(0, lockUntilMs - (Date.now() + clockSkewMs));
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const D = tr('д'), H = tr('ч'), M = tr('м');
  return tr('Вывод через {time}', { time: d ? `${d}${D} ${h}${H}` : h ? `${h}${H} ${m}${M}` : `${Math.max(1, m)}${M}` });
}

function setWithdrawLock(s) {
  lockUntilMs = (s.withdraw_locked_until || 0) * 1000;
  if (s.server_time) clockSkewMs = s.server_time * 1000 - Date.now();
}

setInterval(() => {
  const btns = document.querySelectorAll('#prizeGrid .wd-btn.locked');
  if (!btns.length) return;
  if (!withdrawLocked() && state) { renderPrizes(state.prizes); return; }   // срок вышел — кнопки снова «Вывести»
  btns.forEach((b) => { b.textContent = lockLeftText(); });
}, 30000);


function dropPrizeCards(cards) {
  cards = cards.filter((c) => c.isConnected && !c.classList.contains('leaving'));
  if (!cards.length) return;
  const grid = $('prizeGrid');
  const stay = [...grid.children].filter((el) => !el.classList.contains('leaving') && !cards.includes(el));
  const first = new Map(stay.map((el) => [el, el.getBoundingClientRect()]));
  const g = grid.getBoundingClientRect();

  for (const c of cards) {
    const r = c.getBoundingClientRect();
    c.classList.add('leaving');
    c.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    Object.assign(c.style, {
      position: 'absolute', margin: '0',
      left: `${r.left - g.left}px`, top: `${r.top - g.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
    setTimeout(() => c.remove(), 260);
  }

  
  
  
  
  
  
  
  
  
  for (const anim of flipping.values()) anim.cancel();
  flipping.clear();

  const vh = window.innerHeight;
  const near = (r) => r.bottom > -vh && r.top < vh * 2;
  const moves = [];
  for (const el of stay) {
    const a = first.get(el);
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    if (!near(a) && !near(b)) continue;
    moves.push([el, dx, dy]);
  }
  for (const [el, dx, dy] of moves) {
    const anim = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 280, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
    flipping.set(el, anim);
    anim.onfinish = () => { if (flipping.get(el) === anim) flipping.delete(el); };
  }
}

function renderPrizes(prizes) {
  const grid = $('prizeGrid');
  
  
  const visible = (Array.isArray(prizes) ? prizes : []).filter((p) => !sellingNow.has(p.id));
  $('prizeEmpty').hidden = visible.length > 0;
  
  
  $('sellAllBtn').hidden = visible.filter((p) => p.status === 'owned' && p.sell_ton !== undefined).length < 2;

  const keep = new Set();
  let prev = null;
  for (const p of visible) {
    keep.add(p.id);
    const sig = prizeSig(p);
    let entry = prizeCards.get(p.id);
    if (!entry || entry.sig !== sig) {
      const card = buildPrizeCard(p);
      if (entry) entry.card.replaceWith(card);
      entry = { card, sig };
      prizeCards.set(p.id, entry);
    }
    
    
    
    let ref = prev ? prev.nextElementSibling : grid.firstElementChild;
    while (ref && ref.classList.contains('leaving')) ref = ref.nextElementSibling;
    if (entry.card !== ref) grid.insertBefore(entry.card, ref);
    prev = entry.card;
  }
  const gone = [];
  for (const [id, entry] of prizeCards) {
    if (!keep.has(id)) {
      gone.push(entry.card);
      prizeCards.delete(id);
    }
  }
  dropPrizeCards(gone);
}

function buildPrizeCard(p) {
  const card = document.createElement('div');
  
  card.className = 'prize-card fresh';
  card.addEventListener('animationend', () => card.classList.remove('fresh'), { once: true });

  const thumb = document.createElement('div');
  
  
  
  const isGift = String(p.tier || '').startsWith('gift:');
  thumb.className = isGift ? 'thumb thumb-gift'
    : p.tier && p.tier !== 'random' ? `thumb thumb-${p.tier}` : 'thumb';
  const img = document.createElement('img');
  img.src = p.image || hatAsset(p.tier);
  img.alt = trName(p.name);
  thumb.appendChild(img);

  const btn = document.createElement('button');
  btn.className = 'wd-btn';
  if (p.status === 'owned' && withdrawLocked()) {
    btn.textContent = lockLeftText();
    btn.classList.add('locked');
    btn.disabled = true;
    btn.title = tr('После пополнения подарком вывод открывается через срок возврата платежа');
  } else if (p.status === 'owned') {
    btn.textContent = tr('Вывести');
    btn.addEventListener('click', () => withdraw(p.id, btn, p.withdraw_fee_ton || 0));
  } else {
    
    
    btn.textContent = p.status === 'withdraw_processing' ? tr('Выдаётся') : tr('В обработке');
    btn.classList.add('pending');
    btn.disabled = true;
  }

  card.append(thumb, btn);

  
  
  
  if (p.sell_ton !== undefined) {
    const sellBtn = document.createElement('button');
    sellBtn.className = 'sell-btn';
    sellBtn.textContent = tr('Продать {sum}', { sum: fmt(p.sell_ton, 2) });
    sellBtn.addEventListener('click', () => sellPrize(p, sellBtn, card));
    card.appendChild(sellBtn);
  }

  return card;
}


const VIEW_SLIDE_MS = 260;





const isMeadow = () => document.documentElement.dataset.theme === 'meadow';

function setTheme(name) {
  if (name === 'classic') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'meadow';
  try { localStorage.setItem('theme', name === 'classic' ? 'classic' : 'meadow'); } catch (e) {  }
  syncThemeButtons();
  if (window.alignBg) window.alignBg();     // фон поляны подгоняется под колесо
  shellAlignStump();
  if (!$('view-shell').hidden && shellPhase === 'idle') shellPlace();
}

function syncThemeButtons() {
  const cur = isMeadow() ? 'meadow' : 'classic';
  document.querySelectorAll('#themeBtns .lang-btn').forEach((b) => b.classList.toggle('on', b.dataset.themePick === cur));
}




function listNote(box, text) {
  box.textContent = '';
  const p = document.createElement('p');
  p.className = 'muted gp-empty';
  p.textContent = text;
  box.appendChild(p);
}

function lvShowList() {
  $('lvList').hidden = false;
  $('lvCard').hidden = true;
  $('lvBack').hidden = true;
  $('lvNote').hidden = false;
  $('lvMe').hidden = !$('lvMe').textContent;
  $('lvTitle').textContent = tr('Топ уровней');
}

async function openLevels() {
  $('levelsModal').hidden = false;
  $('lvMe').textContent = '';
  lvShowList();
  listNote($('lvList'), tr('Загружаю…'));
  try {
    renderLevels(await api('/api/levels'));
  } catch (e) {
    listNote($('lvList'), tr('Не удалось загрузить топ'));
  }
}

function renderLevels(res) {
  const list = $('lvList');
  list.textContent = '';
  if (!res.rows.length) listNote(list, tr('Пока никто не играл'));
  for (const row of res.rows) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `lb-row lv-row${row.rank <= 3 ? ` top${row.rank}` : ''}${row.me ? ' me' : ''}`;
    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.textContent = row.rank;
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = row.me ? tr('{name} (ты)', { name: trName(row.name) }) : trName(row.name);   // «Аноним» переводится
    const lvl = document.createElement('b');
    lvl.className = 'lv-badge';
    lvl.textContent = `LVL ${row.level}`;
    b.append(rank, lbAvatar(row.name, row.avatar), name, lvl);
    b.addEventListener('click', () => { haptic('impact', 'light'); openPlayer(row.key); });
    list.appendChild(b);
  }
  const me = $('lvMe');
  me.textContent = res.me.excluded ? tr('Админы в рейтинге не участвуют')
    : res.me.rank ? tr('Твоё место: #{rank} · LVL {level}', { rank: res.me.rank, level: res.me.level })
      : tr('Сыграй, чтобы попасть в топ');
  me.hidden = false;
}

async function openPlayer(key) {
  $('lvList').hidden = true;
  $('lvNote').hidden = true;
  $('lvMe').hidden = true;
  $('lvBack').hidden = false;
  const card = $('lvCard');
  card.hidden = false;
  listNote(card, tr('Загружаю…'));
  try {
    renderPlayer((await api('/api/player', { key })).player);
  } catch (e) {
    listNote(card, tr('Не удалось загрузить игрока'));
  }
}

function renderPlayer(p) {
  const card = $('lvCard');
  card.textContent = '';
  $('lvTitle').textContent = trName(p.name);

  const head = document.createElement('div');
  head.className = 'pcard-head';
  const lvl = document.createElement('div');
  lvl.className = 'lvl-badge';
  lvl.textContent = `LVL ${p.level.level}`;
  const bar = document.createElement('div');
  bar.className = 'lvl-bar';
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(p.level.progress * 100)}%`;
  bar.appendChild(fill);
  head.append(lbAvatar(p.name, p.avatar, 'lb-ava pcard-ava'), bar, lvl);

  const tile = (label, value, note, img) => {
    const t = document.createElement('div');
    t.className = 'pstat';
    const s = document.createElement('small');
    s.textContent = label;
    t.appendChild(s);
    if (img) t.appendChild(img);
    const b = document.createElement('b');
    b.textContent = value;
    const n = document.createElement('span');
    n.textContent = note;
    t.append(b, n);
    return t;
  };
  const st = p.stats;
  let bestImg = null;
  if (st.best) {
    bestImg = document.createElement('img');
    bestImg.alt = '';
    const tier = st.best.tier || 'random';
    if (st.best.image) setGiftImg(bestImg, st.best.image, st.best.image);
    else bestImg.src = hatAsset(tier);
  }
  const tiles = document.createElement('div');
  tiles.className = 'pstats';
  const best = tile(tr('Лучший дроп'), st.best ? `${fmt(st.best.value_ton, 2)} TON` : '—',
    st.best ? trName(st.best.name) : tr('пока нет'), bestImg);
  best.classList.add('pstat-best');
  tiles.append(
    tile(tr('Выведено'), `${fmt(st.withdrawn_ton, 2)} TON`, tn(st.withdrawn_count, 'prize')),
    best,
    tile(tr('Оборот'), `${fmt(st.turnover_ton, 2)} TON`, tn(st.games, 'game')),
  );
  card.append(head, tiles);
}


async function openHistory() {
  $('historyModal').hidden = false;
  const list = $('histList');
  listNote(list, tr('Загружаю…'));
  let rows;
  try {
    rows = (await api('/api/history')).rows;
  } catch (e) {
    listNote(list, tr('Не удалось загрузить историю'));
    return;
  }
  list.textContent = '';
  if (!rows.length) listNote(list, tr('Игр пока не было'));
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = `hist-row ${r.win ? 'win' : 'lose'}`;
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'hist-img';
    const tier = r.image.startsWith('tier:') ? r.image.slice(5) : '';
    if (r.kind === 'shell' && !r.win) img.src = '/static/img/hat.png';
    else if (tier || !r.image) img.src = hatAsset(tier || 'random');
    else setGiftImg(img, r.image, r.image);

    const mid = document.createElement('div');
    mid.className = 'hist-mid';
    const title = document.createElement('b');
    title.textContent = r.target ? trName(r.target)
      : r.kind === 'shell' ? tr('Три шляпы') : hatTierName(tier || 'random');
    const sub = document.createElement('small');
    const when = new Date(r.ts * 1000).toLocaleString(I18N.locale || 'ru-RU',
      { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    sub.textContent = `${r.kind === 'shell' ? tr('Три шляпы') : tr('Апгрейд')} · ${when}`;
    mid.append(title, sub);

    const right = document.createElement('div');
    right.className = 'hist-right';
    const res = document.createElement('b');
    res.textContent = r.win ? tr('Выигрыш') : r.bear ? `${tr('Мимо')} 🧸` : tr('Мимо');
    const cost = document.createElement('small');
    cost.textContent = `−${fmt(r.cost_ton, 2)} TON`;
    right.append(res, cost);
    row.append(img, mid, right);
    list.appendChild(row);
  }
}

function initProfileWindows() {
  $('settingsBtn').addEventListener('click', () => { haptic('impact', 'light'); $('settingsModal').hidden = false; });
  $('settingsClose').addEventListener('click', () => { $('settingsModal').hidden = true; });
  $('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') $('settingsModal').hidden = true; });
  $('levelsBtn').addEventListener('click', () => { haptic('impact', 'light'); openLevels(); });
  $('historyBtn').addEventListener('click', () => { haptic('impact', 'light'); openHistory(); });
  $('lvClose').addEventListener('click', () => { $('levelsModal').hidden = true; });
  $('lvBack').addEventListener('click', lvShowList);
  $('histClose').addEventListener('click', () => { $('historyModal').hidden = true; });
  for (const id of ['levelsModal', 'historyModal']) {
    $(id).addEventListener('click', (e) => { if (e.target.id === id) $(id).hidden = true; });
  }
}




function syncAnon() {
  const on = !!(state && state.user && state.user.anon);
  document.querySelectorAll('#anonBtns .lang-btn').forEach((b) => b.classList.toggle('on', (b.dataset.anon === '1') === on));
}

function initAnon() {
  document.querySelectorAll('#anonBtns .lang-btn').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!state) return;
      haptic('impact', 'light');
      const want = b.dataset.anon === '1';
      state.user.anon = want;                 // сразу показываем, сервер подтвердит
      syncAnon();
      try {
        const res = await api('/api/settings', { anon: want });
        state.user.anon = !!res.anon;
      } catch (e) {
        state.user.anon = !want;
        toast(tr('Ошибка запроса'), true);
      }
      syncAnon();
    });
  });
}

function initThemeSwitch() {
  document.querySelectorAll('#themeBtns .lang-btn').forEach((b) => {
    b.addEventListener('click', () => { haptic('impact', 'light'); setTheme(b.dataset.themePick); });
  });
  syncThemeButtons();
}


function shellAlignStump() {
  const table = $('shellTable');
  const y = window.bgAnchorY;
  if (!table) return;
  if (!isMeadow()) { table.style.marginTop = ''; return; }    // в старом дизайне пенька нет
  if (!y || $('view-shell').hidden) return;
  const stage = document.querySelector('.stage').getBoundingClientRect();
  const sub = $('shellSubtitle').getBoundingClientRect();
  const want = y - 10 - table.offsetHeight - (sub.bottom - stage.top);
  table.style.marginTop = `${Math.max(4, Math.round(want))}px`;
}


function initSwipeTabs() {
  const content = document.querySelector('.content');
  let x0 = 0, y0 = 0, t0 = 0, ok = false;
  content.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    ok = e.touches.length === 1
      && !e.target.closest('input, textarea, select, .mode-picker, [data-noswipe]');
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  }, { passive: true });
  content.addEventListener('touchend', (e) => {
    if (!ok) return;
    ok = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Date.now() - t0 > 600 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    
    if (spinning || shellPhase !== 'idle') return;
    
    const main = ['menu', 'upgrade', 'profile'];
    const sub = !main.includes(currentView);
    const i = main.indexOf(VIEW_TAB[currentView]);
    const next = sub && dx > 0 ? 'menu' : main[i + (dx < 0 ? 1 : -1)];
    if (!next || next === currentView) return;
    haptic('impact', 'light');
    showView(next);
  }, { passive: true });
}


function viewGhost(view) {
  const content = document.querySelector('.content');
  const stage = document.querySelector('.stage');
  const cr = content.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  const vr = view.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'view-ghost';
  box.style.cssText = `left:${cr.left - sr.left}px;top:${cr.top - sr.top}px;width:${cr.width}px;height:${cr.height}px`;
  const copy = view.cloneNode(true);
  copy.style.cssText = `position:absolute;left:${vr.left - cr.left}px;top:${vr.top - cr.top}px;width:${vr.width}px;margin:0`;
  box.appendChild(copy);
  return { box, stage };
}


function slideViews(ghost, next, dir) {
  const out = dir > 0 ? 'out-left' : 'out-right';
  const inn = dir > 0 ? 'in-right' : 'in-left';
  ghost.stage.appendChild(ghost.box);
  ghost.box.classList.add(out);
  next.classList.remove('in-right', 'in-left');
  void next.offsetWidth;                 // перезапуск, если листают быстро
  next.classList.add(inn);
  const done = () => { ghost.box.remove(); next.classList.remove(inn); };
  ghost.box.addEventListener('animationend', done, { once: true });
  setTimeout(done, VIEW_SLIDE_MS + 120);   // вкладка в фоне: animationend может не прийти
}




const VIEWS = ['menu', 'mines', 'shell', 'leaders', 'upgrade', 'profile'];
const VIEW_TAB = { menu: 'menu', mines: 'menu', shell: 'menu', leaders: 'menu', upgrade: 'upgrade', profile: 'profile' };
const VIEW_POS = { menu: 0, mines: 0.5, shell: 0.5, leaders: 0.5, upgrade: 1, profile: 2 };   // порядок слева направо — для анимации
let currentView = 'upgrade';

function showView(name) {
  if (!VIEWS.includes(name)) return;
  
  const prevName = currentView;
  const prevEl = $(`view-${prevName}`);
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ghost = prevEl && !prevEl.hidden && prevName !== name && !calm ? viewGhost(prevEl) : null;
  document.querySelectorAll('.view-ghost').forEach((g) => g.remove());   // недоигравшая прошлая

  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  currentView = name;
  if (name === 'leaders') loadLeaderboard();
  lbSetPlaying(name === 'leaders');   // анимации призов и таймер — только на «Лидерах»
  lbStartTimer(name === 'leaders');
  
  
  
  if (name === 'shell') shellAlignStump();
  if (name === 'shell' && shellPhase === 'idle') shellPlace();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === VIEW_TAB[name]));
  document.querySelector('.content').scrollTop = 0;
  applyBodyTierClass();   // тема оникс/блэк живёт только на вкладке «Апгрейд»
  document.body.dataset.view = name;   // фон затемняется на вкладках со списками (styles.css)
  if (ghost) slideViews(ghost, $(`view-${name}`), VIEW_POS[name] > VIEW_POS[prevName] ? 1 : -1);
  
  if (name === 'upgrade' && window.alignBg) setTimeout(window.alignBg, VIEW_SLIDE_MS + 150);
}




const LB_MIN_INTERVAL = 10000;
let lbLoadedAt = 0;
let lbLoading = false;

function fmtTon(v) {
  return `${Number(v).toLocaleString(I18N.locale || 'ru-RU', { maximumFractionDigits: 2 })} TON`;
}


function lbAvatar(name, url, cls = 'lb-ava') {
  const box = document.createElement('div');
  box.className = cls;
  const letter = (name.replace(/^@/, '').trim()[0] || '?').toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  box.style.setProperty('--ava-h', h);
  const span = document.createElement('span');
  span.textContent = letter;
  box.appendChild(span);
  if (url) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    
    
    img.onload = () => img.classList.add('ok');
    img.onerror = () => img.remove();
    img.src = url;
    box.appendChild(img);
  }
  return box;
}


const LB_PATTERN = [
  [140.6, 13.8, 0.3, 0.213], [249.5, 13.8, 0.3, 0.213], [291.9, 102.8, 0.3, 0.224],
  [98.2, 102.8, 0.3, 0.224], [276.3, 176.2, 0.277, 0.222], [196.1, 188.6, 0.277, 0.123],
  [116.0, 176.2, 0.277, 0.222], [355.1, 79.3, 0.2247, 0.19], [292.1, 52.1, 0.2247, 0.261],
  [334.1, 17.5, 0.2247, 0.146], [198.8, -5.8, 0.2247, 0.153], [63.4, 17.5, 0.2247, 0.145],
  [105.4, 52.1, 0.2247, 0.261], [42.4, 79.3, 0.2247, 0.166], [72.8, 155.9, 0.2247, 0.166],
  [49.4, 205.6, 0.2247, 0.105], [344.2, 205.6, 0.2247, 0.105], [337.2, 155.9, 0.2247, 0.153],
];
const lbVisuals = {};   // place -> готовый блок приза (живёт между перерисовками)
const lbAnims = {};     // place -> запущенная анимация
let lottieLoading = null;

function loadLottie() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (!lottieLoading) {
    lottieLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'assets/lb/lottie_light.min.js';
      s.onload = () => (window.lottie ? resolve(window.lottie) : reject(new Error('no lottie')));
      s.onerror = () => { lottieLoading = null; s.remove(); reject(new Error('lottie load failed')); };
      document.head.appendChild(s);
    });
  }
  return lottieLoading;
}


async function loadGiftModel(prize) {
  if (window.DecompressionStream) {
    try {
      const res = await fetch(prize.model);
      if (res.ok) {
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
      }
    } catch (e) {  }
  }
  const res = await fetch(prize.model_json);
  if (!res.ok) throw new Error('model');
  return res.json();
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}


function lbBackdrop(prize) {
  const id = `lb${prize.place}`;
  const svg = svgEl('svg', { class: 'lb-bd', viewBox: '70 0 280 280', preserveAspectRatio: 'xMidYMid slice' });
  const defs = svgEl('defs');
  const grad = svgEl('radialGradient', { id: `${id}g`, cx: '50%', cy: '46%', r: '62%' });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': prize.bg[0] }),
    svgEl('stop', { offset: '100%', 'stop-color': prize.bg[1] }),
  );
  const filter = svgEl('filter', { id: `${id}f` });
  filter.append(
    svgEl('feFlood', { 'flood-color': prize.pattern }),
    svgEl('feComposite', { in2: 'SourceGraphic', operator: 'in' }),
  );
  defs.append(grad, filter);
  const pattern = svgEl('g', { filter: `url(#${id}f)` });
  for (const [x, y, s, o] of LB_PATTERN) {
    const img = svgEl('image', { x, y, width: 100 * s, height: 100 * s, opacity: o });
    img.setAttribute('href', prize.symbol);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', prize.symbol);
    pattern.appendChild(img);
  }
  svg.append(defs, svgEl('rect', { x: 70, y: 0, width: 280, height: 280, fill: `url(#${id}g)` }), pattern);
  return svg;
}


function lbPrizeVisual(prize) {
  if (lbVisuals[prize.place]) return lbVisuals[prize.place];

  const pic = document.createElement('div');
  pic.className = 'lb-prize';
  pic.style.setProperty('--bd-a', prize.bg[0]);
  pic.style.setProperty('--bd-b', prize.bg[1]);

  const poster = document.createElement('img');
  poster.className = 'lb-poster';
  poster.src = prize.poster;
  poster.alt = trName(prize.name);

  const anim = document.createElement('div');
  anim.className = 'lb-anim';

  pic.append(lbBackdrop(prize), poster, anim);
  lbVisuals[prize.place] = pic;

  Promise.all([loadLottie(), loadGiftModel(prize)])
    .then(([lottie, data]) => {
      const a = lottie.loadAnimation({
        container: anim, renderer: 'svg', loop: true,
        autoplay: !$('view-leaders').hidden,
        animationData: data,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
      });
      a.addEventListener('DOMLoaded', () => pic.classList.add('live'));
      lbAnims[prize.place] = a;
    })
    .catch(() => {
      
      delete lbVisuals[prize.place];
    });
  return pic;
}


function lbSetPlaying(on) {
  for (const a of Object.values(lbAnims)) (on ? a.play() : a.pause());
}


let lbEndsAt = 0;
let lbSkew = 0;
let lbFinished = false;
let lbEndless = false;
let lbTimerId = 0;

function lbTick() {
  const el = $('lbTimer');
  if (!el) return;
  const left = Math.max(0, Math.floor((lbEndsAt - (Date.now() + lbSkew)) / 1000));
  if (lbEndless) { el.replaceChildren(); el.hidden = true; return; }
  if (left <= 0) {
    
    
    el.replaceChildren();
    el.hidden = true;
    if (!lbFinished) { lbFinished = true; loadLeaderboard(true); }
    return;
  }
  el.hidden = false;
  el.classList.remove('done');
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const label = document.createElement('span');
  label.className = 'lb-timer-label';
  label.textContent = tr('Итоги через');
  const value = document.createElement('b');
  value.textContent = `${d > 0 ? `${d}${tr('д')} ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  el.replaceChildren(label, value);
}

function lbStartTimer(on) {
  clearInterval(lbTimerId);
  lbTimerId = 0;
  if (on && lbEndsAt) {
    lbTick();
    lbTimerId = setInterval(lbTick, 1000);
  }
}

function lbPodiumCard(prize, holder) {
  const card = document.createElement('div');
  card.className = `lb-place lb-p${prize.place}`;

  const medal = document.createElement('div');
  medal.className = 'lb-medal';
  medal.textContent = prize.place;

  const pic = lbPrizeVisual(prize);

  const pname = document.createElement('div');
  pname.className = 'lb-prize-name';
  pname.textContent = trName(prize.name);

  const who = document.createElement('div');
  who.className = 'lb-holder';
  if (holder) {
    who.appendChild(lbAvatar(holder.name, holder.avatar, 'lb-ava lb-ava-sm'));
    const n = document.createElement('span');
    n.className = 'lb-holder-name';
    n.textContent = holder.name;
    const s = document.createElement('b');
    s.textContent = fmtTon(holder.total_ton);
    who.append(n, s);
  } else {
    who.classList.add('free');
    who.textContent = tr('место свободно');
  }

  card.append(medal, pic, pname, who);
  return card;
}

const LB_SHOW_PRIZES = false;

function renderLeaderboard(data) {
  const since = new Date(data.since * 1000);
  $('lbSince').textContent = since.toLocaleDateString(I18N.locale || 'ru-RU', { day: 'numeric', month: 'long' });

  lbEndsAt = data.ends * 1000;
  lbSkew = data.now * 1000 - Date.now();
  lbFinished = !!data.finished;
  lbEndless = !!data.endless || !!data.alltime;   // без срока или за всё время — таймера нет
  $('lbSubAll').hidden = !data.alltime;
  $('lbSubSeason').hidden = !!data.alltime;
  lbStartTimer(!$('view-leaders').hidden);

  const byRank = {};
  for (const r of data.rows) byRank[r.rank] = r;

  
  
  const podium = $('lbPodium');
  podium.replaceChildren();
  podium.hidden = !LB_SHOW_PRIZES;
  const prizes = {};
  if (LB_SHOW_PRIZES) {
    for (const p of data.prizes) prizes[p.place] = p;
    for (const place of [2, 1, 3]) {
      if (prizes[place]) podium.appendChild(lbPodiumCard(prizes[place], byRank[place]));
    }
  }

  
  const me = $('lbMe');
  me.replaceChildren();
  me.className = 'lb-me';
  if (data.me.excluded) {
    me.textContent = tr('Админы в рейтинге не участвуют');
    me.classList.add('muted');
  } else if (data.me.rank) {
    const r = document.createElement('span');
    r.className = 'lb-me-rank';
    r.textContent = `#${data.me.rank}`;
    const t = document.createElement('span');
    t.className = 'lb-me-label';
    t.textContent = tr('Твоё место');
    const s = document.createElement('b');
    s.textContent = fmtTon(data.me.total_ton);    me.append(r, t, s);
  } else {
    me.textContent = tr('Тебя пока нет в топе — крути апгрейд или играй в «Три шляпы», чтобы попасть в рейтинг');
    me.classList.add('muted');
  }

  
  const list = $('lbList');
  list.replaceChildren();
  for (const row of data.rows) {
    const li = document.createElement('li');
    li.className = 'lb-row';
    if (row.rank <= 3) li.classList.add(`top${row.rank}`);
    if (row.me) li.classList.add('me');

    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.textContent = row.rank;

    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = row.me ? tr('{name} (ты)', { name: trName(row.name) }) : trName(row.name);

    const sum = document.createElement('b');
    sum.className = 'lb-sum';
    sum.textContent = fmtTon(row.total_ton);

    li.append(rank, lbAvatar(row.name, row.avatar), name, sum);
    if (prizes[row.rank]) {
      const mini = document.createElement('img');
      mini.className = 'lb-mini';
      mini.src = prizes[row.rank].img;
      mini.alt = '';
      li.appendChild(mini);
    }
    list.appendChild(li);
  }
  $('lbEmpty').hidden = data.rows.length > 0;
}

async function loadLeaderboard(force = false) {
  if (lbLoading) return;
  if (!force && Date.now() - lbLoadedAt < LB_MIN_INTERVAL) return;
  lbLoading = true;
  try {
    const data = await api('/api/leaderboard');
    lbLoadedAt = Date.now();
    renderLeaderboard(data);
  } catch (e) {
    if (!lbLoadedAt) toast(tr('Не удалось загрузить топ'), true);
  } finally {
    lbLoading = false;
  }
}





let shellOrder = [0, 1, 2];
let shellPhase = 'idle';          // idle | intro | shuffle | pick | reveal
let shellCfg = null;




let shellRound = 0;

const SHUFFLE_SWAPS = 16;         // сколько раз шляпы меняются местами
const SWAP_FIRST_MS = 400;        // первая перестановка — можно уследить
const SWAP_DECAY = 0.84;          // каждая следующая быстрее
const SWAP_MIN_MS = 70;           // предел: в конце уследить уже нельзя

function shellHats() {
  return [...document.querySelectorAll('#shellTable .shell-hat')];
}


function shellStep() {
  const table = $('shellTable');
  return (table ? table.clientWidth : 330) / 3;
}


function shellTf(slot, dy = 0, scale = 1) {
  const x = (slot - 1) * shellStep();
  return `translate(${x.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale})`;
}


function shellPlace() {
  const hats = shellHats();
  shellOrder.forEach((hatIdx, slot) => {
    hats[hatIdx].style.transform = shellTf(slot);
  });
}


function shellPlan() {
  const plan = [];
  let dur = SWAP_FIRST_MS;
  let prev = -1;
  for (let i = 0; i < SHUFFLE_SWAPS; i++) {
    let a = Math.floor(Math.random() * 3);
    let b;
    do { b = Math.floor(Math.random() * 3); } while (b === a);
    
    const key = Math.min(a, b) * 3 + Math.max(a, b);
    if (key === prev && i) { const t = a; a = b; b = (3 - t - b); }
    prev = Math.min(a, b) * 3 + Math.max(a, b);
    plan.push({ a, b, dur: Math.round(dur) });
    dur = Math.max(SWAP_MIN_MS, dur * SWAP_DECAY);
  }
  return plan;
}


function shellShuffle(round, done) {
  const hats = shellHats();
  const plan = shellPlan();
  const total = plan.reduce((s, p) => s + p.dur, 0);
  const frames = hats.map(() => []);

  
  shellOrder.forEach((hatIdx, slot) => {
    frames[hatIdx].push({ offset: 0, transform: shellTf(slot) });
  });

  let t = 0;
  for (const p of plan) {
    const hatA = shellOrder[p.a];
    const hatB = shellOrder[p.b];
    const t0 = t / total;
    const tm = (t + p.dur / 2) / total;
    const t1 = (t + p.dur) / total;
    const mid = (p.a + p.b) / 2;

    
    frames[hatA].push({ offset: t0, transform: shellTf(p.a), easing: 'ease-in-out' });
    frames[hatB].push({ offset: t0, transform: shellTf(p.b), easing: 'ease-in-out' });
    
    frames[hatA].push({ offset: tm, transform: shellTf(mid, -26, 0.9), easing: 'ease-in-out' });
    frames[hatB].push({ offset: tm, transform: shellTf(mid, 16, 1.08), easing: 'ease-in-out' });
    
    frames[hatA].push({ offset: t1, transform: shellTf(p.b) });
    frames[hatB].push({ offset: t1, transform: shellTf(p.a) });

    shellOrder[p.a] = hatB;
    shellOrder[p.b] = hatA;
    t += p.dur;
  }

  shellOrder.forEach((hatIdx, slot) => {
    frames[hatIdx].push({ offset: 1, transform: shellTf(slot) });
  });

  
  
  const running = [];
  hats.forEach((hat, i) => {
    hat.getAnimations().forEach((a) => a.cancel());
    hat.style.zIndex = '';
    running.push(hat.animate(frames[i], { duration: total, easing: 'linear', fill: 'forwards' }));
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    running.forEach((a) => a.cancel());   // отдаём управление обратно inline-стилю
    if (!shellAlive(round)) return;       // партию успели сменить — молча выходим
    shellPlace();
    done();
  };
  if (running.length) {
    running[running.length - 1].onfinish = finish;
    
    setTimeout(finish, total + 300);
  } else {
    finish();
  }
  return total;
}

function shellSetHint(text, cls = '') {
  const el = $('shellHint');
  el.textContent = text;
  el.className = 'shell-hint' + (cls ? ' ' + cls : '');
}

function shellClearMarks() {
  shellHats().forEach((h) => h.classList.remove('chosen', 'miss'));
}


function shellAlive(round) {
  return round === shellRound;
}


function shellReset() {
  const intro = $('shellCatIntro');
  if (intro) {
    intro.getAnimations().forEach((a) => a.cancel());
    intro.style.opacity = '';
    intro.style.transform = '';
  }
  shellHats().forEach((hat) => {
    const cap = hat.querySelector('.shell-cap');
    const cat = hat.querySelector('.shell-cat');
    [hat, cap, cat].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    cap.style.transform = '';
    cat.style.opacity = '';
    cat.style.transform = '';
    hat.classList.remove('chosen', 'miss');
    hat.style.zIndex = '';
  });
  $('shellTable').classList.remove('picking');
  shellPlace();
}

const CAP_UP = 'translateY(-124px) rotate(-13deg)';
const CAP_DOWN = 'translateY(0px) rotate(0deg)';


function shellAnimate(el, frames, opts, finalStyle) {
  el.getAnimations().forEach((a) => a.cancel());
  Object.assign(el.style, finalStyle);
  el.animate(frames, opts);
}


function shellLift(hat, withCat) {
  const cap = hat.querySelector('.shell-cap');
  const cat = hat.querySelector('.shell-cat');

  shellAnimate(cap, [
    { transform: CAP_DOWN },
    { transform: 'translateY(-138px) rotate(-17deg)', offset: 0.45 },
    { transform: 'translateY(-118px) rotate(-11deg)', offset: 0.72 },
    { transform: CAP_UP },
  ], { duration: 460, easing: 'cubic-bezier(.22,.9,.3,1)' }, { transform: CAP_UP });

  if (!withCat) return;
  
  
  shellAnimate(cat, [
    { opacity: 0, transform: 'translateY(30px) scale(.7)' },
    { opacity: 0, transform: 'translateY(30px) scale(.7)', offset: 0.22 },
    { opacity: 1, transform: 'translateY(-6px) scale(1.06)', offset: 0.68 },
    { opacity: 1, transform: 'translateY(0px) scale(1)' },
  ], { duration: 540, easing: 'ease-out' }, { opacity: '1', transform: 'none' });
}


function shellDrop() {
  shellHats().forEach((hat) => {
    const cap = hat.querySelector('.shell-cap');
    const cat = hat.querySelector('.shell-cat');
    shellAnimate(cap, [{ transform: CAP_UP }, { transform: CAP_DOWN }],
      { duration: 300, easing: 'cubic-bezier(.5,0,.75,.6)' }, { transform: '' });
    cat.getAnimations().forEach((a) => a.cancel());
    cat.style.opacity = '';       // вернулись к базовому «спрятан»
    cat.style.transform = '';
  });
  shellClearMarks();
}


let shellGift = null;
let shellRoundGift = null;       // на что идёт текущая партия


function shellCost() {
  if (!shellGift) return shellCfg.cost_ton;
  if (shellGift.cost_ton != null) return shellGift.cost_ton;
  return roundTon(shellGift.price_ton * (shellCfg.price_share || 0));
}


let shellHiddenKey = null;
function shellApplyHidden(gift) {
  const key = gift ? gift.image : 'cat';
  if (key === shellHiddenKey) return;
  shellHiddenKey = key;
  [$('shellCatIntro'), ...document.querySelectorAll('.shell-cat')].forEach((img) => {
    img.classList.toggle('is-gift', !!gift);
    if (gift) setGiftImg(img, gift.image, giftImage(gift.slug));
    else { img.onerror = null; img.src = 'assets/cat.png'; }
  });
}


function shellText(key, gift) {
  const t = gift ? {
    subtitle: tr('под одной спрятан подарок — найди его'),
    idle: tr('Жми «Угадать» — подарок покажется и спрячется'),
    hiding: tr('Подарок сейчас спрячется'),
    pick: tr('Где подарок? Жми на шляпу'),
    win: tr('Подарок твой! Он уже в профиле'),
    lose: tr('Подарок был не там. Ещё разок?'),
  } : {
    subtitle: tr('под одной сидит кот — найди его'),
    idle: tr('Жми «Угадать» — кот покажется и спрячется'),
    hiding: tr('Кот сейчас спрячется'),
    pick: tr('Где кот? Жми на шляпу'),
    win: tr('Кот твой! Приз в профиле'),
    lose: tr('Кот был не там. Ещё разок?'),
  };
  return t[key];
}


function shellIdleHint() {
  return lsGet('shellPlayed') === '1' ? '' : shellText('idle', shellGift);
}

function renderShellPrize() {
  const box = $('shellPrize');
  if (!shellCfg) return;
  
  
  if (shellPhase === 'idle') {
    shellApplyHidden(shellGift);
    $('shellSubtitle').textContent = shellText('subtitle', shellGift);
  }
  box.hidden = !shellCfg.gifts;          // без каталога приз один — шляпа
  const img = $('shellPrizeImg');
  if (shellGift) {
    setGiftImg(img, shellGift.image, giftImage(shellGift.slug));
    img.classList.add('is-gift');
    $('shellPrizeName').textContent = shellGift.name;
    $('shellPrizeInfo').textContent = tr('{price} TON · шанс 1 из {cups}', { price: fmt(shellGift.price_ton, 2), cups: shellCfg.cups });
  } else {
    img.onerror = null;
    img.src = TIER_HAT_ASSET.random;
    img.classList.remove('is-gift');
    $('shellPrizeName').textContent = trName(shellCfg.prize_name) || hatPrizeName();
    $('shellPrizeInfo').textContent = tr('шанс 1 из {cups}', { cups: shellCfg.cups });
  }
}

function updateShellButton() {
  if (!shellCfg || !state) return;
  const cost = shellCost();
  const enough = state.balance_ton + 1e-9 >= cost;
  const busy = shellPhase !== 'idle';
  $('shellBtn').disabled = busy || !enough;
  $('shellBtn').textContent = busy
    ? tr('Идёт игра…')
    : (enough ? tr('Угадать за {sum} TON', { sum: fmt(cost, 2) }) : tr('Не хватает на игру'));
  
  $('shellDepositBtn').hidden = enough;
  $('shellPrize').disabled = busy;       // приз нельзя менять посреди партии
}

function renderShell(cfg) {
  shellCfg = cfg.shell || null;
  const tab = $('menuShell');             // «Три шляпы» открываются из меню
  if (!shellCfg || !shellCfg.enabled) {
    if (tab) tab.hidden = true;
    return;
  }
  if (tab) tab.hidden = false;
  $('shellTabName').textContent = tr(shellCfg.tab_name);
  if (!shellCfg.gifts) shellGift = null;         // каталог выключили — остаётся шляпа
  renderShellPrize();
  if (shellPhase === 'idle') {
    shellSetHint(shellIdleHint());
    shellPlace();
  }
  updateShellButton();
}


async function shellStart() {
  if (shellPhase !== 'idle' || !shellCfg || !state) return;
  if (state.balance_ton + 1e-9 < shellCost()) { openDeposit(); return; }

  
  
  
  
  shellPhase = 'starting';
  shellRoundGift = shellGift;
  updateShellButton();
  try {
    const res = await api('/api/shell/start', shellGift
      ? { gift: shellGift.slug, model: shellGift.model, cost: shellCost() }
      : {});
    state.balance_ton = res.balance_ton;
    $('balanceValue').textContent = fmt(res.balance_ton, 4);
    updateSpinButton();
  } catch (e) {
    shellPhase = 'idle';
    if (e.code === 'price_changed' && shellGift) {
      
      shellGift.price_ton = e.data.price_ton;
      shellGift.cost_ton = e.data.cost_ton;
      renderShellPrize();
      updateShellButton();
      shellSetHint(tr('Цена подарка обновилась — проверь и жми «Угадать»'), 'lose');
      return;
    }
    if (e.code === 'gift_unavailable') {
      shellGift = null;
      renderShellPrize();
      updateShellButton();
      shellSetHint(tr('Этот подарок сейчас недоступен — выбери другой'), 'lose');
      return;
    }
    updateShellButton();
    if (e.code === 'insufficient_funds') { refresh(); openDeposit(); return; }
    shellSetHint(e.code === 'mode_disabled' ? tr('Режим сейчас выключен') : tr('Ошибка запроса'), 'lose');
    return;
  }

  const round = ++shellRound;      // новая партия: старые таймеры обесценены
  lsSet('shellPlayed', '1');                 // подсказка «Жми «Угадать»» больше не нужна
  shellApplyHidden(shellRoundGift);          // под шляпами — приз этой партии
  shellPhase = 'intro';
  shellReset();
  updateShellButton();
  haptic('impact', 'light');

  
  
  const intro = $('shellCatIntro');
  shellAnimate(intro, [
    { opacity: 0, transform: 'translateY(24px) scale(.6)' },
    { opacity: 1, transform: 'translateY(-6px) scale(1.06)', offset: 0.45 },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ], { duration: 700, easing: 'ease-out' }, { opacity: '1', transform: 'none' });
  shellSetHint(shellText('hiding', shellRoundGift));

  setTimeout(() => {
    if (!shellAlive(round)) return;
    
    shellAnimate(intro, [
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(56px) scale(.45)' },
    ], { duration: 320, easing: 'ease-in' }, { opacity: '', transform: '' });

    setTimeout(() => {
      if (!shellAlive(round)) return;
      shellPhase = 'shuffle';
      shellSetHint(tr('Мешаем!'));
      shellShuffle(round, () => {
        if (!shellAlive(round)) return;
        shellPhase = 'pick';
        $('shellTable').classList.add('picking');
        shellSetHint(shellText('pick', shellRoundGift));
        updateShellButton();
      });
    }, 300);
  }, 1200);
}

async function shellPick(hatEl) {
  if (shellPhase !== 'pick') return;
  const round = shellRound;
  const hats = shellHats();
  const hatIdx = hats.indexOf(hatEl);
  const slot = shellOrder.indexOf(hatIdx);
  if (slot < 0) return;

  shellPhase = 'reveal';
  $('shellTable').classList.remove('picking');
  hatEl.classList.add('chosen');
  shellSetHint(tr('Смотрим…'));
  haptic('impact', 'medium');

  let res;
  try {
    res = await api('/api/shell/play', shellRoundGift
      ? { pick: slot, gift: shellRoundGift.slug }
      : { pick: slot });
  } catch (e) {
    if (!shellAlive(round)) return;
    shellPhase = 'idle';
    shellClearMarks();
    const messages = {
      round_expired: tr('Партия устарела, ставка вернулась — жми «Угадать»'),
      insufficient_funds: tr('Недостаточно средств'),
      too_fast: tr('Слишком часто, подожди секунду'),
      mode_disabled: tr('Режим сейчас выключен'),
      bad_pick: tr('Странный выбор, попробуй ещё раз'),
    };
    shellSetHint(messages[e.code] || tr('Ошибка запроса'), 'lose');
    updateShellButton();
    if (e.code === 'insufficient_funds' || e.code === 'round_expired') refresh();
    return;
  }

  if (!shellAlive(round)) return;
  setCoins(res.hatcoin_balance);

  
  
  const catHat = hats[shellOrder[res.cat]];

  
  shellLift(hatEl, hatEl === catHat);
  if (!res.win) hatEl.classList.add('miss');

  setTimeout(() => {
    if (!shellAlive(round)) return;
    hats.forEach((h) => { if (h !== hatEl) shellLift(h, h === catHat); });

    if (res.win) {
      haptic('notification', 'success');
      const r = catHat.getBoundingClientRect();
      const st = document.querySelector('.stage').getBoundingClientRect();
      burstSparks(r.left + r.width / 2 - st.left, r.top + r.height / 2 - st.top);
      shellSetHint(shellText('win', shellRoundGift), 'win');
      
      spinTier = shellRoundGift ? `url:${shellRoundGift.image}` : 'random';
      flyPrizeToProfile(() => {});
    } else if (res.consolation) {
      haptic('notification', 'error');
      
      
      shellSetHint(shellText('lose', shellRoundGift), 'lose');
      if (res.consolation.first) toast(bearText(), false, 4200);
      flyItemToProfile(hatEl, BEAR_ASSET);
    } else {
      haptic('notification', 'error');
      shellSetHint(shellText('lose', shellRoundGift), 'lose');
    }

    setTimeout(() => {
      if (!shellAlive(round)) return;
      shellDrop();
      shellPhase = 'idle';
      shellPlace();
      shellSetHint(tr('Ещё разок?'));
      updateShellButton();
    }, 2200);

    refresh();
  }, res.win ? 420 : 620);
}





const SPIN_SLOW_MS = 3700;
const SPIN_FAST_MS = 650;

const TURNS_SLOW = 5;
const TURNS_FAST = 1;

let fastSpin = false;

function spinMs() { return fastSpin ? SPIN_FAST_MS : SPIN_SLOW_MS; }


function setFast(on, save = true) {
  fastSpin = !!on;
  document.body.classList.toggle('fast', fastSpin);
  const btn = $('fastBtn');
  if (btn) btn.setAttribute('aria-pressed', fastSpin ? 'true' : 'false');
  if (!save) return;
  
  
  try { localStorage.setItem('fastSpin', fastSpin ? '1' : '0'); } catch (e) {  }
}

function loadFast() {
  let saved = false;
  try { saved = localStorage.getItem('fastSpin') === '1'; } catch (e) {  }
  setFast(saved, false);
}

const STAFF_STATES = ['charging', 'charging-wild', 'cast', 'resting'];

function staffSet(...states) {
  const staff = $('staff');
  const orb = $('staffOrb');
  if (!staff || !orb) return false;
  staff.classList.remove(...STAFF_STATES);
  orb.classList.remove('charging', 'charging-wild', 'fading', 'spent');
  
  
  void staff.offsetWidth;
  if (states.length) {
    staff.classList.add(states[0]);
    orb.classList.add(states[1] || states[0]);
  }
  return true;
}



let boltTimer = 0;



const BOLT_PATTERNS = ['zigzag', 'coil', 'arc', 'fork'];
let boltPattern = 'zigzag';
let coilPhase = 0;


function buildBolt(x0, y0, x1, y1, reach, power) {
  const segments = boltPattern === 'coil' ? 16 : 11;
  const dx = (x1 - x0) * reach;
  const dy = (y1 - y0) * reach;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;     // нормаль: вдоль неё уводим точки вбок
  const ny = dx / len;

  const points = [[x0, y0]];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    let off = 0;

    if (i < segments) {           // кончик всегда на линии, иначе он виляет
      if (boltPattern === 'coil') {
        
        off = Math.sin(t * Math.PI * 3.4 + coilPhase) * power * 1.5 * (0.4 + t);
      } else if (boltPattern === 'arc') {
        
        off = Math.sin(t * Math.PI) * power * 2.4 + (Math.random() * 2 - 1) * power * 0.25;
      } else {
        off = (Math.random() * 2 - 1) * power;
      }
    }
    points.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
  }

  const toPath = (pts) =>
    pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  
  let fork = '';
  if (boltPattern === 'fork') {
    const branches = 2;
    for (let b = 0; b < branches; b++) {
      const from = 3 + Math.floor(Math.random() * (segments - 5));
      const [bx, by] = points[from];
      const side = Math.random() < 0.5 ? 1 : -1;
      const steps = 3;
      const pts = [[bx, by]];
      for (let s = 1; s <= steps; s++) {
        const k = s / steps;
        pts.push([
          bx + dx * 0.16 * k + nx * side * power * 2.6 * k,
          by + dy * 0.16 * k + ny * side * power * 2.6 * k,
        ]);
      }
      fork += (fork ? ' ' : '') + toPath(pts);
    }
  }

  return { main: toPath(points), fork, tip: points[points.length - 1], points };
}


function boltEnds() {
  const orb = $('staffOrb');
  const target = document.querySelector('.wheel-center');
  const stage = document.querySelector('.stage');
  if (!orb || !target || !stage) return null;

  const s = stage.getBoundingClientRect();
  const o = orb.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  return {
    x0: o.left + o.width / 2 - s.left,
    y0: o.top + o.height / 2 - s.top,
    x1: t.left + t.width / 2 - s.left,
    y1: t.top + t.height / 2 - s.top,
  };
}


function pointAlong(points, f) {
  const lens = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let want = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? want / lens[i] : 0;
      return [
        points[i][0] + (points[i + 1][0] - points[i][0]) * k,
        points[i][1] + (points[i + 1][1] - points[i][1]) * k,
      ];
    }
    want -= lens[i];
  }
  return points[points.length - 1];
}

let sparkPhase = 0;

function drawBolt(reach, power) {
  const ends = boltEnds();
  if (!ends) return;
  coilPhase += 0.55;        // спираль «течёт» вдоль разряда
  sparkPhase = (sparkPhase + 0.12) % 1;

  const { main, fork, tip, points } = buildBolt(ends.x0, ends.y0, ends.x1, ends.y1, reach, power);

  ['boltCore', 'boltMid', 'boltAura', 'boltHalo'].forEach((id) => $(id).setAttribute('d', main));
  $('boltFork').setAttribute('d', fork);

  [$('boltTip'), $('boltTipGlow')].forEach((el) => {
    el.setAttribute('cx', tip[0].toFixed(1));
    el.setAttribute('cy', tip[1].toFixed(1));
  });

  
  ['boltP1', 'boltP2', 'boltP3'].forEach((id, i) => {
    const [x, y] = pointAlong(points, (sparkPhase + i * 0.33) % 1);
    $(id).setAttribute('cx', x.toFixed(1));
    $(id).setAttribute('cy', y.toFixed(1));
  });
}


function clearBolt() {
  ['boltCore', 'boltMid', 'boltAura', 'boltHalo', 'boltFork'].forEach(
    (id) => $(id).setAttribute('d', ''),
  );
  ['boltTip', 'boltTipGlow', 'boltP1', 'boltP2', 'boltP3'].forEach((id) => {
    $(id).setAttribute('cx', '-50');
    $(id).setAttribute('cy', '-50');
  });
}


function startBolt() {
  const bolt = $('bolt');
  if (!bolt) return;

  clearInterval(boltTimer);
  bolt.classList.remove('strike');
  bolt.style.opacity = '0';
  boltPattern = BOLT_PATTERNS[Math.floor(Math.random() * BOLT_PATTERNS.length)];
  coilPhase = Math.random() * 6;

  const t0 = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - t0) / spinMs());
    
    drawBolt(0.28 + 0.62 * t, 7 + 13 * t);
    
    bolt.style.opacity = ((0.35 + 0.6 * t) * (0.88 + Math.random() * 0.12)).toFixed(2);
    if (t >= 1) clearInterval(boltTimer);
  };
  tick();
  boltTimer = setInterval(tick, 70);
}


function burstSparks(x, y, count = 12) {
  const box = $('sparks');
  if (!box) return;
  const frag = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 40 + Math.random() * 70;
    const s = document.createElement('i');
    s.style.setProperty('--sx', `${x.toFixed(0)}px`);
    s.style.setProperty('--sy', `${y.toFixed(0)}px`);
    s.style.setProperty('--ex', `${(x + Math.cos(angle) * dist).toFixed(0)}px`);
    s.style.setProperty('--ey', `${(y + Math.sin(angle) * dist).toFixed(0)}px`);
    s.style.animationDelay = `${Math.round(Math.random() * 90)}ms`;
    frag.appendChild(s);
  }

  box.appendChild(frag);
  setTimeout(() => { box.innerHTML = ''; }, 900);
}




const BEAR_ASSET = '/static/img/hat.png';
const bearText = () => tr('Хоть тебе и не повезло, но держи волшебного мишку, пускай он принесёт тебе удачу! 🧸');


function flyItemToProfile(fromEl, src) {
  const stage = document.querySelector('.stage');
  const tab = document.querySelector('.tab[data-view="profile"]');
  if (!stage || !fromEl || !tab) return;
  const s = stage.getBoundingClientRect();
  const f = fromEl.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  if (!f.width) return;            // вкладка скрыта — лететь неоткуда
  const x0 = f.left + f.width / 2 - s.left;
  const y0 = f.top + f.height / 2 - s.top;
  const x1 = t.left + t.width / 2 - s.left;
  const y1 = t.top + t.height / 2 - s.top;
  const ctrlX = x0 + Math.max(150, stage.clientWidth * 0.42);
  const ctrlY = y0 - 40;

  const img = document.createElement('img');
  img.className = 'prize-fly bear-fly';
  img.src = src;
  img.alt = '';
  stage.appendChild(img);

  
  const frames = [
    { transform: `translate(${x0}px, ${y0}px) scale(.2)`, opacity: '0', offset: 0 },
    { transform: `translate(${x0}px, ${y0 - 24}px) scale(1.1)`, opacity: '1', offset: 0.14 },
    { transform: `translate(${x0}px, ${y0 - 18}px) scale(1)`, opacity: '1', offset: 0.25 },
  ];
  const STEPS = 22;
  for (let i = 1; i <= STEPS; i++) {
    const k = i / STEPS;
    const inv = 1 - k;
    const sy = y0 - 18;
    const x = inv * inv * x0 + 2 * inv * k * ctrlX + k * k * x1;
    const y = inv * inv * sy + 2 * inv * k * ctrlY + k * k * y1;
    frames.push({
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 - 0.84 * k * k).toFixed(3)}) rotate(${(k * -24).toFixed(1)}deg)`,
      opacity: k > 0.85 ? String(1 - (k - 0.85) / 0.15) : '1',
      offset: 0.25 + 0.75 * k,
    });
  }
  img.animate(frames, { duration: 1300, easing: 'ease-in-out', fill: 'forwards' });
  setTimeout(() => {
    img.remove();
    tab.classList.add('got');
    setTimeout(() => tab.classList.remove('got'), 600);
  }, 1260);
}


function flyPrizeToProfile(done) {
  const fly = $('prizeFly');
  const stage = document.querySelector('.stage');
  const from = document.querySelector('.wheel-center');
  const tab = document.querySelector('.tab[data-view="profile"]');
  if (!fly || !stage || !from || !tab) { done(); return; }

  const s = stage.getBoundingClientRect();
  const f = from.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  const x0 = f.left + f.width / 2 - s.left;
  const y0 = f.top + f.height / 2 - s.top;
  const x1 = t.left + t.width / 2 - s.left;
  const y1 = t.top + t.height / 2 - s.top;

  
  
  
  const ctrlX = x0 + Math.max(150, stage.clientWidth * 0.42);
  const ctrlY = y0 - 20;
  const STEPS = 26;
  const frames = [];

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const inv = 1 - t;
    const x = inv * inv * x0 + 2 * inv * t * ctrlX + t * t * x1;
    const y = inv * inv * y0 + 2 * inv * t * ctrlY + t * t * y1;
    const scale = 1 - 0.86 * t * t;            // уменьшается к концу
    frames.push({
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)}) rotate(${(t * 34).toFixed(1)}deg)`,
      opacity: t > 0.82 ? String(1 - (t - 0.82) / 0.18) : '1',
      offset: t,
    });
  }

  fly.style.animation = 'none';   // CSS-анимацию не используем, путь задаём сами
  fly.src = hatAsset(spinTier);   // улетает шляпа того тира, который выиграли
  fly.hidden = false;
  fly.animate(frames, { duration: 760, easing: 'cubic-bezier(.34,.05,.28,1)', fill: 'forwards' });

  setTimeout(() => {
    fly.hidden = true;
    tab.classList.add('got');
    haptic('impact', 'light');
    setTimeout(() => tab.classList.remove('got'), 600);
    done();
  }, 720);
}


function boltStrike() {
  const bolt = $('bolt');
  if (!bolt) return;
  clearInterval(boltTimer);
  bolt.classList.add('strike');
  bolt.style.opacity = '1';
  drawBolt(1, 9);
  
  boltTimer = setInterval(() => drawBolt(1, 9), 60);
  setTimeout(() => {
    clearInterval(boltTimer);
    bolt.style.opacity = '0';
    setTimeout(() => { bolt.classList.remove('strike'); clearBolt(); }, 260);
  }, 420);
}


function boltFade() {
  const bolt = $('bolt');
  if (!bolt) return;
  clearInterval(boltTimer);
  bolt.style.opacity = '0';
  setTimeout(clearBolt, 300);
}


function startStaffCharge() {
  const rhythm = Math.random() < 0.5 ? 'charging' : 'charging-wild';
  staffSet(rhythm, 'charging');
  startBolt();
}


function restStaff() {
  staffSet('resting', 'fading');
  boltFade();
}


function castSpell(done) {
  const orb = $('staffOrb');
  const spell = $('spell');
  const stage = document.querySelector('.stage');
  const target = document.querySelector('.wheel-center');
  if (!orb || !spell || !stage || !target || !staffSet('cast', 'spent')) {
    boltFade();
    done();
    return;
  }

  boltStrike();   // разряд дотягивается до шляпы

  
  const stageRect = stage.getBoundingClientRect();
  const from = orb.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  spell.style.setProperty('--x0', `${from.left + from.width / 2 - stageRect.left}px`);
  spell.style.setProperty('--y0', `${from.top + from.height / 2 - stageRect.top}px`);
  spell.style.setProperty('--x1', `${to.left + to.width / 2 - stageRect.left}px`);
  spell.style.setProperty('--y1', `${to.top + to.height / 2 - stageRect.top}px`);

  spell.hidden = true;
  void spell.offsetWidth;      // сбрасываем анимацию перед повторным запуском
  spell.hidden = false;

  setTimeout(() => {
    spell.hidden = true;
    target.classList.add('hit');
    setTimeout(() => target.classList.remove('hit'), 520);
    haptic('impact', 'heavy');

    
    const s = stage.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    burstSparks(t.left + t.width / 2 - s.left, t.top + t.height / 2 - s.top);

    restStaff();
    
    
    setTimeout(() => flyPrizeToProfile(done), 220);
  }, 480);
}


async function doSpin() {
  const mode = currentMode();
  if (spinning || homing || !state || !mode) return;
  if (needsPick) {                 // приз ещё не выбран — сначала в список
    markHintSeen();
    openGiftPicker();
    return;
  }
  if (state.balance_ton + 1e-9 < mode.cost_ton) {
    toast(tr('Не хватает на апгрейд — пополни баланс'), true);
    openDeposit();
    return;
  }

  const giftSpin = currentTier === 'gift' && selectedGift;
  spinning = true;
  spinTier = giftSpin ? `url:${selectedGift.image}` : currentTier;
  const balanceBefore = state.balance_ton;
  setBalance(balanceBefore - mode.cost_ton);   // ставка уходит с баланса сразу по нажатию
  $('spinBtn').disabled = true;
  $('modeSlider').disabled = true;

  
  
  $('fastBtn').disabled = true;

  document.querySelector('.wheel-wrap').classList.add('rolling');
  startStaffCharge();
  haptic('impact', 'light');

  let result;

  try {
    result = await api('/api/spin', giftSpin
      ? { chance: mode.chance, tier: 'gift', gift: selectedGift.slug, model: selectedGift.model, cost: mode.cost_ton }
      : { chance: mode.chance, tier: currentTier });
    setBalance(result.balance_ton);            // точный баланс от сервера (приз в него не входит — исход не выдаёт)
    setCoins(result.hatcoin_balance);          // кешбэк коинами — за любую игру, исход тоже не выдаёт
  } catch (e) {
    setBalance(balanceBefore);                 // прокрутки не было — ставку показываем обратно
    spinning = false;
    $('modeSlider').disabled = false;
    $('fastBtn').disabled = false;
    document.querySelector('.wheel-wrap').classList.remove('rolling');
    restStaff();
    updateSpinButton();

    const messages = {
      insufficient_funds: tr('Недостаточно средств'),
      too_fast: tr('Слишком часто, подожди секунду'),
      too_many_requests: tr('Слишком много запросов, подожди немного'),
      price_changed: tr('Цена подарка обновилась — проверь и крути снова'),
      gift_unavailable: tr('Этот подарок сейчас недоступен'),
    };

    toast(messages[e.code] || tr('Ошибка запроса'), true);

    if (e.code === 'insufficient_funds') refresh();
    if (e.code === 'price_changed' || e.code === 'gift_unavailable') loadGiftCatalog(true).catch(() => {});
    return;
  }

  
  
  
  
  
  

  const visibleChance = mode.chance;

  let targetAngle;

  if (result.win) {
    
    const winSize = visibleChance * 360;

    targetAngle = Math.random() * winSize;
  } else {
    
    const loseStart = visibleChance * 360;
    const loseSize = (1 - visibleChance) * 360;

    targetAngle = loseStart + Math.random() * loseSize;
  }

  
  
  const current = ((pointerDeg % 360) + 360) % 360;
  const turns = fastSpin ? TURNS_FAST : TURNS_SLOW;

  pointerDeg +=
    360 * turns +
    ((targetAngle - current + 360) % 360);

  const pointer = $('pointer');
  let spinDur = spinMs();                      // сколько ждать до показа исхода

  if (isMeadow() && spinStyle === 'wild') {
    
    
    const thrown = throwPointer(pointer, current, targetAngle);
    pointerDeg = thrown.deg;
    spinDur = thrown.ms;                         // с разворотами бросок длится дольше
  } else {
    pointer.classList.add('spinning');

    requestAnimationFrame(() => {
      pointer.style.transform = `rotate(${pointerDeg}deg)`;
    });
  }

  setTimeout(() => {
    document.querySelector('.wheel-wrap').classList.remove('rolling');

    spinning = false;
    $('modeSlider').disabled = false;
    $('fastBtn').disabled = false;

    haptic(
      'notification',
      result.win ? 'success' : 'error'
    );

    if (result.win) {
      
      
      castSpell(() => showResult(result));
    } else {
      
      
      restStaff();
      showResult(result);
    }

    pointerHomeLater();
    refresh();
  }, spinDur);
}


const WILD_BASE_MS = 3200;      // без учёта разворотов
const WILD_STOP_MS = 1100;      // добавляется за каждую ложную остановку

function throwPointer(pointer, from, target) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const quick = fastSpin || calm;                  // быстрая прокрутка — один короткий заход
  const fakes = quick ? 0 : 1 + Math.floor(Math.random() * 3);     // 1, 2 или 3 ложные остановки
  const phases = fakes + 1;
  const total = quick ? spinMs() : WILD_BASE_MS + WILD_STOP_MS * fakes;
  let dir = Math.random() < 0.5 ? 1 : -1;
  const stops = [from];
  const weight = [];
  let a = from;
  for (let i = 0; i < phases; i++) {
    const last = i === phases - 1;
    const loops = quick ? 1 : Math.floor(i === 0 ? rnd(2, 3.99) : rnd(1, 2.99));
    if (last) {
      const delta = (((dir * (target - a)) % 360) + 360) % 360;   // дойти до target в эту сторону
      a += dir * (360 * loops + delta);
    } else {
      a += dir * (360 * loops + rnd(0, 360));       // ложная остановка — в случайном месте круга
    }
    stops.push(a);
    weight.push(i === 0 ? 1.3 : last ? 1.2 : 1);
    dir = -dir;
  }
  const sum = weight.reduce((x, y) => x + y, 0);
  
  
  
  const EASE_TURN = 'cubic-bezier(.25, .6, .6, .9)';
  const EASE_STOP = 'cubic-bezier(.16, .62, .18, 1)';
  const frames = [];
  let at = 0;
  stops.forEach((deg, i) => {
    const lastSeg = i >= stops.length - 2;
    frames.push({ transform: `rotate(${deg}deg)`, offset: Math.min(1, at), easing: lastSeg ? EASE_STOP : EASE_TURN });
    if (i < weight.length) {
      at += weight[i] / sum;
      if (i < weight.length - 1) setTimeout(() => haptic('impact', 'medium'), total * at);   // разворот
    }
  });
  frames[frames.length - 1].offset = 1;

  pointer.classList.remove('spinning');          // без CSS-перехода: движением управляет animate()
  pointer.style.transform = `rotate(${from}deg)`;
  const wrap = document.querySelector('.wheel-wrap');
  wrap.classList.add('throwing');
  let anim = null;
  try { anim = pointer.animate(frames, { duration: total, fill: 'forwards' }); } catch (e) {  }
  setTimeout(() => {
    pointer.style.transform = `rotate(${a}deg)`;  // закрепляем итог и снимаем анимацию
    if (anim) anim.cancel();
    wrap.classList.remove('throwing');
  }, total);
  return { deg: a, ms: total };
}




const WEAPONS = { axe: 'assets/axe-icon.webp?v=2', staff: 'assets/staff-icon.webp?v=2' };   // иконки для кнопки и меню

function setWeapon(name) {
  const w = WEAPONS[name] ? name : 'axe';
  document.documentElement.dataset.weapon = w;
  try { localStorage.setItem('weapon', w); } catch (e) {  }
  $('weaponIcon').src = WEAPONS[w];
  document.querySelectorAll('#weaponMenu [data-weapon]').forEach((b) => b.classList.toggle('on', b.dataset.weapon === w));
}




function initSky() {
  const btn = $('skyBtn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    haptic('impact', 'light');
    const next = document.documentElement.dataset.sky === 'night' ? 'day' : 'night';
    try { localStorage.setItem('sky', next); } catch (err) {  }
    if (window.setSky) window.setSky(next);
  });
}





let spinStyle = 'wild';

function setSpinStyle(name) {
  spinStyle = name === 'plain' ? 'plain' : 'wild';
  try { localStorage.setItem('spinStyle', spinStyle); } catch (e) {  }
  document.querySelectorAll('#spinMenu [data-spin]').forEach((b) => b.classList.toggle('on', b.dataset.spin === spinStyle));
}

function initSpinStyle() {
  let saved = 'wild';
  try { saved = localStorage.getItem('spinStyle') || 'wild'; } catch (e) {  }
  setSpinStyle(saved);
  const menu = $('spinMenu');
  $('gearBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (spinning) return;
    haptic('impact', 'light');
    $('weaponMenu').hidden = true;
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-spin]');
    if (!b) return;
    haptic('impact', 'light');
    setSpinStyle(b.dataset.spin);
    menu.hidden = true;
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#spinMenu')) menu.hidden = true; });
}

function initWeapon() {
  let saved = 'axe';
  try { saved = localStorage.getItem('weapon') || 'axe'; } catch (e) {  }
  setWeapon(saved);
  const menu = $('weaponMenu');
  $('weaponBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (spinning) return;
    haptic('impact', 'light');
    $('spinMenu').hidden = true;
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-weapon]');
    if (!b) return;
    haptic('impact', 'light');
    setWeapon(b.dataset.weapon);
    menu.hidden = true;
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('#weaponMenu')) menu.hidden = true; });
}


const POINTER_HOLD_MS = 350;       // сколько стрелка стоит на результате
const POINTER_BACK_MS = 160;       // сколько едет на ноль — почти мгновенно
const POINTER_HOLD_FAST_MS = 120;
const POINTER_BACK_FAST_MS = 120;
let pointerHomeTimer = 0;
let homing = false;

function pointerHomeLater() {  const hold = fastSpin ? POINTER_HOLD_FAST_MS : POINTER_HOLD_MS;
  const back = fastSpin ? POINTER_BACK_FAST_MS : POINTER_BACK_MS;
  homing = true;
  updateSpinButton();
  clearTimeout(pointerHomeTimer);
  pointerHomeTimer = setTimeout(() => {
    const pointer = $('pointer');
    pointerDeg = Math.round(pointerDeg / 360) * 360;    // ближайший «ноль»
    pointer.classList.remove('spinning');
    pointer.classList.add('returning');
    pointer.style.transitionDuration = `${back}ms`;
    pointer.style.transform = `rotate(${pointerDeg}deg)`;
    pointerHomeTimer = setTimeout(() => {
      pointer.classList.remove('returning');
      pointer.style.transitionDuration = '';
      homing = false;
      updateSpinButton();
    }, back);
  }, hold);
}


function showResult(result) {   // eslint-disable-line no-unused-vars
  
  if (!result.win && result.consolation) {
    setTimeout(() => {
      flyItemToProfile(document.querySelector('.wheel-center'), BEAR_ASSET);
      if (result.consolation.first) toast(bearText(), false, 4200);   // только за первого мишку
    }, 180);
  }
}





let sellSeq = 0;         // номер последнего отправленного запроса
let sellApplied = 0;     // номер запроса, чей баланс уже показан
const sellTally = { n: 0, sum: 0, timer: 0 };


function sellToast(payout) {
  sellTally.n += 1;
  sellTally.sum += payout;
  toast(sellTally.n > 1
    ? tr('Продано {n} шт. на {sum} TON', { n: sellTally.n, sum: fmt(sellTally.sum, 2) })
    : tr('Продано за {sum} TON', { sum: fmt(payout, 2) }));
  clearTimeout(sellTally.timer);
  sellTally.timer = setTimeout(() => { sellTally.n = 0; sellTally.sum = 0; }, 2600);
}

async function sellPrize(prize, btn, card) {
  if (sellingNow.has(prize.id)) return;
  sellingNow.add(prize.id);

  prizeCards.delete(prize.id);
  dropPrizeCards([card]);
  $('prizeEmpty').hidden = prizeCards.size > 0;
  haptic('impact', 'light');

  const seq = ++sellSeq;
  try {
    const res = await api('/api/sell', { prize_id: prize.id });
    sellingNow.delete(prize.id);
    sellToast(res.payout_ton);
    
    
    
    if (seq > sellApplied) {
      sellApplied = seq;
      if (state) {
        state.prizes = res.prizes;
        state.balance_ton = res.balance_ton;
      }
      $('balanceValue').textContent = fmt(res.balance_ton, 4);
      renderPrizes(res.prizes);
      updateSpinButton();
      if (typeof updateShellButton === 'function') updateShellButton();
    }
  } catch (e) {
    sellingNow.delete(prize.id);
    const messages = {
      not_sellable: tr('Приз уже продан или ушёл на вывод'),
      too_fast: tr('Слишком быстро, попробуй ещё раз'),
      too_many_requests: tr('Слишком много запросов, подожди немного'),
      sell_disabled: tr('Продажа сейчас отключена'),
    };
    toast(messages[e.code] || tr('Не удалось продать'), true);
    haptic('notification', 'error');
    refresh();     // подтянем настоящее состояние: карточка вернётся, если не продана
  }
}



async function withdraw(prizeId, btn, feeTon = 0) {
  if (feeTon > 0) {
    if ((state?.balance_ton ?? 0) < feeTon) {
      toast(tr('Вывод этого подарка стоит {sum} TON — не хватает на балансе', { sum: fmt(feeTon, 2) }), true);
      return;
    }
    const ok = await confirmDialog(
      tr('Вывод этого подарка стоит {sum} TON — спишется с баланса. Вывести?', { sum: fmt(feeTon, 2) }));
    if (!ok) return;
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await api('/api/withdraw', { prize_id: prizeId, fee_ton: feeTon });
    renderPrizes(res.prizes);
    state.prizes = res.prizes;
    if (res.balance_ton !== undefined) setBalance(res.balance_ton);
    toast(res.auto_gift ? tr('Мишка отправлен тебе подарком в Telegram 🧸') : tr('Заявка на вывод создана'));
    haptic('notification', 'success');
  } catch (e) {
    toast(e.code === 'already_requested' ? tr('Заявка уже создана')
      : e.code === 'withdraw_locked' ? tr('Вывод откроется через срок после пополнения подарком')
        : e.code === 'no_funds_fee' ? tr('Вывод этого подарка стоит {sum} TON — не хватает на балансе', { sum: fmt(feeTon, 2) })
          : e.code === 'fee_changed' ? tr('Плата за вывод изменилась — попробуй ещё раз')
            : tr('Не удалось создать заявку'), true);
    btn.disabled = false;
    btn.textContent = label;
    refresh();
  }
}


function commentPayload(text) {
  
  
  const body = new TextEncoder().encode(text);
  if (body.length > 123) throw new Error('comment too long');

  const data = new Uint8Array(4 + body.length);
  data.set(body, 4);

  const cell = new Uint8Array(2 + data.length);
  cell[0] = 0x00;               // refs = 0, обычная ячейка
  cell[1] = data.length * 2;    // все байты заполнены целиком
  cell.set(data, 2);

  const header = new Uint8Array([
    0xb5, 0xee, 0x9c, 0x72,     // magic
    0x01,                       // без индекса и crc, размер ссылки = 1 байт
    0x01,                       // off_bytes = 1
    0x01,                       // cells = 1
    0x01,                       // roots = 1
    0x00,                       // absent = 0
    cell.length,                // общий размер ячеек
    0x00,                       // индекс корня
  ]);

  const boc = new Uint8Array(header.length + cell.length);
  boc.set(header, 0);
  boc.set(cell, header.length);

  let bin = '';
  boc.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function initTonConnect() {
  if (!window.TON_CONNECT_UI) {
    $('walletBtnText').textContent = tr('Нет кошелька');
    $('walletBtn').disabled = true;
    $('depWalletAddr').textContent = tr('Кошелёк недоступен');
    $('depWalletBtn').hidden = true;
    return;
  }
  tonUI = new window.TON_CONNECT_UI.TonConnectUI({
    manifestUrl: `${location.origin}/tonconnect-manifest.json`,
  });

  tonUI.onStatusChange(async (wallet) => {
    const address = wallet?.account?.address || '';
    renderWallet(address);
    if (address) {
      try { await api('/api/wallet', { address }); } catch {}
      refresh();
    }
  });
}


function renderWallet(address) {
  $('walletBtn').hidden = !!address;
  $('walletBtnText').textContent = tr('Подключить');
  $('depWalletAddr').textContent = address ? shortAddr(address) : tr('Кошелёк не подключён');
  $('depWalletBtn').textContent = address ? tr('Отвязать') : tr('Подключить');
  $('depWalletSwitch').hidden = !address;
}

async function disconnectWallet() {
  await tonUI.disconnect();
  try { await api('/api/wallet', { address: '' }); } catch {}
}


async function onWalletClick() {
  if (!tonUI) { toast(tr('Кошелёк недоступен'), true); return; }
  if (tonUI.connected) {
    await disconnectWallet();
    toast(tr('Кошелёк отвязан'));
  } else {
    await tonUI.openModal();
  }
}


async function switchWallet() {
  if (!tonUI) { toast(tr('Кошелёк недоступен'), true); return; }
  try {
    if (tonUI.connected) await disconnectWallet();
    await tonUI.openModal();
  } catch (e) {
    toast(tr('Не удалось сменить кошелёк'), true);
  }
}

async function sendDeposit() {
  if (!state?.deposit?.address) { toast(tr('Приём депозитов не настроен'), true); return; }
  if (!tonUI) { toast(tr('Кошелёк недоступен'), true); return; }
  if (!tonUI.connected) { await tonUI.openModal(); return; }

  const amount = parseFloat($('depositAmount').value);
  if (!(amount > 0) || amount < state.config.min_deposit_ton) {
    toast(tr('Минимум {sum} TON', { sum: fmt(state.config.min_deposit_ton, 2) }), true);
    return;
  }

  const btn = $('depositSendBtn');
  btn.disabled = true;
  try {
    await tonUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [{
        address: state.deposit.address,
        amount: String(Math.round(amount * 1e9)),
        payload: commentPayload(state.deposit.memo),
      }],
    });
    $('depositModal').hidden = true;
    toast(tr('Перевод отправлен, ждём подтверждения сети'));
    
    [6, 14, 24, 40].forEach((s) => setTimeout(refresh, s * 1000));
  } catch (e) {
    if (!String(e?.message || '').toLowerCase().includes('reject')) {
      toast(tr('Не удалось отправить перевод'), true);
    }
  } finally {
    btn.disabled = false;
  }
}

function openDeposit() {
  $('depositModal').hidden = false;
}




let giftCfg = null;
let giftPicked = null;

async function openGiftDeposit() {
  if (!giftCfg || !giftCfg.enabled) return;
  $('depositModal').hidden = true;
  $('giftModal').hidden = false;
  $('giftHow').hidden = true;
  giftPicked = null;
  $('giftIntro').textContent =
    tr('Подари улучшенный подарок на @{account} — зачислим {percent}% от самой низкой цены его коллекции на маркетах (по данным peek.tg). Модель и фон не важны.',
      { account: giftCfg.account, percent: Math.round(giftCfg.share * 100) }) +
    (giftCfg.hold_days > 0
      ? ' ' + tr('Свой подарок — вывод призов не блокируется. Если купишь подарок на маркете, вывод откроется через {days} дн. (срок возврата платежа в Telegram).',
        { days: giftCfg.hold_days })
      : '');
  const list = $('giftList');
  list.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'muted gift-empty';
  loading.textContent = tr('Смотрю подарки в твоём профиле…');
  list.appendChild(loading);

  let res;
  try {
    res = await api('/api/gifts/mine');
  } catch (e) {
    loading.textContent = e.code === 'disabled'
      ? tr('Пополнение подарками сейчас выключено')
      : tr('Не удалось получить подарки. Попробуй ещё раз чуть позже.');
    return;
  }
  list.replaceChildren();
  if (!res.market_ok) {
    const warn = document.createElement('p');
    warn.className = 'warn';
    warn.textContent = tr('Маркет сейчас не отвечает — подарок можно отправить, его оценит админ вручную.');
    list.appendChild(warn);
  }
  if (!res.gifts.length) {
    const empty = document.createElement('p');
    empty.className = 'muted gift-empty';
    empty.textContent = tr('В профиле нет улучшенных подарков. Если они есть — включи их показ в профиле Telegram.');
    list.appendChild(empty);
    return;
  }
  for (const g of res.gifts) list.appendChild(giftCard(g));
}

function giftCard(g) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'gift-item';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = '';
  img.onerror = () => img.remove();
  img.src = g.image;
  const title = document.createElement('div');
  title.className = 'gift-title';
  title.textContent = g.title;
  const sub = document.createElement('div');
  sub.className = 'gift-sub';
  sub.textContent = [g.model, g.backdrop].filter(Boolean).join(' · ');
  const val = document.createElement('div');
  val.className = 'gift-val';
  if (g.credit_ton) {
    val.textContent = `≈ ${fmt(g.credit_ton, 2)} TON`;
    if (!g.auto) val.classList.add('manual');
  } else {
    val.textContent = tr('оценит админ');
    val.classList.add('manual');
  }
  card.append(img, title, sub, val);
  if (!g.auto) {
    const note = document.createElement('div');
    note.className = 'gift-note';
    note.textContent = g.reason;
    card.appendChild(note);
  }
  card.addEventListener('click', () => pickGift(g, card));
  return card;
}

function pickGift(g, card) {
  giftPicked = g;
  document.querySelectorAll('#giftList .gift-item').forEach((c) => c.classList.toggle('picked', c === card));
  const how = $('giftHow');
  how.hidden = false;
  $('giftHowText').textContent =
    tr('1. Открой «{title}» в своём профиле Telegram', { title: g.title }) + '\n' +
    tr('2. Нажми «Передать»') + '\n' +
    tr('3. Выбери @{account}', { account: giftCfg.account }) + '\n\n' +
    (g.auto && g.credit_ton
      ? tr('Придёт около {sum} TON — точная сумма по цене в момент получения. Бот пришлёт сообщение.',
        { sum: fmt(g.credit_ton, 2) })
      : tr('Этот подарок проверит админ — бот пришлёт сообщение с суммой.'));
  $('giftOpenAccount').textContent = tr('Открыть @{account}', { account: giftCfg.account });
  how.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function openGiftAccount() {
  if (!giftCfg || !giftCfg.account) return;
  const url = `https://t.me/${encodeURIComponent(giftCfg.account)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}


async function refresh() {
  
  
  let s;
  try {
    s = await api('/api/state');
  } catch (e) {
    toast(e.message === 'HTTP 401' ? tr('Откройте приложение через бота') : tr('Нет связи с сервером'), true);
    return;
  }
  try {
    renderState(s);
  } catch (e) {
    console.error('Ошибка отрисовки:', e);
    toast(tr('Закрой и открой приложение заново'), true);
  }
}


function bind() {
  $('spinBtn').addEventListener('click', doSpin);
  $('fastBtn').addEventListener('click', () => {
    setFast(!fastSpin);
    haptic('impact', 'light');
  });

  document.querySelectorAll('.tier-btn').forEach((b) => {
    b.addEventListener('click', () => {
      if (spinning) return;
      
      if (b.dataset.tier === 'gift') openGiftPicker();
      else setTier(b.dataset.tier);
      haptic('impact', 'light');
    });
  });
  $('gpClose').addEventListener('click', () => { $('giftPickModal').hidden = true; });
  $('gpSearch').addEventListener('input', renderGiftPicker);
  $('gpBack').addEventListener('click', gpBack);
  $('gpSort').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sort]');
    if (b) { setGpSort(b.dataset.sort); haptic('impact', 'light'); }
  });
  $('sellAllBtn').addEventListener('click', sellAll);
  
  for (const l of I18N.langs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = l.code === I18N.lang ? 'lang-btn on' : 'lang-btn';
    b.dataset.lang = l.code;
    b.textContent = l.label;
    b.addEventListener('click', () => { haptic('impact', 'light'); I18N.setLang(l.code); });
    $('langBtns').appendChild(b);
  }
  window.addEventListener('langchange', onLangChange);
  initThemeSwitch();
  initProfileWindows();
  initWeapon();
  initSpinStyle();
  initSky();
  
  const pickFromWheel = () => {
    if (spinning || !(state && state.config.gift_upgrade)) return;
    markHintSeen();              // нажал один раз — подсказка больше не нужна
    openGiftPicker();
    haptic('impact', 'light');
  };
  $('hatQuestion').addEventListener('click', pickFromWheel);
  $('centerHat').addEventListener('click', pickFromWheel);
  $('hatHint').addEventListener('click', pickFromWheel);
  $('gpList').addEventListener('click', (e) => {
    const item = e.target.closest('.gp-item');
    if (item) onGiftTile(item.dataset.key);
  });

  $('shellBtn').addEventListener('click', shellStart);
  $('shellPrize').addEventListener('click', () => { openGiftPicker('shell'); haptic('impact', 'light'); });
  $('shellDepositBtn').addEventListener('click', openDeposit);
  $('shellTable').addEventListener('click', (e) => {
    
    
    if (!$('shellTable').classList.contains('picking')) return;
    const hat = e.target.closest('.shell-hat');
    if (hat) shellPick(hat);
  });
  
  window.addEventListener('resize', () => {
    if (shellPhase === 'idle') shellPlace();
  });
  
  $('balanceChip').addEventListener('click', openDeposit);
  $('depWalletBtn').addEventListener('click', onWalletClick);
  $('depWalletSwitch').addEventListener('click', switchWallet);
  
  
  $('menuLeaders').addEventListener('click', () => { haptic('impact', 'light'); showView('leaders'); });
  $('menuMines').addEventListener('click', () => { showView('mines'); window.hatMinesRefresh?.(); });
  $('menuShell').addEventListener('click', () => { haptic('impact', 'light'); showView('shell'); });
  document.querySelectorAll('.view-back').forEach((b) => {
    b.addEventListener('click', () => {
      if (shellPhase !== 'idle') return;         // посреди партии в шляпы не уходим
      haptic('impact', 'light');
      showView(b.dataset.back);
    });
  });
  initAnon();
  $('depositCloseBtn').addEventListener('click', () => { $('depositModal').hidden = true; });
  $('depositSendBtn').addEventListener('click', sendDeposit);
  $('giftDepositBtn').addEventListener('click', openGiftDeposit);
  $('giftCloseBtn').addEventListener('click', () => { $('giftModal').hidden = true; refresh(); });
  $('giftOpenAccount').addEventListener('click', openGiftAccount);
  $('walletBtn').addEventListener('click', onWalletClick);

  $('modeSlider').addEventListener('input', (e) => selectMode(Number(e.target.value)));

  $('promoForm').addEventListener('submit', activatePromo);
  $('refToggle').addEventListener('click', toggleReferral);
  $('refCreateBtn').addEventListener('click', createReferral);
  $('refCopyBtn').addEventListener('click', copyReferral);
  $('refWithdrawBtn').addEventListener('click', withdrawReferral);

  $('toUpgradeBtn').addEventListener('click', () => {
    $('resultModal').hidden = true;
    showView('upgrade');
  });
  $('toProfileBtn').addEventListener('click', () => {
    $('resultModal').hidden = true;
    showView('profile');
  });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => showView(t.dataset.view));
  });
  initSwipeTabs();
  window.addEventListener('bgaligned', shellAlignStump);

  document.querySelectorAll('.amt').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.amt').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      $('depositAmount').value = b.dataset.amt;
    });
  });

  document.querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      const ok = await copyText($(b.dataset.copy).textContent);
      toast(ok ? tr('Скопировано') : tr('Не удалось скопировать'), !ok);
    });
  });

  $('depositModal').addEventListener('click', (e) => {
    if (e.target.id === 'depositModal') $('depositModal').hidden = true;
  });
}


initTelegram();
makeStars();
bind();
loadFast();
buildWheelScale();
setTier(loadSavedTier(), false);
initTonConnect();
refresh().then(restoreSavedGift).catch(() => {});
setInterval(() => {
  if (spinning) return;
  refresh();
  
  if (currentTier === 'gift' && Date.now() - giftCatalogAt > 120000) loadGiftCatalog(true).catch(() => {});
}, 20000);

})();