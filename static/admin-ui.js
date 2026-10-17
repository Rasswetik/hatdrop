/* HatDrop admin UI v2: общий поиск (Ctrl+K), список игроков с фильтрами и карточка игрока во вкладках */
(() => {
const g = (id) => document.getElementById(id);
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const num = (n, d = 2) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
function avatar(name, id, cls = 'us-av') {
  const a = mk('div', cls, (String(name).replace(/^@/, '')[0] || '?').toUpperCase());
  a.style.background = `linear-gradient(135deg,hsl(${hue(id)} 60% 48%),hsl(${(hue(id) + 40) % 360} 60% 36%))`;
  return a;
}
function ago(ts) {
  if (!ts) return 'не заходил';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 90) return 'онлайн';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} дн назад`;
}
const dateStr = (ts) => ts ? new Date(ts * 1000).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const tag = (txt, cls) => mk('span', 'us-tag ' + (cls || ''), txt);

/* ---------- список игроков ---------- */
const us = { filter: 'all', offset: 0, loading: false };
async function loadUsers(reset = true) {
  const list = g('admUserList'); if (!list || us.loading) return;
  us.loading = true;
  if (reset) us.offset = 0;
  try {
    const res = await api('/api/admin/users', { q: g('admSearch').value, filter: us.filter, sort: g('usSort').value, offset: us.offset, limit: 50 });
    if (reset) list.textContent = '';
    renderStats(res);
    g('usMeta').textContent = res.matched === res.total ? `Игроков: ${res.total}` : `Найдено ${res.matched} из ${res.total}`;
    if (!res.rows.length && reset) list.append(mk('div', 'gs-empty', 'Никого не найдено. Измените запрос или фильтр.'));
    for (const u of res.rows) list.append(userRow(u));
    us.offset += res.rows.length;
    g('usMore').hidden = us.offset >= res.matched;
  } catch (e) { admErr(e); }
  us.loading = false;
}
function renderStats(res) {
  const box = g('usStats'); box.textContent = '';
  const s = res.summary || {};
  for (const [label, val, cls] of [['Всего игроков', res.total], ['Онлайн за 24 ч', s.online24h], ['С балансом', s.with_balance], ['Сумма балансов, TON', num(s.balance_total, 2)], ['Заблокировано', s.banned, s.banned ? 'warn' : '']]) {
    const c = mk('div', 'us-stat ' + (cls || '')); c.append(mk('small', '', label), mk('b', '', String(val ?? 0))); box.append(c);
  }
}
function cell(label, value, cls) { const c = mk('div', 'us-cell'); c.append(mk('small', '', label), mk('b', cls || '', value)); return c; }
function userRow(u) {
  const b = mk('button', 'us-row'); b.type = 'button';
  const id = mk('div', 'us-id'), nm = mk('div', 'us-name'), top = mk('b', '', u.name);
  if (u.admin) top.append(tag('АДМИН', 'blue'));
  if (u.banned) top.append(tag('БАН', 'red'));
  if (u.has_wallet) top.append(tag('КОШЕЛЁК', 'green'));
  nm.append(top, mk('small', '', `${u.username ? '@' + u.username + ' · ' : ''}${u.id} · ${ago(u.seen)}`));
  id.append(avatar(u.name, u.id), nm);
  b.append(id, cell('Баланс', `${num(u.balance_ton, 2)} TON`, 'gold'), cell('HatCoin', num(u.hatcoin, 2)), cell('Оборот', `${num(u.turnover_ton, 1)} TON`), cell('Игры', num(u.games, 0)), cell('Призы', num(u.prizes, 0)), mk('span', 'us-go', '›'));
  b.onclick = () => admOpenUser(u.key);
  return b;
}
window.admLoadUsers = () => loadUsers(true);

/* ---------- карточка игрока ---------- */
const ud = { tab: 'ov', key: '' };
const origRender = window.admRenderUser;
window.admRenderUser = function (u) {
  origRender(u);
  try { decorateUser(u); } catch (e) { console.error(e); }
};
function copy(text) { try { navigator.clipboard.writeText(text); toast('Скопировано'); } catch (e) { toast(text); } }
function decorateUser(u) {
  const root = g('admUser');
  const boxes = [...root.children];
  const panes = { ov: [], bal: [], inv: [], game: [], content: [], act: [] };
  for (const b of boxes) {
    const t = (b.querySelector('h3') || {}).textContent || '';
    if (/^Профиль/.test(t)) continue;
    const k = /^Баланс/.test(t) ? 'bal' : /^(Инвентарь|Выдать подарок|Снаряжение)/.test(t) ? 'inv' : /^(RTP|Вывод заблокирован)/.test(t) ? 'game' : /^Личн/.test(t) ? 'content' : 'ov';
    panes[k].push(b);
  }
  if (ud.key !== u.key) { ud.key = u.key; ud.tab = 'ov'; }
  root.textContent = '';
  // шапка
  const head = mk('div', 'ud-head'), info = mk('div');
  const nm = mk('div', 'ud-name', u.name);
  if (u.admin) nm.append(tag('АДМИН', 'blue'));
  if (u.banned) nm.append(tag('ЗАБЛОКИРОВАН', 'red'));
  const sub = mk('div', 'ud-sub');
  sub.append(mk('span', '', `ID ${u.id}`), mk('span', '', u.username ? '@' + u.username : 'без username'), mk('span', '', `Был: ${ago(u.seen)}`));
  const acts = mk('div', 'ud-acts');
  const cp = mk('button', '', 'Копировать ID'); cp.type = 'button'; cp.onclick = () => copy(String(u.id).replace(/^tg/, ''));
  acts.append(cp);
  if (u.username) { const tg = mk('button', '', 'Открыть в Telegram'); tg.type = 'button'; tg.onclick = () => window.open('https://t.me/' + u.username, '_blank', 'noopener'); acts.append(tg); }
  const rl = mk('button', '', '↻ Обновить'); rl.type = 'button'; rl.onclick = () => admOpenUser(u.key); acts.append(rl);
  info.append(nm, sub, acts);
  head.append(avatar(u.name, u.id, 'us-av'), info);
  const tiles = mk('div', 'ud-tiles');
  for (const [l, v, c] of [['Баланс TON', num(u.balance_ton, 4), 'gold'], ['HatCoin', num(u.hatcoin, 4)], ['Оборот TON', num(u.turnover_ton, 2)], ['Игры', num(u.games, 0)], ['Призы', String(u.prizes.length)], ['Снаряжение', String(u.weapons.length)]]) {
    const t = mk('div', 'ud-tile'); t.append(mk('small', '', l), mk('b', c || '', v)); tiles.append(t);
  }
  head.append(tiles);
  // вкладки
  const names = [['ov', 'Обзор'], ['bal', 'Баланс'], ['inv', 'Инвентарь'], ['game', 'Игра и лимиты'], ['content', 'Квесты и ордера'], ['act', 'Статус']];
  const bar = mk('div', 'ud-tabs'), pane = {};
  for (const [k, label] of names) {
    const b = mk('button', k === ud.tab ? 'on' : '', label); b.type = 'button';
    b.onclick = () => { ud.tab = k; for (const [kk, el] of Object.entries(pane)) el.hidden = kk !== k; [...bar.children].forEach((x, i) => x.classList.toggle('on', names[i][0] === k)); };
    bar.append(b);
    const p = mk('div', 'ud-pane'); p.hidden = k !== ud.tab; pane[k] = p; 
  }
  // обзор: ключевые данные
  const kv = mk('div', 'adm-box'); kv.append(mk('h3', '', 'Данные игрока'));
  const grid = mk('div', 'ud-kv');
  for (const [l, v] of [['ID', u.id], ['Ключ', u.key], ['Кошелёк TON', u.wallet || 'не подключён'], ['Регистрация', dateStr(u.created)], ['Последний вход', dateStr(u.seen)], ['Обучение лавки', u.tour_done ? 'пройдено' : 'не пройдено'], ['Блокировка вывода (Stars)', u.stars_lock_until * 1000 > Date.now() ? 'до ' + dateStr(u.stars_lock_until) : 'нет']]) {
    const d = mk('div'); d.append(mk('small', '', l), mk('span', '', v)); grid.append(d);
  }
  kv.append(grid);
  pane.ov.append(kv, ...panes.ov);
  pane.bal.append(...panes.bal); pane.inv.append(...panes.inv); pane.game.append(...panes.game); pane.content.append(...panes.content);
  pane.act.append(flagsBox(u), ...panes.act);
  root.append(head, bar, ...names.map(([k]) => pane[k]));
}
function flagsBox(u) {
  const box = mk('div', 'adm-box ud-flags'); box.append(mk('h3', '', 'Статус и заметка'));
  const row = mk('div', 'adm-form');
  const ban = mk('button', u.banned ? 'primary' : 'danger', u.banned ? 'Разблокировать игрока' : 'Заблокировать игрока'); ban.type = 'button';
  ban.onclick = async () => {
    if (!u.banned && !confirm('Заблокировать игрока? Он потеряет доступ к игре.')) return;
    try { window.admRenderUser((await api('/api/admin/user/flags', { key: u.key, banned: !u.banned })).user); toast(u.banned ? 'Игрок разблокирован' : 'Игрок заблокирован'); } catch (e) { admErr(e); }
  };
  const tour = mk('button', '', 'Сбросить обучение'); tour.type = 'button';
  tour.onclick = async () => { try { window.admRenderUser((await api('/api/admin/user/flags', { key: u.key, reset_tour: true })).user); toast('Обучение будет показано снова'); } catch (e) { admErr(e); } };
  row.append(ban, tour);
  const note = mk('textarea'); note.maxLength = 300; note.placeholder = 'Заметка об игроке (видна только админам)'; note.value = u.note_text || '';
  const save = mk('button', 'primary', 'Сохранить заметку'); save.type = 'button';
  save.onclick = async () => { try { window.admRenderUser((await api('/api/admin/user/flags', { key: u.key, note: note.value })).user); toast('Заметка сохранена'); } catch (e) { admErr(e); } };
  const r2 = mk('div', 'adm-form'); r2.append(save);
  box.append(row, mk('div', '', ''), note, r2);
  return box;
}

/* ---------- общий поиск ---------- */
const TAB_TITLES = {};
const KW = {
  overview: 'статистика обзор график игроки хранилище база резервная копия бэкап восстановить',
  finance: 'финансы доход расход прибыль операции журнал csv',
  users: 'игроки пользователи баланс бан заблокировать заметка hatcoin оружие',
  rtp: 'rtp возврат процент шанс общий',
  withdrawals: 'выводы вывод заявки подарки одобрить отклонить',
  promos: 'промокод промокоды код',
  quests: 'квесты квест достижения награда',
  payments: 'платежи оплата звезды stars ton crypto пополнение',
  shop: 'лавка магазин ордер ордера цена товары костян бесплатный',
  broadcast: 'рассылка сообщение уведомление пост',
  season: 'лидерборд топ сезон призы места',
  emoji: 'эмодзи премиум подарки',
  relayer: 'nft релейер автовывод лимит аккаунт',
  market: 'маркеты маркет portals mrkt цены ключ',
  bot: 'бот телеграм сообщения кнопки команды тексты',
  admins: 'администраторы админы доступ',
  tonconnect: 'ton connect кошелёк манифест иконка',
  appearance: 'тема хэллоуин оформление',
  weapons: 'оружие коллекции коллекция редкость награда за сбор уровни снаряжение',
};
const FEATURES = [
  ['Общий RTP игры', 'rtp'], ['Резервная копия базы: скачать, отправить, восстановить', 'overview'], ['Включить или выключить Хэллоуин', 'appearance'],
  ['Тексты и кнопки сообщений бота', 'bot'], ['Новый ордер лавки', 'shop'], ['Создать коллекцию оружия', 'weapons'], ['Награды за сбор оружия, уровни', 'weapons'], ['Редкость оружия', 'weapons'], ['Бесплатный ордер', 'shop'], ['Награды за места в топе', 'season'],
  ['Создать промокод', 'promos'], ['Создать квест или достижение', 'quests'], ['Рассылка по ссылке на пост', 'broadcast'], ['Выдать доступ администратору', 'admins'],
  ['Оплата звёздами и CryptoBot', 'payments'], ['Премиум-эмодзи подарков', 'emoji'], ['Манифест TON Connect', 'tonconnect'], ['Одобрить или отклонить вывод', 'withdrawals'],
  ['Расходы и доходы', 'finance'], ['Лимит автовывода NFT', 'relayer'], ['Ключ Portals и MRKT', 'market'], ['Автообновление цен', 'market'],
];
const CONTAINERS = { admOverview: 'overview', admFinance: 'finance', admUsers: 'users', admRtp: 'rtp', admWithdrawals: 'withdrawals', admPromos: 'promos', admQuests: 'quests', admPayments: 'payments', admShop: 'shop', admWeapons: 'weapons', admBroadcast: 'broadcast', admSeason: 'season', admEmoji: 'emoji', admRelayer: 'relayer', admMarket: 'market', admBot: 'bot', admAdmins: 'admins', admTonConnect: 'tonconnect', admAppearance: 'appearance' };
const gs = { items: [], sel: 0, timer: 0, seq: 0 };
function buildIndex() {
  const items = [];
  document.querySelectorAll('#admTabs button').forEach((b) => { const tab = b.dataset.tab, title = (b.querySelector('.nav-tx') || b).textContent.trim(); TAB_TITLES[tab] = title; items.push({ kind: 'Разделы', title, sub: 'Открыть раздел', tab, hay: (title + ' ' + (KW[tab] || '')).toLowerCase(), ico: b.querySelector('.nav-ic')?.textContent || '•' }); });
  for (const [title, tab] of FEATURES) items.push({ kind: 'Настройки и действия', title, sub: 'Раздел «' + (TAB_TITLES[tab] || tab) + '»', tab, hay: (title + ' ' + (KW[tab] || '')).toLowerCase(), ico: '⚙' });
  const seen = new Set();
  for (const [cid, tab] of Object.entries(CONTAINERS)) {
    const root = g(cid); if (!root) continue;
    root.querySelectorAll('h2,h3,legend,summary,.tc-label,dt').forEach((el) => {
      const title = el.textContent.trim().replace(/\s+/g, ' ');
      if (title.length < 3 || title.length > 70 || seen.has(tab + title)) return;
      seen.add(tab + title);
      items.push({ kind: 'Настройки и действия', title, sub: 'Раздел «' + (TAB_TITLES[tab] || tab) + '»', tab, el, hay: title.toLowerCase(), ico: '⚙' });
    });
  }
  return items;
}
function matchScore(it, tokens) {
  let s = 0;
  for (const t of tokens) { const i = it.hay.indexOf(t); if (i < 0) return 0; s += i === 0 ? 3 : it.title.toLowerCase().includes(t) ? 2 : 1; }
  return s;
}
function renderList(sections, users) {
  const list = g('gsList'); list.textContent = ''; gs.items = [];
  const add = (group, rows) => {
    if (!rows.length) return;
    list.append(mk('div', 'gs-group', group));
    for (const r of rows) { gs.items.push(r); r.node = itemNode(r); list.append(r.node); }
  };
  add('Игроки', users); add('Разделы', sections.filter((x) => x.kind === 'Разделы')); add('Настройки и действия', sections.filter((x) => x.kind !== 'Разделы'));
  if (!gs.items.length) list.append(mk('div', 'gs-empty', 'Ничего не найдено. Попробуйте имя игрока, ID или слово из названия раздела.'));
  gs.sel = 0; mark();
}
function itemNode(r) {
  const b = mk('button', 'gs-item'); b.type = 'button'; b.setAttribute('role', 'option');
  if (r.user) b.append(avatar(r.user.name, r.user.id, 'gs-av')); else b.append(mk('span', 'gs-ico', r.ico));
  const t = mk('span', 'gs-t'); t.append(mk('b', '', r.title), mk('small', '', r.sub)); b.append(t);
  if (r.right) b.append(mk('span', 'gs-r', r.right));
  b.onclick = () => choose(r); b.onmousemove = () => { gs.sel = gs.items.indexOf(r); mark(); };
  return b;
}
function mark() { gs.items.forEach((r, i) => r.node.classList.toggle('sel', i === gs.sel)); const n = gs.items[gs.sel]?.node; if (n) n.scrollIntoView({ block: 'nearest' }); }
function closeSearch() { g('gsOverlay').hidden = true; }
function choose(r) {
  closeSearch();
  if (r.user) { admShow('users'); admOpenUser(r.user.key); return; }
  admShow(r.tab);
  if (r.el) setTimeout(() => { const el = r.el.isConnected ? r.el : null; if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('gs-flash'); setTimeout(() => el.classList.remove('gs-flash'), 2400); } }, 500);
}
async function runSearch() {
  const q = g('gsInput').value.trim().toLowerCase(), seq = ++gs.seq;
  const tokens = q.split(/\s+/).filter(Boolean);
  const all = buildIndex();
  const sections = (tokens.length ? all.map((it) => ({ it, s: matchScore(it, tokens) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.it) : all.filter((x) => x.kind === 'Разделы')).slice(0, 14);
  renderList(sections, []);
  if (!q) return;
  try {
    const res = await api('/api/admin/users', { q, limit: 6 });
    if (seq !== gs.seq) return;
    const users = res.rows.map((u) => ({ kind: 'Игроки', title: u.name, sub: `${u.username ? '@' + u.username + ' · ' : ''}${u.id} · ${ago(u.seen)}`, right: `${num(u.balance_ton, 2)} TON`, user: u }));
    renderList(sections, users);
  } catch (e) { /* поиск по разделам остаётся */ }
}
function openSearch(prefill = '') {
  const ov = g('gsOverlay'); ov.hidden = false;
  const inp = g('gsInput'); inp.value = prefill; inp.focus(); inp.select(); runSearch();
}
function initSearch() {
  g('gsOpen').onclick = () => openSearch();
  g('gsClose').onclick = closeSearch;
  g('gsOverlay').addEventListener('click', (e) => { if (e.target === g('gsOverlay')) closeSearch(); });
  g('gsInput').addEventListener('input', () => { clearTimeout(gs.timer); gs.timer = setTimeout(runSearch, 160); });
  g('gsInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); gs.sel = Math.min(gs.items.length - 1, gs.sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); gs.sel = Math.max(0, gs.sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (gs.items[gs.sel]) choose(gs.items[gs.sel]); }
    else if (e.key === 'Escape') closeSearch();
  });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    else if (e.key === '/' && !typing && g('gsOverlay').hidden) { e.preventDefault(); openSearch(); }
    else if (e.key === 'Escape' && !g('gsOverlay').hidden) closeSearch();
  });
}

function initUsersUi() {
  g('usChips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]'); if (!b) return;
    us.filter = b.dataset.f; [...g('usChips').children].forEach((x) => x.classList.toggle('on', x === b)); loadUsers(true);
  });
  g('usSort').addEventListener('change', () => loadUsers(true));
  g('usMore').addEventListener('click', () => loadUsers(false));
}
function init() { initSearch(); initUsersUi(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
