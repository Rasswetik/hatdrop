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

let relayerPoll = null;
let relayerAuto = null;
const RELAYER_REFRESH_CHOICES = [['10', '10 с'], ['20', '20 с'], ['30', '30 с'], ['60', '1 мин'], ['0', 'выкл']];
function relayerRefreshSeconds() {
  try { const v = localStorage.getItem('relayerRefresh'); if (v !== null && RELAYER_REFRESH_CHOICES.some((c) => c[0] === v)) return Number(v); } catch (e) { /* storage недоступно */ }
  return 20;
}
function relayerScheduleRefresh() {
  clearInterval(relayerAuto);
  const secs = relayerRefreshSeconds();
  if (!secs) return;
  relayerAuto = setInterval(() => {
    if (admin.tab !== 'relayer' || document.hidden) return;
    const root = $('admRelayer');
    // не затираем то, что админ сейчас вводит
    if (root.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.id !== 'relayerRefreshSel') return;
    admLoadRelayer(null, null, true);
  }, secs * 1000);
}
function relayerLoadQrLib() {
  if (window.QRCode) return Promise.resolve();
  if (!window.__qrLib) window.__qrLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('qr lib'));
    document.head.append(s);
  });
  return window.__qrLib;
}

async function admLoadRelayer(action, body, silent) {
  const root = $('admRelayer');
  try {
    clearTimeout(relayerPoll);
    const res = await api(action || '/api/admin/relayer/status', body || {});
    admRenderRelayer(root, res);
    if (['qr_starting', 'qr_wait'].includes(res.state && res.state.status) && admin.tab === 'relayer') relayerPoll = setTimeout(() => admLoadRelayer(), 2500);
    if (res.scan) toast(res.scan.baseline ? `Запомнено подарков: ${res.scan.saved_gifts_count}` : `Подарков: ${res.scan.saved_gifts_count} · зачислено: ${res.scan.delivered}`);
  } catch (e) { if (!silent) relayerErr(e); }
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

  const sx = r.stats;
  if (sx) {
    const box = relayerBox('Статистика пополнений NFT');
    const line = (w) => `${w.count} шт. · ${fmt(w.ton, 2)} TON`;
    relayerRows(box, [
      ['Сегодня (МСК)', line(sx.today)],
      ['7 дней', line(sx.week)],
      ['30 дней', line(sx.month)],
      ['Всего', line(sx.total)],
      ['Отправителей', sx.senders],
      ['Подарки на аккаунте (флор)', fmt(sx.gifts_value_ton, 2) + ' TON'],
      ['Stars на аккаунте', st.stars_balance ?? '—'],
    ]);
    if (sx.top && sx.top.length) {
      box.append(Object.assign(document.createElement('p'), { className: 'tc-info', textContent: 'Топ отправителей: ' + sx.top.map((t) => `${t.name || 'ID ' + t.id} — ${fmt(t.ton, 2)} TON (${t.count})`).join(' · ') }));
    }
    root.appendChild(box);
  }

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
    login.append(relayerButton('Войти по QR-коду', () => admLoadRelayer('/api/admin/relayer/login/qr')));
    if (['qr_starting', 'qr_wait'].includes(st.status)) {
      const qrBox = document.createElement('div');
      qrBox.className = 'relayer-qr';
      const qrNote = document.createElement('p');
      qrNote.className = 'tc-info';
      qrNote.textContent = st.status === 'qr_starting' ? 'Готовим QR…' : 'Telegram на телефоне → Настройки → Устройства → Подключить устройство → отсканируйте код. QR обновляется сам.';
      qrBox.append(qrNote);
      const url = r.auth && r.auth.qr_url;
      if (url) {
        const canvas = document.createElement('div');
        canvas.className = 'relayer-qr-canvas';
        qrBox.append(canvas);
        relayerLoadQrLib().then(() => new QRCode(canvas, { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }))
          .catch(() => { canvas.textContent = url; canvas.style.wordBreak = 'break-all'; });
      }
      login.append(qrBox);
    }
    if (st.status === 'qr_expired') {
      const exp = document.createElement('p');
      exp.className = 'tc-info';
      exp.textContent = 'QR-код истёк. Нажмите «Войти по QR-коду» ещё раз.';
      login.append(exp);
    }
    const sessBox = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'Код не приходит? Вход по готовой сессии';
    const sessNote = document.createElement('p');
    sessNote.className = 'tc-info';
    sessNote.textContent = 'Telegram иногда не присылает код при входе с IP хостинга. Выполните на своём компьютере tools/relayer_login.py (инструкция внутри файла), вставьте полученную строку сюда.';
    const [ls, sessInput] = relayerField('Строка сессии (StringSession)', { type: 'password', autocomplete: 'off' });
    sessBox.append(sum, sessNote, ls, relayerButton('Войти по сессии', () => admLoadRelayer('/api/admin/relayer/login/session', { session: sessInput.value })));
    login.append(sessBox);
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

  const foot = document.createElement('div');
  foot.className = 'adm-form';
  const sel = document.createElement('select');
  sel.id = 'relayerRefreshSel';
  for (const [v, label] of RELAYER_REFRESH_CHOICES) sel.append(Object.assign(document.createElement('option'), { value: v, textContent: label }));
  sel.value = String(relayerRefreshSeconds());
  sel.onchange = () => { try { localStorage.setItem('relayerRefresh', sel.value); } catch (e) { /* ignore */ } relayerScheduleRefresh(); };
  const lbl = document.createElement('span');
  lbl.className = 'muted';
  lbl.textContent = 'Автообновление: ';
  const stamp = document.createElement('span');
  stamp.className = 'muted';
  stamp.textContent = ' · обновлено ' + new Date().toLocaleTimeString('ru-RU');
  foot.append(lbl, sel, stamp);
  root.appendChild(foot);
  relayerScheduleRefresh();
}
