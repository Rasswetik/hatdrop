'use strict';
function bcEl(tag, props, ...kids) {
  const el = Object.assign(document.createElement(tag), props || {});
  el.append(...kids);
  return el;
}
let bcTimer = 0;
function bcErr(e) {
  const text = (e && e.data && e.data.message) || (e && e.code) || 'Ошибка';
  $('panelError').textContent = text; $('panelError').hidden = false; toast(text, true);
}

async function admLoadBroadcast() {
  const root = $('admBroadcast');
  clearTimeout(bcTimer);
  try {
    const data = await api('/api/admin/broadcast/list');
    root.replaceChildren();
    const box = bcEl('div', { className: 'adm-box' }, bcEl('h3', { textContent: 'Рассылка в боте' }));
    box.append(bcEl('p', { className: 'muted', textContent: `Получателей в базе: ${data.users}. Вставьте ссылку на пост канала — сообщение скопируется как есть (с картинкой, форматированием и кнопками). Бот должен быть администратором канала.` }));
    const all = bcEl('input', { type: 'radio', name: 'bcAud', value: 'all', checked: true });
    const some = bcEl('input', { type: 'radio', name: 'bcAud', value: 'list' });
    const list = bcEl('textarea', { rows: 3, placeholder: '@username или Telegram ID через пробел, запятую или с новой строки', hidden: true });
    box.append(bcEl('label', { className: 'quest-launch' }, all, ' Все пользователи'), bcEl('label', { className: 'quest-launch' }, some, ' Выбранные'), list);
    for (const r of [all, some]) r.onchange = () => { list.hidden = !some.checked; };
    const link = bcEl('input', { className: 'tc-input', placeholder: 'Ссылка на пост канала: https://t.me/канал/123', autocomplete: 'off' });
    const text = bcEl('textarea', { rows: 4, maxLength: 3500, placeholder: 'Или свой текст (поддерживаются <b>, <i>, <code>, {name} и [emoji:ID:символ]). Если указана ссылка — текст игнорируется.' });
    box.append(bcEl('label', {}, 'Источник сообщения', link), text);
    const payload = () => ({ audience: all.checked ? 'all' : 'list', list: list.value, link: link.value.trim(), text: text.value });
    const test = bcEl('button', { type: 'button', textContent: 'Отправить тест мне' });
    test.onclick = async () => {
      test.disabled = true;
      try { await api('/api/admin/broadcast/test', payload()); toast('Тест отправлен вам в бота'); } catch (e) { bcErr(e); } finally { test.disabled = false; }
    };
    const start = bcEl('button', { type: 'button', className: 'primary', textContent: 'Запустить рассылку' });
    start.onclick = async () => {
      if (!confirm(all.checked ? `Отправить ВСЕМ пользователям (${data.users})?` : 'Отправить выбранным пользователям?')) return;
      start.disabled = true;
      try { const r = await api('/api/admin/broadcast/start', payload()); toast('Рассылка запущена: ' + r.total); admLoadBroadcast(); } catch (e) { bcErr(e); } finally { start.disabled = false; }
    };
    box.append(bcEl('div', { className: 'adm-form' }, test, start));
    root.append(box);

    const hist = bcEl('div', { className: 'adm-box' }, bcEl('h3', { textContent: 'История' }));
    if (!data.rows.length) hist.append(bcEl('p', { className: 'muted', textContent: 'Рассылок пока не было.' }));
    let running = false;
    for (const r of data.rows) {
      if (r.status === 'running') running = true;
      const when = new Date(r.created * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      hist.append(bcEl('div', { className: 'quest-admin-row' },
        bcEl('b', { textContent: `${when} · ${r.kind === 'post' ? 'пост' : 'текст'} · ${r.audience === 'all' ? 'все' : 'выбранные'}` }),
        bcEl('small', { textContent: `${r.status === 'running' ? '⏳ идёт' : '✅ готово'} · отправлено ${r.sent} из ${r.total} · заблокировали бота ${r.blocked} · ошибок ${r.failed}${r.error ? ' · ' + r.error : ''} · ${r.label}` })));
    }
    root.append(hist);
    if (running) bcTimer = setTimeout(() => { if (!$('admBroadcast').hidden) admLoadBroadcast(); }, 3000);
  } catch (e) { bcErr(e); }
}
