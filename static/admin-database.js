'use strict';
/* Админка: выбор базы данных (Postgres или SQLite), проверка, переключение и копия в SQLite. */
function dbEl(tag, props, ...kids) { const e = Object.assign(document.createElement(tag), props || {}); e.append(...kids); return e; }
function dbErr(e) { const t = (e && e.data && e.data.message) || 'Не удалось выполнить запрос'; $('panelError').textContent = t; $('panelError').hidden = false; toast(t, true); }
function dbWhen(ts) { return ts ? new Date(ts * 1000).toLocaleString('ru-RU') : 'ещё не было'; }

async function admLoadDatabase(res) {
  try {
    const d = res || await api('/api/admin/database', { action: 'status' });
    $('panelError').hidden = true;
    dbRender(d);
  } catch (e) { dbErr(e); }
}

function dbRender(d) {
  const box = $('admDatabase');
  box.textContent = '';
  const cur = dbEl('div', { className: 'adm-box' }, dbEl('h3', { textContent: 'Текущая база данных' }));
  cur.append(dbEl('p', { textContent: d.kind === 'postgres' ? 'Postgres: ' + d.url : 'SQLite: ' + d.sqlite_path }));
  if (d.fallback) cur.append(dbEl('p', { className: 'danger', textContent: 'Postgres не ответил при запуске, сайт работает на локальной SQLite-копии. Ссылка: ' + d.wanted_url + '. Ошибка: ' + d.error + '. Проверьте ссылку и подключитесь ниже.' }));
  if (!d.persistent_disk && d.kind === 'sqlite') cur.append(dbEl('p', { className: 'muted', textContent: 'SQLite лежит на временном диске хостинга: при деплое она сотрётся. Для постоянной работы используйте Postgres.' }));
  box.append(cur);

  const form = dbEl('div', { className: 'adm-box' }, dbEl('h3', { textContent: 'Сменить базу' }));
  const type = dbEl('select');
  [['postgres', 'Postgres'], ['sqlite', 'SQLite (локальная)']].forEach(([v, t]) => type.append(dbEl('option', { value: v, textContent: t, selected: v === d.kind })));
  const url = dbEl('input', { type: 'text', placeholder: 'postgresql://user:password@host:5432/dbname', autocomplete: 'off', spellcheck: false });
  url.style.minWidth = '320px';
  const mode = dbEl('select');
  [['copy_current', 'Перенести текущие данные в выбранную базу'], ['use_target', 'Взять данные из выбранной базы (текущие не переносятся)']].forEach(([v, t]) => mode.append(dbEl('option', { value: v, textContent: t })));
  const status = dbEl('p', { className: 'muted' });
  const sync = () => { url.hidden = type.value !== 'postgres'; };
  type.onchange = sync; sync();
  const payload = (action) => ({ action, backend: type.value, url: url.value.trim(), mode: mode.value });
  const test = dbEl('button', { type: 'button', textContent: 'Проверить подключение' });
  test.onclick = async () => {
    test.disabled = true; status.textContent = 'Проверяю…';
    try { const r = await api('/api/admin/database', payload('test')); status.textContent = r.test.has_data ? `Подключение работает. В базе есть данные, игроков: ${r.test.users}.` : 'Подключение работает. База пустая.'; }
    catch (e) { status.textContent = ''; dbErr(e); } finally { test.disabled = false; }
  };
  const save = dbEl('button', { type: 'button', className: 'primary', textContent: 'Сохранить и переключить' });
  save.onclick = async () => {
    const t = type.value === 'postgres' ? 'Postgres' : 'SQLite';
    const how = mode.value === 'copy_current' ? 'Текущие данные будут записаны в выбранную базу и перезапишут её содержимое.' : 'Сайт начнёт работать с данными из выбранной базы.';
    if (!confirm(`Переключить сайт на ${t}? ${how}`)) return;
    save.disabled = true; status.textContent = 'Переключаю…';
    try { const r = await api('/api/admin/database', payload('switch')); toast('База переключена и сохранена'); await admLoadDatabase(r); }
    catch (e) { status.textContent = ''; dbErr(e); } finally { save.disabled = false; }
  };
  form.append(dbEl('div', { className: 'adm-form' }, dbEl('label', { textContent: 'Тип ' }, type), url), dbEl('div', { className: 'adm-form' }, dbEl('label', { textContent: 'Данные ' }, mode)), dbEl('div', { className: 'adm-form' }, test, save), status,
    dbEl('p', { className: 'muted', textContent: 'Выбор сохраняется в файле настроек рядом с локальной базой и действует при каждом запуске, он главнее переменной DATABASE_URL.' + (d.config_saved ? '' : ' Сейчас файла нет, используется переменная окружения или SQLite.') }));
  box.append(form);

  const m = d.mirror, mir = dbEl('div', { className: 'adm-box' }, dbEl('h3', { textContent: 'Копия в SQLite' }));
  mir.append(dbEl('p', { textContent: m.active ? `Каждые ${Math.round(m.every / 60)} мин данные Postgres копируются в локальную SQLite. Последняя копия: ${dbWhen(m.ok)}${m.ok ? `, записей ${m.keys}, ${Math.round(m.bytes / 1024)} КБ` : ''}.` : 'Копия делается только при работе на Postgres.' }));
  if (m.error) mir.append(dbEl('p', { className: 'danger', textContent: 'Последняя ошибка копирования: ' + m.error }));
  if (m.active) {
    const now = dbEl('button', { type: 'button', textContent: 'Скопировать сейчас' });
    now.onclick = async () => { now.disabled = true; try { const r = await api('/api/admin/database', { action: 'mirror' }); toast('Копия обновлена'); await admLoadDatabase(r); } catch (e) { dbErr(e); } finally { now.disabled = false; } };
    mir.append(now);
  }
  mir.append(dbEl('p', { className: 'muted', textContent: 'Чтобы вернуться на копию, выберите SQLite и режим «Взять данные из выбранной базы».' }));
  box.append(mir);
  box.append(dbImportBox(d));
  box.append(dbResetBox(d));
}

function dbResetBox(d) {
  const box = dbEl('div', { className: 'adm-box' }, dbEl('h3', { textContent: 'Сбросить все данные' }),
    dbEl('p', { className: 'danger', textContent: 'Удаляет игроков, балансы, настройки, квесты, каталог и всё остальное сразу в Postgres' + (d.kind === 'postgres' ? '' : ' (сейчас не подключён)') + ' и в локальной SQLite. Копия перед сбросом остаётся в служебном ключе db_before_reset, но лучше сначала скачать резервную копию. Доступно владельцу.' }));
  const slider = dbEl('input', { type: 'range', min: 0, max: 100, value: 0 });
  slider.style.width = '240px';
  const phrase = dbEl('input', { type: 'text', placeholder: 'СБРОСИТЬ ВСЕ ДАННЫЕ', autocomplete: 'off', spellcheck: false });
  const go = dbEl('button', { type: 'button', className: 'danger', textContent: 'Сбросить всё', disabled: true });
  const hint = dbEl('p', { className: 'muted', textContent: 'Сдвиньте ползунок до конца и введите фразу «СБРОСИТЬ ВСЕ ДАННЫЕ».' });
  const ready = () => { go.disabled = !(Number(slider.value) === 100 && phrase.value.trim() === 'СБРОСИТЬ ВСЕ ДАННЫЕ'); };
  slider.oninput = ready; phrase.oninput = ready;
  slider.onchange = () => { if (Number(slider.value) < 100) slider.value = 0; ready(); };
  go.onclick = async () => {
    if (!confirm('Последнее подтверждение: стереть ВСЕ данные в Postgres и SQLite?')) return;
    go.disabled = true;
    try {
      await api('/api/admin/database', { action: 'reset', phrase: phrase.value.trim() });
      toast('Все данные сброшены'); location.reload();
    } catch (e) { dbErr(e); slider.value = 0; ready(); }
  };
  box.append(dbEl('div', { className: 'adm-form' }, slider, phrase, go), hint);
  return box;
}

function dbImportBox(d) {
  const box = dbEl('div', { className: 'adm-box' }, dbEl('h3', { textContent: 'Импорт из файла SQLite' }),
    dbEl('p', { className: 'muted', textContent: 'Загрузите файл SQLite (.sqlite3), выберите, что взять из него, и подтвердите. Данные записываются в текущую базу (' + (d.kind === 'postgres' ? 'Postgres' : 'SQLite') + '). Перед импортом текущее состояние сохраняется. Доступно владельцу.' }));
  const file = dbEl('input', { type: 'file', accept: '.sqlite3,.sqlite,.db,application/octet-stream', hidden: true });
  const pick = dbEl('button', { type: 'button', textContent: 'Выбрать файл SQLite' });
  const out = dbEl('div');
  pick.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    out.textContent = 'Читаю файл…';
    try {
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = '';
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      const r = await api('/api/admin/import', { action: 'analyze', data: btoa(bin) });
      dbImportChoose(out, r, f.name);
    } catch (e) { out.textContent = ''; dbErr(e); } finally { file.value = ''; }
  };
  box.append(dbEl('div', { className: 'adm-form' }, pick, file), out);
  return box;
}

function dbImportChoose(out, r, name) {
  out.textContent = '';
  out.append(dbEl('p', { textContent: 'Файл «' + name + '». Выберите, что импортировать:' }));
  const checks = [];
  for (const sec of r.sections) {
    const cb = dbEl('input', { type: 'checkbox', checked: sec.id === 'users' });
    checks.push([sec, cb]);
    const note = sec.id === 'users' ? `${sec.count} в файле, сейчас ${sec.current}, из них уже есть ${sec.existing || 0}` : `${sec.count} в файле, сейчас ${sec.current}`;
    out.append(dbEl('label', { className: 'adm-form' }, cb, dbEl('span', { textContent: ' ' + sec.label + ': ' + note })));
  }
  const go = dbEl('button', { type: 'button', className: 'danger', textContent: 'Импортировать в ' + (r.target === 'postgres' ? 'Postgres' : 'SQLite') });
  go.onclick = async () => {
    const chosen = checks.filter(([, cb]) => cb.checked).map(([sec]) => sec);
    if (!chosen.length) { toast('Выберите, что импортировать', true); return; }
    const lines = chosen.map((sec) => sec.id === 'users'
      ? `Игроки: ${sec.count} (у ${sec.existing || 0} уже существующих данные будут заменены)`
      : `${sec.label}: текущие (${sec.current}) будут заменены данными из файла (${sec.count})`);
    if (!confirm('Вы уверены, что хотите импортировать эти данные вместо нынешних?\n\n' + lines.join('\n'))) return;
    go.disabled = true;
    try {
      const res = await api('/api/admin/import', { action: 'apply', token: r.token, sections: chosen.map((sec) => sec.id) });
      out.textContent = 'Импортировано: ' + Object.entries(res.done).map(([k, v]) => `${(r.sections.find((x) => x.id === k) || {}).label || k} - ${v}`).join(', ') + '.';
      toast('Импорт завершён');
    } catch (e) { dbErr(e); } finally { go.disabled = false; }
  };
  out.append(go);
}
