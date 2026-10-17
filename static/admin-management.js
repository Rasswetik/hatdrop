const admin = { tab: 'overview', key: null, gifts: null, timer: 0 };

function admErr(e) {
  const m = {
    forbidden: 'Откройте панель снова из профиля игры.',
    csrf_failed: 'Откройте панель снова из профиля игры.',
    portals_not_configured: 'Портал не настроен на сервере (PORTALS_FLOORS_URL)',
    portals_unavailable: 'Портал не отвечает',
    bad_request: 'Неверное значение',
    admin_id_invalid: 'Введите числовой Telegram ID.',
    admin_owner_protected: 'Доступ владельца нельзя удалить.',
  };
  $('panelError').textContent = m[e.code] || 'Не удалось выполнить запрос. Попробуйте ещё раз.';
  $('panelError').hidden = false;
  toast(m[e.code] || 'Ошибка запроса', true);
}

function admShow(tab) {
  admin.tab = tab; admin.key = null;
  clearTimeout(admin.pollTimer);
  const titles = {shop:'Лавка',weapons:'Оружие',levels:'Уровни',database:'База данных',broadcast:'Рассылка',season:'Лидерборд',emoji:'Эмодзи',overview:'Обзор',finance:'Финансы',users:'Пользователи',market:'Маркеты',promos:'Промокоды',quests:'Квесты',withdrawals:'Выводы',tonconnect:'TON Connect',appearance:'Тема и техработы',bot:'Telegram-бот',admins:'Администраторы',relayer:'NFT-релейер',rtp:'RTP',payments:'Платежи'};
  document.querySelectorAll('#admTabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
  $('admBack').hidden = true;
  $('admTitle').textContent = titles[tab] || 'Панель управления';
  $('pageSubtitle').textContent = ({overview:'Работа приложения и финансовый результат',finance:'Игровой результат, доходы и расходы',users:'Баланс, инвентарь и активность игроков',withdrawals:'Заявки на выдачу подарков',market:'Источники цен и управление каталогом',promos:'Создание и управление промокодами',quests:'Настройка заданий, целей, сроков и наград',weapons:'Коллекции, редкость, видимость оружия и прокрутов',levels:'Оборот и награда для каждого уровня игрока',database:'Тип базы, ссылка Postgres и копия в SQLite',bot:'Подключение и уведомления Telegram',tonconnect:'Кошелёк и настройки приложения',appearance:'Оформление игрового приложения',relayer:'Пополнение NFT-подарками через Telegram-аккаунт'})[tab] || '';
  for (const id of ['Overview','Finance','Users','User','Market','Promos','Quests','Withdrawals','TonConnect','Appearance','Bot','Admins','Relayer','Rtp','Payments','Emoji','Season','Broadcast','Shop','Weapons','Levels','Database']) $('adm'+id).hidden = id.toLowerCase() !== tab;
  $('dashboardFilters').hidden = !['overview','finance'].includes(tab);
  $('overviewReload').hidden = !['overview','finance'].includes(tab);
  $('panelError').hidden = true;
  closeNavigation();
  history.replaceState(null, '', '/admin#' + tab);
  if (tab === 'overview' || tab === 'finance') admLoadOverview();
  else if (tab === 'users') admLoadUsers();
  else if (tab === 'market') { admLoadMarket(); admLoadMarketAuto(); admLoadMarketLog(); }
  else if (tab === 'promos') admLoadPromos();
  else if (tab === 'quests') admLoadQuests();
  else if (tab === 'withdrawals') admLoadWithdrawals();
  else if (tab === 'tonconnect') admLoadTonConnect();
  else if (tab === 'appearance') admLoadAppearance();
  else if (tab === 'bot') admLoadBot();
  else if (tab === 'admins') admLoadAdminAccess();
  else if (tab === 'relayer') admLoadRelayer();
  else if (tab === 'rtp') admLoadGlobalRtp();
  else if (tab === 'payments') admLoadPayments();
  else if (tab === 'emoji') admLoadEmoji();
  else if (tab === 'season') admLoadSeason();
  else if (tab === 'broadcast') admLoadBroadcast();
  else if (tab === 'shop') admLoadShop();
  else if (tab === 'weapons') admLoadWeapons();
  else if (tab === 'levels') admLoadLevels();
  else if (tab === 'database') admLoadDatabase();
}

async function admLoadGlobalRtp() {
  const box = $('admRtp');
  try {
    const res = await api('/api/admin/rtp');
    box.textContent = '';
    const names = { upgrade: 'Апгрейд', chests: 'Сундуки' };
    const main = admBox('Общий RTP, %');
    const inputs = {};
    const form = admField('div', { className: 'adm-form' });
    for (const m of res.modes) {
      const input = admField('input', { type: 'number', step: '0.1', min: '0', max: '150', value: m.global, title: `По умолчанию ${m.nominal}%` });
      inputs[m.mode] = input;
      form.append(admField('span', { textContent: `${names[m.mode]} · база ${m.nominal}%` }), input);
    }
    const save = admField('button', { type: 'button', className: 'primary', textContent: 'Сохранить' });
    save.addEventListener('click', async () => {
      const body = {};
      for (const m in inputs) body[m] = parseFloat(inputs[m].value);
      try { await api('/api/admin/rtp/save', body); toast('RTP сохранён'); admLoadGlobalRtp(); }
      catch (e) { admErr(e); }
    });
    form.appendChild(save);
    main.appendChild(form);
    box.appendChild(main);
    const adj = admBox('Персональные поправки');
    if (!res.adjusted.length) adj.append('Нет');
    for (const row of res.adjusted) {
      const b = admField('button', { type: 'button', className: 'adm-row' });
      const fmtAdj = (v) => (v > 0 ? '+' : '') + fmt(v, 2);
      b.append(admField('b', { textContent: row.name }), admField('span', { textContent: `Апгрейд ${fmtAdj(row.adj.upgrade)} · Сундуки ${fmtAdj(row.adj.chests)}` }));
      b.addEventListener('click', () => admOpenUser(row.key));
      adj.appendChild(b);
    }
    box.appendChild(adj);
  } catch (e) { admErr(e); }
}

async function admLoadMarketAuto() {
  const box = $('admMarketAuto');
  try {
    const res = await api('/api/admin/market/auto');
    box.textContent = '';
    const h = document.createElement('h3');
    h.textContent = 'Автообновление цен';
    const form = admField('div', { className: 'adm-form' });
    const on = admField('input', { type: 'checkbox', checked: res.enabled });
    const onLabel = admField('label', { className: 'quest-launch' });
    onLabel.append(on, document.createTextNode(' Включено'));
    const minutes = admField('input', { type: 'number', min: '1', step: '1', value: res.minutes, placeholder: 'Минут' });
    const save = admField('button', { type: 'button', className: 'primary', textContent: 'Сохранить' });
    save.addEventListener('click', async () => {
      try { await api('/api/admin/market/auto', { enabled: on.checked, minutes: parseInt(minutes.value, 10) }); toast('Сохранено'); admLoadMarketAuto(); }
      catch (e) { admErr(e); }
    });
    form.append(onLabel, admField('span', { textContent: 'каждые' }), minutes, admField('span', { textContent: 'мин' }), save);
    const info = document.createElement('p');
    info.className = 'adm-status';
    const when = (t) => new Date(t * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    info.textContent = res.enabled ? `Последнее: ${res.last_run ? when(res.last_run) : '—'} · следующее: ${res.next_run ? when(res.next_run) : '—'}` : 'Выключено';
    box.append(h, form, info);
  } catch (e) { admErr(e); }
}

async function admLoadUsers() {
  const list = $('admUserList');
  try {
    const res = await api('/api/admin/users', { q: $('admSearch').value });
    list.textContent = '';
    if (!res.rows.length) listNote(list, 'Никого не найдено');
    for (const u of res.rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'adm-row';
      const name = document.createElement('b');
      name.textContent = u.name;
      const bal = document.createElement('span');
      bal.textContent = `${fmt(u.balance_ton, 2)} TON`;
      b.append(name, bal);
      b.addEventListener('click', () => admOpenUser(u.key));
      list.appendChild(b);
    }
  } catch (e) { admErr(e); }
}

function admBox(title) {
  const box = document.createElement('div');
  box.className = 'adm-box';
  const h = document.createElement('h3');
  h.textContent = title;
  box.appendChild(h);
  return box;
}

function admField(tag, attrs = {}) {
  const el = document.createElement(tag);
  Object.assign(el, attrs);
  return el;
}

async function admOpenUser(key) {
  admin.key = key; admin.tab = 'user';

  $('admUsers').hidden = true;
  $('admMarket').hidden = true;
  $('admUser').hidden = false;
  $('admBack').hidden = false;
  try {
    const [{ user }, catalog] = await Promise.all([
      api('/api/admin/user', { key }),
      admin.gifts ? Promise.resolve(admin.gifts) : api('/api/gifts/catalog'),
    ]);
    admin.gifts = catalog;
    admRenderUser(user);
  } catch (e) { admErr(e); admShow('users'); }
}

function admRenderUser(u) {
  const root = $('admUser');
  root.textContent = '';
  $('admTitle').textContent = u.name;

  const info = admBox('Профиль');
  info.append(`ID: ${u.id}`, document.createElement('br'),
    `Игр: ${u.games} · оборот ${fmt(u.turnover_ton, 2)} TON`);

  const rtp = admBox('RTP игрока (скрыт от игрока)');
  const modeNames = { upgrade: 'Апгрейд', chests: 'Сундуки' };
  const rtpInputs = {};
  for (const m of ['upgrade', 'chests']) {
    const info = u.rtp[m];
    const row = admField('div', { className: 'adm-form' });
    const label = admField('span', { textContent: `${modeNames[m]}: итого ${fmt(info.effective, 2)}% (общий ${fmt(info.global, 2)}%)` });
    const input = admField('input', { type: 'number', step: '0.1', placeholder: 'Поправка, п.п.', value: info.adj || '' });
    rtpInputs[m] = input;
    row.append(label, input);
    rtp.appendChild(row);
  }
  const rtpSave = admField('button', { type: 'button', textContent: 'Сохранить RTP' });
  rtpSave.addEventListener('click', async () => {
    const body = { key: u.key };
    for (const m in rtpInputs) body[m] = rtpInputs[m].value === '' ? 0 : parseFloat(rtpInputs[m].value);
    try {
      admRenderUser((await api('/api/admin/user/rtp', body)).user);
      toast('RTP игрока сохранён');
    } catch (e) { admErr(e); }
  });
  rtp.appendChild(rtpSave);

  let lockBox = null;
  if (u.stars_lock_until * 1000 > Date.now()) {
    const lock = admBox(`Вывод заблокирован до ${new Date(u.stars_lock_until * 1000).toLocaleDateString('ru-RU')} (Stars)`);
    const unlock = admField('button', { type: 'button', textContent: 'Снять блокировку' });
    unlock.addEventListener('click', async () => {
      try { admRenderUser((await api('/api/admin/user/stars-unlock', { key: u.key })).user); toast('Блокировка снята'); } catch (e) { admErr(e); }
    });
    lock.appendChild(unlock);
    lockBox = lock;
  }

  const bal = admBox(`Баланс: ${fmt(u.balance_ton, 4)} TON`);
  const form = admField('div', { className: 'adm-form' });
  const amount = admField('input', { type: 'number', step: 'any', placeholder: 'Сумма, TON' });
  const set = admField('button', { type: 'button', textContent: 'Установить' });
  const add = admField('button', { type: 'button', textContent: '± Изменить' });
  const depositBox = admField('input', { type: 'checkbox' });
  const depositLabel = admField('label', { textContent: ' пополнение (реф. бонус)' });
  depositLabel.prepend(depositBox);
  const send = async (mode) => {
    const v = parseFloat(amount.value);
    if (!Number.isFinite(v)) { toast('Введи сумму', true); return; }
    try {
      admRenderUser((await api('/api/admin/balance', { key: u.key, mode, amount: v, deposit: mode === 'add' && depositBox.checked })).user);
      toast('Баланс обновлён');
    } catch (e) { admErr(e); }
  };
  set.addEventListener('click', () => send('set'));
  add.addEventListener('click', () => send('add'));
  form.append(amount, set, add, depositLabel);
  bal.appendChild(form);

  const inv = admBox('Инвентарь');
  if (!u.prizes.length) inv.append('Пусто');
  for (const p of u.prizes) {
    const row = admField('div', { className: 'adm-prize' });
    const img = admField('img', { alt: '', src: p.image || hatAsset(p.tier) });
    const name = admField('b', { textContent: trName(p.name) });
    const val = admField('em', { textContent: `${fmt(p.value_ton, 2)} TON` });
    const del = admField('button', { type: 'button', textContent: 'Убрать' });
    del.className = 'danger';
    del.addEventListener('click', async () => {
      try {
        admRenderUser((await api('/api/admin/prize/remove', { key: u.key, prize_id: p.id })).user);
        toast('Подарок убран');
      } catch (e) { admErr(e); }
    });
    row.append(img, name, val, del);
    inv.appendChild(row);
  }

  const give = admBox('Выдать подарок');
  const gform = admField('div', { className: 'adm-form' });
  const sel = admField('select');
  const hats = [['tier:random', 'Шляпа волшебника'], ['tier:onyx', 'Шляпа на ониксе'], ['tier:black', 'Шляпа на блэке']];
  for (const [v, t] of hats) sel.add(new Option(t, v));
  for (const g of admin.gifts.items) sel.add(new Option(`${g.name} · ${fmt(g.price_ton, 2)} TON`, `gift:${g.slug}`));
  const model = admField('select');
  const fillModels = async () => {
    model.textContent = '';
    model.hidden = !sel.value.startsWith('gift:');
    if (model.hidden) return;
    model.add(new Option('Любая модель', ''));
    try {
      const r = await fetchModels(sel.value.slice(5));
      for (const m of r.models) model.add(new Option(m.model, m.model));
    } catch (e) {}
  };
  sel.addEventListener('change', fillModels);
  const giveBtn = admField('button', { type: 'button', textContent: 'Выдать' });
  giveBtn.addEventListener('click', async () => {
    const body = sel.value.startsWith('gift:')
      ? { gift: sel.value.slice(5), model: model.value }
      : { tier: sel.value.slice(5) };
    try {
      admRenderUser((await api('/api/admin/prize/add', { key: u.key, ...body })).user);
      toast('Подарок выдан');
    } catch (e) { admErr(e); }
  });
  gform.append(sel, model, giveBtn);
  give.appendChild(gform);
  fillModels();

  const pq = admBox('Личные квесты');
  pq.id = 'admPersonalQuests';
  admRenderPersonalQuests(pq, u.key);
  // HatCoin
  const hc = admBox(`Баланс HatCoin: ${fmt(u.hatcoin, 4)}`);
  const hcForm = admField('div', { className: 'adm-form' });
  const hcAmount = admField('input', { type: 'number', step: 'any', placeholder: 'Сумма, HatCoin' });
  const hcSet = admField('button', { type: 'button', textContent: 'Установить' });
  const hcAdd = admField('button', { type: 'button', textContent: '± Изменить' });
  const hcSend = async (mode) => {
    const v = parseFloat(hcAmount.value);
    if (!Number.isFinite(v)) { toast('Введи сумму', true); return; }
    try { admRenderUser((await api('/api/admin/user/hatcoin', { key: u.key, mode, amount: v })).user); toast('Баланс HatCoin обновлён'); } catch (e) { admErr(e); }
  };
  hcSet.onclick = () => hcSend('set'); hcAdd.onclick = () => hcSend('add');
  hcForm.append(hcAmount, hcSet, hcAdd); hc.appendChild(hcForm);

  // Снаряжение
  const wp = admBox('Предметы игрока: оружие, прокруты, оформления');
  const names = Object.fromEntries((u.weapon_catalog || []).map(w => [w.id, w.name]));
  if (!u.weapons.length) wp.append('Выданных предметов нет');
  for (const id of u.weapons) {
    const row = admField('div', { className: 'adm-form' });
    const del = admField('button', { type: 'button', className: 'danger', textContent: 'Убрать' });
    del.onclick = async () => { try { admRenderUser((await api('/api/admin/user/weapons', { key: u.key, weapon: id, action: 'revoke' })).user); } catch (e) { admErr(e); } };
    row.append(admField('b', { textContent: names[id] || id }), del); wp.appendChild(row);
  }
  const wForm = admField('div', { className: 'adm-form' });
  const wSel = admField('select');
  for (const [kind, label] of Object.entries(ITEM_GROUPS)) {
    const g = admField('optgroup', { label });
    for (const w of (u.weapon_catalog || []).filter(w => !u.weapons.includes(w.id) && (w.kind || 'gear') === kind)) g.append(admField('option', { value: w.id, textContent: w.name }));
    if (g.children.length) wSel.append(g);
  }
  const wGive = admField('button', { type: 'button', textContent: 'Выдать' });
  wGive.onclick = async () => { if (!wSel.value) return; try { admRenderUser((await api('/api/admin/user/weapons', { key: u.key, weapon: wSel.value })).user); toast('Предмет выдан'); } catch (e) { admErr(e); } };
  wForm.append(wSel, wGive); wp.appendChild(wForm);

  // Личные ордера лавки
  const ps = admBox('Личные ордера лавки');
  (async function drawPs() {
    ps.replaceChildren(admField('h3', { textContent: 'Личные ордера лавки' }));
    try {
      const data = await api('/api/admin/user/shop', { key: u.key });
      for (const o of data.rows) ps.append(shopRow(o, drawPs, (x) => { ps.replaceChildren(admField('h3', { textContent: 'Изменить ордер' }), shopForm(x, u.weapon_catalog || [], drawPs, u.key)); }));
      const add = admField('button', { type: 'button', textContent: 'Новый личный ордер' });
      add.onclick = () => { ps.replaceChildren(admField('h3', { textContent: 'Новый личный ордер' }), shopForm(null, u.weapon_catalog || [], drawPs, u.key)); };
      ps.append(add);
    } catch (e) { admErr(e); }
  })();
  root.append(info, ...(lockBox ? [lockBox] : []), rtp, bal, hc, inv, wp, give, pq, ps);
}

async function admRenderPersonalQuests(box, key, data) {
  const el = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props || {}); n.append(...kids); return n; };
  try { data = data || await api('/api/admin/user/quests', { key }); } catch (e) { admErr(e); return; }
  box.querySelectorAll('.pq-row,.pq-form,.pq-note').forEach((n) => n.remove());
  box.append(el('p', { className: 'muted pq-note', textContent: 'Квест видит и выполняет только этот игрок, награда начисляется как у обычных квестов. Игрок получит уведомление от бота.' }));
  if (!data.rows.length) box.append(el('p', { className: 'muted pq-note', textContent: 'Личных квестов пока нет.' }));
  const units = Object.fromEntries(data.types.map((t) => [t.id, t.unit]));
  for (const q of data.rows) {
    const pr = q.progress;
    const del = el('button', { type: 'button', className: 'danger', textContent: 'Удалить' });
    del.onclick = async () => { if (!confirm('Удалить личный квест?')) return; try { admRenderPersonalQuests(box, key, await api('/api/admin/user/quests/save', { key, action: 'delete', id: q.id })); } catch (e) { admErr(e); } };
    const state = pr.claimed ? 'награда получена' : pr.completed ? 'выполнен, не забран' : pr.expired ? 'истёк' : 'в процессе';
    box.append(el('div', { className: 'adm-prize pq-row' },
      el('b', { textContent: q.title }),
      el('em', { textContent: `${fmt(pr.value, 2)} / ${fmt(q.goal, 2)} · ${q.reward_amount} ${q.reward_type === 'ton' ? 'TON' : 'HatCoin'} · ${state}` }), del));
  }
  const kind = el('select');
  for (const t of data.types) kind.add(new Option(t.label, t.id));
  const goal = el('input', { type: 'number', min: '0', step: 'any', value: '1', placeholder: 'Цель' });
  const threshold = el('input', { type: 'number', min: '0', step: 'any', placeholder: 'Порог (шанс % / сумма TON)', hidden: true });
  const title = el('input', { placeholder: 'Название (пусто — авто)', maxLength: 80 });
  const reward = el('input', { type: 'number', min: '0', step: 'any', value: '0.1', placeholder: 'Награда' });
  const rtype = el('select');
  rtype.add(new Option('TON', 'ton')); rtype.add(new Option('HatCoin', 'hatcoin'));
  const hours = el('input', { type: 'number', min: '0', step: '1', value: '0', placeholder: 'Часов на выполнение (0 — без лимита)' });
  kind.onchange = () => { threshold.hidden = !/^(upgrade_|deposit_min)/.test(kind.value); if (!threshold.hidden && !threshold.value) threshold.value = kind.value === 'deposit_min' ? '5' : '20'; };
  const add = el('button', { type: 'button', className: 'primary', textContent: 'Добавить квест' });
  add.onclick = async () => {
    add.disabled = true;
    try {
      admRenderPersonalQuests(box, key, await api('/api/admin/user/quests/save', {
        key, action: 'create', kind: kind.value, goal: parseFloat(goal.value) || 0, threshold: parseFloat(threshold.value) || 0,
        title: title.value, reward_type: rtype.value, reward_amount: parseFloat(reward.value) || 0, duration_hours: parseFloat(hours.value) || 0 }));
      toast('Личный квест добавлен');
    } catch (e) { toast(e.code === 'quest_invalid' ? 'Проверьте цель, порог и награду' : e.code === 'quest_limit' ? 'Слишком много личных квестов' : 'Ошибка', true); } finally { add.disabled = false; }
  };
  box.append(el('div', { className: 'adm-form pq-form' }, kind, goal, threshold), el('div', { className: 'adm-form pq-form' }, title), el('div', { className: 'adm-form pq-form' }, reward, rtype, hours), el('div', { className: 'adm-form pq-form' }, add));
}

async function admLoadMarket(action, body) {
  const list = $('admMarketList');
  try {
    const res = await api(action || '/api/admin/market', body || {});
    admRenderMarket(res);
    if (res.refreshing) toast('Загружаю подарки и модели с Portals…');
    if ((res.portals_refreshing || res.mrkt_refreshing) && admin.tab === 'market') {
      clearTimeout(admin.pollTimer);
      admin.pollTimer = setTimeout(() => admLoadMarket(), 5000);
    }
  } catch (e) { admErr(e); }
}

function admRenderPortals(res) {
  if (res.portals_configured === undefined) return;
  admin.portals = res.portals_configured;
  const parts = [
    res.portals_key_set ? `ключ: ${res.portals_key_mask}` : 'ключ не задан',
    `подарков: ${res.portals_gifts || 0}, моделей: ${res.portals_models || 0}`,
  ];
  if (res.portals_refreshing) parts.push('идёт загрузка…');
  if (res.portals_error) parts.push(`ошибка: ${res.portals_error}`);
  $('admPortalsStatus').textContent = parts.join(' · ');
  $('admPortalsKey').value = '';
  $('admMarketSource').value = res.active_market || "portals";
  $('admMrktStatus').textContent = [res.mrkt_key_mask ? `ключ MRKT: ${res.mrkt_key_mask}` : 'ключ MRKT не задан',res.mrkt_refreshing ? 'идёт загрузка…' : '',`проверено: ${res.mrkt_checked || 0}/${res.mrkt_total || 0}`,`моделей: ${res.mrkt_models || 0}`,res.mrkt_error ? `ошибка: ${res.mrkt_error}` : ''].filter(Boolean).join(' · ');
}

async function admSavePortals(clear) {
  const body = {};
  if (clear) body.clear_key = true;
  else if ($('admPortalsKey').value.trim()) body.auth = $('admPortalsKey').value.trim();
  try {
    const out = await api('/api/admin/portals/set', body);
    admRenderMarket(out);
    toast(clear ? 'Ключ удалён' : 'Сохранено');
  } catch (e) { admErr(e); }
}

function admRenderMarket(res) {
  admRenderPortals(res);
  $('admMarketNote').textContent = 'Portals и MRKT обновляются отдельно. MRKT получает модели и их минимальные цены из /api/v1/gifts/models. Цены коллекций можно менять вручную.';
  const list = $('admMarketList');
  list.textContent = '';
  for (const r of res.rows) {
    const row = admField('div', { className: 'adm-form' });
    const name = admField('span', { className: 'adm-name', textContent: r.name });
    if (r.custom) name.classList.add('custom');
    const input = admField('input', { type: 'number', step: 'any', min: '0', value: r.price_ton });
    const save = admField('button', { type: 'button', textContent: 'Сохранить' });
    save.addEventListener('click', async () => {
      try {
        const out = await api('/api/admin/market/set', { slug: r.slug, price: parseFloat(input.value) });
        admin.gifts = null;
        admRenderMarket(out);
        toast('Цена сохранена');
      } catch (e) { admErr(e); }
    });
    row.append(name, input, save);
    list.appendChild(row);
  }
}

let promoGift = null;
const ITEM_GROUPS = { gear: 'Оружие', spin: 'Типы прокрута', theme: 'Оформления' };
async function admFillItems(sel) {
  try {
    const { items } = await api('/api/admin/levels');
    for (const [kind, label] of Object.entries(ITEM_GROUPS)) {
      const g = admField('optgroup', { label });
      for (const it of items.filter(i => !i.default && i.kind === kind)) g.append(admField('option', { value: it.id, textContent: it.name }));
      sel.append(g);
    }
  } catch (e) { admErr(e); }
}

async function admLoadPromos() {
  try {
    const {rows} = await api('/api/admin/promos');
    const list = $('admPromoRows'); list.replaceChildren();
    for (const item of rows) {
      const row = admField('div', {className: 'adm-box'});
      const detail = admField('p', {textContent: `${item.code} · ${item.kind === 'balance' ? item.amount + ' TON' : item.name + (item.model ? ' / ' + item.model : '')} · ${item.uses}/${item.limit} · ${item.active ? 'Активен' : 'Отключён'}`});
      const buttons = admField('div', {className: 'adm-form'});
      const copy = admField('button', {type: 'button', textContent: 'Копировать'});
      copy.onclick = async () => { try { await navigator.clipboard.writeText(item.code); toast('Код скопирован'); } catch(e) { toast(item.code); } };
      const toggle = admField('button', {type: 'button', textContent: item.active ? 'Отключить' : 'Включить'});
      toggle.onclick = async () => { try { await api('/api/admin/promos/update', {code:item.code, active: !item.active}); admLoadPromos(); } catch(e) { admErr(e); } };
      const del = admField('button', {type:'button', className:'danger', textContent:'Удалить'});
      del.onclick = async () => { if (!confirm(`Удалить ${item.code}?`)) return; try { await api('/api/admin/promos/update', {code:item.code, delete:true}); admLoadPromos(); } catch(e) { admErr(e); } };
      buttons.append(copy,toggle,del); row.append(detail,buttons); list.appendChild(row);
    }
    if (!rows.length) list.textContent = 'Пока нет промокодов';
  } catch(e) { admErr(e); }
}
async function admChoosePromoGift() {
  try {
    const catalog = await api('/api/gifts/catalog');
    const modal = document.createElement('div'); modal.className = 'modal adm-promo-picker'; modal.style.zIndex = '9999'; modal.style.overflowX='hidden';
    const panel = admField('div', {className: 'modal-card list-modal'});
    panel.style.maxHeight = '85dvh'; panel.style.width='min(100% - 20px, 460px)'; panel.style.maxWidth='460px'; panel.style.minWidth='0'; panel.style.overflowX='hidden'; panel.style.overflowY='auto';
    const search = admField('input', {className: 'gp-search', placeholder:'Поиск подарка'});
    const list = admField('div', {className:'gift-list'}); list.style.gridTemplateColumns='repeat(3,minmax(0,1fr))'; list.style.width='100%';
    const render = () => { list.replaceChildren();
      for (const g of catalog.items.filter(g=>g.name.toLowerCase().includes(search.value.toLowerCase()))) {
        const b=admField('button',{type:'button',className:'gift-item'});
        const img=admField('img',{src:g.image,alt:''});
        const name=admField('span',{textContent:g.name}); const price=admField('span',{textContent:`${g.price_ton} TON`});
        b.append(img,name,price); b.onclick=()=>{ promoGift=g; $('admPromoSelected').textContent=`${g.name} · ${g.price_ton} TON`; modal.remove(); };
        list.append(b);
      }
    };
    search.oninput=render; render();
    const close=admField('button',{type:'button',className:'adm-promo-picker-close',textContent:'✕ Закрыть выбор'}); close.onclick=()=>modal.remove();
    panel.append(search,list,close);modal.append(panel); document.body.append(modal); modal.hidden=false;
  } catch(e) { admErr(e); }
}
async function admSaveMrkt(clear) {
  try {
    const res=await api('/api/admin/mrkt/set', clear ? {clear_key:true} : {auth:$('admMrktKey').value.trim()});
    $('admMrktKey').value='';toast('Настройки MRKT сохранены');admLoadMarket();
  } catch(e) { admErr(e); }
}

let adminWdTab = 'active';
let adminWdBotUsername = '';

async function admLoadWithdrawals() {
  const root = $('admWdList');
  if (admin.tab !== 'withdrawals') return;
  root.textContent = 'Загружаю заявки…';
  try {
    const res = await api('/api/admin/withdrawals');
    adminWdBotUsername = res.bot_username || '';
    $('admWdBotStatus').textContent = res.bot_enabled
      ? (adminWdBotUsername ? 'Бот: @' + adminWdBotUsername : 'Бот подключён · username не определён')
      : 'BOT_TOKEN не задан на сервере. Уведомления отключены.';
    document.querySelectorAll('#admWdTabs button').forEach(b => b.classList.toggle('on', b.dataset.wd === adminWdTab));
    root.replaceChildren();
    const active = (x) => x.status === 'pending' || x.status === 'approved';
    const rows = (res.rows || []).filter(x => adminWdTab === 'active' ? active(x) : !active(x));
    if (!rows.length) return listNote(root, adminWdTab === 'active' ? 'Нет активных заявок' : 'Нет завершённых заявок');
    for (const wd of rows) {
      const card = admField('div', {className:'adm-wd-card'});
      const img = admField('img', {className:'adm-wd-art', alt:''});
      img.src = wd.image || '/images/hat.webp';
      img.loading = 'lazy';
      const info = admField('div', {className:'adm-wd-info'});
      const title = admField('strong', {className:'adm-wd-name', textContent: wd.name || 'Подарок'});
      const owner = admField('span', {className:'adm-wd-meta',
        textContent:(wd.username ? '@'+wd.username : (wd.first_name || 'Игрок')) + ' · ID ' + (wd.telegram_id || wd.user_id)});
      const price = admField('span', {className:'adm-wd-meta',textContent: Number(wd.value_ton || 0).toFixed(2)+' TON'});
      const state = admField('span',{className:'adm-wd-chip',textContent: admWdStatus(wd)});
      info.append(title,owner,price,state);
      if (wd.auto) {
        const auto = {queued:'Автовывод: в очереди у релейера', done:'Автовывод: выдан', failed:'Автовывод не удался — нужен ручной вывод', manual:'Ручная проверка'}[wd.auto] || wd.auto;
        let line = auto;
        if (wd.auto_error) line += (wd.auto_status === 'not_eligible' ? ' · Причина: ' : ' · Ошибка: ') + wd.auto_error + (wd.attempts ? ' (попытка ' + wd.attempts + '/5)' : '');
        else if (wd.auto_status && wd.auto === 'queued') line += ' · ' + wd.auto_status;
        info.append(admField('span',{className:'adm-wd-meta',textContent:line}));
      }
      const buttons=admField('div',{className:'adm-wd-actions'});
      function btn(label,cls,fn){const b=admField('button',{type:'button',className:cls,textContent:label});b.onclick=fn;buttons.append(b);}
      if(wd.status==='pending'||wd.status==='approved') btn('Рассмотреть','approve',()=>admOpenWd(wd.id));
      if (wd.telegram_id) btn('Профиль ↗','',()=>{window.open(wd.username ? 'https://t.me/'+encodeURIComponent(wd.username) : 'tg://user?id='+encodeURIComponent(wd.telegram_id),'_blank');});
      if(buttons.childNodes.length) info.append(buttons);
      card.append(img,info);root.append(card);
    }
  } catch(e){root.textContent='Не удалось загрузить заявки';admErr(e);}
  let want = ''; try { want = sessionStorage.getItem('admWd') || ''; sessionStorage.removeItem('admWd'); } catch(e) {}
  if (want) admOpenWd(want);
}

function admWdStatus(wd){
  if (wd.status==='approved') return wd.transfer==='failed' ? 'Ошибка передачи — нужен ручной вывод' : 'Принято, подарок передаётся…';
  if (wd.status==='pending' && wd.auto==='failed') return 'Автовывод не удался — нужно решение';
  return ({pending:'Ждёт решения',completed:'Выполнено',rejected:'Отклонено'})[wd.status] || wd.status;
}
const admWdDate = (ts) => ts ? new Date(ts*1000).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
let admWdPoll = 0;

async function admOpenWd(id) {
  clearTimeout(admWdPoll);
  const root = $('admWdList');
  root.textContent = 'Загружаю заявку…';
  let d;
  try { d = await api('/api/admin/withdrawals/detail', {id}); }
  catch (e) { root.textContent = 'Не удалось загрузить заявку'; admErr(e); return; }
  root.replaceChildren();
  const wd = d.request, pl = d.player, pr = d.prize;
  const box = (title) => { const b = admField('div',{className:'adm-box'}); b.append(admField('h3',{textContent:title})); root.append(b); return b; };
  const line = (b, k, v) => { const r = admField('div',{className:'adm-wd-row'}); r.append(admField('span',{textContent:k}), admField('b',{textContent:String(v)})); b.append(r); };
  const back = admField('button',{type:'button',className:'ghost',textContent:'← К списку заявок'}); back.onclick = () => admLoadWithdrawals(); root.append(back);

  const head = box('Заявка на вывод · ' + admWdStatus(wd));
  const art = admField('img',{className:'adm-wd-art',alt:''}); art.src = wd.image || '/images/hat.webp'; head.append(art);
  line(head,'Подарок',pr.name); line(head,'Стоимость',Number(pr.value_ton||0).toFixed(2)+' TON');
  line(head,'Получен',pr.origin); line(head,'Подана',admWdDate(wd.created));
  if (pr.slug) line(head,'NFT',pr.slug); else if (pr.collection) line(head,'Коллекция / модель',pr.collection + (pr.model ? ' · ' + pr.model : ''));
  if (wd.auto_error && wd.status==='pending') line(head,'Почему не автоматически',wd.auto_error);

  if (wd.transfer==='failed') {
    const eb = box('⚠ Ошибка передачи');
    eb.append(admField('p',{textContent:'Ошибка: ' + (wd.transfer_error || 'неизвестная')}));
    eb.append(admField('p',{className:'muted',textContent:'Передайте подарок вручную: «' + pr.name + '»' + (pr.slug ? ' (' + pr.slug + ')' : '') + ' → ' + (pl.username ? '@' + pl.username : 'ID ' + pl.telegram_id) + '. Затем нажмите «Я отправил вручную» — игрок получит уведомление. Либо повторите попытку.'}));
  } else if (wd.status==='approved') {
    head.append(admField('p',{className:'muted',textContent:'Подарок передаётся через релейер. Страница обновится сама.'}));
    admWdPoll = setTimeout(() => admOpenWd(id), 4000);
  }

  const who = box('Игрок');
  line(who,'Имя', (pl.name||'—') + (pl.username ? ' · @' + pl.username : '')); line(who,'Telegram ID', pl.telegram_id || pl.id);
  line(who,'В игре с', admWdDate(pl.created)); line(who,'Был онлайн', admWdDate(pl.seen));
  line(who,'Баланс', Number(pl.balance_ton||0).toFixed(2)+' TON · '+Number(pl.hatcoin||0).toFixed(2)+' HatCoin');
  line(who,'Оборот / игры', Number(pl.turnover_ton||0).toFixed(2)+' TON · '+pl.games);
  line(who,'Кошелёк', pl.has_wallet ? (pl.wallet || 'привязан') : 'нет');
  if (pl.banned) line(who,'Статус','ЗАБЛОКИРОВАН');
  if (pl.note_text) line(who,'Заметка',pl.note_text);

  const dep = box('Депозиты · ' + d.deposits.count + ' шт. · ' + Number(d.deposits.total||0).toFixed(2) + ' TON');
  if (!d.deposits.rows.length) dep.append(admField('p',{className:'muted',textContent:'Депозитов нет'}));
  for (const r of d.deposits.rows) line(dep, admWdDate(r.ts) + ' · ' + r.kind + (r.note ? ' · ' + r.note : ''), '+' + Number(r.amount||0).toFixed(2) + ' TON');

  const wds = box('Выводы игрока');
  if (!d.withdrawals.length) wds.append(admField('p',{className:'muted',textContent:'Выводов не было'}));
  for (const r of d.withdrawals) line(wds, admWdDate(r.created) + ' · ' + r.name, Number(r.value_ton||0).toFixed(2) + ' TON · ' + ({pending:'ждёт',approved:'принят',completed:'выдан',rejected:'отклонён'}[r.status] || r.status));

  const gm = box('Последние игры');
  if (!d.games.length) gm.append(admField('p',{className:'muted',textContent:'Игр нет'}));
  for (const g of d.games) line(gm, admWdDate(g.ts) + ' · ' + g.kind + (g.target ? ' · ' + g.target : ''), (g.win ? '+' : '−') + (g.win ? Number(g.payout_ton||0) : Number(g.cost_ton||0)).toFixed(2) + ' TON');

  const acts = admField('div',{className:'adm-wd-actions adm-wd-big'}); root.append(acts);
  const btn = (label, cls, action, confirmText) => { const b = admField('button',{type:'button',className:cls,textContent:label}); b.onclick = () => admResolveWd(wd, action, confirmText); acts.append(b); };
  if (wd.status==='pending') {
    btn('✓ Принять вывод','approve','approve','Принять вывод? Подарок будет передан игроку автоматически через релейер.');
    btn('Я отправил вручную','','complete','Подтверждаете, что подарок уже отправлен игроку вручную? Игрок получит уведомление.');
    btn('✕ Отклонить','reject','reject','Отклонить заявку и вернуть подарок в инвентарь?');
  } else if (wd.status==='approved' && wd.transfer==='failed') {
    btn('↻ Повторить попытку','approve','retry','');
    btn('✓ Я отправил вручную','approve','complete','Подтверждаете, что подарок реально отправлен игроку? Он получит уведомление о выводе.');
    btn('✕ Отклонить','reject','reject','Отклонить заявку и вернуть подарок в инвентарь?');
  }
}

async function admResolveWd(wd,action,confirmText){
  if(confirmText && !window.confirm(confirmText))return;
  try {
    await api('/api/admin/withdrawals/resolve',{id:wd.id,action});
    toast('Готово');
    if (action==='approve' || action==='retry') await admOpenWd(wd.id); else await admLoadWithdrawals();
  }catch(e){admErr(e);}
}

async function admSetupBot(){
  if(!window.confirm('Установить webhook Telegram на адрес текущего HTTPS-сервера? Секрет должен быть задан в TELEGRAM_WEBHOOK_SECRET.'))return;
  try{
    const result=await api('/api/admin/bot/setup');
    adminWdBotUsername=result.bot_username||'';
    toast(result.ok ? 'Telegram webhook установлен' : 'Не удалось подключить webhook',!result.ok);
    admLoadWithdrawals();
  }catch(e){toast('Не удалось настроить бот: '+(e.code||'ошибка'),true);}
}

let tcManifestUrl='/tonconnect-manifest.json';

async function admLoadTonConnect(){
  const status=$('tcStatus');
  status.textContent='Загружаем настройки TON Connect…';
  try{
    const data=await api('/api/admin/tonconnect');
    const cfg=data.config || {};
    const map={recipient_address:'tcRecipient',app_name:'tcAppName',app_url:'tcAppUrl',
      icon_url:'tcIconUrl',terms_url:'tcTerms',privacy_url:'tcPrivacy'};
    for(const [field,id] of Object.entries(map))$(id).value=cfg[field]||'';
    $('tcIconPreview').src=cfg.icon_url||'images/hat.png';
    tcManifestUrl=data.manifest_url||'/tonconnect-manifest.json';
    status.textContent=(data.using_saved?'Настройки загружены из базы. ':'Используются значения по умолчанию. ')+
      (data.deposit_ready?'Получатель TON указан.':'Укажите кошелёк для пополнений.');
  }catch(e){status.textContent='Ошибка загрузки настроек';admErr(e);}
}

async function admSaveTonConnect(reset){
  if(reset && !window.confirm('Вернуть значения TON Connect из настроек сервера?'))return;
  const body=reset?{reset:true}:{
    recipient_address:$('tcRecipient').value.trim(),
    app_name:$('tcAppName').value.trim(),
    app_url:$('tcAppUrl').value.trim(),
    icon_url:$('tcIconUrl').value.trim(),
    terms_url:$('tcTerms').value.trim(),
    privacy_url:$('tcPrivacy').value.trim()
  };
  const btn=$('tcSave');btn.disabled=true;
  try{
    await api('/api/admin/tonconnect/save',body);
    toast(reset?'Значения по умолчанию восстановлены':'TON Connect сохранён в базе');
    await admLoadTonConnect();

  }catch(e){toast('Настройки не сохранены: '+(e.code||'ошибка'),true);}
  finally{btn.disabled=false;}
}


async function admLoadMaint() {
  try {
    const r = await api('/api/admin/maintenance');
    $('admMaintToggle').checked = r.enabled; $('admMaintText').value = r.text || '';
    $('admMaintStatus').textContent = r.enabled ? 'Включён · игра закрыта для игроков, открыта админам' : 'Выключен · игра работает';
  } catch (e) { admErr(e); }
}
async function admSaveMaint(payload, okText) {
  try {
    const r = await api('/api/admin/maintenance', payload);
    $('admMaintToggle').checked = r.enabled; $('admMaintStatus').textContent = r.enabled ? 'Включён · игра закрыта для игроков, открыта админам' : 'Выключен · игра работает';
    toast(okText);
  } catch (e) { $('admMaintToggle').checked = !$('admMaintToggle').checked; admErr(e); }
}

async function admLoadAppearance() {
  admLoadMaint();
  const toggle = $('admHalloweenToggle');
  const status = $('admHalloweenStatus');
  toggle.disabled = true;
  status.textContent = 'Загружаем настройку…';
  try {
    const result = await api('/api/admin/theme');
    toggle.checked = result.enabled === true;
    status.textContent = result.enabled ? 'Тема включена для всех игроков' : 'Выключена · обычная тема';

  } catch (error) {
    status.textContent = 'Не удалось загрузить настройку';
    admErr(error);
  } finally {
    toggle.disabled = false;
  }
}

async function admToggleHalloween() {
  const toggle = $('admHalloweenToggle');
  const status = $('admHalloweenStatus');
  const desired = toggle.checked;
  toggle.disabled = true;
  status.textContent = 'Сохраняем…';
  try {
    const result = await api('/api/admin/theme', { enabled: desired });

    toggle.checked = result.enabled === true;

    status.textContent = result.enabled ? 'Тема включена для всех игроков' : 'Выключена · обычная тема';
    toast(result.enabled ? 'Хэллоуинская тема включена' : 'Обычное оформление восстановлено');
  } catch (error) {
    toggle.checked = !desired;
    status.textContent = 'Ошибка сохранения · попробуйте ещё раз';
    admErr(error);
  } finally {
    toggle.disabled = false;
  }
}

function initAdmin() {
  initQuestAdmin();
  $('admHalloweenToggle').addEventListener('change', admToggleHalloween);
  $('admMaintToggle').addEventListener('change', () => {
    const on = $('admMaintToggle').checked;
    if (on && !confirm('Включить технические работы? Все игроки, кроме админов, потеряют доступ к игре.')) { $('admMaintToggle').checked = false; return; }
    admSaveMaint({ enabled: on, text: $('admMaintText').value }, on ? 'Технические работы включены' : 'Игра снова открыта');
  });
  $('admMaintSave').addEventListener('click', () => admSaveMaint({ enabled: $('admMaintToggle').checked, text: $('admMaintText').value }, 'Текст сохранён'));
  $('admBack').addEventListener('click', () => admShow('users'));
  document.querySelectorAll('#admTabs button').forEach(b => b.addEventListener('click', () => admShow(b.dataset.tab)));
  $('admSearch').addEventListener('input', () => {
    clearTimeout(admin.timer);
    admin.timer = setTimeout(admLoadUsers, 250);
  });
  $('admMarketChoose').addEventListener('click', async () => {
    const source = $('admMarketSource').value;
    if (!window.confirm('Сменить основной маркет на ' + source.toUpperCase() + '? Старые цены и дубли будут удалены.')) return;
    try { await api('/api/admin/market/source', {source, clear_cache:true}); toast('Источник переключён. Обновление запущено'); admLoadMarket(); }
    catch(e) { admErr(e); }
  });
  $('tcSave').addEventListener('click',()=>admSaveTonConnect(false));
  $('tcReset').addEventListener('click',()=>admSaveTonConnect(true));
  $('tcReload').addEventListener('click',admLoadTonConnect);
  $('tcManifest').addEventListener('click',()=>window.open(tcManifestUrl,'_blank'));
  $('tcIconUrl').addEventListener('input',()=>{$('tcIconPreview').src=$('tcIconUrl').value.trim()||'images/hat.png';});
  $('admWdReload').addEventListener('click', admLoadWithdrawals);
  document.querySelectorAll('#admWdTabs button').forEach(b=>b.addEventListener('click',()=>{adminWdTab=b.dataset.wd;admLoadWithdrawals();}));
  $('admWdBotOpen').addEventListener('click',()=>{if(adminWdBotUsername)window.open('https://t.me/'+encodeURIComponent(adminWdBotUsername),'_blank');else toast('Сначала настройте бота',true);});
  $('admWdBotSetup').addEventListener('click', admSetupBot);
  $('admRefresh').addEventListener('click', () => admLoadMarket('/api/admin/market/refresh'));
  $('admMrktRefresh').addEventListener('click', () => admLoadMarket('/api/admin/mrkt/refresh'));
  $('admPortalsSave').addEventListener('click', () => admSavePortals(false));
  $('admPortalsClear').addEventListener('click', () => admSavePortals(true));
  $('admMrktSave').addEventListener('click', () => admSaveMrkt(false));
  $('admMrktClear').addEventListener('click', () => admSaveMrkt(true));
  $('admPromoKind').addEventListener('change', () => {
    const k=$('admPromoKind').value; $('admPromoAmount').hidden=k!=='balance'; $('admPromoGiftField').hidden=k!=='gift'; $('admPromoItem').hidden=k!=='item';
    if (k==='item' && !$('admPromoItem').options.length) admFillItems($('admPromoItem'));
  });
  $('admPromoChoose').addEventListener('click', admChoosePromoGift);
  $('admPromoCreate').addEventListener('click', async () => {
    const kind=$('admPromoKind').value;
    if (kind==='gift' && !promoGift) return toast('Выбери подарок',true);
    try {
      const result=await api('/api/admin/promos/create', {kind,code:$('admPromoCode').value.trim(),
        limit: Number($('admPromoLimit').value),amount:Number($('admPromoAmount').value),
        gift:promoGift?.slug, weapon:$('admPromoItem').value});
      $('admPromoCode').value='';toast(`Создан промокод ${result.code}`);admLoadPromos();
    } catch(e) { admErr(e); }
  });
}
