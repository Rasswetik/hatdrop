(() => {
const board=document.getElementById('minesBoard'), status=document.getElementById('minesStatus');
const start=document.getElementById('minesStart'),cash=document.getElementById('minesCashout');
if(!board)return;
let busy=false,game=null;
const api=async(path,body={})=>{
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:window.Telegram?.WebApp?.initData||'',...body})});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'server_error');
 return data;
};
const error=e=>{status.textContent='Ошибка: '+e.message;};
const modal=document.getElementById('minesResultModal');
document.getElementById('minesResultClose')?.addEventListener('click',()=>{modal.hidden=true;});

const apply=d=>{
 game=d;board.replaceChildren();
 (d.cells||Array(25).fill(null)).forEach((v,i)=>{
  const b=document.createElement('button');
  b.className='mine-cell'+(v?' revealed':'');b.type='button';
  b.textContent=v==='gold'?'💰':v==='empty'?'🪹':'?';
  b.disabled=!d.active||v!==null||busy;
  b.setAttribute('aria-label',v==='gold'?'Золото':v==='empty'?'Пустой мешок':'Открыть клетку');
  b.addEventListener('click',()=>act('/api/mines/open',{cell:i}));
  board.append(b);
 });
 const mult=Number(d.multiplier||1).toFixed(2);
 status.textContent=d.result==='win'?'ПОБЕДА! Выплата '+Number(d.payout_ton||d.bet*d.multiplier).toFixed(2)+' TON':d.result==='lose'?'ПРОИГРЫШ — пустой мешок':d.active?'Открыто: '+d.opened+' · x'+mult:'Выберите ставку и начните игру';
 start.hidden=!!d.active;cash.hidden=!d.active||!d.opened;
 cash.textContent='Забрать '+Number((d.bet||0)*(d.multiplier||1)).toFixed(2)+' TON';
 document.getElementById('minesBet').disabled=!!d.active;
 document.getElementById('minesCount').disabled=!!d.active;
 if(d.balance_ton!==undefined){const b=document.getElementById('balanceValue');if(b)b.textContent=Number(d.balance_ton).toFixed(2);}
 if(d.result==='win'||d.result==='lose')window.setTimeout(()=>window.hatMinesRefresh?.(),4500);
};
const act=async(path,body={})=>{if(busy)return;busy=true;try{const d=await api(path,body);apply(d);if(d.result && (path==='/api/mines/open'||path==='/api/mines/cashout')){document.getElementById('minesResultIcon').textContent=d.result==='win'?'💰':'🪹';document.getElementById('minesResultTitle').textContent=d.result==='win'?'ПОБЕДА!':'ПРОИГРЫШ';document.getElementById('minesResultText').textContent=d.result==='win'?'Выигрыш: '+Number(d.payout_ton||d.bet*d.multiplier).toFixed(2)+' TON':'Попался пустой мешок';modal.hidden=false;}}catch(e){error(e);}finally{busy=false;}};
start.addEventListener('click',()=>act('/api/mines/start',{bet:document.getElementById('minesBet').value,mines:document.getElementById('minesCount').value}));
cash.addEventListener('click',()=>act('/api/mines/cashout'));
window.hatMinesRefresh=async()=>{try{apply(await api('/api/mines/state'));}catch(e){error(e);}};
window.hatMinesRefresh();
})();
