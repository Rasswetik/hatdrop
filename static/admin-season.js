'use strict';
const SEASON_PLACES = 10;

function seErr(e) {
  const text = (e && e.data && e.data.message) || ({ season_active: 'Сезон уже идёт', no_season: 'Нет активного сезона', bad_request: 'Проверьте поля' })[e && e.code] || 'Ошибка';
  $('panelError').textContent = text; $('panelError').hidden = false; toast(text, true);
}

function seEl(tag, props, ...kids) {
  const el = Object.assign(document.createElement(tag), props || {});
  el.append(...kids);
  return el;
}

function seBox(title) { return seEl('div', { className: 'adm-box' }, seEl('h3', { textContent: title })); }

const seWhen = (t) => new Date(t * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

let seCatalog = null;

// Редактор награды одного места: нет / подарок из каталога / NFT по ссылке.
function sePrizeEditor(place, prize) {
  const row = seEl('div', { className: 'se-place' });
  row.append(seEl('b', { className: 'se-num', textContent: place + ' место' }));
  const type = seEl('select');
  for (const [v, l] of [['', 'Без награды'], ['gift', 'Подарок из каталога'], ['nft', 'NFT-подарок Telegram (ссылка)']]) type.append(seEl('option', { value: v, textContent: l }));
  type.value = prize ? prize.kind : '';
  const body = seEl('div', { className: 'se-body' });
  const state = { gift: prize && prize.kind === 'gift' ? prize.gift : '', model: prize && prize.kind === 'gift' ? prize.model : '', url: prize && prize.kind === 'nft' ? prize.url : '' };
  const preview = seEl('div', { className: 'se-preview muted' });
  if (prize) preview.textContent = `${prize.name} · ${prize.value} TON`;

  const draw = () => {
    body.replaceChildren();
    if (type.value === 'gift') {
      const sel = seEl('select');
      sel.append(seEl('option', { value: '', textContent: 'Выберите подарок…' }));
      for (const g of (seCatalog || [])) sel.append(seEl('option', { value: g.slug, textContent: `${g.name} · ${g.price_ton} TON` }));
      sel.value = state.gift;
      const model = seEl('select');
      const fillModels = async () => {
        model.replaceChildren(seEl('option', { value: '', textContent: 'Любая модель (флор)' }));
        if (!state.gift) return;
        try {
          const r = await api('/api/gifts/models', { slug: state.gift });
          for (const m of r.models || []) model.append(seEl('option', { value: m.model, textContent: `${m.model} · ${m.price_ton} TON` }));
          model.value = state.model;
        } catch (e) { /* список моделей необязателен */ }
      };
      sel.onchange = () => { state.gift = sel.value; state.model = ''; fillModels(); };
      model.onchange = () => { state.model = model.value; };
      body.append(sel, model);
      fillModels();
    } else if (type.value === 'nft') {
      const url = seEl('input', { className: 'tc-input', placeholder: 'https://t.me/nft/PlushPepe-1234', value: state.url, autocomplete: 'off' });
      url.oninput = () => { state.url = url.value.trim(); };
      const check = seEl('button', { type: 'button', textContent: 'Проверить цену' });
      check.onclick = async () => {
        check.disabled = true;
        try {
          const r = (await api('/api/admin/season/resolve', { kind: 'nft', url: state.url })).prize;
          preview.textContent = `${r.name}${r.model ? ' · ' + r.model : ''} · Portals ${r.portal_ton} TON → в инвентарь ${r.value} TON (−15%)`;
        } catch (e) { seErr(e); } finally { check.disabled = false; }
      };
      body.append(url, check);
    }
  };
  type.onchange = () => { preview.textContent = ''; draw(); };
  draw();
  row.append(type, body, preview);
  row.spec = () => {
    if (type.value === 'gift') return state.gift ? { kind: 'gift', gift: state.gift, model: state.model } : null;
    if (type.value === 'nft') return state.url ? { kind: 'nft', url: state.url } : null;
    return null;
  };
  return row;
}

async function admLoadSeason() {
  const root = $('admSeason');
  try {
    const [data, cat] = await Promise.all([api('/api/admin/season'), seCatalog ? null : api('/api/gifts/catalog')]);
    if (cat) seCatalog = (cat.items || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    root.textContent = '';
    const cur = data.current;
    const running = cur && !cur.finished;

    const info = seBox('Сезон');
    if (!cur) info.append(seEl('p', { className: 'muted', textContent: 'Сезон не запущен — в рейтинге общий оборот за всё время. Запустите сезон: он идёт заданное время, затем места из топа получают награды.' }));
    else {
      const rows = [['Название', cur.name], ['Статус', running ? 'Идёт' : 'Завершён'], ['Начало (МСК)', seWhen(cur.start)], ['Конец (МСК)', seWhen(cur.end)], ['Игроков в рейтинге', cur.players]];
      const dl = seEl('dl', { className: 'status-list' });
      for (const [k, v] of rows) dl.append(seEl('div', {}, seEl('dt', { textContent: k }), seEl('dd', { textContent: v })));
      info.append(dl);
      if (cur.top && cur.top.length) info.append(seEl('p', { className: 'tc-info', textContent: 'Топ: ' + cur.top.map((t) => `${t.rank}. ${t.name} — ${t.total_ton} TON`).join(' · ') }));
      if (cur.winners && cur.winners.length) info.append(seEl('p', { className: 'tc-info', textContent: 'Награды выданы: ' + cur.winners.map((w) => `${w.place} место → ${w.name} (${w.prize})`).join(' · ') }));
    }
    root.append(info);

    const form = seBox(running ? 'Награды сезона' : 'Новый сезон');
    const name = seEl('input', { className: 'tc-input', placeholder: 'Сезон 1', value: running ? cur.name : '', maxLength: 60 });
    form.append(seEl('label', { className: 'tc-label', textContent: 'Название' }, name));
    let days, hours;
    if (!running) {
      days = seEl('input', { className: 'tc-input', type: 'number', min: '0', step: '1', value: '3' });
      hours = seEl('input', { className: 'tc-input', type: 'number', min: '0', step: '1', value: '0' });
      form.append(seEl('div', { className: 'adm-form' }, seEl('label', { className: 'tc-label', textContent: 'Дней' }, days), seEl('label', { className: 'tc-label', textContent: 'Часов' }, hours)));
    }
    const places = [];
    const box = seEl('div', { className: 'se-places' });
    for (let p = 1; p <= SEASON_PLACES; p += 1) {
      const row = sePrizeEditor(p, running ? (cur.prizes || {})[String(p)] : null);
      places.push(row);
      box.append(row);
    }
    form.append(seEl('p', { className: 'tc-info', textContent: 'Для каждого места — подарок из каталога или NFT по ссылке t.me/nft/…: цена берётся с Portals по модели подарка, в инвентарь победителя он попадает за вычетом 15%. Победители получают награду автоматически в момент окончания сезона.' }), box);
    const collect = () => { const out = {}; places.forEach((r, i) => { const s = r.spec(); if (s) out[String(i + 1)] = s; }); return out; };
    const actions = seEl('div', { className: 'tc-actions' });
    if (running) {
      const save = seEl('button', { type: 'button', className: 'primary', textContent: 'Сохранить награды' });
      save.onclick = async () => { save.disabled = true; try { await api('/api/admin/season/prizes', { name: name.value, prizes: collect() }); toast('Сохранено'); admLoadSeason(); } catch (e) { seErr(e); } finally { save.disabled = false; } };
      const finish = seEl('button', { type: 'button', textContent: 'Завершить сейчас и выдать награды' });
      finish.onclick = async () => { if (!confirm('Завершить сезон и выдать награды победителям?')) return; try { await api('/api/admin/season/finish', {}); toast('Сезон завершён'); admLoadSeason(); } catch (e) { seErr(e); } };
      const cancel = seEl('button', { type: 'button', className: 'danger', textContent: 'Завершить без наград' });
      cancel.onclick = async () => { if (!confirm('Завершить сезон БЕЗ выдачи наград?')) return; try { await api('/api/admin/season/finish', { award: false }); admLoadSeason(); } catch (e) { seErr(e); } };
      actions.append(save, finish, cancel);
    } else {
      const start = seEl('button', { type: 'button', className: 'primary', textContent: 'Начать сезон' });
      start.onclick = async () => {
        start.disabled = true;
        try { await api('/api/admin/season/start', { name: name.value, days: Number(days.value) || 0, hours: Number(hours.value) || 0, prizes: collect() }); toast('Сезон запущен'); admLoadSeason(); }
        catch (e) { seErr(e); } finally { start.disabled = false; }
      };
      actions.append(start);
      if (cur) {
        const clear = seEl('button', { type: 'button', textContent: 'Вернуться к общему рейтингу' });
        clear.onclick = async () => { try { await api('/api/admin/season/clear', {}); admLoadSeason(); } catch (e) { seErr(e); } };
        actions.append(clear);
      }
    }
    form.append(actions);
    root.append(form);

    if (data.history && data.history.length) {
      const hist = seBox('Прошлые сезоны');
      for (const h of data.history) hist.append(seEl('p', { className: 'tc-info', textContent: `${h.name} · ${seWhen(h.start)} — ${seWhen(h.end)} · ` + (h.winners.length ? h.winners.map((w) => `${w.place}. ${w.name} (${w.prize})`).join(', ') : 'без победителей') }));
      root.append(hist);
    }
  } catch (e) { admErr(e); }
}
