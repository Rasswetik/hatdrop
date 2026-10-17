'use strict';
/* Админка: оружие, коллекции и награды за сбор */
const WRAR = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' };
const wImg = (id) => ({ axe: '/images/axe-icon.webp', staff: '/images/staff-icon.webp' })[id] || `/static/weapons/${id}-icon.png`;
let wState = null, wLevels = null, wLvRows = [];

function wEl(tag, props, ...kids) { const e = Object.assign(document.createElement(tag), props || {}); e.append(...kids); return e; }
function wNum(value, props) { return wEl('input', { type: 'number', value, step: 'any', min: 0, ...props }); }
function wBtn(text, cls, fn) { const b = wEl('button', { type: 'button', className: cls || '', textContent: text }); b.onclick = fn; return b; }
function wErr(e) { const t = (e && e.data && e.data.message) || 'Ошибка'; $('panelError').textContent = t; $('panelError').hidden = false; toast(t, true); }

async function admLoadWeapons() {
  const box = $('admWeapons');
  try {
    [wState, wLevels] = await Promise.all([api('/api/admin/weapons'), api('/api/admin/levels')]);
    wLvRows = Object.entries(wLevels.rewards).map(([n, r]) => ({ level: Number(n), kind: r.kind, weapon: r.weapon || '', amount: r.amount || 1 })).sort((a, b) => a.level - b.level);
    wRender();
  } catch (e) { admErr(e); }
}

function wRender() {
  const box = $('admWeapons'), st = wState, cfg = st.cfg;
  const byId = Object.fromEntries(st.weapons.map((w) => [w.id, w]));
  const taken = new Set(cfg.collections.flatMap((c) => c.weapons));
  box.textContent = '';

  const top = wEl('div', { className: 'adm-box' }, wEl('h3', { textContent: 'Обзор' }),
    wEl('p', { className: 'muted', textContent: `Видов оружия: ${st.weapons.length} · коллекций: ${cfg.collections.length} · уровней наград: ${cfg.levels.length} · выдано наград за сбор: ${st.claims}. Оружие входит максимум в одну коллекцию: оно показывается только в ней, остальное — по редкости (обычные, редкие, эпические, легендарные).` }));
  const save = wBtn('Сохранить все изменения', 'primary', async () => {
    save.disabled = true;
    try {
      const rewards = {};
      for (const r of wLvRows) {
        if (!(r.level >= 1)) throw { data: { message: 'Укажите номер уровня у каждой награды.' } };
        rewards[String(r.level)] = r.kind === 'weapon' ? { kind: 'weapon', weapon: r.weapon } : { kind: r.kind, amount: r.amount };
      }
      await api('/api/admin/levels', { rewards });
      await api('/api/admin/weapons/save', { cfg }); toast('Сохранено'); await admLoadWeapons(); } catch (e) { wErr(e); } finally { save.disabled = false; }
  });
  top.append(wEl('div', { className: 'adm-form' }, save));
  box.append(top);

  // награды за уровни игрока
  const lr = wEl('div', { className: 'adm-box' }, wEl('h3', { textContent: 'Награды за уровень игрока' }),
    wEl('p', { className: 'muted', textContent: 'При достижении уровня игрок автоматически получает награду: оружие, оформление, тип прокрута или монеты. Награда видна в окне «Награды за уровни». Уже достигшие уровня получат её при следующем входе.' }));
  const items = wLevels.items.filter((i) => !i.default);
  const kinds = [['weapon', 'Предмет (оружие, оформление, прокрут)'], ['ton', 'TON'], ['hatcoin', 'HatCoin']];
  wLvRows.forEach((r, i) => {
    const lvl = wNum(r.level, { min: 1, step: 1, onchange: () => { r.level = Number(lvl.value) || 0; } });
    const kind = wEl('select'); kinds.forEach(([v, t]) => kind.append(wEl('option', { value: v, textContent: t, selected: r.kind === v })));
    kind.onchange = () => { r.kind = kind.value; wRender(); };
    let value;
    if (r.kind === 'weapon') {
      value = wEl('select'); items.forEach((it) => value.append(wEl('option', { value: it.id, textContent: it.name, selected: it.id === r.weapon })));
      if (!r.weapon && items.length) r.weapon = items[0].id;
      value.onchange = () => { r.weapon = value.value; };
    } else value = wNum(r.amount, { onchange: () => { r.amount = Number(value.value) || 0; } });
    lr.append(wEl('div', { className: 'adm-form' }, wEl('label', { textContent: 'Уровень ' }, lvl), kind, value, wBtn('Удалить', 'danger', () => { wLvRows.splice(i, 1); wRender(); })));
  });
  lr.append(wBtn('+ Добавить награду за уровень', '', () => { wLvRows.push({ level: (wLvRows.length ? Math.max(...wLvRows.map((x) => x.level)) : 1) + 1, kind: 'weapon', weapon: items[0] ? items[0].id : '', amount: 1 }); wRender(); }));
  box.append(lr);

  // уровни
  const lv = wEl('div', { className: 'adm-box' }, wEl('h3', { textContent: 'Награды за общий сбор оружия' }),
    wEl('p', { className: 'muted', textContent: `Игрок получает награду, когда соберёт нужное число из ${st.weapons.length} видов оружия. Можно добавлять, менять и удалять уровни.` }));
  cfg.levels.forEach((l, i) => {
    const need = wNum(l.need, { min: 1, step: 1, onchange: () => { l.need = Number(need.value) || 1; } });
    const rw = wNum(l.reward, { onchange: () => { l.reward = Number(rw.value) || 0; } });
    lv.append(wEl('div', { className: 'adm-form' }, wEl('b', { textContent: `Уровень ${i + 1}` }), wEl('label', { textContent: 'Нужно собрать ' }, need), wEl('label', { textContent: 'Награда, TON ' }, rw),
      wBtn('Удалить', 'danger', () => { cfg.levels.splice(i, 1); wRender(); })));
  });
  lv.append(wBtn('+ Добавить уровень', '', () => { const last = cfg.levels[cfg.levels.length - 1]; cfg.levels.push({ id: '', need: last ? last.need + 2 : 5, reward: 0.1 }); wRender(); }));
  box.append(lv);

  // коллекции
  const colBox = wEl('div', { className: 'adm-box' }, wEl('h3', { textContent: 'Коллекции' }));
  cfg.collections.forEach((c, i) => {
    const card = wEl('div', { className: 'wcol' });
    const name = wEl('input', { value: c.name, maxLength: 40, placeholder: 'Название', oninput: () => { c.name = name.value; } });
    const need = wNum(c.need, { min: 1, step: 1, max: Math.max(1, c.weapons.length), onchange: () => { c.need = Number(need.value) || 1; } });
    const rw = wNum(c.reward, { onchange: () => { c.reward = Number(rw.value) || 0; } });
    card.append(wEl('div', { className: 'adm-form' }, name, wEl('label', { textContent: 'Нужно собрать ' }, need), wEl('label', { textContent: 'Награда, TON ' }, rw),
      wBtn('Удалить коллекцию', 'danger', () => { if (confirm(`Удалить коллекцию «${c.name}»? Оружие вернётся в разделы по редкости.`)) { cfg.collections.splice(i, 1); wRender(); } })));
    const chips = wEl('div', { className: 'wchips' });
    for (const id of c.weapons) {
      const w = byId[id]; if (!w) continue;
      chips.append(wEl('span', { className: 'wchip', 'data-rarity': w.rarity }, wEl('img', { src: wImg(id), alt: '' }), w.name, wBtn('×', '', () => { c.weapons = c.weapons.filter((x) => x !== id); wRender(); })));
    }
    if (!c.weapons.length) chips.append(wEl('span', { className: 'muted', textContent: 'В коллекции пока нет оружия' }));
    card.append(chips);
    const free = st.weapons.filter((w) => !taken.has(w.id));
    const sel = wEl('select'); sel.append(wEl('option', { value: '', textContent: '+ Добавить оружие…' }));
    for (const w of free) sel.append(wEl('option', { value: w.id, textContent: `${w.name} · ${WRAR[w.rarity]}` }));
    sel.onchange = () => { if (sel.value) { c.weapons.push(sel.value); wRender(); } };
    card.append(wEl('div', { className: 'adm-form' }, sel));
    colBox.append(card);
  });
  colBox.append(wBtn('+ Новая коллекция', 'primary', () => { cfg.collections.push({ id: '', name: 'Новая коллекция', need: 1, reward: 0, weapons: [] }); wRender(); }));
  box.append(colBox);

  // всё оружие
  const all = wEl('div', { className: 'adm-box' }, wEl('h3', { textContent: 'Всё оружие' }));
  const table = wEl('table', { className: 'adm-table' });
  table.append(wEl('thead', {}, wEl('tr', {}, ...['', 'Название', 'Редкость', 'Где показывается', 'Владельцев'].map((t) => wEl('th', { textContent: t })))));
  const tb = wEl('tbody');
  const order = { common: 0, rare: 1, epic: 2, legendary: 3 };
  for (const w of [...st.weapons].sort((a, b) => order[a.rarity] - order[b.rarity])) {
    const cur = cfg.collections.find((c) => c.weapons.includes(w.id));
    const sel = wEl('select'); sel.append(wEl('option', { value: '', textContent: `По редкости (${WRAR[w.rarity]})` }));
    cfg.collections.forEach((c, i) => sel.append(wEl('option', { value: String(i), textContent: `Коллекция: ${c.name}`, selected: cur === c })));
    sel.onchange = () => { cfg.collections.forEach((c) => { c.weapons = c.weapons.filter((x) => x !== w.id); }); if (sel.value !== '') cfg.collections[Number(sel.value)].weapons.push(w.id); wRender(); };
    tb.append(wEl('tr', {}, wEl('td', {}, wEl('img', { src: wImg(w.id), alt: '', className: 'wimg' })), wEl('td', { textContent: w.name + (w.event ? ' · ивент' : '') + (w.default ? ' · стартовое' : '') }),
      wEl('td', { textContent: WRAR[w.rarity] }), wEl('td', {}, sel), wEl('td', { textContent: `${w.owners} (${Math.round(100 * w.owners / st.players)}%)` })));
  }
  table.append(tb); all.append(wEl('div', { className: 'table-wrap' }, table));
  box.append(all);
}
