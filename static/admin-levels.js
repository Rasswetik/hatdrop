'use strict';
/* Админка: таблица уровней. Для каждого уровня: нужный оборот (TON) и награда. Награду игрок забирает нажатием на ячейку. */
let lvData = null, lvRows = [];

function lvEl(tag, props, ...kids) { const e = Object.assign(document.createElement(tag), props || {}); e.append(...kids); return e; }
function lvErr(e) { const t = (e && e.data && e.data.message) || 'Не удалось выполнить запрос'; $('panelError').textContent = t; $('panelError').hidden = false; toast(t, true); }

async function admLoadLevels() {
  try {
    lvData = await api('/api/admin/levels');
    lvRows = lvData.levels.map((r) => ({ level: r.level, need: r.need, def: r.default_need,
      kind: r.reward ? r.reward.kind : '', weapon: r.reward && r.reward.weapon || '', amount: r.reward && r.reward.amount || 1 }));
    lvRender();
  } catch (e) { lvErr(e); }
}

function lvRender() {
  const box = $('admLevels'), items = lvData.items.filter((i) => !i.default);
  box.textContent = '';
  const top = lvEl('div', { className: 'adm-box' }, lvEl('h3', { textContent: 'Уровни игроков' }),
    lvEl('p', { className: 'muted', textContent: 'Уровень растёт от оборота игрока (сумма всех ставок). У каждого уровня можно изменить нужный оборот и добавить награду: TON, HatCoin или предмет (оружие, прокрут, оформление). Награда не выдаётся автоматически: когда игрок достигает уровня, ячейка в окне «Награды за уровни» начинает светиться, и он забирает награду нажатием. Нужный оборот должен расти от уровня к уровню.' }));
  const count = lvEl('input', { type: 'number', min: 1, max: lvData.max_count, step: 1, value: lvRows.length });
  const apply = lvEl('button', { type: 'button', textContent: 'Применить число уровней' });
  apply.onclick = () => {
    const n = Math.max(1, Math.min(lvData.max_count, Number(count.value) || lvRows.length));
    while (lvRows.length < n) { const l = lvRows.length + 1; lvRows.push({ level: l, need: (l - 1) ** 2 * 5, def: (l - 1) ** 2 * 5, kind: '', weapon: '', amount: 1 }); }
    lvRows.length = n; lvRender();
  };
  const reset = lvEl('button', { type: 'button', className: 'danger', textContent: 'Вернуть обороты по формуле' });
  reset.onclick = () => { if (confirm('Вернуть нужный оборот у всех уровней к стандартному (5·(N−1)²)? Награды останутся.')) { lvRows.forEach((r) => { r.need = r.def; }); lvRender(); } };
  const save = lvEl('button', { type: 'button', className: 'primary', textContent: 'Сохранить все уровни' });
  save.onclick = async () => {
    save.disabled = true;
    try {
      const levels = lvRows.map((r) => ({ level: r.level, need: r.need,
        reward: r.kind ? (r.kind === 'weapon' ? { kind: 'weapon', weapon: r.weapon } : { kind: r.kind, amount: r.amount }) : null }));
      lvData = await api('/api/admin/levels', { count: lvRows.length, levels });
      toast('Уровни сохранены'); await admLoadLevels();
    } catch (e) { lvErr(e); } finally { save.disabled = false; }
  };
  top.append(lvEl('div', { className: 'adm-form' }, lvEl('label', { textContent: 'Всего уровней ' }, count), apply, reset), lvEl('div', { className: 'adm-form' }, save));
  if (lvData.hidden_rewards) top.append(lvEl('p', { className: 'muted', textContent: `Ещё ${lvData.hidden_rewards} наград привязаны к уровням выше текущей границы — они сохранены, но не видны. Увеличьте число уровней, чтобы увидеть их.` }));
  box.append(top);

  const list = lvEl('div', { className: 'adm-box' });
  const kinds = [['', 'Без награды'], ['ton', 'TON'], ['hatcoin', 'HatCoin'], ['weapon', 'Предмет']];
  for (const r of lvRows) {
    const need = lvEl('input', { type: 'number', min: 0, step: 'any', value: +Number(r.need).toFixed(4), disabled: r.level === 1 });
    need.onchange = () => { r.need = Number(need.value) || 0; };
    const kind = lvEl('select'); kinds.forEach(([v, t]) => kind.append(lvEl('option', { value: v, textContent: t, selected: r.kind === v })));
    kind.onchange = () => { r.kind = kind.value; if (r.kind === 'weapon' && !r.weapon && items.length) r.weapon = items[0].id; lvRender(); };
    let value = null;
    if (r.kind === 'weapon') {
      value = lvEl('select'); items.forEach((it) => value.append(lvEl('option', { value: it.id, textContent: it.name, selected: it.id === r.weapon })));
      value.onchange = () => { r.weapon = value.value; };
    } else if (r.kind) {
      value = lvEl('input', { type: 'number', min: 0, step: 'any', value: r.amount });
      value.onchange = () => { r.amount = Number(value.value) || 0; };
    }
    list.append(lvEl('div', { className: 'adm-form lvl-admin-row' }, lvEl('b', { textContent: 'Ур. ' + r.level }),
      lvEl('label', { textContent: 'Оборот, TON ' }, need), kind, ...(value ? [value] : [])));
  }
  box.append(list);
}
