'use strict';
const questMs = value => value ? Math.round(new Date(value).getTime() / 1000) : 0;
const questDate = ts => ts ? new Date((Number(ts) - 3*3600)*1000).toISOString().slice(0,16) : '';
const questEditCache = new Map();
function questFormClear() { $('questForm').reset();$('questId').value='';$('questGoal').value='1';$('questThreshold').value='0';$('questRewardAmount').value='0.1';$('questDuration').value='0';$('questSave').textContent='Сохранить квест'; }
function questRow(q) {
  const el=document.createElement('div');el.className='quest-admin-row';
  const heading=document.createElement('b');heading.textContent=q.title+' · '+(q.active?'Включён':'Выключен');
  const details=document.createElement('small');details.textContent=
    (document.querySelector('#questKind option[value="'+q.kind+'"]')?.textContent||q.kind)+
    ' · цель: '+q.goal+(q.threshold?' · порог: '+q.threshold:'')+
    ' · награда: '+q.reward_amount+' '+q.reward_type+
    (q.end_at?' · до '+new Date(q.end_at*1000).toLocaleString('ru-RU'):'');
  const buttons=document.createElement('div');buttons.className='adm-form';
  const edit=document.createElement('button');edit.type='button';edit.textContent='Изменить';
  edit.onclick=()=>{ $('questId').value=q.id;$('questTitle').value=q.title;$('questDescription').value=q.description||'';
    $('questKind').value=q.kind;$('questGoal').value=q.goal;$('questThreshold').value=q.threshold;
    $('questStart').value=questDate(q.start_at);$('questEnd').value=questDate(q.end_at);
    $('questDuration').value=q.duration_hours;$('questRewardType').value=q.reward_type;
    $('questRewardAmount').value=q.reward_amount;$('questActive').checked=q.active;
    $('questSave').textContent='Сохранить изменения';$('questTitle').focus();
  };
  const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='Удалить';
  del.onclick=async()=>{if(!confirm('Удалить квест «'+q.title+'»?'))return;try{await api('/api/admin/quests/save',{action:'delete',id:q.id});toast('Квест удалён');admLoadQuests();}catch(e){admErr(e);}};
  buttons.append(edit,del);el.append(heading,details,buttons);return el;
}
async function admLoadQuests(){
  try{
    const data=await api('/api/admin/quests');
    $('questsLaunch').checked=data.enabled;
    const kinds=$('questKind'),current=kinds.value;
    kinds.replaceChildren();data.types.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.label;kinds.append(o);});
    if(data.types.some(t=>t.id===current))kinds.value=current;
    const box=$('questRows');box.replaceChildren();
    data.rows.forEach(q=>box.append(questRow(q)));
    if(!data.rows.length){const p=document.createElement('p');p.className='muted';p.textContent='Заданий пока нет.';box.append(p);}
  }catch(e){admErr(e);}
}
function initQuestAdmin(){
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
      kind:$('questKind').value,goal:Number($('questGoal').value),threshold:Number($('questThreshold').value),
      start_at:questMs($('questStart').value)+($('questStart').value?3*3600:0),
      end_at:questMs($('questEnd').value)+($('questEnd').value?3*3600:0),
      duration_hours:Number($('questDuration').value),
      reward_type:$('questRewardType').value,reward_amount:Number($('questRewardAmount').value),active:$('questActive').checked};
    try{await api('/api/admin/quests/save',data);toast('Квест сохранён');questFormClear();await admLoadQuests();}
    catch(e){admErr(e);}finally{button.disabled=false;}
  };
}
