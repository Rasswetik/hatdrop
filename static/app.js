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
let chancePct = 25;         // выбранный шанс, % (позиция ползунка)
let chanceCfg = null;       // {min, max, default, marks} с сервера
let prizePrice = 7;         // цена шляпы, из неё считается ставка

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
// У SVG-элементов нет свойства .hidden — переключаем атрибут напрямую.
const setHidden = (el, hidden) => el.toggleAttribute('hidden', !!hidden);
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

/* --------------------------------------------------- шанс и ползунок */
// Ставка = шанс × цена шляпы (10% → 0.7, 25% → 1.75 ...). Округление «половина
// вверх» — то же самое, что делает сервер (bet_cost в app.py).
function costFor(pct) {
  return Math.floor(prizePrice * pct + 0.5) / 100;
}

function currentMode() {
  return chanceCfg ? { chance: chancePct, cost_ton: costFor(chancePct) } : null;
}

function buildModes(cfg) {
  prizePrice = cfg.prize_price;
  const changed = JSON.stringify(cfg.chance) !== JSON.stringify(chanceCfg);
  chanceCfg = cfg.chance;

  const slider = $('modeSlider');
  slider.min = String(chanceCfg.min);
  slider.max = String(chanceCfg.max);

  if (changed) {
    chancePct = chanceCfg.default;
    slider.value = String(chancePct);

    const marks = $('modeMarks');
    marks.innerHTML = '';
    chanceCfg.marks.forEach((pct) => {
      const b = document.createElement('button');
      b.className = 'mode-mark';
      b.type = 'button';
      b.dataset.pct = String(pct);
      b.style.setProperty('--p', (pct - chanceCfg.min) / (chanceCfg.max - chanceCfg.min));
      b.innerHTML = `<b>${pct}%</b>${fmt(costFor(pct), 2)} TON`;
      b.addEventListener('click', () => { selectChance(pct); haptic('impact', 'light'); });
      marks.appendChild(b);
    });
  }

  applyMode();
}

function selectChance(pct) {
  if (spinning) return;
  chancePct = Math.max(chanceCfg.min, Math.min(chanceCfg.max, Math.round(pct)));
  $('modeSlider').value = String(chancePct);
  applyMode();
}

/** Перерисовывает всё, что зависит от выбранного шанса. */
function applyMode() {
  const m = currentMode();
  if (!m) return;

  $('modeCost').textContent = `${fmt(m.cost_ton, 2)} TON`;
  $('modeChance').textContent = `${m.chance}%`;

  document.querySelectorAll('.mode-mark').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.pct) === chancePct);
  });

  // Зелёная дуга = доля выигрыша на колесе. CSS-transition на
  // stroke-dasharray (см. .ring-arc) отвечает за плавное "дотягивание"
  // при смене ставки/процента — тут только выставляем целевое значение.
  const arcWin = $('arcWin');
  arcWin.setAttribute('stroke-dasharray', `${RING_C * m.chance / 100} ${RING_C}`);
  $('arcLose').setAttribute('stroke-dasharray', `${RING_C} 0`);
  arcWin.classList.remove('arc-pulse');
  void arcWin.offsetWidth; // reflow — чтобы анимацию можно было перезапускать подряд
  arcWin.classList.add('arc-pulse');

  updateSpinButton();
}

function updateSpinButton() {
  const m = currentMode();
  if (!m || !state) return;
  const enough = state.balance_ton + 1e-9 >= m.cost_ton;
  $('spinBtn').disabled = spinning || !enough;
  $('spinBtnText').textContent = enough ? `Крутить за ${fmt(m.cost_ton, 2)} TON` : 'Пополни баланс';
}

/* -------------------------------------------------------- анимация баланса */
// Плавно "прокручивает" отображаемое число от старого значения к новому
// и одновременно показывает всплывающую подпись ±X TON над чипом баланса.
// Раньше баланс менялся мгновенным textContent = ..., поэтому списание при
// ставке было незаметно — цифра просто скачком становилась меньше.
let balanceAnimFrame = null;
function animateBalance(from, to) {
  const el = $('balanceValue');
  const chip = $('balanceChip');
  const delta = to - from;

  if (Math.abs(delta) < 1e-9) {
    el.textContent = fmt(to, 4);
    return;
  }

  cancelAnimationFrame(balanceAnimFrame);
  const duration = 550;
  const start = performance.now();

  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = fmt(from + delta * eased, 4);
    if (p < 1) {
      balanceAnimFrame = requestAnimationFrame(tick);
    } else {
      el.textContent = fmt(to, 4);
    }
  }
  balanceAnimFrame = requestAnimationFrame(tick);

  chip.classList.remove('flash-out', 'flash-in');
  // reflow, чтобы анимацию можно было перезапустить при повторном срабатывании подряд
  void chip.offsetWidth;
  chip.classList.add(delta < 0 ? 'flash-out' : 'flash-in');

  const fly = document.createElement('div');
  fly.className = `balance-fly ${delta < 0 ? 'out' : 'in'}`;
  fly.textContent = `${delta < 0 ? '−' : '+'}${fmt(Math.abs(delta), 4)} TON`;
  chip.appendChild(fly);
  setTimeout(() => fly.remove(), 1150);
}

/* --------------------------------------------------------------- рендер */
function renderState(s) {
  const prevBalance = state ? state.balance_ton : s.balance_ton;
  state = s;
  buildModes(s.config);

  animateBalance(prevBalance, s.balance_ton);
  $('prizeNameInline').textContent = s.config.prize_name;
  $('depositAmount').min = s.config.min_deposit_ton;

  $('profileName').textContent = s.user.username ? `@${s.user.username}` : (s.user.first_name || 'Игрок');
  $('profileWallet').textContent = s.user.wallet ? shortAddr(s.user.wallet) : 'Кошелёк не подключён';

  const avImg = $('avatarImg');
  const avIcon = $('avatarIcon');
  if (s.user.photo_url) {
    avImg.onerror = () => { setHidden(avImg, true); setHidden(avIcon, false); };
    if (avImg.getAttribute('src') !== s.user.photo_url) avImg.src = s.user.photo_url;
    setHidden(avImg, false);
    setHidden(avIcon, true);
  } else {
    setHidden(avImg, true);
    setHidden(avIcon, false);
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
  if (showLink) {
    $('refLink').textContent = ref.link;
  } else if (ref.created && !ref.bot_username_known) {
    // Ссылка создана, но имя бота ещё не определено сервером (getMe не
    // отработал) — не показываем битую ссылку, а объясняем, что происходит.
    $('refLinkBox').hidden = false;
    $('refLink').textContent = 'Ссылка появится через несколько секунд…';
    $('refCopyBtn').disabled = true;
  }
  if (showLink) $('refCopyBtn').disabled = false;

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
    setHidden(img, true);
    setHidden(icon, false);
    return;
  }

  nameEl.textContent = entry.username ? `@${entry.username}` : (entry.first_name || 'Игрок');
  turnoverEl.textContent = `${fmt(entry.turnover_ton, 2)} TON`;
  if (entry.avatar_url) {
    img.onerror = () => { setHidden(img, true); setHidden(icon, false); };
    if (img.getAttribute('src') !== entry.avatar_url) img.src = entry.avatar_url;
    setHidden(img, false);
    setHidden(icon, true);
  } else {
    setHidden(img, true);
    setHidden(icon, false);
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

    // Карточка-плитка: ранг → аватар → имя/оборот, размещаются в сетке по
    // несколько штук в ряд (см. .lb-list в styles.css).
    row.append(rank, avatar, info);
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

    const actions = document.createElement('div');
    actions.className = 'prize-actions';

    const btn = document.createElement('button');
    btn.className = 'wd-btn';
    if (p.status === 'owned') {
      btn.textContent = 'Вывести';
      btn.addEventListener('click', () => withdraw(p.id, btn));

      const sellBtn = document.createElement('button');
      sellBtn.className = 'sell-btn';
      sellBtn.textContent = 'Продать';
      sellBtn.addEventListener('click', () => sellPrize(p, sellBtn));
      actions.append(btn, sellBtn);
    } else {
      btn.textContent = 'В обработке';
      btn.classList.add('pending');
      btn.disabled = true;
      actions.append(btn);
    }

    card.append(thumb, pv, actions);
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
    toast('Недостаточно средств — нажми «Пополнить баланс»', true);
    return;
  }

  spinning = true;
  $('spinBtn').disabled = true;
  $('modeSlider').disabled = true;
  document.querySelector('.wheel-wrap').classList.add('rolling');
  haptic('impact', 'light');

  let result;
  try {
    result = await api('/api/spin', { chance: mode.chance });
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

  // Итог (выигрыш/угол) уже решён сервером ДО начала анимации — тут мы
  // только подбираем, как именно колесо к нему подкатится. Раньше это было
  // всегда ровно 5 оборотов с одной и той же длительностью и кривой —
  // после пары прокруток становилось видно, что колесо крутится "по
  // одному и тому же счёту", и финал угадывался на глаз. Теперь число
  // оборотов, длительность и кривая движения каждый раз немного разные,
  // а в середине кручения добавлен случайный рывок ("заминка—ускорение"),
  // чтобы сам процесс вращения было сложнее прочитать по шаблону.
  const current = ((pointerDeg % 360) + 360) % 360;
  const targetDelta = (result.angle - current + 360) % 360;

  const extraTurns = 4 + Math.floor(Math.random() * 4); // 4..7 полных оборотов
  const duration = 3200 + Math.random() * 900;           // 3.2..4.1s
  const curves = [
    'cubic-bezier(.12,.72,.12,1)',
    'cubic-bezier(.16,.85,.10,1)',
    'cubic-bezier(.22,.61,.08,1)',
  ];
  const curve = curves[Math.floor(Math.random() * curves.length)];

  const pointer = $('pointer');
  pointer.style.transition = 'none';
  pointer.classList.remove('spinning');
  void pointer.offsetWidth; // reflow — сбрасываем предыдущую transition перед новой

  // Небольшой случайный "перелёт" и откат назад в середине пути делает
  // скорость вращения не строго монотонной, а не только меняет числа.
  const overshoot = 12 + Math.random() * 26; // градусов
  const midDeg = pointerDeg + 360 * extraTurns + targetDelta + overshoot;
  const finalDeg = pointerDeg + 360 * extraTurns + targetDelta;
  const midShare = 0.72 + Math.random() * 0.08; // доля времени до "перелёта"

  pointer.style.transition = `transform ${(duration * midShare / 1000).toFixed(3)}s ${curve}`;
  requestAnimationFrame(() => { pointer.style.transform = `rotate(${midDeg}deg)`; });

  setTimeout(() => {
    pointer.style.transition = `transform ${(duration * (1 - midShare) / 1000).toFixed(3)}s cubic-bezier(.34,1.56,.64,1)`;
    pointer.style.transform = `rotate(${finalDeg}deg)`;
  }, duration * midShare);

  pointerDeg = finalDeg;

  setTimeout(() => {
    document.querySelector('.wheel-wrap').classList.remove('rolling');
    spinning = false;
    $('modeSlider').disabled = false;
    pointer.style.transition = '';
    haptic('notification', result.win ? 'success' : 'error');
    showResult(result);
    refresh();
  }, duration);
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

/* --------------------------------------------------------------- продажа */
async function sellPrize(prize, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await api('/api/sell', { prize_id: prize.id });
    renderState(res);   // шляпа исчезает, баланс обновляется
    toast(`Продано за ${fmt(res.sold_ton, 2)} TON`);
    haptic('notification', 'success');
  } catch (e) {
    toast(e.code === 'not_sellable' || e.code === 'prize_not_found'
      ? 'Этот приз уже нельзя продать' : 'Не удалось продать', true);
    refresh();
  }
}

/* -------------------------------------------------------------- пополнение */
// Каждое нажатие «Пополнить баланс» сразу добавляет +10 TON.
async function topUp() {
  try {
    const res = await api('/api/topup');
    renderState(res);
    toast(`+${fmt(res.added, 2)} TON`);
    haptic('impact', 'light');
  } catch (e) {
    toast('Не удалось пополнить баланс', true);
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
  // «Пополнить баланс» открывает форму реального пополнения через TON
  // Connect (openDeposit) — раньше эта кнопка была привязана к topUp() и
  // мгновенно зачисляла тестовые +10 TON, а сама форма пополнения нигде
  // не открывалась, поэтому переводы через кошелёк никуда не доходили.
  $('depositBtn').addEventListener('click', openDeposit);
  $('testTopupBtn')?.addEventListener('click', topUp);
  $('depositCloseBtn').addEventListener('click', () => { $('depositModal').hidden = true; });
  $('depositSendBtn').addEventListener('click', sendDeposit);
  $('walletBtn').addEventListener('click', onWalletClick);

  $('modeSlider').addEventListener('input', (e) => selectChance(Number(e.target.value)));

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
