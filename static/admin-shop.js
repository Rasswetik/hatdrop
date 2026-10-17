'use strict';
function shEl(tag, props, ...kids) {
  const el = Object.assign(document.createElement(tag), props || {});
  el.append(...kids);
  return el;
}
function shErr(e) {
  const text = (e && e.data && e.data.message) || (e && e.code) || 'Ошибка';
  $('panelError').textContent = text; $('panelError').hidden = false; toast(text, true);
}
let shCatalog = null;
const SH_KINDS = [['ton', 'TON на баланс'], ['hatcoin', 'HatCoin'], ['weapon', 'Снаряжение'], ['gift', 'Подарок из каталога'], ['nft', 'NFT-подарок Telegram (ссылка)']];

// Форма ордера. personalKey — ключ игрока, если ордер личный (из карточки пользователя).
function shopForm(offer, weapons, onSaved, personalKey) {
  const f = shEl('div', { className: 'stack-form' });
  const title = shEl('input', { placeholder: 'Название (по умолчанию — название награды)', maxLength: 60, value: offer ? offer.title : '' });
  const desc = shEl('input', { placeholder: 'Описание (необязательно)', maxLength: 200, value: offer ? offer.description || '' : '' });
  const currency = shEl('select');
  for (const [v, l] of [['ton', 'Цена в TON'], ['hatcoin', 'Цена в HatCoin']]) currency.append(shEl('option', { value: v, textContent: l }));
  currency.value = offer ? offer.currency : 'ton';
  const price = shEl('input', { type: 'number', step: 'any', min: '0', placeholder: 'Цена', value: offer ? offer.price : '1' });
  const lt = shEl('input', { type: 'number', min: '0', step: '1', placeholder: 'Лимит на всех (0 — без лимита)', value: offer ? offer.limit_total : '0' });
  const lu = shEl('input', { type: 'number', min: '0', step: '1', placeholder: 'Лимит на игрока (0 — без лимита)', value: offer ? offer.limit_user : '0' });
  const kind = shEl('select');
  for (const [v, l] of SH_KINDS) kind.append(shEl('option', { value: v, textContent: 'Награда: ' + l }));
  const r = offer ? offer.reward : { kind: 'ton', amount: 1 };
  kind.value = r.kind;
  const state = { amount: r.amount || 1, weapon: r.weapon || '', gift: r.gift || '', model: r.model || '', url: r.url || '' };
  const body = shEl('div', { className: 'se-body' });
  const preview = shEl('div', { className: 'muted' });
  if (offer && (r.kind === 'gift' || r.kind === 'nft')) preview.textContent = `${r.name} · ${r.value} TON`;
  const draw = () => {
    body.replaceChildren();
    if (kind.value === 'ton' || kind.value === 'hatcoin') {
      const a = shEl('input', { type: 'number', step: 'any', min: '0', value: state.amount, placeholder: 'Количество' });
      a.oninput = () => { state.amount = a.value; };
      body.append(a);
    } else if (kind.value === 'weapon') {
      const w = shEl('select');
      w.append(shEl('option', { value: '', textContent: 'Выберите снаряжение…' }));
      for (const x of weapons) w.append(shEl('option', { value: x.id, textContent: x.name + (x.event ? ' (Хэллоуин)' : '') }));
      w.value = state.weapon; w.onchange = () => { state.weapon = w.value; };
      body.append(w);
    } else if (kind.value === 'gift') {
      const sel = shEl('select'); sel.append(shEl('option', { value: '', textContent: 'Выберите подарок…' }));
      for (const g of (shCatalog || [])) sel.append(shEl('option', { value: g.slug, textContent: `${g.name} · ${g.price_ton} TON` }));
      sel.value = state.gift;
      const model = shEl('select');
      const fill = async () => {
        model.replaceChildren(shEl('option', { value: '', textContent: 'Любая модель (флор)' }));
        if (!state.gift) return;
        try { const m = await api('/api/gifts/models', { slug: state.gift }); for (const x of m.models || []) model.append(shEl('option', { value: x.model, textContent: `${x.model} · ${x.price_ton} TON` })); model.value = state.model; } catch (e) {}
      };
      sel.onchange = () => { state.gift = sel.value; state.model = ''; fill(); };
      model.onchange = () => { state.model = model.value; };
      body.append(sel, model); fill();
    } else {
      const url = shEl('input', { className: 'tc-input', placeholder: 'https://t.me/nft/PlushPepe-1234', value: state.url, autocomplete: 'off' });
      url.oninput = () => { state.url = url.value.trim(); };
      body.append(url);
    }
  };
  kind.onchange = () => { preview.textContent = ''; draw(); };
  draw();
  const active = shEl('input', { type: 'checkbox', checked: offer ? offer.active !== false : true });
  const save = shEl('button', { type: 'button', className: 'primary', textContent: offer ? 'Сохранить ордер' : 'Создать ордер' });
  save.onclick = async () => {
    save.disabled = true;
    try {
      const reward = { kind: kind.value, amount: state.amount, weapon: state.weapon, gift: state.gift, model: state.model, url: state.url };
      await api('/api/admin/shop/save', { action: offer ? 'update' : 'create', id: offer && offer.id, key: personalKey, title: title.value, description: desc.value,
        currency: currency.value, price: price.value, limit_total: lt.value, limit_user: lu.value, active: active.checked, reward });
      toast('Ордер сохранён'); onSaved();
    } catch (e) { shErr(e); } finally { save.disabled = false; }
  };
  f.append(title, desc, currency, price, lt, lu, kind, body, preview, shEl('label', { className: 'quest-launch' }, active, ' Ордер активен'), save);
  return f;
}

function shopRow(o, reload, edit) {
  const left = o.limit_total ? `${Math.max(0, o.limit_total - o.sold)} из ${o.limit_total}` : 'без лимита';
  const row = shEl('div', { className: 'quest-admin-row' },
    shEl('b', { textContent: `${o.title} · ${o.active === false ? 'выключен' : 'активен'}` }),
    shEl('small', { textContent: `${o.price} ${o.currency === 'hatcoin' ? 'HatCoin' : 'TON'} · награда: ${o.reward_view.name} · продано ${o.sold} · осталось ${left}${o.limit_user ? ' · лимит на игрока ' + o.limit_user : ''}` }));
  const buttons = shEl('div', { className: 'adm-form' });
  const e = shEl('button', { type: 'button', textContent: 'Изменить' }); e.onclick = () => edit(o);
  const d = shEl('button', { type: 'button', className: 'danger', textContent: 'Удалить' });
  d.onclick = async () => { if (!confirm('Удалить ордер «' + o.title + '»?')) return; try { await api('/api/admin/shop/save', { action: 'delete', id: o.id }); reload(); } catch (x) { shErr(x); } };
  buttons.append(e, d); row.append(buttons);
  return row;
}

async function admLoadShop() {
  const root = $('admShop');
  try {
    const [data, cat] = await Promise.all([api('/api/admin/shop'), shCatalog ? null : api('/api/gifts/catalog')]);
    if (cat) shCatalog = (cat.items || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    root.replaceChildren();
    const formBox = shEl('div', { className: 'adm-box' }, shEl('h3', { textContent: 'Новый ордер' }));
    const holder = shEl('div');
    const showForm = (offer) => { holder.replaceChildren(shopForm(offer, data.weapons, admLoadShop)); formBox.scrollIntoView({ block: 'start' }); };
    holder.append(shopForm(null, data.weapons, admLoadShop));
    formBox.append(holder);
    const list = shEl('div', { className: 'adm-box' }, shEl('h3', { textContent: 'Ордера лавки' }));
    if (!data.rows.length) list.append(shEl('p', { className: 'muted', textContent: 'Ордеров пока нет.' }));
    for (const o of data.rows) list.append(shopRow(o, admLoadShop, showForm));
    root.append(formBox, list);
  } catch (e) { shErr(e); }
}
