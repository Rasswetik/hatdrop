'use strict';
function payErr(e) {
  const map = { crypto_unavailable: 'CryptoBot не отвечает', crypto_rejected: 'CryptoBot отклонил токен', crypto_token_missing: 'Укажите токен Crypto Pay', bad_request: 'Неверное значение' };
  let text = map[e.code];
  if (text && e.data && e.data.reason) text += ' (' + e.data.reason + ')';
  if (text) { $('panelError').textContent = text; $('panelError').hidden = false; toast(text, true); } else admErr(e);
}

function payBox(title) {
  const box = document.createElement('div');
  box.className = 'adm-box';
  const h = document.createElement('h3');
  h.textContent = title;
  box.appendChild(h);
  return box;
}

function payField(label, attrs) {
  const wrap = document.createElement('label');
  wrap.className = 'tc-label';
  wrap.textContent = label;
  const input = Object.assign(document.createElement('input'), { className: 'tc-input', autocomplete: 'off' }, attrs);
  wrap.appendChild(input);
  return [wrap, input];
}

function payCheck(label, checked) {
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  const wrap = document.createElement('label');
  wrap.className = 'quest-launch';
  wrap.append(input, document.createTextNode(' ' + label));
  return [wrap, input];
}

async function admLoadPayments() {
  const root = $('admPayments');
  try {
    const [stars, crypto] = await Promise.all([api('/api/admin/stars'), api('/api/admin/cryptobot')]);
    root.textContent = '';

    const sBox = payBox('Telegram Stars');
    const [l, per] = payField('Курс: Stars за 1 TON', { type: 'number', min: '1', max: '100000', step: '1', value: stars.stars.per_ton });
    const [sOnWrap, sOn] = payCheck('Включено', stars.stars.enabled);
    const sSave = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'Сохранить' });
    sSave.onclick = async () => { try { await api('/api/admin/stars/save', { per_ton: parseInt(per.value, 10), enabled: sOn.checked }); toast('Сохранено'); } catch (e) { payErr(e); } };
    sBox.append(l, sOnWrap, sSave);
    if (!stars.bot_ready) sBox.append(Object.assign(document.createElement('p'), { className: 'adm-status', textContent: 'Нужен BOT_TOKEN на сервере' }));
    root.appendChild(sBox);

    const cBox = payBox('CryptoBot');
    const [tWrap, token] = payField('Crypto Pay API token', { type: 'password', placeholder: crypto.configured ? (crypto.env_token ? 'задан в окружении' : '•••• (задан)') : '' });
    const [onWrap, on] = payCheck('Включено', crypto.enabled);
    const [testWrap, test] = payCheck('Тестовая сеть', crypto.testnet);
    const save = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'Сохранить и проверить' });
    save.onclick = async () => {
      save.disabled = true;
      try { await api('/api/admin/cryptobot/save', { token: token.value, enabled: on.checked, testnet: test.checked }); toast('CryptoBot подключён'); admLoadPayments(); }
      catch (e) { payErr(e); } finally { save.disabled = false; }
    };
    cBox.append(tWrap, onWrap, testWrap, save);
    if (crypto.configured && crypto.app_name) cBox.append(Object.assign(document.createElement('p'), { className: 'adm-status', textContent: 'Приложение: ' + crypto.app_name }));
    if (crypto.webhook_url) {
      const [wWrap, w] = payField('Webhook URL (вставьте в Crypto Pay → Webhooks)', { type: 'text', readOnly: true, value: crypto.webhook_url });
      w.addEventListener('focus', () => w.select());
      cBox.append(wWrap);
    }
    root.appendChild(cBox);
  } catch (e) { admErr(e); }
}
