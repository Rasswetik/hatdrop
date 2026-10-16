'use strict';
const RELAYER_STATUS = { online: 'Подключён', code_sent: 'Ждём код из Telegram', need_password: 'Нужен пароль 2FA', logged_out: 'Не подключён', login_required: 'Нужен вход', disabled: 'Выключен' };
const RELAYER_EVENT = { credited: 'Зачислен', delivered: 'Зачислен', baseline: 'Был до подключения', unknown_user: 'Отправитель не в игре', skipped: 'Обычный подарок', no_price: 'Нет цены' };
const RELAYER_AUTO = { queued: 'В очереди', done: 'Выдан', failed: 'Нужен ручной вывод' };

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
    if (res.scan) toast(res.scan.baseline ? `Запомнено подарков: ${res.scan.saved_gifts_count}` : `Подарков: ${res.scan.saved_gifts_count} · зачислено: ${res.scan.delivered}`);
  } catch (e) { relayerErr(e); }
}

function relayerBox(title) {
  const box = document.createElement('div');
  box.className = 'adm-box';
  if (title) { const h = document.createElement('h3'); h.textContent = title; box.appendChild(h); }
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

function relayerCheck(label, checked) {
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  const wrap = document.createElement('label');
  wrap.className = 'quest-launch';
  wrap.append(input, document.createTextNode(' ' + label));
  return [wrap, input];
}

function relayerButton(text, handler, cls) {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
  if (cls) b.className = cls;
  b.addEventListener('click', async () => { b.disabled = true; try { await handler(); } finally { b.disabled = false; } });
  return b;
}

function relayerRows(box, rows) {
  const dl = document.createElement('dl');
  dl.className = 'status-list';
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    const dt = Object.assign(document.createElement('dt'), { textContent: k });
    const dd = Object.assign(document.createElement('dd'), { textContent: v });
    d.append(dt, dd);
    dl.appendChild(d);
  }
  box.appendChild(dl);
}

function relayerGiftLine(img, name, meta) {
  const line = document.createElement('div');
  line.className = 'adm-prize';
  line.append(
    Object.assign(document.createElement('img'), { alt: '', loading: 'lazy', src: img || '/images/hat.webp' }),
    Object.assign(document.createElement('b'), { textContent: name }),
    Object.assign(document.createElement('em'), { textContent: meta }));
  return line;
}

function admRenderRelayer(root, r) {
  root.textContent = '';
  const st = r.state || {};
  const acc = st.account || {};
  const when = (t) => (t ? new Date(t * 1000).toLocaleString('ru-RU') : '—');

  const info = relayerBox('Аккаунт релейера');
  relayerRows(info, [
    ['Статус', RELAYER_STATUS[st.status] || (st.authorized ? 'Подключён' : 'Не подключён')],
    ['Имя', acc.name || '—'],
    ['Username', acc.username ? '@' + acc.username : '—'],
    ['Telegram ID', acc.id || '—'],
    ['Телефон', acc.phone ? '+' + String(acc.phone).replace(/^\+/, '') : '—'],
    ['Stars на балансе', st.stars_balance ?? '—'],
    ['Подарков на аккаунте', st.saved_gifts_count ?? '—'],
    ['Последняя проверка', when(st.last_scan)],
    ...(st.error ? [['Ошибка', st.error]] : []),
    ...(r.available ? [] : [['Telethon', 'не установлен на сервере']]),
  ]);
  if (st.authorized) {
    const row = document.createElement('div');
    row.className = 'adm-form';
    row.append(relayerButton('Загрузить подарки', () => admLoadRelayer('/api/admin/relayer/scan')),
      relayerButton('Выйти из аккаунта', async () => { if (confirm('Отвязать аккаунт?')) await admLoadRelayer('/api/admin/relayer/logout'); }, 'danger'));
    info.appendChild(row);
  }
  root.appendChild(info);

  if (!st.authorized) {
    const login = relayerBox('Вход');
    const [lp, phone] = relayerField('Телефон', { type: 'tel', placeholder: '+79990000000', value: (r.auth && r.auth.phone) || '' });
    login.append(lp, relayerButton('Получить код', () => admLoadRelayer('/api/admin/relayer/login/phone', { phone: phone.value })));
    const sent = st.status === 'code_sent' || st.status === 'need_password';
    if (sent && r.auth) {
      const where = { app: 'в приложение Telegram: откройте чат «Telegram» (аккаунт +' + String(r.auth.phone || '').replace('+', '') + ') — код приходит туда, а не по SMS', sms: 'по SMS', call: 'звонком', fragment: 'через Fragment', email: 'на почту' }[r.auth.delivery] || 'в Telegram';
      const hint = document.createElement('p');
      hint.className = 'tc-info';
      hint.textContent = 'Код отправлен ' + where + '.';
      login.append(hint);
      if (r.auth.next) login.append(relayerButton('Отправить код ещё раз (' + ({ sms: 'SMS', call: 'звонок', app: 'Telegram', email: 'почта' }[r.auth.next] || r.auth.next) + ')', () => admLoadRelayer('/api/admin/relayer/login/resend')));
    }
    const [lc, code] = relayerField('Код из Telegram', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code' });
    const [lw, pw] = relayerField('Пароль 2FA (если включена двухфакторная защита)', { type: 'password', autocomplete: 'off' });
    login.append(lc, lw, relayerButton('Войти', () => {
      if (st.status === 'need_password' && !code.value.trim()) return admLoadRelayer('/api/admin/relayer/login/password', { password: pw.value });
      return admLoadRelayer('/api/admin/relayer/login/code', { code: code.value, password: pw.value });
    }));
    if (st.status === 'need_password') {
      const note = document.createElement('p');
      note.className = 'tc-info';
      note.textContent = 'Код принят. На аккаунте включена двухфакторная защита — введите пароль 2FA и нажмите «Войти».';
      login.append(note);
    }
    root.appendChild(login);
  }

  const cfg = relayerBox('Настройки');
  const [l1, idInput] = relayerField('API ID', { type: 'text', inputMode: 'numeric', value: r.api_id || '' });
  const [l2, hashInput] = relayerField('API hash', { type: 'password', placeholder: r.api_hash_set ? r.api_hash_mask + ' (задан)' : '' });
  const [enWrap, enabled] = relayerCheck('Принимать подарки', r.enabled);
  const [autoWrap, autoOn] = relayerCheck('Автовывод подарков с релейера', r.auto.enabled);
  const [limWrap, limOn] = relayerCheck('Лимит автовывода', r.auto.limit_enabled);
  const [l3, limit] = relayerField('Лимит, TON (дороже — только ручной вывод)', { type: 'number', min: '0.01', step: '0.01', value: r.auto.limit_ton });
  cfg.append(l1, l2, enWrap, autoWrap, limWrap, l3, relayerButton('Сохранить', async () => {
    try {
      admRenderRelayer(root, await api('/api/admin/relayer/settings', {
        api_id: idInput.value, api_hash: hashInput.value, enabled: enabled.checked,
        auto_enabled: autoOn.checked, auto_limit_enabled: limOn.checked, auto_limit_ton: parseFloat(limit.value) || 10 }));
      toast('Сохранено');
    } catch (e) { relayerErr(e); }
  }));
  root.appendChild(cfg);

  const gifts = relayerBox(`Подарки на релейере · ${r.gifts.length}`);
  if (!r.gifts.length) gifts.append('Пусто — нажмите «Загрузить подарки»');
  for (const g of r.gifts) {
    const locked = g.can_transfer_at * 1000 > Date.now();
    gifts.appendChild(relayerGiftLine(g.slug ? `/nft-img/${g.slug.toLowerCase()}.png` : '', `${g.title}${g.number ? ' #' + g.number : ''}`,
      [g.model, g.backdrop, locked ? 'передача с ' + new Date(g.can_transfer_at * 1000).toLocaleDateString('ru-RU') : '', g.transfer_stars ? g.transfer_stars + ' ⭐' : ''].filter(Boolean).join(' · ')));
  }
  root.appendChild(gifts);

  const wd = relayerBox('Последние выводы');
  if (!r.withdrawals.length) wd.append('Пока пусто');
  for (const w of r.withdrawals) {
    wd.appendChild(relayerGiftLine(w.image, w.name, `${RELAYER_AUTO[w.auto] || w.auto} · ${fmt(w.value_ton, 2)} TON · @${w.user} · ${when(w.updated)}${w.auto_error ? ' · ' + w.auto_error : ''}`));
  }
  root.appendChild(wd);

  const log = relayerBox('Последние пополнения подарками');
  if (!r.events.length) log.append('Пока пусто');
  for (const ev of r.events) {
    log.appendChild(relayerGiftLine(ev.slug ? `/nft-img/${ev.slug.toLowerCase()}.png` : '', `${ev.title}${ev.number ? ' #' + ev.number : ''}`,
      `${RELAYER_EVENT[ev.status] || ev.status}${ev.price_ton ? ' · ' + fmt(ev.price_ton, 2) + ' TON' : ''} · ID ${ev.sender_id}`));
  }
  root.appendChild(log);
}
