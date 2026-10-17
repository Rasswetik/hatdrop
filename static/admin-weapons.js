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
    wState = await api('/api/admin/weapons');
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
      await api('/api/admin/weapons/save', { cfg }); toast('Сохранено'); await admLoadWeapons(); } catch (e) { wErr(e); } finally { save.disabled = false; }
  });
  top.append(wEl('div', { className: 'adm-form' }, save));
  box.append(top);

  // видимость в кастомизации игрока: скрытое оружие и прокруты не видны, пока админ их не откроет
  const visBox = wEl('div', { className: 'adm-box' }, wEl('h3', { textContent: 'Видимость для игроков' }),
    wEl('p', { className: 'muted', textContent: 'Галочка — предмет показывается в кастомизации. Скрытые предметы можно по-прежнему выдавать игрокам, но они не видны, пока вы их не откроете. Изменения применяются сразу и сохраняются в базе.' }));
  const visRow = (it) => {
    const cb = wEl('input', { type: 'checkbox', checked: !it.hidden });
    cb.onchange = async () => {
      cb.disabled = true;
      try { await api('/api/admin/weapons/visibility', { id: it.id, hidden: !cb.checked }); it.hidden = !cb.checked; toast(cb.checked ? 'Показывается игрокам' : 'Скрыто'); }
      catch (e) { cb.checked = !cb.checked; wErr(e); } finally { cb.disabled = false; }
    };
    return wEl('label', { className: 'wvis' }, cb, wEl('img', { src: it.id.startsWith('spin_') ? `/static/weapons/${it.id}-icon.png` : wImg(it.id), alt: '' }),
      wEl('span', { textContent: `${it.name} · ${WRAR[it.rarity] || it.rarity}` }));
  };
  visBox.append(wEl('h4', { textContent: 'Оружие' }), ...st.weapons.map(visRow), wEl('h4', { textContent: 'Прокруты' }), ...(st.spins || []).map(visRow));
  box.append(visBox);

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
