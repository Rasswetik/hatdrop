'use strict';
const questMs = value => value ? Math.round(new Date(value + ':00+03:00').getTime() / 1000) : 0;
const questDate = ts => ts ? new Date((Number(ts) - 3*3600)*1000).toISOString().slice(0,16) : '';
const questEditCache = new Map();
function questFormClear() { $('questForm').reset();$('questActive').checked=true;$('questAchievement').checked=false;$('questId').value='';$('questGoal').value='1';$('questThreshold').value='0';$('questRewardAmount').value='0.1';$('questDuration').value='0';$('questSave').textContent='Сохранить квест';questPreview(); }
function questRow(q) {
  const el=document.createElement('div');el.className='quest-admin-row';
  const heading=document.createElement('b');heading.textContent=(q.achievement?'🏆 ':'')+q.title+' · '+(q.active?'Включён':'Выключен');
  const details=document.createElement('small');details.textContent=
    (document.querySelector('#questKind option[value="'+q.kind+'"]')?.textContent||q.kind)+
    ' · цель: '+q.goal+(q.threshold?' · порог: '+q.threshold:'')+
    ' · награда: '+(q.reward_type==='weapon'?'снаряжение '+q.reward_weapon:q.reward_amount+' '+q.reward_type)+
    (q.end_at?' · до '+new Date(q.end_at*1000).toLocaleString('ru-RU'):'');
  const icon=document.createElement('img');icon.src='/static/quests/'+(q.resolved_icon||'star')+'.svg';icon.width=42;icon.height=42;icon.alt='';
  const buttons=document.createElement('div');buttons.className='adm-form';
  const edit=document.createElement('button');edit.type='button';edit.textContent='Изменить';
  edit.onclick=()=>{ $('questId').value=q.id;$('questTitle').value=q.title;$('questDescription').value=q.description||'';
    $('questKind').value=q.kind;$('questGoal').value=q.goal;$('questThreshold').value=q.threshold;
    $('questStart').value=questDate(q.start_at);$('questEnd').value=questDate(q.end_at);
    $('questDuration').value=q.duration_hours;$('questRewardType').value=q.reward_type==='weapon'?'weapon:'+q.reward_weapon:q.reward_type;$('questAchievement').checked=!!q.achievement;
    $('questRewardAmount').value=q.reward_amount;$('questIcon').value=q.icon||'auto';$('questActive').checked=q.active;questPreview();
    $('questSave').textContent='Сохранить изменения';$('questTitle').focus();
  };
  const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='Удалить';
  del.onclick=async()=>{if(!confirm('Удалить квест «'+q.title+'»?'))return;del.disabled=true;try{await api('/api/admin/quests/save',{action:'delete',id:q.id});if($('questId').value===q.id)questFormClear();el.remove();toast('Квест удалён');await admLoadQuests();}catch(e){admErr(e);}finally{del.disabled=false;}};
  buttons.append(edit,del);el.append(icon,heading,details,buttons);return el;
}
async function admLoadQuests(){
  try{
    const data=await api('/api/admin/quests');
    $('questsLaunch').checked=data.enabled;
    const kinds=$('questKind'),current=kinds.value;
    kinds.replaceChildren();data.types.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.label;kinds.append(o);});
    if(data.types.some(t=>t.id===current))kinds.value=current;
    const iconSelect=$('questIcon'),iconCurrent=iconSelect.value;iconSelect.replaceChildren();(data.icons||['auto','wheel','upgrade','mines','gift','deposit','turnover','chest','star','trophy','hatcoin','moon','flame']).forEach(icon=>{const op=document.createElement('option');op.value=icon;op.textContent=icon==='auto'?'Автоматически':icon;iconSelect.append(op)});if(data.icons?.includes(iconCurrent))iconSelect.value=iconCurrent;questPreview();
    const rt=$('questRewardType'),rtCur=rt.value;
    [...rt.querySelectorAll('option[data-weapon]')].forEach(o=>o.remove());
    (data.weapons||[]).forEach(w=>{const o=document.createElement('option');o.value='weapon:'+w.id;o.dataset.weapon='1';o.textContent='Снаряжение: '+w.name+(w.event?' (Хэллоуин)':'');rt.append(o);});
    if([...rt.options].some(o=>o.value===rtCur))rt.value=rtCur;
    const box=$('questRows');box.replaceChildren();
    data.rows.forEach(q=>box.append(questRow(q)));
    if(!data.rows.length){const p=document.createElement('p');p.className='muted';p.textContent='Заданий пока нет.';box.append(p);}
  }catch(e){admErr(e);}
}
function questPreview(){const kind=$('questKind').value||'wheel_spins',goal=Number($('questGoal').value)||1,threshold=Number($('questThreshold').value)||0;const n={deposit_min:`Сделай ${goal} пополнений от ${threshold} TON`,deposit_total:`Пополняй баланс на ${goal} TON`,turnover:`Набери оборот ${goal} TON`,wheel_spins:`Прокрути рулетку ${goal} раз`,wheel_wins:`Выиграй в рулетку ${goal} раз`,upgrade_plays_below:`Сделай апгрейд ${goal} раз с шансом ниже ${threshold}%`,upgrade_plays_above:`Сделай апгрейд ${goal} раз с шансом от ${threshold}%`,upgrade_wins_min:`Выиграй апгрейд ${goal} раз с шансом от ${threshold}%`,upgrade_wins_max:`Выиграй апгрейд ${goal} раз с шансом до ${threshold}%`,mines_plays:`Сыграй в мины ${goal} раз`,mines_gift_wins:`Выиграй подарок в минах ${goal} раз`,mines_opened:`Открой ${goal} безопасных клеток в минах`};$('questNamePreview').textContent='Автоматическое название: '+(n[kind]||'Задание');const auto=kind.startsWith('deposit')?'deposit':kind==='turnover'?'turnover':kind.startsWith('wheel')?'wheel':kind.startsWith('upgrade')?'upgrade':kind==='mines_gift_wins'?'gift':'mines';$('questIconPreview').querySelector('img').src='/static/quests/'+($('questIcon').value==='auto'?auto:$('questIcon').value)+'.svg';}
function initQuestAdmin(){
  ['questKind','questGoal','questThreshold','questIcon'].forEach(id=>$(id).addEventListener('input',questPreview));
  $('questKind').addEventListener('change',()=>{$('questThreshold').value=$('questKind').value==='deposit_min'?5:$('questKind').value.startsWith('upgrade_')?20:0;questPreview();});
  $('questActive').checked=true;
  $('questsReload').onclick=admLoadQuests;
  $('questClear').onclick=questFormClear;
  $('questsLaunch').onchange=async()=>{
    const checkbox=$('questsLaunch');checkbox.disabled=true;
    try{await api('/api/admin/quests/save',{action:'launch',enabled:checkbox.checked});toast(checkbox.checked?'Квесты включены (кнопка пока скрыта)':'Квесты выключены');}
    catch(e){checkbox.checked=!checkbox.checked;admErr(e);}finally{checkbox.disabled=false;}
  };
  $('questForm').onsubmit=async event=>{
    event.preventDefault();
    const button=$('questSave');button.disabled=true;
    const id=$('questId').value;
    const data={action:id?'update':'create',id,
      title:$('questTitle').value,description:$('questDescription').value,
      icon:$('questIcon').value,kind:$('questKind').value,goal:Number($('questGoal').value),threshold:Number($('questThreshold').value),
      start_at:questMs($('questStart').value),
      end_at:questMs($('questEnd').value),
      duration_hours:Number($('questDuration').value),
      reward_type:$('questRewardType').value.startsWith('weapon:')?'weapon':$('questRewardType').value,
      reward_weapon:$('questRewardType').value.startsWith('weapon:')?$('questRewardType').value.slice(7):'',
      achievement:$('questAchievement').checked,
      reward_amount:Number($('questRewardAmount').value)||1,active:$('questActive').checked};
    try{await api('/api/admin/quests/save',data);toast(data.achievement?'Достижение сохранено':'Квест сохранён');questFormClear();await admLoadQuests();}
    catch(e){if(e.code==='quest_invalid'){toast(e.data?.field==='threshold'?'Порог для выбранного задания должен быть больше нуля':'Проверьте параметры квеста',true);}else admErr(e);}finally{button.disabled=false;}
  };
}
