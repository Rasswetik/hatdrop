/* ============================================================
   Magic Upgrade — клиент мини-аппы.
   Исход прокрутки решает сервер; здесь только анимация и UI.
   ============================================================ */
(() => {
'use strict';

const tg = window.Telegram?.WebApp;
const $ = (id) => document.getElementById(id);

const RING_R = 120;
const RING_C = 2 * Math.PI * RING_R;

let state = null;
let tonUI = null;
let spinning = false;
let pointerDeg = 0;
let modeIndex = 0;          // позиция ползунка
let modes = [];             // режимы ставки с сервера

/* ----------------------------------------------------------- телеграм */
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

/* ---------------------------------------------------------------- API */
async function api(path, body = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg?.initData || '', ...body }),
    });
  } catch (e) {
    // fetch сам кинул исключение — сети нет вообще (не путать с тем, что
    // сервер ответил с ошибкой: то отдельный случай ниже).
    const err = new Error('network');
    err.code = 'network';
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.error || `http_${res.status}`;
    throw err;
  }
  return data;
}

/* -------------------------------------------------------------- утилиты */
const fmt = (n, d = 4) => Number(n).toFixed(d).replace(/\.?0+$/, '') || '0';
const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');

// 1 приз / 2 приза / 5 призов
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Копирование с запасным путём: в WebView Telegram Clipboard API бывает
// недоступен, тогда копируем через скрытое поле и execCommand.
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
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
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

/* --------------------------------------------------- режимы и ползунок */
function currentMode() {
  return modes[modeIndex] || null;
}

function buildModes(cfg) {
  const changed = JSON.stringify(cfg.modes) !== JSON.stringify(modes);
  modes = cfg.modes;

  const slider = $('modeSlider');
  slider.max = String(Math.max(0, modes.length - 1));

  if (changed) {
    const def = modes.findIndex((m) => m.id === cfg.default_mode);
    modeIndex = def >= 0 ? def : Math.floor(modes.length / 2);
    slider.value = String(modeIndex);

    const marks = $('modeMarks');
    marks.innerHTML = '';
    modes.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'mode-mark';
      b.type = 'button';
      b.innerHTML = `<b>${fmt(m.cost_ton, 2)}</b>${Math.round(m.chance * 100)}%`;
      b.addEventListener('click', () => selectMode(i));
      marks.appendChild(b);
    });
  }

  applyMode();
}

function selectMode(index) {
  if (spinning) return;
  modeIndex = Math.max(0, Math.min(modes.length - 1, index));
  $('modeSlider').value = String(modeIndex);
  applyMode();
  haptic('impact', 'light');
}

/** Перерисовывает всё, что зависит от выбранного режима. */
function applyMode() {
  const m = currentMode();
  if (!m) return;

  $('modeCost').textContent = `${fmt(m.cost_ton, 2)} TON`;
  $('modeChance').textContent = `${Math.round(m.chance * 100)}%`;

  document.querySelectorAll('.mode-mark').forEach((el, i) => {
    el.classList.toggle('active', i === modeIndex);
  });

  // Зелёная дуга = доля выигрыша на колесе.
  $('arcWin').setAttribute('stroke-dasharray', `${RING_C * m.chance} ${RING_C}`);
  $('arcLose').setAttribute('stroke-dasharray', `${RING_C} 0`);

  updateSpinButton();
}

function updateSpinButton() {
  const m = currentMode();
  if (!m || !state) return;
  const enough = state.balance_ton + 1e-9 >= m.cost_ton;
  $('spinBtn').disabled = spinning || !enough;
  $('spinBtnText').textContent = enough ? `Крутить за ${fmt(m.cost_ton, 2)} TON` : 'Пополни баланс';
}

/* --------------------------------------------------------------- рендер */
function renderState(s) {
  state = s;
  buildModes(s.config);

  $('balanceValue').textContent = fmt(s.balance_ton, 4);
  $('prizeNameInline').textContent = s.config.prize_name;
  $('depositAmount').min = s.config.min_deposit_ton;

  $('profileName').textContent = s.user.username ? `@${s.user.username}` : (s.user.first_name || 'Игрок');
  $('profileWallet').textContent = s.user.wallet ? shortAddr(s.user.wallet) : 'Кошелёк не подключён';

  const avImg = $('avatarImg');
  const avIcon = $('avatarIcon');
  if (s.user.photo_url) {
    avImg.src = s.user.photo_url;
    avImg.hidden = false;
    avIcon.hidden = true;
    avImg.onerror = () => { avImg.hidden = true; avIcon.hidden = false; };
  } else {
    avImg.hidden = true;
    avIcon.hidden = false;
  }
  $('walletBtnText').textContent = s.user.bonus_claimed ? 'Получено +10' : 'Получить +10';

  $('depAddress').textContent = s.deposit.address || 'не настроен';
  $('depMemo').textContent = s.deposit.memo;

  renderPrizes(s.prizes);
  if (s.referral) renderReferral(s.referral);
  renderLeaders(s.leaders);
  updateSpinButton();
}

/* ------------------------------------------------------------ рефералы */
function renderReferral(ref) {
  $('refPercent').textContent = `${fmt(ref.percent, 2)}%`;

  // До нажатия «Создать» показываем кнопку, после — поле со ссылкой.
  const showLink = ref.created && ref.link;
  $('refCreateBtn').hidden = showLink;
  $('refLinkBox').hidden = !showLink;
  if (showLink) $('refLink').textContent = ref.link;

  $('refCount').textContent = ref.count;
  $('refCountLabel').textContent = plural(ref.count, 'реферал', 'реферала', 'рефералов');
  $('refEarned').textContent = fmt(ref.earned_ton, 4);
  $('refBalance').textContent = `${fmt(ref.balance_ton, 4)} TON`;

  const canWithdraw = ref.balance_ton + 1e-9 >= ref.min_withdraw_ton;
  $('refWithdrawBtn').disabled = !canWithdraw;

  const hint = $('refHint');
  if (ref.pending_ton > 0) {
    hint.textContent = `В обработке: ${fmt(ref.pending_ton, 4)} TON`;
    hint.classList.add('pending');
  } else {
    hint.textContent = `Вывод от ${fmt(ref.min_withdraw_ton, 2)} TON`;
    hint.classList.remove('pending');
  }
}

/* ------------------------------------------------------------- лидеры */
function svgIcon(symbolId) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${symbolId}`);
  svg.appendChild(use);
  return svg;
}

let lbEndTs = 0;
function tickLeaderTimer() {
  const el = $('lbTimer');
  if (!el || !lbEndTs) return;
  const diff = Math.max(0, lbEndTs - Math.floor(Date.now() / 1000));
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  el.textContent = d > 0 ? `${d}д ${h}ч ${m}м` : `${h}ч ${m}м`;
}

function fillPodiumSlot(el, entry) {
  el.classList.toggle('empty-slot', !entry);
  const img = el.querySelector('.podium-avatar img');
  const icon = el.querySelector('.podium-avatar svg');
  const nameEl = el.querySelector('.podium-name');
  const turnoverEl = el.querySelector('.podium-turnover');

  if (!entry) {
    nameEl.textContent = '—';
    turnoverEl.textContent = '—';
    img.hidden = true;
    icon.hidden = false;
    return;
  }

  nameEl.textContent = entry.username ? `@${entry.username}` : (entry.first_name || 'Игрок');
  turnoverEl.textContent = `${fmt(entry.turnover_ton, 2)} TON`;
  if (entry.avatar_url) {
    img.src = entry.avatar_url;
    img.hidden = false;
    icon.hidden = true;
    img.onerror = () => { img.hidden = true; icon.hidden = false; };
  } else {
    img.hidden = true;
    icon.hidden = false;
  }
}

function renderLeaders(leaders) {
  const entries = leaders?.entries || [];
  const hasLeaders = entries.length > 0;

  $('lbEmpty').hidden = hasLeaders;
  $('lbCountdown').hidden = !hasLeaders;
  $('podium').hidden = !hasLeaders;

  if (!hasLeaders) {
    $('lbList').innerHTML = '';
    lbEndTs = 0;
    return;
  }

  lbEndTs = leaders.period_ends_at || 0;
  tickLeaderTimer();

  fillPodiumSlot($('slot-1'), entries[0] || null);
  fillPodiumSlot($('slot-2'), entries[1] || null);
  fillPodiumSlot($('slot-3'), entries[2] || null);

  const list = $('lbList');
  list.innerHTML = '';
  entries.slice(3).forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';

    const rank = document.createElement('div');
    rank.className = 'lb-rank';
    rank.textContent = `#${i + 4}`;

    const avatar = document.createElement('div');
    avatar.className = 'lb-avatar';
    if (entry.avatar_url) {
      const img = document.createElement('img');
      img.src = entry.avatar_url;
      img.alt = '';
      img.onerror = () => { img.remove(); avatar.appendChild(svgIcon('ic-profile')); };
      avatar.appendChild(img);
    } else {
      avatar.appendChild(svgIcon('ic-profile'));
    }

    const info = document.createElement('div');
    info.className = 'lb-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'lb-name';
    nameEl.textContent = entry.username ? `@${entry.username}` : (entry.first_name || 'Игрок');
    const turnoverEl = document.createElement('div');
    turnoverEl.className = 'lb-turnover';
    turnoverEl.textContent = `${fmt(entry.turnover_ton, 2)} TON`;
    info.append(nameEl, turnoverEl);

    const prize = document.createElement('div');
    prize.className = 'lb-prize';
    prize.textContent = '—';

    row.append(rank, avatar, info, prize);
    list.appendChild(row);
  });
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
      ? 'Ссылки временно недоступны'
      : 'Не удалось создать ссылку', true);
  } finally {
    btn.disabled = false;
  }
}

async function copyReferral() {
  const link = $('refLink').textContent;
  const btn = $('refCopyBtn');
  if (await copyText(link)) {
    btn.textContent = 'Скопировано';
    btn.classList.add('done');
    haptic('notification', 'success');
    setTimeout(() => {
      btn.textContent = 'Копировать';
      btn.classList.remove('done');
    }, 1800);
  } else {
    // Совсем не вышло — выделяем текст, чтобы скопировать вручную.
    const range = document.createRange();
    range.selectNodeContents($('refLink'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('Выдели ссылку и скопируй вручную', true);
  }
}

async function withdrawReferral() {
  const btn = $('refWithdrawBtn');
  btn.disabled = true;
  try {
    const res = await api('/api/referral/withdraw');
    renderReferral(res.referral);
    toast('Заявка на вывод создана');
    haptic('notification', 'success');
  } catch (e) {
    toast(e.code === 'below_minimum'
      ? `Минимум для вывода — ${fmt(state?.referral?.min_withdraw_ton ?? 1, 2)} TON`
      : 'Не удалось создать заявку', true);
    refresh();
  }
}

function renderPrizes(prizes) {
  const grid = $('prizeGrid');
  grid.innerHTML = '';
  $('prizeEmpty').hidden = prizes.length > 0;

  $('statPrizes').textContent = prizes.length;
  $('statPrizesLabel').textContent = plural(prizes.length, 'приз', 'приза', 'призов');

  for (const p of prizes) {
    const card = document.createElement('div');
    card.className = 'prize-card';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    // Раньше путь был 'assets/hat.png' — такого файла не существует
    // (картинки лежат в /static/img/), поэтому иконка приза не грузилась.
    img.src = '/static/img/hat.png';
    img.alt = p.item_name;
    thumb.appendChild(img);

    const pv = document.createElement('div');
    pv.className = 'pv';
    // Бэкенд отдаёт поле item_price (см. /api/state), а не value_ton —
    // из-за несовпадения имён тут всегда показывалось "NaN TON".
    pv.textContent = `${fmt(p.item_price, 2)} TON`;

    const btn = document.createElement('button');
    btn.className = 'wd-btn';
    if (p.status === 'owned') {
      btn.textContent = 'Вывести';
      btn.addEventListener('click', () => withdraw(p.id, btn));
    } else {
      btn.textContent = 'В обработке';
      btn.classList.add('pending');
      btn.disabled = true;
    }

    card.append(thumb, pv, btn);
    grid.appendChild(card);
  }
}

/* ----------------------------------------------------------- навигация */
function showView(name) {
  $('view-upgrade').hidden = name !== 'upgrade';
  $('view-profile').hidden = name !== 'profile';
  $('view-leaders').hidden = name !== 'leaders';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  document.querySelector('.content').scrollTop = 0;
}

/* -------------------------------------------------------------- прокрутка */
async function doSpin() {
  const mode = currentMode();
  if (spinning || !state || !mode) return;
  if (state.balance_ton + 1e-9 < mode.cost_ton) {
    openDeposit();
    return;
  }

  spinning = true;
  $('spinBtn').disabled = true;
  $('modeSlider').disabled = true;
  document.querySelector('.wheel-wrap').classList.add('rolling');
  haptic('impact', 'light');

  let result;
  try {
    result = await api('/api/spin', { mode: mode.id });
  } catch (e) {
    spinning = false;
    $('modeSlider').disabled = false;
    document.querySelector('.wheel-wrap').classList.remove('rolling');
    updateSpinButton();
    const messages = {
      insufficient_funds: 'Недостаточно средств',
      too_fast: 'Слишком часто, подожди секунду',
      too_many_requests: 'Слишком много запросов, подожди немного',
    };
    toast(messages[e.code] || 'Ошибка запроса', true);
    if (e.code === 'insufficient_funds') refresh();
    return;
  }

  // Докручиваем вперёд: 5 полных оборотов + нужный угол.
  const current = ((pointerDeg % 360) + 360) % 360;
  pointerDeg += 360 * 5 + ((result.angle - current + 360) % 360);

  const pointer = $('pointer');
  pointer.classList.add('spinning');
  requestAnimationFrame(() => { pointer.style.transform = `rotate(${pointerDeg}deg)`; });

  setTimeout(() => {
    document.querySelector('.wheel-wrap').classList.remove('rolling');
    spinning = false;
    $('modeSlider').disabled = false;
    haptic('notification', result.win ? 'success' : 'error');
    showResult(result);
    refresh();
  }, 3700);
}

function showResult(result) {
  const card = $('resultCard');
  card.classList.toggle('lose', !result.win);
  if (result.win) {
    $('resultTitle').textContent = 'Поздравляем!';
    $('resultText').textContent = `Приз «${state.config.prize_name}» уже в профиле.`;
  } else {
    $('resultTitle').textContent = 'Не в этот раз';
    $('resultText').textContent = 'Шляпа ускользнула. Попробуй ещё раз — удача рядом.';
  }
  $('resultModal').hidden = false;
}

/* ---------------------------------------------------------------- вывод */
async function withdraw(prizeId, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await api('/api/withdraw', { prize_id: prizeId });
    renderPrizes(res.prizes);
    state.prizes = res.prizes;
    toast('Заявка на вывод создана');
    haptic('notification', 'success');
  } catch (e) {
    toast(e.code === 'already_requested' ? 'Заявка уже создана' : 'Не удалось создать заявку', true);
    refresh();
  }
}

/* ---------------------------------------------------------- TON Connect */
function commentPayload(text) {
  // Минимальный BOC с одной ячейкой: 32 нулевых бита (опкод текста) + utf-8.
  // В одну ячейку влезает не больше 123 байт текста — нашей метки хватает.
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
    $('walletBtnText').textContent = 'Нет кошелька';
    $('walletBtn').disabled = true;
    return;
  }
  tonUI = new window.TON_CONNECT_UI.TonConnectUI({
    manifestUrl: `${location.origin}/tonconnect-manifest.json`,
  });

  tonUI.onStatusChange(async (wallet) => {
    const address = wallet?.account?.address || '';
    const btn = $('walletBtn');
    if (address) {
      $('walletBtnText').textContent = shortAddr(address);
      btn.classList.add('connected');
      try { await api('/api/wallet', { address }); } catch {}
      refresh();
    } else {
      $('walletBtnText').textContent = 'Подключить';
      btn.classList.remove('connected');
    }
  });
}

async function onWalletClick() {
  const btn = $('walletBtn');
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  const old = $('walletBtnText').textContent;
  $('walletBtnText').textContent = 'Зачисление…';
  btn.disabled = true;
  try {
    const res = await api('/api/connect');
    if (res.ok) {
      renderState(res);
      toast('+10 TON зачислено');
      haptic('notification', 'success');
    } else if (res.error === 'bonus_already_claimed') {
      toast('Бонус уже получен');
      await refresh();
    }
  } catch (e) {
    toast('Не удалось зачислить бонус', true);
  } finally {
    btn.disabled = false;
    btn.dataset.busy = '0';
    if (!state?.user?.wallet) $('walletBtnText').textContent = old === 'Зачисление…' ? 'Получить +10' : old;
  }
}

async function sendDeposit() {
  if (!state?.deposit?.address) { toast('Приём депозитов не настроен', true); return; }
  if (!tonUI) { toast('Кошелёк недоступен', true); return; }
  if (!tonUI.connected) { await tonUI.openModal(); return; }

  const amount = parseFloat($('depositAmount').value);
  if (!(amount > 0) || amount < state.config.min_deposit_ton) {
    toast(`Минимум ${fmt(state.config.min_deposit_ton, 2)} TON`, true);
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
    toast('Перевод отправлен, ждём подтверждения сети');
    // Транзакция подтверждается не мгновенно — несколько раз перечитываем баланс.
    [6, 14, 24, 40].forEach((s) => setTimeout(refresh, s * 1000));
  } catch (e) {
    if (!String(e?.message || '').toLowerCase().includes('reject')) {
      toast('Не удалось отправить перевод', true);
    }
  } finally {
    btn.disabled = false;
  }
}

function openDeposit() {
  $('depositModal').hidden = false;
}

/* ------------------------------------------------------------ обновление */
async function refresh() {
  // Сеть и отрисовку ловим отдельно: раньше любая ошибка в коде показывалась
  // как «Нет связи с сервером», и настоящую причину было не найти.
  let s;
  try {
    s = await api('/api/state');
  } catch (e) {
    console.error('Ошибка /api/state:', e);
    const msg = e.code === 'network'
      ? 'Нет связи с сервером'
      : `Ошибка сервера (${e.code || e.message})`;
    toast(msg, true);
    return;
  }
  try {
    renderState(s);
  } catch (e) {
    console.error('Ошибка отрисовки:', e);
    toast('Закрой и открой приложение заново', true);
  }
}

/* ------------------------------------------------------------- обработчики */
function bind() {
  $('spinBtn').addEventListener('click', doSpin);
  $('depositBtn').addEventListener('click', openDeposit);
  $('depositCloseBtn').addEventListener('click', () => { $('depositModal').hidden = true; });
  $('depositSendBtn').addEventListener('click', sendDeposit);
  $('walletBtn').addEventListener('click', onWalletClick);

  $('modeSlider').addEventListener('input', (e) => selectMode(Number(e.target.value)));

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
      toast(ok ? 'Скопировано' : 'Не удалось скопировать', !ok);
    });
  });

  $('depositModal').addEventListener('click', (e) => {
    if (e.target.id === 'depositModal') $('depositModal').hidden = true;
  });
}

/* --------------------------------------------------------------- запуск */
initTelegram();
makeStars();
bind();
initTonConnect();
refresh();
setInterval(() => { if (!spinning) refresh(); }, 20000);
setInterval(tickLeaderTimer, 30000);

})();
