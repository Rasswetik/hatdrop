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
}
