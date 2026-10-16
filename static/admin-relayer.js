'use strict';
const RELAYER_STATUS = { online: 'Подключён', code_sent: 'Ждём код из Telegram', need_password: 'Нужен пароль 2FA', logged_out: 'Не подключён', login_required: 'Нужен вход', disabled: 'Выключен' };
const RELAYER_EVENT = { delivered: 'Зачислен', baseline: 'Был до подключения', unknown_user: 'Отправитель не в игре', skipped: 'Обычный подарок', no_price: 'Нет цены' };

function relayerErr(e) {
  const msg = e.data && e.data.message;
  const map = { bad_phone: 'Введите номер в формате +79990000000.', bad_code: 'Введите код из Telegram.', bad_request: 'Неверное значение.' };
  const text = msg || map[e.code];
  if (text) { $('panelError').textContent = text; $('panelError').hidden = false; toast(text, true); } else admErr(e);
}

async function admLoadRelayer(action, body) {
  const root = $('admRelayer');
  try {
    const res = await api(action || '/api/admin/relayer/status', body || {});
    admRenderRelayer(root, res);
    await admRenderStars(root);
    if (res.scan) toast(res.scan.baseline ? `Базовый скан: ${res.scan.saved_gifts_count} подарков запомнено` : `Обработано: ${res.scan.processed}, зачислено: ${res.scan.delivered}`);
  } catch (e) { relayerErr(e); }
}

function relayerBox(title) {
  const box = document.createElement('div');
  box.className = 'adm-box';
  const h = document.createElement('h3');
  h.textContent = title;
  box.appendChild(h);
  return box;
}

function relayerField(label, attrs) {
  const wrap = document.createElement('label');
  wrap.className = 'tc-label';
  wrap.textContent = label;
  const input = Object.assign(document.createElement('input'), { className: 'tc-input', autocomplete: 'off' }, attrs);
  wrap.appendChild(input);
  return [wrap, input];
}

function relayerButton(text, handler, cls) {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
  if (cls) b.className = cls;
  b.addEventListener('click', async () => { b.disabled = true; try { await handler(); } finally { b.disabled = false; } });
  return b;
}

function admRenderRelayer(root, r) {
  root.textContent = '';
  const st = r.state || {};
  const acc = st.account || {};

  const info = relayerBox('Привязка Telegram-аккаунта');
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = `Игрок дарит NFT этому аккаунту → подарок попадает в инвентарь картинкой по цене Portals −${r.accept_percent}%, продать можно по этой цене.`;
  const dl = document.createElement('dl');
  dl.className = 'status-list';
  const row = (k, v) => { const d = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; d.append(dt, dd); dl.appendChild(d); };
  row('Статус', RELAYER_STATUS[st.status] || (st.authorized ? 'Подключён' : 'Не подключён'));
  row('Аккаунт', acc.username ? '@' + acc.username : (acc.name || '—'));
  row('Подарков в аккаунте', st.saved_gifts_count ?? '—');
  row('Последний скан', st.last_scan ? new Date(st.last_scan * 1000).toLocaleString('ru-RU') : '—');
  if (st.error) row('Ошибка', st.error);
  if (!r.available) row('Telethon', 'не установлен на сервере');
  info.append(p, dl);
  root.appendChild(info);

  const cfg = relayerBox('API Telegram');
  const [l1, idInput] = relayerField('API ID (my.telegram.org)', { type: 'text', inputMode: 'numeric', value: r.api_id || '' });
  const [l2, hashInput] = relayerField('API hash', { type: 'password', placeholder: r.api_hash_set ? r.api_hash_mask + ' (задан)' : '' });
  const enabled = Object.assign(document.createElement('input'), { type: 'checkbox', checked: r.enabled });
  const enLabel = document.createElement('label');
  enLabel.className = 'quest-launch';
  enLabel.append(enabled, document.createTextNode(' Принимать подарки (сканер включён)'));
  cfg.append(l1, l2, enLabel, relayerButton('Сохранить', async () => {
    try { admRenderRelayer(root, await api('/api/admin/relayer/settings', { api_id: idInput.value, api_hash: hashInput.value, enabled: enabled.checked })); toast('Сохранено'); } catch (e) { relayerErr(e); }
  }));
  root.appendChild(cfg);

  const login = relayerBox('Вход в аккаунт');
  if (st.authorized) {
    login.append(relayerButton('Проверить сейчас', () => admLoadRelayer('/api/admin/relayer/scan')),
      relayerButton('Выйти из аккаунта', async () => { if (confirm('Отвязать аккаунт?')) await admLoadRelayer('/api/admin/relayer/logout'); }, 'danger'));
  } else {
    const [lp, phone] = relayerField('Телефон', { type: 'tel', placeholder: '+79990000000', value: (r.auth && r.auth.phone) || '' });
    login.append(lp, relayerButton('Получить код', () => admLoadRelayer('/api/admin/relayer/login/phone', { phone: phone.value })));
    const [lc, code] = relayerField('Код из Telegram', { type: 'text', inputMode: 'numeric' });
    login.append(lc, relayerButton('Войти по коду', () => admLoadRelayer('/api/admin/relayer/login/code', { code: code.value })));
    if (st.status === 'need_password') {
      const [lw, pw] = relayerField('Пароль 2FA', { type: 'password' });
      login.append(lw, relayerButton('Войти по паролю', () => admLoadRelayer('/api/admin/relayer/login/password', { password: pw.value })));
    }
  }
  root.appendChild(login);

  const log = relayerBox('Последние подарки');
  if (!r.events.length) log.append('Пока пусто');
  for (const ev of r.events) {
    const line = document.createElement('div');
    line.className = 'adm-prize';
    const img = Object.assign(document.createElement('img'), { alt: '', src: ev.slug ? `/nft-img/${ev.slug.toLowerCase()}.png` : '/images/hat.webp' });
    const name = Object.assign(document.createElement('b'), { textContent: `${ev.title}${ev.number ? ' #' + ev.number : ''}` });
    const val = Object.assign(document.createElement('em'), { textContent: `${RELAYER_EVENT[ev.status] || ev.status}${ev.price_ton ? ' · ' + fmt(ev.price_ton, 2) + ' TON' : ''} · ID ${ev.sender_id}` });
    line.append(img, name, val);
    log.appendChild(line);
  }
  root.appendChild(log);
}

async function admRenderStars(root) {
  const res = await api('/api/admin/stars');
  const box = relayerBox('Пополнение Telegram Stars');
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = res.bot_ready ? 'Счёт создаётся через бота, зачисление — после подтверждения оплаты Telegram. После оплаты вывод подарков блокируется на 21 день.' : 'Нужен BOT_TOKEN на сервере и подключённый бот (раздел «Telegram-бот»).';
  const [l, per] = relayerField('Курс: сколько Stars за 1 TON', { type: 'number', min: '1', max: '100000', step: '1', value: res.stars.per_ton });
  const enabled = Object.assign(document.createElement('input'), { type: 'checkbox', checked: res.stars.enabled });
  const label = document.createElement('label');
  label.className = 'quest-launch';
  label.append(enabled, document.createTextNode(' Пополнение Stars включено'));
  box.append(p, l, label, relayerButton('Сохранить', async () => {
    try { await api('/api/admin/stars/save', { per_ton: parseInt(per.value, 10), enabled: enabled.checked }); toast('Сохранено'); } catch (e) { relayerErr(e); }
  }));
  root.appendChild(box);
}
