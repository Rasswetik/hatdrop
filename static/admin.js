'use strict';
const $ = id => document.getElementById(id);
const fmt = (n, digits = 2) => Number(n || 0).toLocaleString('ru-RU', {maximumFractionDigits:digits});
const trName = name => name;
const hatAsset = () => '/images/hat.webp';
let toastTimer, overviewSequence = 0, overviewData = null;
function toast(message, error = false) { $('toast').textContent=message; $('toast').classList.toggle('error', error); $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
function listNote(root, message) {root.textContent=message;}
async function api(path, body = {}) {
  const res = await fetch(path, {method:'POST', credentials:'same-origin',headers:{'Content-Type':'application/json','X-Admin-CSRF':document.querySelector('meta[name="admin-csrf"]').content}, body:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) { const error=new Error(data.error || `HTTP ${res.status}`);error.code=data.error;error.data=data;throw error; }
  return data;
}
async function fetchModels(slug) { return api('/api/gifts/models', {slug}); }
const dateLabel = value => new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(value+'T12:00:00+03:00'));
const timeLabel = ts => new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(ts*1000));
function closeNavigation() { $('sidebar').classList.remove('open');$('navOverlay').hidden=true;$('menuBtn').setAttribute('aria-expanded','false'); }
function metric(root, label, value, note, unit = '', primary=false, signed=false) {
  const card=admField('article',{className:'metric'+(primary?' primary-metric':'')});
  const heading=admField('div',{className:'label',textContent:label});
  const number=admField('div',{className:'value',textContent:fmt(value)});
  if(signed)number.classList.add(value<0?'negative':value>0?'positive':'neutral');
  if(unit)number.append(admField('span',{className:'unit',textContent:unit}));
  card.append(heading,number,admField('div',{className:'metric-note',textContent:note}));root.append(card);
}
function row(root, values, signedColumn=-1) {const tr=document.createElement('tr');values.forEach((value,i)=>{const td=admField('td',{textContent:String(value)});if(i===signedColumn)td.className=String(value).startsWith('-')?'negative':'positive';tr.append(td);});root.append(tr);return tr;}
function emptyRow(root, count, text) {const tr=document.createElement('tr');const td=admField('td',{className:'empty',textContent:text});td.colSpan=count;tr.append(td);root.append(tr);}
function status(root, name, value) {const pair=document.createElement('div');pair.append(admField('dt',{textContent:name}),admField('dd',{textContent:String(value)}));root.append(pair);}
async function admLoadOverview() {
  const sequence=++overviewSequence;
  $('overviewReload').disabled=true;
  try {
    const data = await api('/api/admin/overview',{days:Number($('statsPeriod').value),scope:$('statsScope').value});
    if(sequence!==overviewSequence || !['overview','finance'].includes(admin.tab))return;
    overviewData=data;renderOverview(data);$('panelError').hidden=true;
  } catch(e) {if(sequence===overviewSequence)admErr(e);}
  finally {if(sequence===overviewSequence)$('overviewReload').disabled=false;}
}
function renderStorageBox(data) {
  let box = $('storageBox');
  if (!box) { box = admField('div', {id: 'storageBox', className: 'adm-box'}); $('summaryCards').before(box); }
  box.replaceChildren();
  const st = data.storage || {};
  if (st.persistent === false) {
    box.append(admField('p', {className: 'em-notice', textContent: '⚠️ База лежит во временном хранилище: при деплое или перезапуске хостинга данные (рейтинг, эмодзи, настройки) сотрутся. Задайте DATABASE_URL (Postgres) или SQLITE_PATH на постоянном диске. Пока этого нет — копия базы автоматически приходит владельцу в Telegram, её можно вернуть командой /restore.'}));
  } else {
    box.append(admField('p', {className: 'muted', textContent: 'Хранилище: ' + (st.kind === 'postgres' ? 'Postgres' : 'SQLite на постоянном диске') + '. Копия базы приходит владельцу в Telegram каждые 12 часов.'}));
  }
  if (st.conflict) box.append(admField('p', {className: 'em-notice', textContent: '⛔ Базу изменяет другой процесс сервера: из-за этого данные откатываются. Запустите ровно один воркер (gunicorn -w 1) и перезапустите сервис.'}));
  if (st.last_saved) box.append(admField('p', {className: 'muted', textContent: 'Последнее сохранение: ' + new Date(st.last_saved * 1000).toLocaleString('ru-RU') + ' · игроков ' + st.users + ' · ' + Math.round(st.bytes / 1024) + ' КБ' + (st.path ? ' · файл ' + st.path : '')}));
  const row = admField('div', {className: 'adm-form'});
  const dl = admField('button', {type: 'button', textContent: 'Скачать копию'});
  dl.onclick = async () => {
    dl.disabled = true;
    try {
      const r = await api('/api/admin/backup/download');
      const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], {type: 'application/gzip'})); a.download = r.filename; a.click();
    } catch (e) { admErr(e); } finally { dl.disabled = false; }
  };
  const send = admField('button', {type: 'button', textContent: 'Прислать копию в Telegram'});
  send.onclick = async () => { send.disabled = true; try { const r = await api('/api/admin/backup/send'); toast(r.ok ? 'Копия отправлена владельцу' : 'Нечего отправлять', !r.ok); } catch (e) { admErr(e); } finally { send.disabled = false; } };
  const file = admField('input', {type: 'file', accept: '.gz,.json', hidden: true});
  const up = admField('button', {type: 'button', className: 'danger', textContent: 'Восстановить из файла'});
  up.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    if (!confirm('Заменить ВСЮ текущую базу данными из файла «' + f.name + '»? Текущее состояние будет сохранено в служебный ключ.')) { file.value = ''; return; }
    try {
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (const b of buf) bin += String.fromCharCode(b);
      const r = await api('/api/admin/backup/restore', {data: btoa(bin)});
      toast('База восстановлена. Игроков: ' + r.users); location.reload();
    } catch (e) { admErr(e); } finally { file.value = ''; }
  };
  row.append(dl, send, up, file); box.append(row);
}
function renderOverview(data) {
  renderStorageBox(data);
  const t=data.totals,u=data.users,w=data.withdrawals;
  $('statsUpdated').textContent='Обновлено '+new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(data.now*1000));
  $('summaryCards').replaceChildren();
  metric($('summaryCards'),'Результат бота',t.net,'Игры + доходы − расходы','TON',true,true);
  metric($('summaryCards'),'Ставки',t.stakes,fmt(t.games,0)+' завершённых игр','TON');
  metric($('summaryCards'),'Выигрыши',t.payouts,'RTP: '+(t.rtp===null?'нет данных':fmt(t.rtp)+'%'),'TON');
  metric($('summaryCards'),'Игровой результат',t.gross,'Маржа: '+(t.margin===null?'нет данных':fmt(t.margin)+'%'),'TON',false,true);
  metric($('summaryCards'),'Игроки',u.total,fmt(u.online,0)+' активны за 5 минут');
  metric($('summaryCards'),'Балансы игроков',u.balances,'Активные ставки: '+fmt(u.active_stakes)+' TON','TON');
  metric($('summaryCards'),'Инвентарь игроков',u.inventory,'Стоимость принадлежащих игрокам подарков','TON');
  metric($('summaryCards'),'Заявки на вывод',w.pending,'На сумму '+fmt(w.pending_value)+' TON');
  $('financeCards').replaceChildren();
  metric($('financeCards'),'Результат бота',t.net,'За выбранный период','TON',true,true);
  metric($('financeCards'),'Игровой результат',t.gross,'Ставки − выигрыши','TON',false,true);
  metric($('financeCards'),'Доходы вне игр',t.income,'Внесённые операции','TON');
  metric($('financeCards'),'Расходы',t.expense,'Внесённые операции','TON');
  $('chartNetBadge').textContent=(t.net>=0?'+':'')+fmt(t.net)+' TON';
  drawChart('profitChart',data.series,'line');drawChart('volumeChart',data.series,'bar');
  $('modeRows').replaceChildren();
  for(const [kind,m] of Object.entries(data.modes))row($('modeRows'),[kind==='chests'?'Мины':kind==='upgrade'?'Колесо':kind,fmt(m.games,0),fmt(m.stakes),fmt(m.payouts),fmt(m.gross)+' TON'],4);
  if(!Object.keys(data.modes).length)emptyRow($('modeRows'),5,'В этом периоде пока нет завершённых игр');
  $('dailyRows').replaceChildren();
  for(const d of [...data.series].reverse())row($('dailyRows'),[dateLabel(d.date),d.games,fmt(d.stakes),fmt(d.payouts),fmt(d.gross),fmt(d.income),fmt(d.expense),fmt(d.net)],7);
  $('systemStatus').replaceChildren();
  status($('systemStatus'),'Telegram',data.bot.configured?'Бот подключён':'Токен не задан');
  status($('systemStatus'),'Основной маркет',data.bot.market.toUpperCase());
  status($('systemStatus'),'Хэллоуинская тема',data.bot.halloween?'Включена':'Выключена');
  status($('systemStatus'),'Выполнено выводов за период',fmt(w.completed,0)+' · '+fmt(w.completed_value)+' TON');
  $('botBadge').textContent=data.bot.configured?'Подключён':'Не настроен';
  $('accountingNote').textContent='Точный учёт игр начат '+timeLabel(data.started)+' МСК. Старые игры без точных выплат не включены. Завершённые игры учитываются целиком, включая стоимость подарков. Вывод не уменьшает результат повторно. '+(data.scope==='demo'?'Выбрана демо-статистика; реальные доходы и расходы в неё не входят.':'Балансы игроков и их инвентарь — текущие обязательства, а не прибыль.');
  $('financeRows').replaceChildren();
  for(const e of data.entries) {const tr=row($('financeRows'),[timeLabel(e.ts),e.kind==='expense'?'Расход':'Доход',e.note,(e.kind==='expense'?'-':'+')+fmt(e.amount)],3);tr.children[2].className='note';}
  if(!data.entries.length)emptyRow($('financeRows'),4,data.scope==='demo'?'Финансовые операции доступны в статистике реальных игроков':'В этом периоде нет внесённых операций');
  for(const el of $('financeForm').elements)el.disabled=data.scope==='demo';
}
const SVG_NS='http://www.w3.org/2000/svg';
function svgEl(name, attrs={}, text) {const e=document.createElementNS(SVG_NS,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
function drawChart(id, series, kind) {
  const root=$(id);root.replaceChildren();
  const width=Math.max(250,root.clientWidth || 620),height=width<450?220:250,left=49,right=20,top=15,bottom=33,plotW=width-left-right,plotH=height-top-bottom;
  const keys=kind==='line'?['net','gross']:['stakes','payouts'];
  const values=series.flatMap(d=>keys.map(k=>d[k]));
  let low=Math.min(0,...values), high=Math.max(0,...values);
  if(low===high)high=1;
  const padding=(high-low)*.12; if(low<0)low-=padding;high+=padding;
  const x=i=>left+(series.length===1?plotW/2:i*plotW/(series.length-1));
  const y=value=>top+(high-value)*plotH/(high-low);
  const svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':kind==='line'?'График результата бота и игрового результата по дням':'График ставок и выигрышей по дням'});
  const desc=svgEl('desc',{},'Точные значения доступны в таблице «Данные по дням» и в CSV.');svg.append(desc);
  for(let n=0;n<5;n++) {const value=low+(high-low)*n/4,py=y(value);svg.append(svgEl('line',{x1:left,x2:width-right,y1:py,y2:py,stroke:'#2a364b','stroke-width':1}),svgEl('text',{x:left-9,y:py+4,'text-anchor':'end',fill:'#a1aec3','font-size':11},Math.abs(value)>=1_000_000 ? fmt(value/1_000_000,1)+'млн' : Math.abs(value)>=1000 ? fmt(value/1000,1)+'тыс' : fmt(value,1)));}
  if(low<0)svg.append(svgEl('line',{x1:left,x2:width-right,y1:y(0),y2:y(0),stroke:'#536580','stroke-dasharray':'4 4'}));
  const ticks=[...new Set([0,Math.floor((series.length-1)/3),Math.floor((series.length-1)*2/3),series.length-1])];
  for(const i of ticks)svg.append(svgEl('text',{x:x(i),y:height-8,'text-anchor':'middle',fill:'#a1aec3','font-size':11},dateLabel(series[i].date)));
  if(kind==='line') {
    keys.forEach((key,j)=>{const points=series.map((d,i)=>`${x(i)},${y(d[key])}`).join(' ');if(j===0&&series.length>1){const polygon=points+` ${x(series.length-1)},${y(0)} ${x(0)},${y(0)}`;svg.append(svgEl('polygon',{points:polygon,fill:'#4669e8',opacity:'.06'}));}svg.append(svgEl('polyline',{points,fill:'none',stroke:j===0?'#4669e8':'#b6c2d8','stroke-width':j===0?2.5:1.6,'stroke-linejoin':'round','stroke-linecap':'round',...(j===1?{'stroke-dasharray':'5 5'}:{})}));if(series.length===1)svg.append(svgEl('circle',{cx:x(0),cy:y(series[0][key]),r:4,fill:j===0?'#4669e8':'#b6c2d8'}));});
  } else {
    const step=plotW/Math.max(series.length,1),bw=Math.min(18,step*.36);
    series.forEach((d,i)=>{const center=left+step*(i+.5);keys.forEach((key,j)=>svg.append(svgEl('rect',{x:center+(j===0?-bw-1:1),y:y(d[key]),width:bw,height:Math.max(0,y(0)-y(d[key])),rx:Math.min(2,bw/3),fill:j===0?'#4669e8':'#35b8ab'})));});
  }
  const cursor=svgEl('line',{x1:left,x2:left,y1:top,y2:height-bottom,stroke:'#8394bc','stroke-dasharray':'3 3',visibility:'hidden'});svg.append(cursor);
  root.append(svg);const tip=admField('div',{className:'chart-tooltip',hidden:true});root.append(tip);
  const move=e=>{const rect=svg.getBoundingClientRect();const px=(e.clientX-rect.left)*width/rect.width;const index=Math.max(0,Math.min(series.length-1,Math.round((px-left)/plotW*(series.length-1))));const d=series[index];tip.textContent=dateLabel(d.date)+'\n'+(kind==='line'?`Итог: ${fmt(d.net)} TON\nИгры: ${fmt(d.gross)} TON`:`Ставки: ${fmt(d.stakes)} TON\nВыигрыши: ${fmt(d.payouts)} TON`);tip.hidden=false;tip.style.left=Math.max(0,Math.min(root.clientWidth-180,e.clientX-rect.left-85))+'px';cursor.setAttribute('x1',x(index));cursor.setAttribute('x2',x(index));cursor.setAttribute('visibility','visible');};
  svg.addEventListener('pointermove',move);svg.addEventListener('pointerdown',move);svg.addEventListener('pointerleave',()=>{tip.hidden=true;cursor.setAttribute('visibility','hidden');});
  if(values.every(v=>v===0))root.append(admField('p',{className:'chart-empty',textContent:'Нет операций за выбранный период'}));
}
let emojiLib = [];
function emojiImg(id, fallback) {
  const img = admField('img', {className: 'em-img', alt: fallback || '⭐', loading: 'lazy', src: '/api/admin/emoji-thumb/' + id});
  img.onerror = () => img.replaceWith(document.createTextNode(fallback || '⭐'));
  return img;
}
const BOT_STYLE_TAGS = {b: 'b', i: 'i', u: 'u', s: 's', code: 'code', pre: 'pre', 'tg-spoiler': 'span', blockquote: 'blockquote'};
function botRenderRich(root, text) {
  root.replaceChildren();
  let node = root;
  const stack = [];
  for (const part of text.split(/(<\/?(?:b|i|u|s|code|pre|tg-spoiler|blockquote)>|\[emoji:\d{5,30}:[^\]\r\n]{1,16}\])/g)) {
    if (!part) continue;
    let m = part.match(/^<(\/?)(b|i|u|s|code|pre|tg-spoiler|blockquote)>$/);
    if (m) {
      if (!m[1]) {
        const el = document.createElement(BOT_STYLE_TAGS[m[2]]);
        if (m[2] === 'tg-spoiler') el.className = 'tg-spoiler';
        node.append(el); stack.push(el); node = el;
      } else if (stack.length) { stack.pop(); node = stack[stack.length - 1] || root; }
      continue;
    }
    m = part.match(/^\[emoji:(\d{5,30}):([^\]\r\n]{1,16})\]$/);
    node.append(m ? emojiImg(m[1], m[2]) : document.createTextNode(part));
  }
}
function renderEmojiPicker() {
  let box = $('botEmojiPicker');
  if (!box) {
    box = admField('div', {id: 'botEmojiPicker', className: 'em-picker'});
    $('botMessageText').closest('label').after(box);
  }
  const insert = (token) => {
    const t = $('botMessageText');
    const a = t.selectionStart ?? t.value.length, z = t.selectionEnd ?? a;
    t.value = t.value.slice(0, a) + token + t.value.slice(z);
    t.focus(); t.setSelectionRange(a + token.length, a + token.length); botChanged();
  };
  box.replaceChildren();
  const fmtBar = admField('div', {className: 'em-bar em-fmt'});
  const wrap = (tag) => {
    const t = $('botMessageText'), a = t.selectionStart ?? 0, z = t.selectionEnd ?? a;
    const open = `<${tag}>`, close = `</${tag}>`, sel = t.value.slice(a, z);
    t.value = t.value.slice(0, a) + open + sel + close + t.value.slice(z);
    t.focus(); t.setSelectionRange(a + open.length, a + open.length + sel.length); botChanged();
  };
  for (const [tag, label, title, css] of [['b', 'Ж', 'Жирный (Ctrl+B)', 'font-weight:700'], ['i', 'К', 'Курсив (Ctrl+I)', 'font-style:italic'], ['u', 'Ч', 'Подчёркнутый (Ctrl+U)', 'text-decoration:underline'], ['s', 'S', 'Зачёркнутый', 'text-decoration:line-through'], ['code', 'Моно', 'Моноширинный (копируется по нажатию)', 'font-family:monospace'], ['pre', '{ }', 'Блок кода', 'font-family:monospace'], ['tg-spoiler', 'Спойлер', 'Скрытый текст', ''], ['blockquote', '❝ Цитата', 'Цитата', '']]) {
    const b = admField('button', {type: 'button', className: 'em-fmt-btn', textContent: label, title});
    if (css) b.style.cssText = css;
    b.onclick = () => wrap(tag);
    fmtBar.append(b);
  }
  const ta = $('botMessageText');
  if (!ta.dataset.fmtKeys) {
    ta.dataset.fmtKeys = '1';
    ta.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const tag = {b: 'b', i: 'i', u: 'u'}[e.key.toLowerCase()];
      if (tag) { e.preventDefault(); wrap(tag); }
    });
  }
  box.append(fmtBar);
  const bar = admField('div', {className: 'em-bar'});
  const toggle = admField('button', {type: 'button', className: 'em-toggle', textContent: '😀 Premium-эмодзи'});
  bar.append(toggle);
  for (const [token, label] of [['{gift_emoji}', 'эмодзи подарка'], ['{gift}', 'название подарка'], ['{name}', 'имя игрока']]) {
    const b = admField('button', {type: 'button', className: 'em-var', textContent: token, title: label});
    b.onclick = () => insert(token);
    bar.append(b);
  }
  const panel = admField('div', {className: 'em-panel', hidden: true});
  toggle.onclick = () => { panel.hidden = !panel.hidden; };
  box.append(bar, panel);
  const search = admField('input', {className: 'tc-input', placeholder: 'Поиск по набору или символу', autocomplete: 'off'});
  const grid = admField('div', {className: 'em-grid'});
  const add = admField('div', {className: 'adm-form'});
  const link = admField('input', {className: 'tc-input', placeholder: 'Добавить набор: https://t.me/addemoji/НАЗВАНИЕ', autocomplete: 'off'});
  const addBtn = admField('button', {type: 'button', textContent: '+ Набор'});
  addBtn.onclick = async () => {
    addBtn.disabled = true;
    try { const r = await api('/api/admin/emojis/pack', {link: link.value.trim()}); toast(`Набор «${r.title}»: добавлено ${r.added}`); const lib = await api('/api/admin/emojis'); emojiLib = lib.saved || []; fill(); link.value = ''; }
    catch (e) { admErr(e); } finally { addBtn.disabled = false; }
  };
  add.append(link, addBtn);
  function fill() {
    grid.replaceChildren();
    const q = search.value.trim().toLowerCase();
    if (!emojiLib.length) { grid.append(admField('small', {className: 'muted', textContent: 'Библиотека пуста — добавьте набор ссылкой ниже или во вкладке «Эмодзи».'})); return; }
    const groups = new Map();
    for (const e of emojiLib) {
      const set = e.set_name || 'Отдельные';
      if (q && !set.toLowerCase().includes(q) && !String(e.emoji).includes(q)) continue;
      if (!groups.has(set)) groups.set(set, []);
      groups.get(set).push(e);
    }
    for (const [set, items] of groups) {
      grid.append(admField('div', {className: 'em-set', textContent: set}));
      const row = admField('div', {className: 'em-cells'});
      for (const e of items) {
        const b = admField('button', {type: 'button', title: e.emoji});
        b.append(emojiImg(e.id, e.emoji));
        b.onclick = () => insert(`[emoji:${e.id}:${e.emoji}]`);
        row.append(b);
      }
      grid.append(row);
    }
  }
  search.oninput = fill;
  panel.append(search, grid, add);
  fill();
}
let botMessages = null, botDraft = null, botDirty = false;
const BOT_ERROR = {message_format_invalid:'Теги стилей должны закрываться: <b>…</b>, <i>…</i> и т.д., без пересечений.',message_text_invalid:'Введите текст до 3500 символов.',message_buttons_invalid:'Можно добавить до 8 кнопок.',message_button_invalid:'Проверьте названия и цвета кнопок.',message_button_url_invalid:'Для ссылки нужен полный HTTPS-адрес.',message_button_target_invalid:'Выберите раздел приложения.',app_https_url_required:'Укажите HTTPS-адрес приложения в разделе TON Connect.',command_name_invalid:'Команда: от 1 до 32 латинских букв, цифр или символов _.',command_description_invalid:'Введите описание команды до 256 символов.',command_reserved:'/start и /help редактируются как стандартные сообщения.',command_exists:'Эта команда уже существует. Выберите её в редакторе.',command_limit:'Можно создать до 98 дополнительных команд.'};
function botApplyConfig(config, selected='welcome') {
  botMessages=config;const select=$('botMessageKey');select.replaceChildren();
  for(const [key,item] of Object.entries(config.messages))select.append(admField('option',{value:key,textContent:item.label}));
  select.value=config.messages[selected]?selected:'welcome';botSelectMessage();
}
function botMenuStatus(result){$('botMenuSyncState').textContent=result.menu_synced?'Меню команд в Telegram обновлено.':'Команды сохранены. Telegram не подтвердил обновление меню — нажмите «Обновить меню команд в Telegram» повторно.';}
function botSelectMessage() {
  botDraft=structuredClone(botMessages.messages[$('botMessageKey').value]);botDirty=false;botMessages.currentKey=$('botMessageKey').value;
  $('botMessageText').value=botDraft.text;renderBotButtons();renderBotPreview();$('botMessageState').textContent='';
  const custom=botMessages.currentKey.startsWith('command:');$('botCommandFields').hidden=!custom;$('botCommandDescription').value=botDraft.description||'';$('botCommandDescription').required=custom;
  $('botMessageReset').hidden=custom;$('botCommandDelete').hidden=!custom;
}
function botChanged() {botDirty=true;$('botMessageState').textContent='Есть несохранённые изменения';renderBotPreview();}
function botOptions(options, value) {const select=document.createElement('select');for(const [v,label] of options)select.append(admField('option',{value:v,textContent:label}));select.value=value;return select;}
function renderBotButtons() {
  const root=$('botButtonRows');root.replaceChildren();$('botButtonAdd').disabled=botDraft.buttons.length>=8;
  botDraft.buttons.forEach((b,i)=>{
    const row=admField('div',{className:'bot-button-row'});
    const field=(title,control,wide=false)=>{const label=admField('label',{className:wide?'wide':''});label.append(document.createTextNode(title),control);row.append(label);return control;};
    const text=field('Название',admField('input',{value:b.text,maxLength:64,required:true}));text.oninput=()=>{b.text=text.value;botChanged();};
    const style=field('Цвет',botOptions([['default','Стандартный'],['primary','Синий'],['success','Зелёный'],['danger','Красный']],b.style));style.onchange=()=>{b.style=style.value;botChanged();};
    const icon=field('Premium-эмодзи на кнопке',botOptions([['','Без иконки'],...emojiLib.map(e=>[e.id,e.emoji+' · '+e.id])],b.icon||''),true);icon.onchange=()=>{if(icon.value)b.icon=icon.value;else delete b.icon;botChanged();};
    const action=field('Действие',botOptions([['app','Открыть игру'],['url','Открыть ссылку']],b.action));action.onchange=()=>{b.action=action.value;b.target=b.action==='app'?'menu':'https://';renderBotButtons();botChanged();};
    const target=field(b.action==='app'?'Раздел игры':'HTTPS-ссылка',b.action==='app'?botOptions([['menu','Меню'],['upgrade','Колесо'],['chests','Мины'],['profile','Профиль']],b.target):admField('input',{type:'url',value:b.target,required:true,maxLength:512}));target.onchange=target.oninput=()=>{b.target=target.value;botChanged();};
    const tools=admField('div',{className:'bot-row-toolbar'});tools.append(admField('span',{textContent:'Кнопка '+(i+1)}));const actions=document.createElement('div');
    for(const [title,offset] of [['↑',-1],['↓',1]]){const move=admField('button',{type:'button',textContent:title,disabled:i+offset<0||i+offset>=botDraft.buttons.length});move.setAttribute('aria-label',offset<0?'Поднять кнопку':'Опустить кнопку');move.onclick=()=>{[botDraft.buttons[i],botDraft.buttons[i+offset]]=[botDraft.buttons[i+offset],botDraft.buttons[i]];renderBotButtons();botChanged();};actions.append(move);}
    const remove=admField('button',{type:'button',textContent:'Удалить',className:'danger'});remove.onclick=()=>{botDraft.buttons.splice(i,1);renderBotButtons();botChanged();};actions.append(remove);tools.append(actions);row.append(tools);root.append(row);
  });
}
function renderBotPreview() {
  if(!botDraft)return;
  botRenderRich($('botPreviewText'),$('botMessageText').value.replace(/\{(name|gift|gift_emoji|value|user|id|mode|error)\}/g,(_,key)=>({name:'Александр',gift:'Шляпа волшебника',gift_emoji:'🎁',value:'3.89',user:'@username',id:'123456789',mode:'автовывод через релейер',error:'FLOOD_WAIT 30'})[key]));
  const root=$('botPreviewButtons');root.replaceChildren();for(const b of botDraft.buttons){const button=admField('button',{type:'button'});if(b.icon)button.append(emojiImg(b.icon,'⭐'));button.append(document.createTextNode(b.text||'Кнопка'));button.dataset.style=b.style;root.append(button);}
  $('botAppWarning').hidden=!botDraft.buttons.some(b=>b.action==='app')||botMessages.app_url.startsWith('https://');
}
async function admLoadBot() {
  try {const [data,config,lib]=await Promise.all([api('/api/admin/bot/status'),api('/api/admin/bot/messages'),api('/api/admin/emojis').catch(()=>({saved:[]}))]);emojiLib=lib.saved||[];renderEmojiPicker();if(botDraft)renderBotButtons();const root=$('botDetails');root.replaceChildren();status(root,'Подключение',data.connected?'Подключён':data.configured?'Ожидает подключения':'Нужен токен бота');status(root,'Бот',data.bot_username?'@'+data.bot_username:'—');status(root,'Приём сообщений',data.connected?'Включён':data.connection_error==='telegram_unavailable'?'Telegram временно недоступен':'Нажмите «Подключить бота»');$('botOpenLink').hidden=!data.bot_username;if(data.bot_username)$('botOpenLink').href='https://t.me/'+encodeURIComponent(data.bot_username);
    if(!botDirty)botApplyConfig(config,$('botMessageKey').value);
  }catch(e){admErr(e);}
}
function initBotEditor() {
  $('botMessageKey').onchange=()=>{if(botDirty&&!confirm('Перейти к другому сообщению без сохранения?')){ $('botMessageKey').value=botMessages.currentKey;return;}botMessages.currentKey=$('botMessageKey').value;botSelectMessage();};
  $('botMessageText').oninput=botChanged;
  $('botCommandDescription').oninput=botChanged;
  $('botButtonAdd').onclick=()=>{if(!botDraft||botDraft.buttons.length>=8)return;botDraft.buttons.push({text:'Играть',action:'app',target:'menu',style:'primary'});renderBotButtons();botChanged();};
  async function save(reset=false){const key=$('botMessageKey').value;$('botMessageSave').disabled=true;$('botMessageReset').disabled=true;$('botCommandDelete').disabled=true;try{const message={text:$('botMessageText').value,buttons:botDraft.buttons};if(key.startsWith('command:')){const result=await api('/api/admin/bot/commands/save',{command:key.slice(8),description:$('botCommandDescription').value,message});botApplyConfig(result,key);botMenuStatus(result);}else{const result=await api('/api/admin/bot/messages/save',{key,...(reset?{reset:true}:{message})});botMessages.messages[key]=result.message;botSelectMessage();}$('botMessageState').textContent='Сохранено';toast(reset?'Стандартное сообщение восстановлено':'Сообщение сохранено');}catch(e){toast(BOT_ERROR[e.code]||'Не удалось сохранить сообщение',true);}finally{$('botMessageSave').disabled=false;$('botMessageReset').disabled=false;$('botCommandDelete').disabled=false;}}
  $('botMessageForm').onsubmit=e=>{e.preventDefault();save();};$('botMessageReset').onclick=()=>{if(confirm('Вернуть стандартный текст и кнопки этого сообщения?'))save(true);};
  $('botCommandCreateForm').onsubmit=async e=>{
    e.preventDefault();if(botDirty&&!confirm('Создать новую команду без сохранения текущих изменений?'))return;
    $('botCommandCreate').disabled=true;
    try{const command=$('botNewCommand').value;const result=await api('/api/admin/bot/commands/save',{command,description:$('botNewDescription').value,create:true,message:{text:'🎩 Привет, {name}! Выбирайте режим в меню HatDrop.',buttons:[{text:'🎮 Играть',action:'app',target:'menu',style:'primary'}]}});botApplyConfig(result,'command:'+command.trim().replace(/^\//,'').toLowerCase());botMenuStatus(result);$('botCommandCreateForm').reset();$('botMessageText').focus();toast('Команда создана. Настройте её ответ и кнопки.');}catch(e){toast(BOT_ERROR[e.code]||'Не удалось создать команду',true);}finally{$('botCommandCreate').disabled=false;}
  };
  $('botCommandDelete').onclick=async()=>{
    const key=$('botMessageKey').value;if(!key.startsWith('command:')||!confirm('Удалить команду /'+key.slice(8)+' вместе с ответом и кнопками?'))return;
    $('botCommandDelete').disabled=true;try{const result=await api('/api/admin/bot/commands/delete',{command:key.slice(8)});botApplyConfig(result);botMenuStatus(result);toast('Команда удалена');}catch(e){toast('Не удалось удалить команду',true);}finally{$('botCommandDelete').disabled=false;}
  };
  $('botCommandsSync').onclick=async()=>{const button=$('botCommandsSync');button.disabled=true;try{botMenuStatus(await api('/api/admin/bot/commands/sync'));}catch(e){admErr(e);}finally{button.disabled=false;}};
}
async function setupBot() {
  $('botSetup').disabled=true;
  try {await api('/api/admin/bot/setup');toast('Бот подключён');await admLoadBot();}
  catch(e){const messages={bot_token_missing:'На сервере не задан токен Telegram-бота.',webhook_secret_invalid:'Проверьте TELEGRAM_WEBHOOK_SECRET: только латинские буквы, цифры, дефис и подчёркивание.',https_required:'Укажите публичный HTTPS-адрес сервера.',telegram_webhook_failed:'Telegram не подтвердил подключение. Проверьте токен бота и повторите попытку.'};toast(messages[e.code]||'Не удалось подключить бота. Попробуйте ещё раз.',true);}
  finally{$('botSetup').disabled=false;}
}
function exportStats() {
  if(!overviewData)return;
  const header=['Дата','Игры','Ставки TON','Выигрыши TON','Игровой результат TON','Доходы TON','Расходы TON','Итог TON'];
  const rows=overviewData.series.map(d=>[d.date,d.games,d.stakes,d.payouts,d.gross,d.income,d.expense,d.net]);
  const csv='\uFEFF'+[header,...rows].map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=admField('a',{href:url,download:`hatdrop-${overviewData.scope}-${overviewData.series[0].date}-${overviewData.series.at(-1).date}.csv`});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function startAdmin() {
  const hashParams = new URLSearchParams(location.hash.slice(1)); const ticket = hashParams.get('ticket');
  if (hashParams.get('wd')) { try { sessionStorage.setItem('admWd', hashParams.get('wd')); } catch(e) {} }
  if(ticket) {
    history.replaceState(null,'','/admin');
    try {const r=await fetch('/admin/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});if(!r.ok)throw new Error();location.replace(hashParams.get('wd') ? '/admin#withdrawals' : '/admin');return;}catch(e){$('accessMessage').textContent='Откройте панель снова из профиля игры.';return;}
  }
  if(!document.querySelector('meta[name="admin-csrf"]').content){$('accessMessage').textContent='Войдите через профиль администратора в игре.';return;}
  try {const data=await api('/api/admin/overview',{days:30});$('adminName').textContent=data.admin_name;overviewData=data;}catch(e){$('accessMessage').textContent='Откройте панель снова из профиля игры.';return;}
  $('accessGate').hidden=true;$('adminApp').hidden=false;initAdmin();
  $('menuBtn').onclick=()=>{const open=!$('sidebar').classList.contains('open');$('sidebar').classList.toggle('open',open);$('navOverlay').hidden=!open;$('menuBtn').setAttribute('aria-expanded',String(open));if(open)$('admTabs button.on')?.focus();};
  $('navOverlay').onclick=closeNavigation;document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeNavigation();$('menuBtn').focus();}});
  $('statsPeriod').onchange=admLoadOverview;$('statsScope').onchange=admLoadOverview;$('overviewReload').onclick=admLoadOverview;$('exportStats').onclick=exportStats;
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>admShow(b.dataset.open));
  initBotEditor();initAdminAccess();$('botReload').onclick=admLoadBot;$('botSetup').onclick=setupBot;
  $('logoutBtn').onclick=async()=>{try{await api('/admin/logout');location.replace('/admin');}catch(e){admErr(e);}};
  let financeRequestId=null;
  $('financeForm').onsubmit=async e=>{e.preventDefault();const amount=Number($('financeAmount').value),note=$('financeNote').value.trim();if(!Number.isFinite(amount)||amount<=0||!note)return toast('Введите сумму и комментарий',true);if(!confirm(`Записать ${$('financeKind').value==='expense'?'расход':'доход'} ${fmt(amount,4)} TON?`))return;
    $('financeSave').disabled=true;financeRequestId ||= crypto.randomUUID ? crypto.randomUUID() : Date.now().toString()+Math.random().toString(16).slice(2);
    try{await api('/api/admin/finance/entry',{kind:$('financeKind').value,amount,note,request_id:financeRequestId});financeRequestId=null;$('financeForm').reset();toast('Операция записана');await admLoadOverview();}catch(e){admErr(e);}finally{$('financeSave').disabled=$('statsScope').value==='demo';}};
  if(typeof ResizeObserver!=='undefined') { let sizes={};const observer=new ResizeObserver(entries=>{for(const entry of entries){const id=entry.target.id,width=entry.contentRect.width;if(width>0&&sizes[id]!==width&&overviewData){sizes[id]=width;drawChart(id,overviewData.series,id==='profitChart'?'line':'bar');}}});observer.observe($('profitChart'));observer.observe($('volumeChart'));}
  const initialTab=location.hash.slice(1);admShow(['overview','finance','users','withdrawals','promos','quests','market','bot','admins','tonconnect','appearance','relayer','rtp','payments','emoji','season','broadcast','shop','weapons','levels'].includes(initialTab)?initialTab:'overview');
  setInterval(()=>{if(!document.hidden&&['overview','finance'].includes(admin.tab))admLoadOverview();},60000);
}
startAdmin().catch(()=>{$('accessMessage').textContent='Не удалось загрузить панель. Обновите страницу.';});
