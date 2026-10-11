const admin = { tab: 'overview', key: null, gifts: null, timer: 0 };

function admErr(e) {
  const m = {
    forbidden: 'Откройте панель снова из профиля игры.',
    csrf_failed: 'Откройте панель снова из профиля игры.',
    portals_not_configured: 'Портал не настроен на сервере (PORTALS_FLOORS_URL)',
    portals_unavailable: 'Портал не отвечает',
    bad_request: 'Неверное значение',
  };
  $('panelError').textContent = m[e.code] || 'Не удалось выполнить запрос. Попробуйте ещё раз.';
  $('panelError').hidden = false;
  toast(m[e.code] || 'Ошибка запроса', true);
}

function admShow(tab) {
  admin.tab = tab; admin.key = null;
  clearTimeout(admin.pollTimer);
  const titles = {overview:'Обзор',finance:'Финансы',users:'Пользователи',market:'Маркеты',promos:'Промокоды',withdrawals:'Выводы',tonconnect:'TON Connect',appearance:'Тема игры',bot:'Telegram-бот'};
  document.querySelectorAll('#admTabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
  $('admBack').hidden = true;
  $('admTitle').textContent = titles[tab] || 'Панель управления';
  $('pageSubtitle').textContent = ({overview:'Работа приложения и финансовый результат',finance:'Игровой результат, доходы и расходы',users:'Баланс, инвентарь и активность игроков',withdrawals:'Заявки на выдачу подарков',market:'Источники цен и управление каталогом',promos:'Создание и управление промокодами',bot:'Подключение и уведомления Telegram',tonconnect:'Кошелёк и настройки приложения',appearance:'Оформление игрового приложения'})[tab] || '';
  for (const id of ['Overview','Finance','Users','User','Market','Promos','Withdrawals','TonConnect','Appearance','Bot']) $('adm'+id).hidden = id.toLowerCase() !== tab;
  $('dashboardFilters').hidden = !['overview','finance'].includes(tab);
  $('overviewReload').hidden = !['overview','finance'].includes(tab);
  $('panelError').hidden = true;
  closeNavigation();
  history.replaceState(null, '', '/admin#' + tab);
  if (tab === 'overview' || tab === 'finance') admLoadOverview();
  else if (tab === 'users') admLoadUsers();
  else if (tab === 'market') admLoadMarket();
  else if (tab === 'promos') admLoadPromos();
  else if (tab === 'withdrawals') admLoadWithdrawals();
  else if (tab === 'tonconnect') admLoadTonConnect();
  else if (tab === 'appearance') admLoadAppearance();
  else if (tab === 'bot') admLoadBot();
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

  const bal = admBox(`Баланс: ${fmt(u.balance_ton, 4)} TON`);
  const form = admField('div', { className: 'adm-form' });
  const amount = admField('input', { type: 'number', step: 'any', placeholder: 'Сумма, TON' });
  const set = admField('button', { type: 'button', textContent: 'Установить' });
  const add = admField('button', { type: 'button', textContent: '± Изменить' });
  const send = async (mode) => {
    const v = parseFloat(amount.value);
    if (!Number.isFinite(v)) { toast('Введи сумму', true); return; }
    try {
      admRenderUser((await api('/api/admin/balance', { key: u.key, mode, amount: v })).user);
      toast('Баланс обновлён');
    } catch (e) { admErr(e); }
  };
  set.addEventListener('click', () => send('set'));
  add.addEventListener('click', () => send('add'));
  form.append(amount, set, add);
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

  root.append(info, bal, inv, give);
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
      const state = admField('span',{className:'adm-wd-chip',textContent: ({pending:'На проверке',approved:'Одобрено, ожидает отправки',completed:'Выполнено',rejected:'Отклонено'})[wd.status] || wd.status});
      info.append(title,owner,price,state);
      const buttons=admField('div',{className:'adm-wd-actions'});
      function btn(label,cls,fn){const b=admField('button',{type:'button',className:cls,textContent:label});b.onclick=fn;buttons.append(b);}
      if(wd.status==='pending'){
        btn('✓ Одобрить','approve',()=>admResolveWd(wd,'approve'));
        btn('✕ Отклонить','reject',()=>admResolveWd(wd,'reject'));
      } else if(wd.status==='approved'){
        btn('✓ Отправлено','approve',()=>admResolveWd(wd,'complete'));
      }
      if (wd.telegram_id) btn('Профиль ↗','',()=>{window.open(wd.username ? 'https://t.me/'+encodeURIComponent(wd.username) : 'tg://user?id='+encodeURIComponent(wd.telegram_id),'_blank');});
      if(buttons.childNodes.length) info.append(buttons);
      card.append(img,info);root.append(card);
    }
  } catch(e){root.textContent='Не удалось загрузить заявки';admErr(e);}
}

async function admResolveWd(wd,action){
  const confirmText=({approve:'Одобрить заявку? Это не отправляет NFT автоматически.',reject:'Отклонить заявку и вернуть подарок в инвентарь?',complete:'Подтверждаете, что NFT реально отправлен игроку?'})[action];
  if(!window.confirm(confirmText))return;
  try {
    await api('/api/admin/withdrawals/resolve',{id:wd.id,action});
    toast('Статус заявки обновлён');
    await admLoadWithdrawals();
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


async function admLoadAppearance() {
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
  $('admHalloweenToggle').addEventListener('change', admToggleHalloween);
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
    const gift=$('admPromoKind').value==='gift'; $('admPromoAmount').hidden=gift; $('admPromoGiftField').hidden=!gift;
  });
  $('admPromoChoose').addEventListener('click', admChoosePromoGift);
  $('admPromoCreate').addEventListener('click', async () => {
    const kind=$('admPromoKind').value;
    if (kind==='gift' && !promoGift) return toast('Выбери подарок',true);
    try {
      const result=await api('/api/admin/promos/create', {kind,code:$('admPromoCode').value.trim(),
        limit: Number($('admPromoLimit').value),amount:Number($('admPromoAmount').value),
        gift:promoGift?.slug});
      $('admPromoCode').value='';toast(`Создан промокод ${result.code}`);admLoadPromos();
    } catch(e) { admErr(e); }
  });
}
