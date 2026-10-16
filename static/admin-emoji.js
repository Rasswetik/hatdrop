'use strict';
function emErr(e) {
  const text = (e && e.data && e.data.message) || (e && e.code) || 'Ошибка';
  $('panelError').textContent = text; $('panelError').hidden = false; toast(text, true);
}

function emEl(tag, props, ...kids) {
  const el = Object.assign(document.createElement(tag), props || {});
  el.append(...kids);
  return el;
}

async function admLoadEmoji() {
  const root = $('admEmoji');
  try {
    const data = await api('/api/admin/emojis');
    root.textContent = '';

    // --- Библиотека ---
    const lib = emEl('div', { className: 'adm-box' }, emEl('h3', { textContent: 'Premium-эмодзи' }));
    lib.append(emEl('p', { className: 'em-notice', textContent: data.notice }));
    const idInput = emEl('input', { className: 'tc-input', placeholder: 'ID custom emoji, например 5368324170671202286', inputMode: 'numeric', autocomplete: 'off' });
    const addBtn = emEl('button', { type: 'button', className: 'primary', textContent: 'Добавить' });
    addBtn.onclick = async () => {
      addBtn.disabled = true;
      try { await api('/api/admin/emojis/add', { id: idInput.value.trim() }); toast('Эмодзи добавлено'); admLoadEmoji(); }
      catch (e) { emErr(e); } finally { addBtn.disabled = false; }
    };
    lib.append(emEl('div', { className: 'adm-form' }, idInput, addBtn));
    const chips = emEl('div', { className: 'em-chips' });
    if (!data.saved.length) chips.append(emEl('span', { className: 'muted', textContent: 'Пока пусто. Telegram проверяет каждый ID перед сохранением.' }));
    for (const item of data.saved) {
      const del = emEl('button', { type: 'button', className: 'danger', textContent: '×', title: 'Удалить' });
      del.onclick = async () => { try { await api('/api/admin/emojis/remove', { id: item.id }); admLoadEmoji(); } catch (e) { emErr(e); } };
      chips.append(emEl('span', { className: 'em-chip' }, emEl('b', { textContent: item.emoji }), emEl('code', { textContent: item.id }), del));
    }
    lib.append(chips);

    // --- TON ---
    const ton = emEl('div', { className: 'adm-box' }, emEl('h3', { textContent: 'Эмодзи TON' }));
    ton.append(emEl('p', { className: 'em-notice', textContent: 'Подставляется вместо 💎 рядом с суммой в сообщениях бота (например, об обмене NFT-подарка).' }));
    const tonInput = emEl('input', { className: 'tc-input', placeholder: 'ID эмодзи TON (пусто — обычный 💎)', value: (data.ton && data.ton.id) || '', inputMode: 'numeric', autocomplete: 'off' });
    const tonSave = emEl('button', { type: 'button', className: 'primary', textContent: 'Сохранить' });
    tonSave.onclick = async () => {
      tonSave.disabled = true;
      try { await api('/api/admin/emojis/ton', { emoji_id: tonInput.value.trim() }); toast('Сохранено'); admLoadEmoji(); }
      catch (e) { emErr(e); } finally { tonSave.disabled = false; }
    };
    ton.append(emEl('div', { className: 'adm-form' }, emEl('span', { className: 'em-cur', textContent: (data.ton && data.ton.emoji) || '💎' }), tonInput, tonSave));

    // --- Подарки ---
    const gifts = emEl('div', { className: 'adm-box' }, emEl('h3', { textContent: 'Эмодзи подарков' }));
    const search = emEl('input', { className: 'tc-input', type: 'search', placeholder: 'Поиск подарка', autocomplete: 'off' });
    const grid = emEl('div', { className: 'em-gifts' });
    gifts.append(search, grid);
    let timer;
    const render = async () => {
      let res;
      try { res = await api('/api/admin/gift-emojis', { q: search.value.trim() }); } catch (e) { emErr(e); return; }
      grid.textContent = '';
      if (!res.items.length) grid.append(emEl('p', { className: 'muted', textContent: 'Каталог подарков пуст — загрузите маркет.' }));
      for (const g of res.items) {
        const input = emEl('input', { placeholder: 'ID эмодзи', value: g.emoji_id, inputMode: 'numeric', autocomplete: 'off' });
        const save = emEl('button', { type: 'button', textContent: 'OK' });
        const cur = emEl('span', { className: 'em-cur', textContent: g.emoji || '🎁' });
        save.onclick = async () => {
          save.disabled = true;
          try { const r = await api('/api/admin/gift-emojis/save', { gift_id: g.gift_id, emoji_id: input.value.trim() }); cur.textContent = (r.item && r.item.emoji) || '🎁'; toast('Сохранено'); }
          catch (e) { emErr(e); } finally { save.disabled = false; }
        };
        const img = emEl('img', { alt: '', loading: 'lazy', src: g.image || '' });
        grid.append(emEl('div', { className: 'em-gift' }, img, emEl('b', { textContent: g.name }), emEl('div', { className: 'em-row' }, cur, input, save)));
      }
    };
    search.oninput = () => { clearTimeout(timer); timer = setTimeout(render, 250); };
    root.append(lib, ton, gifts);
    render();
  } catch (e) { admErr(e); }
}
