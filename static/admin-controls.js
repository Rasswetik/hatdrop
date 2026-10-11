'use strict';
function renderAdminAccess(data) {
  const root=$('adminAccessRows');root.replaceChildren();
  for(const item of data.rows){
    const row=admField('div',{className:'admin-access-row'}),copy=document.createElement('div');
    copy.append(admField('b',{textContent:item.username?'@'+item.username:item.name}),admField('small',{textContent:'ID '+item.telegram_id+(item.self?' · Вы':'')+(item.owner?' · Владелец':'')}));
    const remove=admField('button',{type:'button',className:'danger',textContent:'Удалить',disabled:item.owner});
    remove.onclick=async()=>{
      if(!confirm(item.self?'Удалить свой доступ к панели?':'Удалить администратора '+item.telegram_id+'?'))return;
      remove.disabled=true;
      try{const result=await api('/api/admin/admins/save',{telegram_id:item.telegram_id,action:'remove'});if(result.self_removed){location.replace('/admin');return;}renderAdminAccess(result);toast('Доступ администратора удалён');}catch(e){admErr(e);remove.disabled=false;}
    };
    row.dataset.telegramId=item.telegram_id;row.append(copy,remove);root.append(row);
  }
}
async function admLoadAdminAccess(){try{renderAdminAccess(await api('/api/admin/admins'));}catch(e){admErr(e);}}
function initAdminAccess(){
  $('adminsReload').onclick=admLoadAdminAccess;
  $('adminAddForm').onsubmit=async e=>{
    e.preventDefault();const id=$('adminNewId').value.trim();if(!/^[1-9][0-9]{0,19}$/.test(id))return toast('Введите числовой Telegram ID.',true);
    $('adminAdd').disabled=true;
    try{renderAdminAccess(await api('/api/admin/admins/save',{telegram_id:id,action:'add'}));$('adminAddForm').reset();toast('Администратор добавлен');}catch(e){admErr(e);}finally{$('adminAdd').disabled=false;}
  };
}
