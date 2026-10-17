'use strict';
/* Админка, «Маркеты»: консоль журнала загрузки Portals и MRKT (процесс и ошибки). */
const mlState = { last: 0, timer: 0, lines: [] };

function mlEl(tag, props, ...kids) { const e = Object.assign(document.createElement(tag), props || {}); e.append(...kids); return e; }
function mlTime(t) { return new Date(t * 1000).toLocaleTimeString('ru-RU'); }

function admLoadMarketLog() {
  const box = $('admMarketLog');
  if (!box) return;
  clearTimeout(mlState.timer);
  mlState.last = 0; mlState.lines = [];
  box.textContent = '';
  const status = mlEl('p', { className: 'muted' });
  const screen = mlEl('div', { className: 'ml-console', role: 'log' });
  const clear = mlEl('button', { type: 'button', textContent: 'Очистить' });
  const copy = mlEl('button', { type: 'button', textContent: 'Копировать' });
  clear.onclick = async () => { try { await api('/api/admin/market/log', { clear: true }); mlState.last = 0; mlState.lines = []; screen.textContent = ''; tick(); } catch (e) { admErr(e); } };
  copy.onclick = async () => { try { await navigator.clipboard.writeText(mlState.lines.join('\n')); toast('Журнал скопирован'); } catch (e) { toast('Не удалось скопировать', true); } };
  box.append(mlEl('h3', { textContent: 'Консоль загрузки маркетов' }),
    mlEl('p', { className: 'muted', textContent: 'Показывает, что делает загрузка Portals и MRKT: запросы, ответы, ошибки и прогресс. Обновляется сама.' }),
    mlEl('div', { className: 'adm-form' }, clear, copy), status, screen);
  const tick = async () => {
    if (admin.tab !== 'market' || !document.body.contains(screen)) return;
    try {
      const r = await api('/api/admin/market/log', { since: mlState.last });
      const stick = screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 24;
      for (const e of r.entries) {
        const text = `${mlTime(e.t)} [${e.src}] ${e.msg}`;
        mlState.lines.push(text);
        screen.append(mlEl('div', { className: 'ml-line ml-' + e.level, textContent: text }));
        mlState.last = e.id;
      }
      while (screen.childNodes.length > 600) screen.firstChild.remove();
      if (stick) screen.scrollTop = screen.scrollHeight;
      const parts = [r.portals.running ? 'Portals: идёт загрузка…' : 'Portals: ожидает', r.mrkt.running ? `MRKT: идёт загрузка… ${r.mrkt.checked}/${r.mrkt.total}` : 'MRKT: ожидает'];
      status.textContent = parts.join(' · ');
      if (!screen.childNodes.length) screen.textContent = 'Пока пусто. Нажмите обновление подарков или сохраните ключ, и здесь появится журнал.';
    } catch (e) { status.textContent = 'Нет связи с сервером'; }
    mlState.timer = setTimeout(tick, 2000);
  };
  tick();
}
