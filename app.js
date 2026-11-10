'use strict';
const DB_NAME='SIGESP_DB',DB_STORE='CONFIG',DB_KEY='rootFolder';
const H={users:['id_usuario','nome','login','senha_hash','perfil','unidades_permitidas','supervisao_id','status','data_criacao','ultimo_acesso','versao_registro','data_atualizacao','usuario_ultima_alteracao'],org:['tipo','id','nome','supervisao_id','ativo','aliases'],nature:['id_natureza','nome','ativo','aliases'],units:['id_unidade','nome','id_supervisao'],supervisions:['id_supervisao','nome'],occ:['id_ocorrencia','id_interno','numero_protocolo','data_ocorrencia','hora_ocorrencia','gerencia','supervisao','unidade','area','local_especifico','natureza_ocorrencia','tipo_vinculo','nome_envolvido','empresa_envolvido','matricula_id','telefone','documento','placa_veiculo','gerencia_envolvido','gerencia_geral','diretoria','relato_detalhado','providencias_adotadas','prioridade','status','anexos_referencias','responsavel_registro','perfil_registro','data_registro','versao_registro','usuario_ultima_alteracao','status_validacao','data_envio_validacao','validado_por','data_validacao','observacao_validacao'],keys:['id_chave','codigo','descricao','setor','unidade','status','observacoes','versao_registro','data_atualizacao','usuario_ultima_alteracao'],moves:['id_movimento','id_chave','codigo_chave','tipo_movimento','retirante','matricula_documento','data_hora_retirada','data_hora_devolucao','observacoes','usuario_registro','versao_registro','data_atualizacao'],audit:['id_auditoria','data_hora','usuario','perfil','modulo','acao','id_registro','codigo_registro','detalhes'],inspecoes:['id','data','realizar_monitoramento','motivo_nao_execucao','placa','transportadora','nota','laudo','observacao','responsavel','matricula_responsavel','usuario_registro','data_hora_registro','data_hora_alteracao','alterado_por','unidade','supervisao'],registros_apagados:['id_exclusao','modulo_origem','data_hora_exclusao','administrador','id_registro','codigo_registro','dados_originais','motivo_exclusao']};
const H_PENDING=H.occ;
const PRI=['Baixa','Média','Alta','Crítica'],OST=['Rascunho','Registrada','Em Apuração','Encerrada'],KST=['Disponível','Retirada','Inativa','Manutenção','Extraviada'],MAX=6,WIDTH=1280,QUALITY=.72;
const ENVIRONMENTAL_FILE='inspecao_fumaca_preta.csv';
const ENVIRONMENTAL_REASONS=['Condição climática adversa / dia nublado / chuva','Equipamento indisponível','Falta de equipe operacional','Interrupção operacional / Emergência'];
const RIGHTS={Administrador:{all:1,users:1,audit:1,export:1},Supervisor:{users:1,audit:1,export:1},Líder:{all:1,audit:1,export:1},Operador:{},Consulta:{export:1}};
const PROFILE_ALIASES={administrador:'Administrador',supervisor:'Supervisor',lider:'Líder',operador:'Operador',consulta:'Consulta'};
function normalizePerfil(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}
function canonicalPerfil(value){const key=normalizePerfil(value);return PROFILE_ALIASES[key]||String(value??'').trim()}
function hasProfile(user, ...names){const current=normalizePerfil(user?.perfil);return names.some(name=>normalizePerfil(name)===current)}
function getRightsForUser(user=S.user){const profile=canonicalPerfil(user?.perfil);return RIGHTS[profile]||{}}
function canRegisterOccurrence(user=S.user){return hasProfile(user,'Administrador','Supervisor','Líder','Operador')}
function canValidateOccurrence(user=S.user){return hasProfile(user,'Administrador','Supervisor','Líder')}
function canManageUsers(user=S.user){return Boolean(getRightsForUser(user).users)}
function isAdministratorUser(user=S.user){if(!user)return false;return normalizePerfil(user.perfil)==='administrador'||hasProfile(user,'Administrador')||user.login==='admin'}
function manageableUsers(){if(!canManageUsers())return[];return hasProfile(S.user,'Supervisor')?S.users.filter(user=>!isAdministratorUser(user)):S.users}
function assertUserTargetPermission(user){if(!canManageUsers()){const error=Error('Sem permissão para administrar usuários.');error.name='UserPermissionError';throw error}if(hasProfile(S.user,'Supervisor')&&isAdministratorUser(user))throw new UserTargetRestrictedError()}
function assertAdministrator(){if(!hasProfile(S.user,'Administrador')){const error=Error('Somente Administradores podem gerenciar Supervisões e Unidades.');error.name='OrganizationPermissionError';throw error}}
function canManageKeys(user=S.user){return hasProfile(user,'Administrador','Supervisor','Líder')||isAdministratorUser(user)}
function canAccessKeyCautela(user=S.user){return hasProfile(user,'Administrador','Supervisor','Líder','Operador')||isAdministratorUser(user)}
function canAccessPage(page,user=S.user){if(page==='usuarios'&&!canManageUsers(user))return false;if(page==='chaves-cadastro'&&!canManageKeys(user))return false;if(['chaves','chaves-cautela'].includes(page)&&!canAccessKeyCautela(user))return false;if(page==='occ-apuracao'&&!hasProfile(user,'Administrador','Supervisor','Líder')&&!isAdministratorUser(user))return false;if(['inspecao-veicular','hist-inspecoes'].includes(page))return hasProfile(user,'Administrador','Supervisor','Líder','Operador');if(hasProfile(user,'Operador'))return['occ-register','chaves','chaves-cautela','inspecao-veicular','hist-inspecoes'].includes(page);if(hasProfile(user,'Líder'))return page!=='usuarios';return true}
function denyOperatorAccess(){if(!hasProfile(S.user,'Operador'))return false;S.accessDenied=true;render();return true}
function denyUserManagement(){if(!hasProfile(S.user,'Líder'))return false;S.accessDenied=true;render();return true}
class OccurrenceValidationError extends Error{}
class DataScopeError extends Error{}
const writeQueues=new Map();
function withWriteLock(name,operation,timeoutMs=0){
  const key=`SIGESP:${S.dir?.name||'dados'}:${name}`;
  const previous=writeQueues.get(key)||Promise.resolve();
  const current=previous.catch(()=>{}).then(async ()=>{
    if(typeof navigator!=='undefined'&&navigator.locks?.request){
      const ac=(typeof AbortController!=='undefined'&&timeoutMs>0)?new AbortController():null;
      const tId=(ac&&timeoutMs>0)?setTimeout(()=>{
        try{ac.abort(new Error('LockTimeout'));}catch{}
      },timeoutMs):null;
      try{
        return await navigator.locks.request(key,{mode:'exclusive',signal:ac?.signal},operation);
      }finally{
        if(tId)clearTimeout(tId);
      }
    }
    return await operation();
  });
  writeQueues.set(key,current);
  return current.finally(()=>{
    if(writeQueues.get(key)===current)writeQueues.delete(key);
  });
}
const S={dir:null,savedHandle:null,user:null,users:[],unitCatalog:[],supervisions:[],natureCatalog:[],occ:[],pending:[],keys:[],moves:[],audits:[],inspecoes:[],deletedRecords:[],page:'dashboard',message:'',permissionNeeded:false,restoring:true,folderModal:false,editing:null,activeReservation:null,reservingProtocol:false,occurrenceDraft:null,userPasswordTarget:null,userRemovalTarget:null,modal:null,validationModal:null,deletePendingTarget:null,deleteRecordTarget:null,toast:null,masterEditor:null,masterConfirmation:null,masterBusy:false,settingsTab:'supervisions',settingsSearch:'',newPhotos:[],existing:[],removed:[],viewUrl:null,query:'',currentPage:1,pageSize:50,successPopup:null,errorPopup:null,submitting:false,accessDenied:false,activeMenu:null,lastSyncTime:new Date(),keysTab:'cautela',keyWithdrawTarget:null,keyReturnTarget:null,keyHistoryTarget:null,keySearchQuery:'',keyStatusFilter:'todos',keyUnitFilter:'',keyViewMode:'grid',keyModalErrors:{},historyFilters:{dateFrom:'',dateTo:'',nature:'',protocol:'',general:''},ambientalFilters:{dateFrom:'',dateTo:'',placa:'',transportadora:'',realizado:'',laudo:'',responsavel:'',unidade:'',supervisao:'',general:''},apuracaoFilters:{dateFrom:'',dateTo:'',priority:'',nature:'',status:'',general:''},apuracaoModal:null,apuracaoCurrentPage:1,apuracaoNewPdfs:[],apuracaoExistingPdfs:[]};
const app=document.getElementById('app'),uid=()=>(typeof window!=='undefined'&&window.StorageService?.generateUUID?window.StorageService.generateUUID():(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2,11)}`)),now=()=>new Date().toISOString();
app.addEventListener('click',event=>{if(event.target.closest('#closeAccessDenied')){S.accessDenied=false;render()}});
app.addEventListener('click',event=>{if(!hasProfile(S.user,'Líder'))return;const action=event.target instanceof Element?event.target.closest('#newUser,.editUser'):null;if(!action)return;event.preventDefault();event.stopImmediatePropagation();denyUserManagement()},true);
app.addEventListener('click',event=>{const button=event.target instanceof Element?event.target.closest('#exportOcc,#exportKeys'):null;if(!button)return;event.preventDefault();event.stopImmediatePropagation();void exportScopedData(button.id)},true);
app.addEventListener('click',event=>{if(!canManageUsers())return;const action=event.target instanceof Element?event.target.closest('.editUser,.toggleUser,.changeUserPassword,#closeUserPassword,#cancelUserPassword'):null;if(!action)return;event.preventDefault();event.stopImmediatePropagation();if(action.matches('#closeUserPassword,#cancelUserPassword')){S.userPasswordTarget=null;render();return}const id=action.dataset.id;if(action.matches('.editUser'))void editUser(id);else if(action.matches('.toggleUser'))void toggleUser(id);else if(action.matches('.changeUserPassword'))void openUserPassword(id)},true);
app.addEventListener('click',event=>{const navigation=event.target instanceof Element?event.target.closest('.menu-btn[data-page],.submenu-btn[data-page]'):null;if(navigation&&navigation.dataset.page!=='usuarios')S.userPasswordTarget=null},true);
app.addEventListener('submit',event=>{if(event.target?.id!=='userPasswordForm')return;event.preventDefault();event.stopImmediatePropagation();void saveUserPassword({preventDefault:()=>event.preventDefault(),currentTarget:event.target})},true);
app.addEventListener('submit',event=>{if(event.target?.id==='masterDataForm'){event.preventDefault();void saveMasterData(event)}},true);
app.addEventListener('click',event=>{const action=event.target instanceof Element?event.target.closest('.removeUser,#cancelUserRemoval,#confirmUserRemoval'):null;if(!action)return;event.preventDefault();event.stopImmediatePropagation();if(action.matches('.removeUser'))void openUserRemoval(action.dataset.id);else if(action.matches('#cancelUserRemoval')){S.userRemovalTarget=null;render()}else if(action.matches('#confirmUserRemoval'))void removeUser(S.userRemovalTarget?.id)},true);
app.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest('.settingsTab,.newMaster,.editMaster,.deactivateMaster,.cancelMasterEditor,#cancelMasterEditor,#cancelMasterConfirmation,#confirmMasterDeactivation'):null;if(!target)return;event.preventDefault();if(target.matches('.settingsTab')){S.settingsTab=target.dataset.tab;S.settingsSearch='';render()}else if(target.matches('.newMaster'))openMasterEditor(target.dataset.entity);else if(target.matches('.editMaster'))openMasterEditor(target.dataset.entity,target.dataset.id);else if(target.matches('.deactivateMaster'))void requestMasterDeactivation(target.dataset.entity,target.dataset.id);else if(target.matches('.cancelMasterEditor,#cancelMasterEditor')){S.masterEditor=null;render()}else if(target.matches('#cancelMasterConfirmation')){S.masterConfirmation=null;render()}else if(target.matches('#confirmMasterDeactivation'))void deactivateMasterRecord()},true);
app.addEventListener('submit',event=>{if(event.target?.id==='settingsSearch'){event.preventDefault();S.settingsSearch=String(new FormData(event.target).get('query')||'').trim();render()}},true);
app.addEventListener('change',event=>{
  const form=event.target instanceof Element?event.target.closest('#userForm'):null;
  if(!form)return;
  const field=event.target;
  if(field.name==='perfil'||field.id==='userPerfilSelect'){
    const prof=canonicalPerfil(field.value);
    const existing=(S.editing?.kind==='user'?S.editing.data:{})||{};
    const data={...existing,...captureUserDraft(form),perfil:prof};
    if(prof==='Administrador'){data.supervisao_id='';data.unidades_permitidas='*'}
    else if(prof==='Supervisor'){data.unidades_permitidas=''}
    else{data.unidades_permitidas=''}
    S.editing={kind:'user',data};
    render();
    const select=document.getElementById('userPerfilSelect');
    if(select)select.value=prof;
    return;
  }
  if(field.name==='supervisao_id'){
    const data=captureUserDraft(form);
    data.unidades_permitidas='';
    S.editing={kind:'user',data};
    render();
    return;
  }
  captureUserDraft(form);
});
app.addEventListener('input',event=>{
  const form=event.target instanceof Element?event.target.closest('#userForm'):null;
  if(!form)return;
  const field=event.target;
  if(field.name==='perfil'||field.id==='userPerfilSelect')return;
  captureUserDraft(form);
});
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function ce(v){if(v===null||v===undefined||v==='')return'';let s=typeof v==='string'?v:String(v);const c0=s.charCodeAt(0);if(c0===61||c0===43||c0===45||c0===64)s="'"+s;return /[;"\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function csv(rows,h){const hLen=h.length,rLen=rows.length,lines=new Array(rLen+1),rowBuf=new Array(hLen);lines[0]=h.join(';');for(let i=0;i<rLen;i++){const r=rows[i];for(let j=0;j<hLen;j++)rowBuf[j]=ce(r[h[j]]);lines[i+1]=rowBuf.join(';')}return '\ufeff'+lines.join('\r\n')}
class CSVStorageError extends Error{constructor(code,message,name='CSVStorageError',cause=null){super(message);this.name=name;this.code=code;this.cause=cause}}
function logCsvError(code,fileName,error,operation=''){console.error(`[CSVService:${code}]`,{arquivo:fileName,operacao:operation,mensagem:error?.message||String(error)})}
function classifyCsvError(error,fileName='',operation='',options={}){
if(error instanceof CSVStorageError)return error;
const name=error?.name||'',msg=String(error?.message||'');
let code='ERRO_DE_LEITURA';
if(name==='NotFoundError')code='ARQUIVO_NAO_ENCONTRADO';
else if(name==='NotAllowedError'||name==='SecurityError')code='ERRO_DE_PERMISSAO';
else if(name==='InvalidStateError'||/state had changed|Conflito/i.test(msg))code='ERRO_DE_SINCRONIZACAO';
else if(/CSV inválido/i.test(msg))code='ERRO_DE_PARSE';
else if(name==='CryptoIntegrityError'||/criptograf|adulterado|integridade/i.test(msg))code='ERRO_CRIPTOGRAFIA';
else if(operation==='write'||/gravar|salvar|confirmar/i.test(msg))code='ERRO_DE_GRAVACAO';
if(code!=='ARQUIVO_NAO_ENCONTRADO'&&!options?.silent&&!options?.optional)logCsvError(code,fileName,error,operation);
const wrapped=new CSVStorageError(code,msg||`Falha na operação CSV (${code}).`,name||'Error',error);
return wrapped
}
function detectCsvDelimiter(t){
  const s=String(t??'').replace(/^\ufeff/,'').trim();
  if(!s)return';';
  const firstLine=s.split(/\r?\n/)[0]||'';
  let inQ=false,semi=0,comma=0,tab=0;
  for(let i=0;i<firstLine.length;i++){
    const ch=firstLine[i];
    if(ch==='"'){if(firstLine[i+1]==='"')i++;else inQ=!inQ}
    else if(!inQ){
      if(ch===';')semi++;
      else if(ch===',')comma++;
      else if(ch==='\t')tab++;
    }
  }
  if(semi>0&&semi>=comma)return';';
  if(comma>semi)return',';
  if(tab>semi&&tab>comma)return'\t';
  return';';
}
function buildRowsObjects(headers,rows){
  const cleanHeaders=(headers||[]).map(h=>String(h||'').replace(/^["'\s]+|["'\s]+$/g,'').trim());
  const isLegacyOccHdr=cleanHeaders.some(h=>{
    const lower=String(h||'').toLowerCase();
    return lower==='arma_envolvida'||lower==='camera_relacionada'||lower==='operador_responsavel'||(lower==='data_hora_registro'&&cleanHeaders.includes('local_ocorrencia'));
  });
  const hLen=cleanHeaders.length,rLen=rows.length,out=[];
  for(let i=0;i<rLen;i++){
    const row=rows[i];
    let hasVal=false;
    for(let j=0;j<row.length;j++){if(row[j]!==''){hasVal=true;break}}
    if(!hasVal)continue;
    if(String(row[0]??'').trim().toLowerCase()==='id_ocorrencia'&&String(row[1]??'').trim().toLowerCase()==='id_interno')continue;

    if(isLegacyOccHdr&&typeof H!=='undefined'&&H.occ){
      const col23=String(row[23]??'').trim().toLowerCase();
      const col24=String(row[24]??'').trim().toLowerCase();
      const col21Len=String(row[21]??'').trim().length;
      const isCanonicalRow=['baixa','média','media','alta','crítica','critica'].includes(col23)||
        ['validada','pendente','rascunho','registrada','em apuração','encerrada','pendente de validação'].includes(col24)||
        col21Len>=15;

      if(isCanonicalRow){
        const obj={};
        for(let j=0;j<H.occ.length;j++)obj[H.occ[j]]=row[j]??'';
        out.push(obj);
        continue;
      }else{
        const rawObj={};
        for(let j=0;j<hLen;j++)rawObj[cleanHeaders[j]]=row[j]??'';
        const obj={
          id_ocorrencia:rawObj.id_ocorrencia||'',
          id_interno:rawObj.id_interno||'',
          numero_protocolo:rawObj.numero_protocolo||'',
          data_ocorrencia:rawObj.data_ocorrencia||'',
          hora_ocorrencia:rawObj.hora_ocorrencia||'',
          gerencia:rawObj.gerencia||'GSP/SP',
          supervisao:rawObj.supervisao||rawObj.local_ocorrencia||'GSP/SP',
          unidade:rawObj.unidade||rawObj.setor||'',
          area:rawObj.area||rawObj.tipo_ocorrencia||'',
          local_especifico:rawObj.local_especifico||rawObj.natureza_ocorrencia||'Geral',
          natureza_ocorrencia:rawObj.natureza_ocorrencia||rawObj.tipo_ocorrencia||'Geral',
          tipo_vinculo:rawObj.tipo_vinculo||rawObj.envolvido_vinculo||rawObj.envolvido_tipo||'Terceiro',
          nome_envolvido:rawObj.nome_envolvido||rawObj.envolvido_nome||'',
          empresa_envolvido:rawObj.empresa_envolvido||rawObj.acao_imediata||'',
          matricula_id:rawObj.matricula_id||'',
          telefone:rawObj.telefone||rawObj.envolvido_documento||'',
          documento:rawObj.documento||rawObj.envolvido_documento||'',
          placa_veiculo:rawObj.placa_veiculo||rawObj.veiculo_envolvido||'',
          gerencia_envolvido:rawObj.gerencia_envolvido||'',
          gerencia_geral:rawObj.gerencia_geral||'',
          diretoria:rawObj.diretoria||'',
          relato_detalhado:rawObj.relato_detalhado||rawObj.descricao_ocorrencia||rawObj.arma_envolvida||'',
          providencias_adotadas:rawObj.providencias_adotadas||rawObj.acao_imediata||rawObj.Camera_relacionada||'',
          prioridade:rawObj.prioridade||rawObj.classificacao||rawObj.nivel_risco||'Média',
          status:rawObj.status||'validada',
          anexos_referencias:rawObj.anexos_referencias||rawObj.anexos||rawObj.equipe_plantao||'',
          responsavel_registro:rawObj.responsavel_registro||rawObj.operador_responsavel||'',
          matricula_responsavel:rawObj.matricula_responsavel||rawObj.id_operador||'',
          perfil_registro:rawObj.perfil_registro||'Operador',
          data_registro:rawObj.data_registro||rawObj.data_hora_registro||rawObj.data_ultima_alteracao||'',
          versao_registro:rawObj.versao_registro||'1',
          usuario_ultima_alteracao:rawObj.usuario_ultima_alteracao||rawObj.operador_responsavel||'',
          status_validacao:rawObj.status_validacao||'Validada',
          data_envio_validacao:rawObj.data_envio_validacao||'',
          validado_por:rawObj.validado_por||'',
          data_validacao:rawObj.data_validacao||'',
          observacao_validacao:rawObj.observacao_validacao||''
        };
        out.push(obj);
        continue;
      }
    }

    const obj={};
    for(let j=0;j<hLen;j++)obj[cleanHeaders[j]]=row[j]??'';
    out.push(obj);
  }
  return out;
}
function parseWithQuoteSupport(t,customDelim=null){
  const s=String(t??'').replace(/^\ufeff/,'');
  if(!s.trim())return[];
  const delim=customDelim||detectCsvDelimiter(s);
  let o=[],r=[],c='',q=false;
  for(let i=0,len=s.length;i<len;i++){
    const x=s[i];
    if(q){
      if(x==='"'){if(s[i+1]==='"'){c+='"';i++}else q=false}else c+=x;
    }else if(x==='"'){
      q=true;
    }else if(x===delim){
      r.push(c);c='';
    }else if(x==='\n'){
      r.push(c.endsWith('\r')?c.slice(0,-1):c);o.push(r);r=[];c='';
    }else c+=x;
  }
  if(q)throw new CSVStorageError('ERRO_DE_PARSE','CSV inválido.','ParseError');
  if(c||r.length){r.push(c.endsWith('\r')?c.slice(0,-1):c);o.push(r)}
  while(o.length&&!o[0].some(x=>x!==''))o.shift();
  const rawHeader=o.shift()||[];
  const h=rawHeader.map(x=>String(x||'').replace(/^["'\s]+|["'\s]+$/g,'').trim());
  return buildRowsObjects(h,o);
}
function parse(t){
  const s=String(t??'').replace(/^\ufeff/,'');
  if(!s.trim())return[];
  return parseWithQuoteSupport(s);
}
const _headerKeyCache=new Map();
function normalizeHeaderKey(k){
  const strKey=String(k||'');
  if(_headerKeyCache.has(strKey))return _headerKeyCache.get(strKey);
  const norm=strKey.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/^_+|_+$/g,'');
  if(_headerKeyCache.size<256)_headerKeyCache.set(strKey,norm);
  return norm;
}
const OCC_FIELD_SYNONYMS={
  id_ocorrencia:['id_ocorrencia','id','codigo','cod','identificador','numero_id','num_id'],
  id_interno:['id_interno','uid','uuid','internal_id','identificador_unico'],
  numero_protocolo:['numero_protocolo','protocolo','n_protocolo','num_protocolo','protocol','ticket','n_do_protocolo'],
  data_ocorrencia:['data_ocorrencia','data','dt_ocorrencia','data_da_ocorrencia','date','data_evento','data_fato'],
  hora_ocorrencia:['hora_ocorrencia','hora','horario','hr_ocorrencia','hora_da_ocorrencia','time','horario_ocorrencia'],
  gerencia:['gerencia','gerência','gerencia_responsavel'],
  supervisao:['supervisao','supervisão','id_supervisao','nome_supervisao'],
  unidade:['unidade','id_unidade','nome_unidade','local_ocorrencia','setor','unidade_operacional','posto','posto_de_servico','localidade','filial','posto_servico','base'],
  area:['area','área','setor','departamento'],
  local_especifico:['local_especifico','local','local_específico','detalhe_local','ponto','local_do_fato','area_local'],
  natureza_ocorrencia:['natureza_ocorrencia','natureza','tipo','tipo_ocorrencia','tipo_de_ocorrencia','categoria','nature'],
  tipo_vinculo:['tipo_vinculo','vinculo','vínculo','tipo_do_vinculo'],
  nome_envolvido:['nome_envolvido','nome','envolvido','colaborador','autor_fato','nome_completo'],
  empresa_envolvido:['empresa_envolvido','empresa','prestadora','terceira','empresa_prestadora'],
  matricula_id:['matricula_id','matricula','matrícula','cracha','registro_funcional'],
  telefone:['telefone','contato','celular','tel','fone'],
  documento:['documento','cpf','rg','cnh','doc','documento_identificacao'],
  placa_veiculo:['placa_veiculo','placa','veiculo','veículo'],
  gerencia_envolvido:['gerencia_envolvido','gerencia_envolvidos'],
  gerencia_geral:['gerencia_geral'],
  diretoria:['diretoria'],
  relato_detalhado:['relato_detalhado','relato','descricao','descrição','descricao_do_fato','historico','detalhes','narrativa','fatos','ocorrencia','observacoes'],
  providencias_adotadas:['providencias_adotadas','providencias','providências','acoes','acoes_tomadas','medidas','providencias_iniciais'],
  prioridade:['prioridade','gravidade','urgencia','urgência','criticidade'],
  status:['status','situacao','situação','estado','status_ocorrencia'],
  anexos_referencias:['anexos_referencias','anexos','fotos','evidencias','imagens'],
  responsavel_registro:['responsavel_registro','operador_responsavel','responsavel','responsável','usuario','usuário','user_id','login','registrado_por','autor','operador','usuario_registro'],
  matricula_responsavel:['matricula_responsavel','responsavel_matricula','matricula_operador','id_operador'],
  perfil_registro:['perfil_registro','perfil','cargo'],
  data_registro:['data_registro','created_at','criado_em','data_criacao','timestamp','data_hora_registro'],
  versao_registro:['versao_registro','versao','versão'],
  usuario_ultima_alteracao:['usuario_ultima_alteracao','alterado_por','updated_by'],
  status_validacao:['status_validacao','validacao','status_da_validacao'],
  data_envio_validacao:['data_envio_validacao'],
  validado_por:['validado_por','aprovado_por'],
  data_validacao:['data_validacao','aprovado_em'],
  observacao_validacao:['observacao_validacao','parecer_validacao','observacao','observações']
};

const INVALID_RESPONSIBLE_VALUES=new Set([
  'baixa','média','media','alta','crítica','critica',
  'validada','pendente','rascunho','registrada','em apuração','encerrada','pendente de validação'
]);
function isInvalidResponsibleValue(val){
  if(!val)return true;
  return INVALID_RESPONSIBLE_VALUES.has(String(val).trim().toLowerCase());
}

function parseDateAndTimeToIso(rawDate, rawTime = '') {
  let datePart = '';
  let timePart = String(rawTime || '').trim();
  const dStr = String(rawDate || '').trim();

  if (dStr) {
    const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})([T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(dStr);
    if (isoMatch) {
      datePart = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
      if (!timePart && isoMatch[5] && isoMatch[6]) {
        timePart = `${isoMatch[5].padStart(2, '0')}:${isoMatch[6].padStart(2, '0')}`;
      }
    } else {
      const brMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})([T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(dStr);
      if (brMatch) {
        datePart = `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
        if (!timePart && brMatch[5] && brMatch[6]) {
          timePart = `${brMatch[5].padStart(2, '0')}:${brMatch[6].padStart(2, '0')}`;
        }
      } else {
        const dt = new Date(dStr);
        if (!isNaN(dt.getTime())) {
          datePart = dt.toISOString().slice(0, 10);
          if (!timePart) {
            timePart = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
          }
        }
      }
    }
  }

  if (!datePart) {
    datePart = new Date().toISOString().slice(0, 10);
  }
  if (!timePart || !/^\d{1,2}:\d{2}/.test(timePart)) {
    timePart = new Date().toTimeString().slice(0, 5);
  } else if (/^\d{1,2}:\d{2}/.test(timePart)) {
    const [h, m] = timePart.split(':');
    timePart = `${h.padStart(2, '0')}:${m.slice(0, 2)}`;
  }

  return { date: datePart, time: timePart };
}

function normalizeOccurrenceRow(raw,index=0,existingList=[]){
  if(!raw||typeof raw!=='object')return null;
  if(raw._norm===true)return raw;

  // Higieniza registros legados com campos deslocados
  if(raw.arma_envolvida&&!raw.relato_detalhado){
    raw.relato_detalhado=raw.arma_envolvida;
  }
  if(raw.Camera_relacionada&&!raw.providencias_adotadas){
    raw.providencias_adotadas=raw.Camera_relacionada;
  }
  if(raw.operador_responsavel&&['baixa','média','media','alta','crítica','critica'].includes(String(raw.operador_responsavel).toLowerCase())&&!raw.prioridade){
    raw.prioridade=raw.operador_responsavel;
    delete raw.operador_responsavel;
  }
  if(raw.id_operador&&['validada','pendente','rascunho','registrada','em apuração','encerrada','pendente de validação'].includes(String(raw.id_operador).toLowerCase())&&!raw.status_validacao){
    raw.status_validacao=raw.id_operador;
    delete raw.id_operador;
  }
  if(raw.classificacao&&!raw.natureza_ocorrencia){
    raw.natureza_ocorrencia=raw.classificacao;
  }
  if(raw.descricao_ocorrencia&&!raw.relato_detalhado){
    raw.relato_detalhado=raw.descricao_ocorrencia;
  }
  if(raw.acao_imediata&&!raw.providencias_adotadas){
    raw.providencias_adotadas=raw.acao_imediata;
  }
  if(raw.setor&&!raw.unidade){
    raw.unidade=raw.setor;
  }
  if(raw.local_ocorrencia&&!raw.supervisao){
    raw.supervisao=raw.local_ocorrencia;
  }

  const isCanonicalSchema=('id_ocorrencia' in raw)&&('numero_protocolo' in raw)&&('relato_detalhado' in raw)&&!('arma_envolvida' in raw)&&!('local_ocorrencia' in raw);
  let normalizedKeys=null;
  function getNormalizedMap(){
    if(!normalizedKeys){
      normalizedKeys=new Map();
      for(const[k,v]of Object.entries(raw)){
        const cleanKey=normalizeHeaderKey(k);
        if(!normalizedKeys.has(cleanKey)){
          normalizedKeys.set(cleanKey,String(v??'').trim());
        }
      }
    }
    return normalizedKeys;
  }
  function getField(canonicalName){
    const direct=raw[canonicalName];
    if(direct!==undefined&&direct!==null){
      const s=typeof direct==='string'?direct.trim():String(direct).trim();
      if(s!==''){
        if(canonicalName==='responsavel_registro'||canonicalName==='matricula_responsavel'){
          if(!isInvalidResponsibleValue(s))return s;
        }else{
          return s;
        }
      }else if(isCanonicalSchema){
        return'';
      }
    }else if(isCanonicalSchema){
      return'';
    }
    const synonyms=OCC_FIELD_SYNONYMS[canonicalName];
    if(synonyms&&synonyms.length){
      const map=getNormalizedMap();
      for(const syn of synonyms){
        const val=map.get(syn);
        if(val!==undefined&&val!==''){
          if(canonicalName==='responsavel_registro'||canonicalName==='matricula_responsavel'){
            if(!isInvalidResponsibleValue(val))return val;
          }else{
            return val;
          }
        }
      }
    }
    return'';
  }
  const parsedDate=parseDateAndTimeToIso(
    getField('data_ocorrencia')||getField('data_registro'),
    getField('hora_ocorrencia')
  );
  let dataOcc=parsedDate.date;
  let horaOcc=parsedDate.time;
  let dataReg=getField('data_registro')||(new Date().toISOString());
  let idOcc=getField('id_ocorrencia');
  let idInt=getField('id_interno');
  let proto=getField('numero_protocolo');
  if(!idOcc){
    idOcc=String(index+1);
  }
  if(!idInt){
    idInt=uid();
  }
  if(!proto){
    const yr=new Date().getFullYear();
    proto=`OC-${yr}-${String(idOcc).padStart(6,'0')}`;
  }
  let statusVal=getField('status')||'';
  let statusValidacao=getField('status_validacao')||'';
  const valLower=String(statusValidacao).trim().toLowerCase();
  const stLower=String(statusVal).trim().toLowerCase();
  const perfilReg=String(getField('perfil_registro')||getField('perfil')||'').trim().toLowerCase();
  const validadoPor=String(getField('validado_por')||'').trim();
  const isOpPending=(perfilReg==='operador'&&!validadoPor&&valLower!=='validada');

  if(stLower==='pendente'||stLower==='pendente de validação'||valLower.includes('pendente')||isOpPending){
    statusVal='pendente';
    statusValidacao='Pendente de validação';
  }else if(valLower==='validada'||validadoPor||stLower==='validada'||stLower==='em apuração'||stLower==='em apuracao'||stLower==='encerrada'){
    statusValidacao='Validada';
    if(stLower==='em apuração'||stLower==='em apuracao'){
      statusVal='Em Apuração';
    }else if(stLower==='encerrada'||stLower==='concluída'||stLower==='concluida'){
      statusVal='Encerrada';
    }else if(stLower==='rascunho'){
      statusVal='Rascunho';
    }else{
      statusVal='Registrada';
    }
  }else{
    statusValidacao='Validada';
    statusVal='Registrada';
  }
  let unidade=getField('unidade');
  if(!unidade){
    const avail=(typeof units==='function'?units():[])||[];
    unidade=avail[0]||'Unidade Principal';
  }
  let supervisao=getField('supervisao');
  if(!supervisao&&typeof supervisionForUnit==='function'){
    const supObj=supervisionForUnit(unidade);
    if(supObj)supervisao=supObj.nome;
  }
  if(!supervisao)supervisao='GSP/SP';
  const userLogin=(typeof S!=='undefined'&&S.user?.login)||'Sistema';
  const userPerfil=(typeof S!=='undefined'&&S.user?.perfil)||'Administrador';

  let respVal=getField('responsavel_registro');
  if(isInvalidResponsibleValue(respVal))respVal='';
  if(!respVal){
    if(raw.usuario_registro&&!isInvalidResponsibleValue(raw.usuario_registro))respVal=String(raw.usuario_registro).trim();
    else if(raw.login&&!isInvalidResponsibleValue(raw.login))respVal=String(raw.login).trim();
    else if(raw.autor&&!isInvalidResponsibleValue(raw.autor))respVal=String(raw.autor).trim();
    else respVal=userLogin;
  }

  let matVal=getField('matricula_responsavel');
  if(isInvalidResponsibleValue(matVal))matVal='';
  const uFound=getOccurrenceResponsibleUser({responsavel_registro:respVal,matricula_responsavel:matVal});
  if(uFound&&uFound.login){
    matVal=String(uFound.login).trim();
  }else if(!matVal&&respVal){
    if(uFound)matVal=String(uFound.login||uFound.matricula||'').trim();
  }
  if((/^u\d+$/i.test(matVal)||/^ui$/i.test(matVal))&&uFound&&uFound.login){
    matVal=String(uFound.login).trim();
  }

  const resObj={
    id_ocorrencia:String(idOcc),
    id_interno:String(idInt),
    numero_protocolo:String(proto),
    data_ocorrencia:String(dataOcc),
    hora_ocorrencia:String(horaOcc),
    gerencia:getField('gerencia')||'GSP/SP',
    supervisao:String(supervisao),
    unidade:String(unidade),
    area:getField('area'),
    local_especifico:getField('local_especifico')||'Geral',
    natureza_ocorrencia:getField('natureza_ocorrencia')||'Geral',
    tipo_vinculo:getField('tipo_vinculo')||'Terceiro',
    nome_envolvido:getField('nome_envolvido'),
    empresa_envolvido:getField('empresa_envolvido'),
    matricula_id:getField('matricula_id'),
    telefone:getField('telefone'),
    documento:getField('documento'),
    placa_veiculo:getField('placa_veiculo'),
    gerencia_envolvido:getField('gerencia_envolvido'),
    gerencia_geral:getField('gerencia_geral'),
    diretoria:getField('diretoria'),
    relato_detalhado:getField('relato_detalhado')||'Registro de ocorrência.',
    providencias_adotadas:getField('providencias_adotadas'),
    prioridade:getField('prioridade')||'Média',
    status:String(statusVal),
    anexos_referencias:getField('anexos_referencias'),
    responsavel_registro:(uFound&&uFound.login)?uFound.login:respVal,
    responsavel:matVal?`${(uFound?.nome||respVal.replace(/\s*\([^)]+\)/g,'').trim())} (${matVal})`:(uFound?.nome||respVal),
    matricula_responsavel:matVal,
    responsavel_matricula:matVal,
    perfil_registro:getField('perfil_registro')||userPerfil,
    data_registro:String(dataReg),
    versao_registro:getField('versao_registro')||'1',
    usuario_ultima_alteracao:getField('usuario_ultima_alteracao')||userLogin,
    status_validacao:String(statusValidacao),
    data_envio_validacao:getField('data_envio_validacao')||(statusVal==='pendente'?dataReg:''),
    validado_por:getField('validado_por')||(statusVal==='validada'?userLogin:''),
    data_validacao:getField('data_validacao')||(statusVal==='validada'?dataReg:''),
    observacao_validacao:getField('observacao_validacao')
  };
  Object.defineProperty(resObj,'_norm',{value:true,enumerable:false,configurable:true});
  return resObj;
}
let _userLookupRef=null,_userLookupMap=null;
function getUserLookupMap(){
  const list=S.users||[];
  if(_userLookupRef===list&&_userLookupMap)return _userLookupMap;
  const map=new Map();
  for(let i=0,len=list.length;i<len;i++){
    const u=list[i];
    if(!u)continue;
    const uLogin=String(u.login||'').trim().toLowerCase();
    const uNome=String(u.nome||'').trim().toLowerCase();
    const uId=String(u.id_usuario||'').trim().toLowerCase();
    const uMat=String(u.matricula||'').trim().toLowerCase();
    if(uLogin&&!map.has(uLogin))map.set(uLogin,u);
    if(uNome&&!map.has(uNome))map.set(uNome,u);
    if(uId&&!map.has(uId))map.set(uId,u);
    if(uMat&&!map.has(uMat))map.set(uMat,u);
  }
  _userLookupRef=list;
  _userLookupMap=map;
  return map;
}
function getOccurrenceResponsibleUser(x){
  if(!x)return null;
  let rawResp=String(x.responsavel_registro||x.responsavel||x.operador_responsavel||x.usuario_registro||'').trim();
  if(isInvalidResponsibleValue(rawResp))rawResp='';
  let rawMat=String(x.matricula_responsavel||x.responsavel_matricula||x.id_operador||x.id_usuario||'').trim();
  if(isInvalidResponsibleValue(rawMat))rawMat='';
  if(!rawResp&&!rawMat)return null;
  const map=getUserLookupMap();
  if(rawResp){
    const direct=map.get(rawResp.toLowerCase());
    if(direct)return direct;
    if(rawResp.includes('(')){
      const parenMatch=/\(([^)]+)\)/.exec(rawResp);
      const parenVal=parenMatch?parenMatch[1].trim().toLowerCase():'';
      const cleanName=rawResp.replace(/\s*\([^)]+\)/g,'').trim().toLowerCase();
      if(cleanName&&map.has(cleanName))return map.get(cleanName);
      if(parenVal&&map.has(parenVal))return map.get(parenVal);
    }
  }
  if(rawMat){
    const byMat=map.get(rawMat.toLowerCase());
    if(byMat)return byMat;
  }
  return null;
}
function getOccurrenceResponsibleMatricula(x){
  if(!x)return '';
  const user=getOccurrenceResponsibleUser(x);
  if(user&&user.login){
    return String(user.login).trim();
  }
  const directMat=String(x.matricula_responsavel||x.responsavel_matricula||x.id_operador||'').trim();
  if(directMat&&!isInvalidResponsibleValue(directMat)){
    if(/^u\d+$/i.test(directMat)||/^ui$/i.test(directMat)){
      const found=getOccurrenceResponsibleUser({id_usuario:directMat});
      if(found&&found.login)return String(found.login).trim();
    }
    return directMat;
  }
  const rawResp=String(x.responsavel_registro||x.responsavel||x.operador_responsavel||x.usuario_registro||'').trim();
  if(rawResp&&!isInvalidResponsibleValue(rawResp)){
    const match=/\(([^)]+)\)/.exec(rawResp);
    if(match&&match[1]&&!isInvalidResponsibleValue(match[1])){
      const inner=match[1].trim();
      if(/^u\d+$/i.test(inner)||/^ui$/i.test(inner)){
        const found=getOccurrenceResponsibleUser({id_usuario:inner});
        if(found&&found.login)return String(found.login).trim();
      }
      return inner;
    }
  }
  if(user){
    return String(user.login||user.matricula||user.id_usuario||'').trim();
  }
  return '';
}
function formatOccurrenceResponsible(x){
  if(!x)return 'Não informado';
  let rawResp=String(x.responsavel_registro||x.responsavel||x.operador_responsavel||x.usuario_registro||'').trim();
  if(isInvalidResponsibleValue(rawResp))rawResp='';
  const user=getOccurrenceResponsibleUser(x);
  const login=user?.login||getOccurrenceResponsibleMatricula(x);
  let cleanName=user?.nome||'';
  if(!cleanName&&rawResp){
    cleanName=rawResp.replace(/\s*\([^)]+\)/g,'').trim();
  }
  if(!cleanName)cleanName='Responsável';
  if(login){
    return `${cleanName} (${login})`;
  }
  return rawResp||cleanName||'Não informado';
}
function formatAmbientalResponsible(item){
  if(!item)return 'Não informado';
  let resp=String(item.responsavel||'').trim();
  const mat=String(item.matricula_responsavel||'').trim();
  const user=getOccurrenceResponsibleUser({responsavel:resp,responsavel_registro:item.usuario_registro,matricula_responsavel:mat});
  if(user&&user.login){
    const cleanName=(user.nome||resp.replace(/\s*\([^)]+\)/g,'')).trim()||'Responsável';
    return `${cleanName} (${user.login})`;
  }
  if(/\([uU][0-9iI]+\)/.test(resp)){
    const uMatch=/\(([uU][0-9iI]+)\)/.exec(resp);
    if(uMatch&&uMatch[1]){
      const found=getOccurrenceResponsibleUser({id_usuario:uMatch[1]});
      if(found&&found.login){
        return `${(found.nome||resp.replace(/\s*\([^)]+\)/g,'')).trim()} (${found.login})`;
      }
    }
  }
  return resp||'Não informado';
}
function isPendingOccurrence(item){
  if(!item||typeof item!=='object')return false;
  const stVal=String(item.status_validacao||'').trim().toLowerCase();
  const st=String(item.status||'').trim().toLowerCase();
  const validadoPor=String(item.validado_por||'').trim();
  const perfil=String(item.perfil_registro||item.perfil||'').trim().toLowerCase();

  if(stVal==='validada'||validadoPor)return false;
  if(stVal.includes('pendente')||st==='pendente'||st==='pendente de validação')return true;
  if(perfil==='operador'&&!validadoPor)return true;
  if(st==='em apuração'||st==='em apuracao'||st==='encerrada')return false;
  return false;
}
function isValidatedOccurrence(item){
  if(!item||typeof item!=='object')return false;
  return !isPendingOccurrence(item);
}
if(typeof window!=='undefined'){window.normalizeOccurrenceRow=normalizeOccurrenceRow;window.isPendingOccurrence=isPendingOccurrence;window.isValidatedOccurrence=isValidatedOccurrence;window.formatOccurrenceResponsible=formatOccurrenceResponsible;window.getOccurrenceResponsibleMatricula=getOccurrenceResponsibleMatricula}
async function hash(v){const b=new TextEncoder().encode(v),h=await crypto.subtle.digest('SHA-256',b);return[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
const DirectoryPersistence = {
  DB_NAME: 'SIGESP_DB',
  STORE_NAME: 'config',
  KEY_NAME: 'csvDirectoryHandle',
  LEGACY_STORE: 'CONFIG',
  LEGACY_KEY: 'rootFolder',

  openDatabase() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
        if (!db.objectStoreNames.contains(this.LEGACY_STORE)) {
          db.createObjectStore(this.LEGACY_STORE);
        }
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: 'key' });
          store.createIndex('by_file', 'fileName', { unique: false });
          store.createIndex('by_updated', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('sync_outbox')) {
          const store = db.createObjectStore('sync_outbox', { keyPath: 'id' });
          store.createIndex('by_status', 'status', { unique: false });
          store.createIndex('by_created', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('sync_metadata')) {
          db.createObjectStore('sync_metadata', { keyPath: 'fileName' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('O armazenamento local IndexedDB está ocupado por outra sessão.'));
    });
  },

  async saveDirectoryHandle(handle) {
    if (!handle) return;
    const db = await this.openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const activeStores = [this.STORE_NAME, this.LEGACY_STORE].filter(s => db.objectStoreNames.contains(s));
        const tx = db.transaction(activeStores, 'readwrite');
        if (db.objectStoreNames.contains(this.STORE_NAME)) {
          tx.objectStore(this.STORE_NAME).put(handle, this.KEY_NAME);
        }
        if (db.objectStoreNames.contains(this.LEGACY_STORE)) {
          tx.objectStore(this.LEGACY_STORE).put(handle, this.LEGACY_KEY);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      console.log(`[DirectoryPersistence] Referência da pasta "${handle.name}" salva com sucesso no IndexedDB.`);
    } finally {
      db.close();
    }
  },

  async getDirectoryHandle() {
    const db = await this.openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const activeStores = [this.STORE_NAME, this.LEGACY_STORE].filter(s => db.objectStoreNames.contains(s));
        if (!activeStores.length) return resolve(null);
        const tx = db.transaction(activeStores, 'readonly');
        let handle = null;

        const checkStore = (sName, kName) => {
          return new Promise(res => {
            if (!db.objectStoreNames.contains(sName)) return res(null);
            try {
              const req = tx.objectStore(sName).get(kName);
              req.onsuccess = () => res(req.result || null);
              req.onerror = () => res(null);
            } catch {
              res(null);
            }
          });
        };

        (async () => {
          handle = await checkStore(this.STORE_NAME, this.KEY_NAME);
          if (!handle) {
            handle = await checkStore(this.LEGACY_STORE, this.LEGACY_KEY);
          }
          resolve(handle || null);
        })().catch(reject);
      });
    } finally {
      db.close();
    }
  },

  async clearDirectoryHandle() {
    const db = await this.openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const activeStores = [this.STORE_NAME, this.LEGACY_STORE].filter(s => db.objectStoreNames.contains(s));
        if (!activeStores.length) return resolve();
        const tx = db.transaction(activeStores, 'readwrite');
        if (db.objectStoreNames.contains(this.STORE_NAME)) {
          tx.objectStore(this.STORE_NAME).delete(this.KEY_NAME);
        }
        if (db.objectStoreNames.contains(this.LEGACY_STORE)) {
          tx.objectStore(this.LEGACY_STORE).delete(this.LEGACY_KEY);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      console.log('[DirectoryPersistence] Referência da pasta removida com sucesso do IndexedDB.');
    } finally {
      db.close();
    }
  }
};
function openDB(){return DirectoryPersistence.openDatabase()}
async function dbPut(v){return await DirectoryPersistence.saveDirectoryHandle(v)}
async function dbGet(){return await DirectoryPersistence.getDirectoryHandle()}
async function dbDelete(){return await DirectoryPersistence.clearDirectoryHandle()}
if(typeof window!=='undefined'){window.DirectoryPersistence=DirectoryPersistence}
const rights=()=>getRightsForUser(S.user);
const _normNameCache=new Map(),_aliasCache=new Map();
let _unitLookupMap=new Map(),_supervisionLookupMap=new Map(),_orgCatalogVersion=0,_viewCacheVersion=0;
function normalizedMasterName(value){const raw=String(value??'');let cached=_normNameCache.get(raw);if(cached!==undefined)return cached;cached=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();if(_normNameCache.size>25000)_normNameCache.clear();_normNameCache.set(raw,cached);return cached}
function activeMaster(record){return record?.ativo!=='0'&&String(record?.ativo||'ATIVO').toUpperCase()!=='INATIVO'}
function aliasesOf(record){const raw=record?.aliases||'[]';if(raw==='[]'||!raw)return[];let cached=_aliasCache.get(raw);if(cached)return cached;try{const values=JSON.parse(raw);cached=Array.isArray(values)?values.map(String):[];if(_aliasCache.size>5000)_aliasCache.clear();_aliasCache.set(raw,cached);return cached}catch(error){console.warn('Aliases inválidos em cadastro mestre.',record?.id,error);return[]}}
function organizationUnits(rows){return rows.filter(row=>row.tipo==='UNIDADE').map(row=>({id_unidade:row.id,nome:row.nome,id_supervisao:row.supervisao_id,ativo:row.ativo,aliases:row.aliases}))}
function organizationSupervisions(rows){return rows.filter(row=>row.tipo==='SUPERVISAO').map(row=>({id_supervisao:row.id,nome:row.nome,ativo:row.ativo}))}
function organizationRows(supervisions,unitCatalog){return [...supervisions.map(item=>({tipo:'SUPERVISAO',id:item.id_supervisao,nome:item.nome,supervisao_id:'',ativo:item.ativo||'1',aliases:''})),...unitCatalog.map(item=>({tipo:'UNIDADE',id:item.id_unidade,nome:item.nome,supervisao_id:item.id_supervisao,ativo:item.ativo||'1',aliases:item.aliases||'[]'}))]}
function rebuildOrganizationIndexes(){
_unitLookupMap=new Map();_supervisionLookupMap=new Map();
for(const sup of S.supervisions)_supervisionLookupMap.set(sup.id_supervisao,sup);
for(const unit of S.unitCatalog){
const key=normalizedMasterName(unit.nome);
if(key&&!_unitLookupMap.has(key))_unitLookupMap.set(key,unit);
for(const alias of aliasesOf(unit)){const aKey=normalizedMasterName(alias);if(aKey&&!_unitLookupMap.has(aKey))_unitLookupMap.set(aKey,unit)}
}
_orgCatalogVersion++;_viewCacheVersion++
}
function resolveUnitByRef(value){const trimmed=String(value||'').trim();if(!trimmed)return null;const byId=S.unitCatalog.find(u=>u.id_unidade===trimmed);if(byId)return byId;return _unitLookupMap.get(normalizedMasterName(trimmed))||null}
function effectiveSupervisionId(user){if(user?.supervisao_id&&_supervisionLookupMap.has(user.supervisao_id))return user.supervisao_id;if(user?.supervisao_id&&S.supervisions.some(item=>item.id_supervisao===user.supervisao_id))return user.supervisao_id;const values=String(user?.unidades_permitidas||'').split('|').map(value=>value.trim()).filter(Boolean),ids=values.map(value=>resolveUnitByRef(value)?.id_supervisao).filter(Boolean),distinct=[...new Set(ids)];return distinct.length===1?distinct[0]:''}
function assignedUnitIds(user){const values=String(user?.unidades_permitidas||'').split('|').map(value=>value.trim()).filter(Boolean);return [...new Set(values.map(value=>resolveUnitByRef(value)?.id_unidade).filter(Boolean))]}
function authorizedUnitRecords(user=S.user,includeInactive=false){if(!user)return[];const supervisionId=effectiveSupervisionId(user),valid=S.unitCatalog.filter(unit=>unit.id_supervisao&&S.supervisions.some(supervision=>supervision.id_supervisao===unit.id_supervisao&&(includeInactive||activeMaster(supervision))));let rows;if(hasProfile(user,'Administrador'))rows=valid;else if(!supervisionId)return[];else if(hasProfile(user,'Supervisor'))rows=valid.filter(unit=>unit.id_supervisao===supervisionId);else{const allowed=new Set(assignedUnitIds(user));rows=valid.filter(unit=>unit.id_supervisao===supervisionId&&allowed.has(unit.id_unidade))}return rows.filter(unit=>includeInactive||activeMaster(unit))}
function authorizedUnitNames(user=S.user){return [...new Set(authorizedUnitRecords(user).map(unit=>unit.nome))]}
function authorizedHistoricalNames(user=S.user){return authorizedUnitRecords(user,true).flatMap(unit=>[unit.nome,...aliasesOf(unit)])}
let _scopeMemo={rowsRef:null,userKey:'',orgVer:-1,result:[]};
function userAccessCacheKey(user=S.user){if(!user)return'anon';return `${user.id_usuario||''}:${user.perfil||''}:${user.supervisao_id||''}:${user.unidades_permitidas||''}:${_orgCatalogVersion}`}
const units=()=>authorizedUnitNames(),scope=(rows,user=S.user)=>{
  if(!rows||!rows.length)return rows||[];
  if(hasProfile(user,'Administrador'))return rows;
  const uKey=userAccessCacheKey(user);
  if(_scopeMemo.rowsRef===rows&&_scopeMemo.userKey===uKey&&_scopeMemo.orgVer===_orgCatalogVersion)return _scopeMemo.result;
  const unitDecision=new Map(),filtered=rows.filter(row=>{
    if(row.id_ocorrencia||row.numero_protocolo){
      return canViewOccurrence(row,user);
    }
    const uName=row.unidade||'';
    let ok=unitDecision.get(uName);
    if(ok===undefined){
      ok=canAccessUnit(uName,user);
      unitDecision.set(uName,ok);
    }
    return ok;
  });
  if(user===S.user)_scopeMemo={rowsRef:rows,userKey:uKey,orgVer:_orgCatalogVersion,result:filtered};
  return filtered;
};
const DATA_FOLDER='dados';
async function fetchServerStorage(relPath,method='GET',body=null,extraParams={}){
  let cleanPath=String(relPath||'');
  const params={...extraParams};
  if(cleanPath.includes('?')){const[p,q]=cleanPath.split('?');cleanPath=p;new URLSearchParams(q).forEach((v,k)=>{if(!(k in params))params[k]=v})}
  if(cleanPath.includes('&create=1')){cleanPath=cleanPath.replace('&create=1','');params.create='1'}
  const now=Date.now();
  const search=new URLSearchParams();
  search.set('path',cleanPath);
  for(const[k,v]of Object.entries(params)){if(v!==undefined&&v!==null&&k!=='expectedMtime'&&k!=='releasedProtocol'&&k!=='signal')search.set(k,String(v))}
  search.set('_t',String(now));
  const queryStr=search.toString();
  const targetUrl=`/api/storage/file?${queryStr}`;
  const opts={method,headers:{}};
  if(params.signal)opts.signal=params.signal;
  if(body){
    opts.body=body;
    if(body instanceof Blob)opts.headers['Content-Type']=body.type||'application/octet-stream';
  }
  if(params.releasedProtocol)opts.headers['X-Released-Protocol']=String(params.releasedProtocol);
  if(params.expectedMtime!==undefined&&params.expectedMtime!==null&&Number(params.expectedMtime)>0){
    opts.headers['X-Expected-Mtime']=String(params.expectedMtime);
  }
  try{
    const res=await fetch(targetUrl,opts);
    if(res.ok||res.status===404||res.status===409)return res;
    return await fetch(targetUrl,opts);
  }catch(err){
    return await fetch(targetUrl,opts);
  }
}
class ServerFileHandle{constructor(name,relPath,initialSize=null,initialMtime=null){this.kind='file';this.name=name;this.relPath=relPath;this.initialSize=initialSize;this.initialMtime=initialMtime}async getFile(){const res=await fetchServerStorage(this.relPath,'GET');if(res.status===404){if(this.initialSize===0)return new Blob([],{type:'text/csv; charset=utf-8'});const err=new Error(`Arquivo não encontrado: ${this.relPath}`);err.name='NotFoundError';throw classifyCsvError(err,this.relPath,'read')}if(!res.ok)throw classifyCsvError(new Error(`Falha ao ler arquivo (${res.status}): ${this.relPath}`),this.relPath,'read');return await res.blob()}async createWritable(){const relPath=this.relPath,chunks=[];return{async write(data){chunks.push(data)},async close(){const mime=(chunks[0] instanceof Blob && chunks[0].type)?chunks[0].type:(/\.(jpe?g)$/i.test(relPath)?'image/jpeg':/\.(png)$/i.test(relPath)?'image/png':/\.(webp)$/i.test(relPath)?'image/webp':/\.(pdf)$/i.test(relPath)?'application/pdf':'text/csv; charset=utf-8');const blob=new Blob(chunks,{type:mime});const res=await fetchServerStorage(relPath,'PUT',blob);if(!res.ok)throw classifyCsvError(new Error(`Falha ao gravar arquivo (${res.status}): ${relPath}`),relPath,'write');const info=await res.json().catch(()=>null);if(info&&typeof info.size==='number'&&info.size!==blob.size)throw classifyCsvError(new Error(`Verificação de escrita falhou para ${relPath}`),relPath,'write')},async abort(){chunks.length=0}}}}
class ServerDirectoryHandle{constructor(name=DATA_FOLDER,relPath=''){this.kind='directory';this.name=name;this.relPath=relPath;this.folderName=DATA_FOLDER;this.isServer=true}async queryPermission(){return'granted'}async requestPermission(){return'granted'}async getFileHandle(fileName,options={}){const childPath=this.relPath?`${this.relPath}/${fileName}`:fileName,isCreate=Boolean(options?.create);const res=await fetchServerStorage(childPath,'HEAD',null,isCreate?{create:'1'}:{});if(res.status===404){if(isCreate)return new ServerFileHandle(fileName,childPath,0,Date.now());const err=new Error(`Arquivo não encontrado: ${childPath}`);err.name='NotFoundError';throw err}if(!res.ok)throw classifyCsvError(new Error(`Falha ao acessar arquivo (${res.status}): ${childPath}`),childPath,'head');const sizeHeader=res.headers.get('X-File-Size')??res.headers.get('Content-Length'),mtimeHeader=res.headers.get('X-File-Mtime');return new ServerFileHandle(fileName,childPath,sizeHeader!==null?Number(sizeHeader):null,mtimeHeader!==null?Number(mtimeHeader):null)}async getDirectoryHandle(dirName,options={}){const childPath=this.relPath?`${this.relPath}/${dirName}`:dirName;if(options?.create){const enc=encodeURIComponent(childPath);try{const res=await fetch(`/api/storage/mkdir?path=${enc}`,{method:'POST'});if(!res.ok&&res.status!==404)console.warn('Aviso ao criar diretório:',childPath,res.status)}catch(e){console.warn('Aviso de rede ao criar diretório:',childPath,e)}}return new ServerDirectoryHandle(dirName,childPath)}async removeEntry(entryName){const childPath=this.relPath?`${this.relPath}/${entryName}`:entryName;const res=await fetchServerStorage(childPath,'DELETE');if(!res.ok&&res.status!==404)throw classifyCsvError(new Error(`Falha ao remover arquivo (${res.status}): ${childPath}`),childPath,'delete')}}
const CSV_ID_FIELDS={'usuarios.csv':'id_usuario','ocorrencias.csv':'id_ocorrencia','chaves.csv':'id_chave','movimentacao_chaves.csv':'id_movimento','historico_sistema.csv':'id_auditoria','inspecao_fumaca_preta.csv':'id','naturezas_ocorrencias.csv':'id_natureza','supervisoes_unidades.csv':'id'};
const _freshCsvMeta=new Map();
if(typeof window!=='undefined'){
  window.syncFreshCsvMeta=function(fileName,mtimeMs,size){
    if(mtimeMs>0)_freshCsvMeta.set(fileName,{mtimeMs:Number(mtimeMs),size:Number(size||0)});
  };
}
function parseAndConsolidateCsv(rawText){
  const parsed=parse(rawText);
  return (typeof window!=='undefined'&&window.StorageService?.consolidateVersionedRows)
    ? window.StorageService.consolidateVersionedRows(parsed)
    : parsed;
}
async function fetchFreshRawCsv(fileName,options={}){
  if(fileName==='ocorrencias.csv'&&typeof window!=='undefined'&&window.StorageService?.fetchFreshOccurrencesCsv){
    return await window.StorageService.fetchFreshOccurrencesCsv(options,_freshCsvMeta);
  }
  const nocache=Date.now();
  const prevMeta=_freshCsvMeta.get(fileName);

  // Se conectado a uma pasta local nativa (não-servidor), SEMPRE leia estritamente do disco local
  if(S.dir&&!S.dir.isServer&&typeof S.dir.getFileHandle==='function'){
    try{
      const fh=await S.dir.getFileHandle(fileName,{create:false});
      const f=await fh.getFile();
      const lastMod=Number(f.lastModified||0);
      const fSize=Number(f.size||0);
      if(options?.onlyIfChanged&&prevMeta&&lastMod>0&&lastMod===prevMeta.mtimeMs&&fSize===prevMeta.size){
        return null;
      }
      let rawCipher=await f.text();
      const rawSig=`${rawCipher.length}:${rawCipher.slice(0,48)}:${rawCipher.slice(-48)}`;
      if(prevMeta&&prevMeta.rawSig===rawSig&&options?.onlyIfChanged){
        prevMeta.mtimeMs=lastMod||prevMeta.mtimeMs;
        prevMeta.size=fSize||rawCipher.length;
        return null;
      }
      let text=rawCipher;
      if(window.CryptoService&&window.CryptoService.isEncryptedFile(text)){
        try{
          text=await window.CryptoService.decrypt(text);
        }catch(decErr){
          console.error(`[fetchFreshRawCsv] Falha ao descriptografar ${fileName} (handle):`,decErr);
        }
      }
      _freshCsvMeta.set(fileName,{mtimeMs:lastMod||Date.now(),size:fSize||rawCipher.length,rawSig});
      return text;
    }catch(e){
      if(e?.name==='NotFoundError')return '';
      console.warn(`[fetchFreshRawCsv] Falha de leitura da pasta local para ${fileName}:`,e);
      return '';
    }
  }

  // Apenas consulta o endpoint do servidor se não houver pasta nativa conectada ou se for modo servidor
  try{
    const baseUrl=`/api/storage/file?path=${encodeURIComponent(fileName)}&nocache=${nocache}&_t=${nocache}`;
    const timeoutSignal = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
      ? AbortSignal.timeout(7000)
      : undefined;

    if(options?.onlyIfChanged&&prevMeta){
      const headRes=await fetch(baseUrl,{method:'HEAD',headers:{'Cache-Control':'no-cache'},signal:timeoutSignal});
      if(headRes.ok){
        const mtime=Number(headRes.headers.get('X-File-Mtime')||0);
        const size=Number(headRes.headers.get('X-File-Size')||headRes.headers.get('Content-Length')||0);
        if(mtime>0&&mtime===prevMeta.mtimeMs&&size===prevMeta.size){
          return null;
        }
      }else if(headRes.status===404){
        return '';
      }
    }
    const res=await fetch(baseUrl,{
      method:'GET',
      headers:{
        'Cache-Control':'no-cache, no-store, must-revalidate',
        'Pragma':'no-cache',
        'Expires':'0'
      },
      signal:timeoutSignal
    });
    if(res.ok){
      const mtime=Number(res.headers.get('X-File-Mtime')||Date.now());
      const size=Number(res.headers.get('X-File-Size')||res.headers.get('Content-Length')||0);
      let rawCipher=await res.text();
      const rawSig=`${rawCipher.length}:${rawCipher.slice(0,48)}:${rawCipher.slice(-48)}`;
      if(prevMeta&&prevMeta.rawSig===rawSig&&options?.onlyIfChanged){
        prevMeta.mtimeMs=mtime;
        prevMeta.size=size||rawCipher.length;
        return null;
      }
      let text=rawCipher;
      if(window.CryptoService&&window.CryptoService.isEncryptedFile(text)){
        try{
          text=await window.CryptoService.decrypt(text);
        }catch(decErr){
          console.error(`[fetchFreshRawCsv] Falha ao descriptografar ${fileName}:`,decErr);
        }
      }
      _freshCsvMeta.set(fileName,{mtimeMs:mtime,size:size||rawCipher.length,rawSig});
      return text;
    }
    if(res.status===404)return '';
  }catch(e){
    console.warn(`[fetchFreshRawCsv] Falha de leitura direta para ${fileName}:`,e);
  }
  return '';
}
async function writeFreshRawCsv(fileName,content){
  const rows=parseAndConsolidateCsv(content);
  const spec=HYBRID_CSVS?.find(x=>x[0]===fileName);
  const hdrs=spec?.[3]||(fileName==='ocorrencias.csv'?H.occ:null);
  if(window.StorageService?.writeEncryptedCsv){
    await window.StorageService.writeEncryptedCsv(fileName,rows,hdrs);
    _freshCsvMeta.delete(fileName);
    CSVService.buildEntry(fileName,rows,content);
    return true;
  }
  let payload=content;
  if(window.CryptoService&&!window.CryptoService.isEncryptedFile(payload)){
    try{
      payload=await window.CryptoService.encrypt(payload,{fileName});
    }catch(encErr){
      console.warn(`[writeFreshRawCsv] Falha ao cifrar ${fileName}:`,encErr);
    }
  }
  const blob=new Blob([payload],{type:'text/csv; charset=utf-8'});
  const nocache=Date.now();
  let written=false;
  try{
    const url=`/api/storage/file?path=${encodeURIComponent(fileName)}&nocache=${nocache}&_t=${nocache}`;
    const res=await fetch(url,{
      method:'PUT',
      headers:{
        'Content-Type':'text/csv; charset=utf-8',
        'Cache-Control':'no-cache, no-store, must-revalidate'
      },
      body:blob
    });
    if(res.ok)written=true;
  }catch(e){
    console.warn(`[writeFreshRawCsv] Falha de escrita direta para ${fileName}:`,e);
  }
  if(!written&&S.dir&&typeof S.dir.getFileHandle==='function'){
    const fh=await S.dir.getFileHandle(fileName,{create:true});
    const w=await fh.createWritable();
    await w.write(blob);
    await w.close();
    written=true;
  }
  _freshCsvMeta.delete(fileName);
  CSVService.setCachedText(fileName,content);
  return written;
}
const CSVService=(()=>{
const cache=new Map(),inFlight=new Map();
function buildEntry(fileName,rows,rawText=null){
const idField=CSV_ID_FIELDS[fileName]||null,byId=new Map();
if(idField){for(let i=0,len=rows.length;i<len;i++){const r=rows[i],id=r[idField];if(id!==undefined&&id!=='')byId.set(String(id),r)}}
const prev=cache.get(fileName),version=(prev?.version||0)+1;
const entry={rows,rawText,byId,idField,version,updatedAt:Date.now()};
cache.set(fileName,entry);
_viewCacheVersion++;
return entry
}
async function readFromDisk(fileName,options={}){
if(!S.dir)throw classifyCsvError(new Error('Pasta de dados indisponível.'),fileName,'read',options);
try{
if(window.StorageService){
const rows=await window.StorageService.readEncryptedCsv(fileName,options);
return buildEntry(fileName,rows).rows
}
if(S.dir.isServer&&!S.dir.relPath){
const res=await fetchServerStorage(fileName,'GET');
if(res.status===404){const err=new Error(`Arquivo não encontrado: ${fileName}`);err.name='NotFoundError';throw err}
if(!res.ok)throw new Error(`Falha ao ler arquivo (${res.status}): ${fileName}`);
const text=await res.text();
const rows=parse(text);
return buildEntry(fileName,rows,text).rows
}
const h=await S.dir.getFileHandle(fileName),f=await h.getFile(),text=await f.text(),rows=parse(text);
return buildEntry(fileName,rows,text).rows
}catch(err){
if(err?.name==='NotFoundError'||err?.code==='ARQUIVO_NAO_ENCONTRADO'||options?.optional)return[];
if(cache.has(fileName)){console.warn(`[CSVService] Usando cache para ${fileName} após falha de leitura:`,err?.message||err);return cache.get(fileName).rows}
throw classifyCsvError(err,fileName,'read',options)
}
}
async function writeToDisk(fileName,rows,headers){
if(!S.dir)throw classifyCsvError(new Error('Pasta de dados indisponível.'),fileName,'write');
try{
if(window.StorageService){
const cloned=await window.StorageService.writeEncryptedCsv(fileName,rows,headers);
buildEntry(fileName,cloned);
return cloned
}
const serialized=csv(rows,headers);
if(S.dir.isServer&&!S.dir.relPath){
const blob=new Blob([serialized],{type:'text/csv;charset=utf-8'});const res=await fetchServerStorage(fileName,'PUT',blob);
if(!res.ok)throw new Error(`Falha ao gravar arquivo (${res.status}): ${fileName}`);
const info=await res.json().catch(()=>null);
if(info&&typeof info.size==='number'&&info.size!==blob.size)throw new Error(`Tamanho confirmado divergente para ${fileName}.`);
}else{
const f=await S.dir.getFileHandle(fileName,{create:true}),w=await f.createWritable();
try{await w.write(serialized);await w.close()}catch(x){try{await w.abort()}catch(abortError){console.warn('Falha ao abortar a gravação temporária do CSV.',abortError)}throw x}
}
const cloned=rows.map(r=>({...r}));
buildEntry(fileName,cloned,serialized);
return cloned
}catch(err){
cache.delete(fileName);
_viewCacheVersion++;
throw classifyCsvError(err,fileName,'write')
}
}
return{
cache,
buildEntry,
getVersion(fileName){return fileName?(cache.get(fileName)?.version||0):_viewCacheVersion},
hasValidCache(fileName){return cache.has(fileName)},
async read(fileName,options={}){
if(!options?.force&&cache.has(fileName))return cache.get(fileName).rows;
if(!options?.force&&inFlight.has(fileName))return await inFlight.get(fileName);
const p=readFromDisk(fileName,options).finally(()=>inFlight.delete(fileName));
inFlight.set(fileName,p);
return await p
},
async readAll(fileNames,options={}){return await Promise.all(fileNames.map(name=>this.read(name,options)))},
async find(fileName,predicate){const rows=await this.read(fileName);return rows.find(predicate)||null},
async findById(fileName,id,idField=CSV_ID_FIELDS[fileName]){
const normId=String(id??'').trim();
if(!normId)return null;
let rows=await this.read(fileName);
let entry=cache.get(fileName);
let found=(entry?.byId&&idField===entry.idField)?entry.byId.get(normId):null;
if(!found){
found=rows.find(r=>(idField&&String(r[idField]??'').trim()===normId)||String(r.id_ocorrencia??'').trim()===normId||String(r.numero_protocolo??'').trim()===normId||String(r.id_chave??'').trim()===normId||String(r.id_usuario??'').trim()===normId||String(r.id??'').trim()===normId);
}
if(!found){
rows=await this.read(fileName,{force:true});
entry=cache.get(fileName);
found=(entry?.byId&&idField===entry.idField)?entry.byId.get(normId):null;
if(!found){
found=rows.find(r=>(idField&&String(r[idField]??'').trim()===normId)||String(r.id_ocorrencia??'').trim()===normId||String(r.numero_protocolo??'').trim()===normId||String(r.id_chave??'').trim()===normId||String(r.id_usuario??'').trim()===normId||String(r.id??'').trim()===normId);
}
}
return found||null;
},
async filter(fileName,predicate){const rows=await this.read(fileName);return rows.filter(predicate)},
async save(fileName,rows,headers){return await writeToDisk(fileName,rows,headers)},
async insert(fileName,record,headers){
  if(window.StorageService?.appendRecord){
    const saved=await window.StorageService.appendRecord(fileName,record,headers,{isNewRecord:true});
    const current=cache.get(fileName)?.rows||[];
    buildEntry(fileName,[...current,saved]);
    return saved;
  }
  return await this.append(fileName,record,headers);
},
async append(fileName,record,headers){
  if(window.StorageService?.appendRecord){
    const saved=await window.StorageService.appendRecord(fileName,record,headers,{isNewRecord:true});
    const current=cache.get(fileName)?.rows||[];
    buildEntry(fileName,[...current,saved]);
    return saved;
  }
  const current=await this.read(fileName,{force:true}),next=[...current,record];
  await this.save(fileName,next,headers);
  return record;
},
async update(fileName,id,updater,headers,idField=CSV_ID_FIELDS[fileName]){const current=await this.read(fileName);let updated=null;const next=current.map(r=>{if(String(r[idField])!==String(id))return r;updated=typeof updater==='function'?updater(r):{...r,...updater};return updated});if(!updated)throw classifyCsvError(new Error(`Registro ${id} não encontrado em ${fileName}.`),fileName,'write');await this.save(fileName,next,headers);return updated},
async delete(fileName,id,headers,idField=CSV_ID_FIELDS[fileName]){const current=await this.read(fileName),next=current.filter(r=>String(r[idField])!==String(id));await this.save(fileName,next,headers);return next},
async reload(fileName){if(fileName){this.invalidateCache(fileName);return await this.read(fileName,{force:true})}this.invalidateCache();return await load(true)},
invalidateCache(fileName){if(fileName){cache.delete(fileName);_freshCsvMeta.delete(fileName);window.StorageService?.invalidateCache?.(fileName)}else{cache.clear();_freshCsvMeta.clear();window.StorageService?.invalidateCache?.()}_viewCacheVersion++},
setCachedText(fileName,text){const rows=parseAndConsolidateCsv(text);return buildEntry(fileName,rows,text).rows}
}
})();
async function read(n,options={}){return await CSVService.read(n,options)}
async function write(n,d,h){return await CSVService.save(n,d,h)}
async function ensure(n,h){
if(window.StorageService){await window.StorageService.ensureFile(n,h);return}
const f=await S.dir.getFileHandle(n,{create:true});const isEmpty=f.initialSize!==null&&f.initialSize!==undefined?f.initialSize===0:(await f.getFile()).size===0;if(isEmpty){await write(n,[],h)}
}
async function fileExists(name){if(CSVService.hasValidCache(name))return true;try{await S.dir.getFileHandle(name);return true}catch(error){if(error?.name==='NotFoundError')return false;throw error}}
async function initializeOrganizationCatalog(){await withWriteLock('organization',async()=>{const existed=await fileExists('supervisoes_unidades.csv');let legacy=[];if(!existed){const[supervisions,units]=await Promise.all([read('supervisoes.csv'),read('unidades.csv')]);legacy=organizationRows(supervisions,units)}await ensure('supervisoes_unidades.csv',H.org);if(!existed&&legacy.length)await write('supervisoes_unidades.csv',legacy,H.org);const existedNature=await fileExists('naturezas_ocorrencias.csv');await ensure('naturezas_ocorrencias.csv',H.nature);if(!existedNature){const currentNatures=await read('naturezas_ocorrencias.csv');if(!currentNatures.length){await write('naturezas_ocorrencias.csv',[{id_natureza:uid(),nome:'Portaria',ativo:'1',aliases:'[]'},{id_natureza:uid(),nome:'Segurança Patrimonial',ativo:'1',aliases:'[]'},{id_natureza:uid(),nome:'Controle de Acesso',ativo:'1',aliases:'[]'}],H.nature)}}})}
function normalizedUsers(rows){return rows.map(user=>({...user,perfil:canonicalPerfil(user.perfil),supervisao_id:effectiveSupervisionId(user)}))}
function setOrganizationContext(rows){S.supervisions=organizationSupervisions(rows);S.unitCatalog=organizationUnits(rows);rebuildOrganizationIndexes()}
let _lastAccessCtxSig='';
async function refreshAccessContext(){if(!S.user?.id_usuario)throw new DataScopeError('A sessão não possui um usuário válido.');const hasCached=CSVService.hasValidCache('usuarios.csv')&&CSVService.hasValidCache('supervisoes_unidades.csv')&&CSVService.hasValidCache('naturezas_ocorrencias.csv');const sig=hasCached?`${CSVService.getVersion('usuarios.csv')}:${CSVService.getVersion('supervisoes_unidades.csv')}:${CSVService.getVersion('naturezas_ocorrencias.csv')}`:'';if(sig&&sig===_lastAccessCtxSig&&S.users?.length&&S.supervisions?.length){const current=S.users.find(user=>user.id_usuario===S.user.id_usuario);if(!current||current.status!=='Ativo')throw new DataScopeError('A sessão expirou ou o usuário está inativo.');S.user=current;return S.user}const[users,organization,natures]=await Promise.all([read('usuarios.csv'),read('supervisoes_unidades.csv'),read('naturezas_ocorrencias.csv')]);setOrganizationContext(organization);S.natureCatalog=natures;S.users=normalizedUsers(users);_lastAccessCtxSig=`${CSVService.getVersion('usuarios.csv')}:${CSVService.getVersion('supervisoes_unidades.csv')}:${CSVService.getVersion('naturezas_ocorrencias.csv')}`;const current=S.users.find(user=>user.id_usuario===S.user.id_usuario);if(!current||current.status!=='Ativo')throw new DataScopeError('A sessão expirou ou o usuário está inativo.');S.user=current;return S.user}
function unitForName(unitName){const key=normalizedMasterName(unitName);if(!key)return null;const indexed=_unitLookupMap.get(key);if(indexed)return indexed;return S.unitCatalog.find(item=>normalizedMasterName(item.nome)===key||aliasesOf(item).some(alias=>normalizedMasterName(alias)===key))||null}
function canAccessUnit(unitName,user=S.user){if(!user)return false;if(isAdministratorUser(user))return true;const unit=unitForName(unitName);if(!unit||!unit.id_supervisao||unit.id_supervisao!==effectiveSupervisionId(user))return false;if(!authorizedUnitRecords(user,true).some(item=>item.id_unidade===unit.id_unidade))return false;return hasProfile(user,'Supervisor')||assignedUnitIds(user).includes(unit.id_unidade)}
function assertUnitAccess(unitName,user=S.user){if(isAdministratorUser(user))return;if(!canAccessUnit(unitName,user))throw new DataScopeError('Seu cadastro não autoriza acesso aos dados desta unidade.')}
function supervisionForUnit(unitName){const unit=unitForName(unitName),supervision=unit&&(_supervisionLookupMap.get(unit.id_supervisao)||S.supervisions.find(item=>item.id_supervisao===unit.id_supervisao));return supervision||null}
function canViewOccurrence(occ,user=S.user){
if(!user||!occ)return false;
if(isAdministratorUser(user))return true;
if(hasProfile(user,'Supervisor')){
const unit=unitForName(occ.unidade);
const userSupId=effectiveSupervisionId(user);
if(unit&&unit.id_supervisao&&unit.id_supervisao===userSupId)return true;
if(occ.supervisao&&S.supervisions.some(s=>s.id_supervisao===userSupId&&(s.nome===occ.supervisao||s.id_supervisao===occ.supervisao)))return true;
if(user.supervisao&&occ.supervisao&&(user.supervisao===occ.supervisao||user.supervisao_id===occ.supervisao))return true;
return canAccessUnit(occ.unidade,user);
}
if(hasProfile(user,'Líder'))return canAccessUnit(occ.unidade,user);
if(hasProfile(user,'Operador')){
const isAuthor=occ.responsavel_registro&&String(occ.responsavel_registro).trim().toLowerCase()===String(user.login).trim().toLowerCase();
return isAuthor||canAccessUnit(occ.unidade,user);
}
if(hasProfile(user,'Consulta'))return canAccessUnit(occ.unidade,user);
return false;
}
async function searchOccurrenceInFiles(id,hintPending=false){
const normId=String(id??'').trim();
if(!normId)return null;
let found=(S.occ||[]).find(x=>String(x.id_ocorrencia||'').trim()===normId||String(x.id_interno||'').trim()===normId||String(x.numero_protocolo||'').trim()===normId);
if(found)return found;
try{
const rows=await CSVService.read('ocorrencias.csv',{force:true});
found=rows.find(x=>String(x.id_ocorrencia||'').trim()===normId||String(x.id_interno||'').trim()===normId||String(x.numero_protocolo||'').trim()===normId);
if(found)return found;
}catch(err){console.warn('[SIGESP] Busca em ocorrencias.csv falhou:',err?.message||err)}
return null;
}
async function findAuthorizedOccurrence(id,pending=false){
await refreshAccessContext().catch(()=>{});
const user=S.user;
if(!user)throw new DataScopeError('Sessão expirada ou usuário inválido.');
const occurrence=await searchOccurrenceInFiles(id,pending);
if(!occurrence)throw new DataScopeError('Registro não encontrado ou sem autorização para acessá-lo.');
if(isAdministratorUser(user)){
console.log('[PERMISSAO] Validação concluída:',{usuario:user.login,perfil:user.perfil,id_ocorrencia:occurrence.id_ocorrencia,protocolo:occurrence.numero_protocolo,unidade:occurrence.unidade,autor:occurrence.responsavel_registro,acesso:'ADMINISTRADOR_ACESSO_TOTAL'});
return occurrence;
}
if(!canViewOccurrence(occurrence,user)){
throw new DataScopeError('Registro não encontrado ou sem autorização para acessá-lo.');
}
console.log('[PERMISSAO] Validação concluída:',{usuario:user.login,perfil:user.perfil,id_ocorrencia:occurrence.id_ocorrencia,protocolo:occurrence.numero_protocolo,unidade:occurrence.unidade,autor:occurrence.responsavel_registro,acesso:'ACESSO_AUTORIZADO'});
return occurrence;
}
async function load(forceReload=false,skipRender=false){
  if(forceReload===true||forceReload?.type==='click')CSVService.invalidateCache();
  const[u,o,k,m,a,organization,natures,inspecoes,delRecs]=await Promise.all([
    read('usuarios.csv'),
    read('ocorrencias.csv'),
    read('chaves.csv'),
    read('movimentacao_chaves.csv'),
    read('historico_sistema.csv'),
    read('supervisoes_unidades.csv'),
    read('naturezas_ocorrencias.csv'),
    read(ENVIRONMENTAL_FILE),
    read('registros_apagados.csv').catch(()=>[])
  ]);
  let effOrg=organization;
  let effNatures=natures;
  if((!effOrg||!effOrg.length)||(!effNatures||!effNatures.length)){
    await initializeOrganizationCatalog();
    effOrg=await read('supervisoes_unidades.csv');
    effNatures=await read('naturezas_ocorrencias.csv');
  }
  setOrganizationContext(effOrg);
  S.users=normalizedUsers(u);
  S.natureCatalog=effNatures;
  const rawOccList=o||[];
  const consolidatedOcc=(rawOccList._consolidated||!window.StorageService?.consolidateVersionedRows)
    ? rawOccList
    : window.StorageService.consolidateVersionedRows(rawOccList);
  const normOcc=[];
  const totalOcc=consolidatedOcc.length;
  for(let idx=0;idx<totalOcc;idx++){
    const normItem=normalizeOccurrenceRow(consolidatedOcc[idx],idx,consolidatedOcc);
    if(normItem)normOcc.push(normItem);
    if((idx&4095)===4095){
      await new Promise(r=>setTimeout(r,0));
    }
  }
  S.occ=normOcc;
  S.pending=filteredPendingOccurrences();
  S.keys=k;
  S.moves=m;
  S.audits=a;
  S.inspecoes=inspecoes;
  S.deletedRecords=delRecs||[];
  if(S.user){
    const current=S.users.find(user=>user.id_usuario===S.user.id_usuario);
    if(!current||current.status!=='Ativo'){
      cleanup();
      S.user=null;
      S.message='Sua sessão foi encerrada porque o usuário está inativo ou foi removido.';
    }else{
      S.user=current;
    }
  }
  S.permissionNeeded=false;
  S.restoring=false;
  S.lastSyncTime=new Date();
  if(!skipRender)render();
  updateSyncIndicatorElement();
}
let _isConnectingFolder=false;
async function prepare(handle,options={}){
  if(window.SIGESP_PERF_TRACE&&console.time)console.time('[SIGESP:Perf] autorizacao e listagem da pasta');
  const isSameDir=S.dir&&(
    (S.dir===handle)||
    (S.dir.isServer&&handle?.isServer&&S.dir.name===handle?.name)
  );
  S.dir=handle;
  if(!isSameDir){
    CSVService.invalidateCache();
  }
  if(window.StorageService){
    await window.StorageService.initializeStorage(handle);
  }
  if(handle&&typeof handle.getDirectoryHandle==='function'){
    void handle.getDirectoryHandle('anexos',{create:true}).catch(()=>{});
  }
  if(window.SIGESP_PERF_TRACE&&console.timeEnd)console.timeEnd('[SIGESP:Perf] autorizacao e listagem da pasta');
  await load(false,Boolean(options?.skipRender));
  startBackgroundPolling();
}
async function connectDataFolder(silent=false){
  if(_isConnectingFolder)return;
  _isConnectingFolder=true;
  try{
    const h=new ServerDirectoryHandle(DATA_FOLDER,'');
    await prepare(h,{skipRender:!silent});
    if(!silent){
      S.message='Pasta dados sincronizada com sucesso.';
      render();
    }
  }finally{
    _isConnectingFolder=false;
  }
}
const connectServerFolder=connectDataFolder;
let _isFilePickerActive=false;
let _filePickerCooldownUntil=0;
let _filePickerSafetyTimer=null;
let _filePickerOpenedAt=0;
function markFilePickerOpening(){
  _isFilePickerActive=true;
  _filePickerOpenedAt=Date.now();
  _filePickerCooldownUntil=Date.now()+2500;
  if(_filePickerSafetyTimer)clearTimeout(_filePickerSafetyTimer);
  _filePickerSafetyTimer=setTimeout(()=>{
    _isFilePickerActive=false;
    _filePickerCooldownUntil=0;
  },2500);
}
function markFilePickerClosed(cooldownMs=1500){
  _isFilePickerActive=false;
  _filePickerCooldownUntil=Date.now()+cooldownMs;
  if(_filePickerSafetyTimer){
    clearTimeout(_filePickerSafetyTimer);
    _filePickerSafetyTimer=null;
  }
}
function isFilePickerBlockingSync(){
  return _isFilePickerActive||_isConnectingFolder||Date.now()<_filePickerCooldownUntil;
}
function triggerFallbackFolderInput(msg){
  if(msg)S.message=msg;
  let inp=document.getElementById('folderPickerInput')||document.getElementById('folderInputDirect');
  if(!inp){
    render();
    inp=document.getElementById('folderPickerInput')||document.getElementById('folderInputDirect');
  }
  if(inp){
    markFilePickerOpening();
    inp.click();
  }else if(msg){
    render();
  }
}
async function selectFolder(){if(denyOperatorAccess())return;S.folderModal=true;render()}
async function pickFolderWithPicker(ev){
  if(ev&&typeof ev.preventDefault==='function')ev.preventDefault();
  if(denyOperatorAccess())return;
  if(_isFilePickerActive||_isConnectingFolder)return;
  if(typeof window.showDirectoryPicker==='function'){
    markFilePickerOpening();
    try{
      // IMPORTANTE: showDirectoryPicker deve ser a PRIMEIRA chamada assíncrona no clique para preservar a Transient User Activation
      const handle=await window.showDirectoryPicker({mode:'readwrite'});
      markFilePickerClosed(2000);
      _isConnectingFolder=true;
      showLoading('Conectando e sincronizando pasta selecionada...',{kicker:'File System Access API',title:`Carregando dados da pasta "${handle.name}"...`,progress:25,overlayId:'pdfProgressOverlay'});
      try{
        void DirectoryPersistence.saveDirectoryHandle(handle).catch(()=>{});
        S.savedHandle=handle;
        S.permissionNeeded=false;
        S.folderModal=false;
        await prepare(handle,{skipRender:true});
        S.message=`Pasta "${handle.name}" conectada com sucesso.`;
      }finally{
        _isConnectingFolder=false;
        hideLoading();
      }
      render();
      return;
    }catch(err){
      _isConnectingFolder=false;
      hideLoading();
      markFilePickerClosed(800);
      if(err?.name==='AbortError')return;
      console.warn('showDirectoryPicker cancelado ou bloqueado:',err);
      if(err?.name==='SecurityError'||/cross.origin|iframe|sub frame|user gesture|activation/i.test(err?.message||'')){
        triggerFallbackFolderInput('O navegador restringe o seletor nativo no quadro incorporado. Selecione a pasta via arquivos ou use a pasta automática "dados".');
        return;
      }
      fail(err.message||'Não foi possível conectar à pasta selecionada.');
      return;
    }
  }
  triggerFallbackFolderInput('Seletor nativo indisponível neste navegador. Utilize a seleção de arquivos de pasta ou a pasta automática "dados".');
}
async function handleDirectoryInput(files){
  markFilePickerClosed(2000);
  const list=Array.from(files||[]);
  if(!list.length)return;
  const csvFiles=list.filter(f=>f.name&&f.name.toLowerCase().endsWith('.csv'));
  if(!csvFiles.length){
    fail('Nenhum arquivo .csv encontrado na pasta selecionada.');
    return;
  }
  showLoading('Conectando pasta selecionada...',{kicker:'Sincronização de dados',title:'Lendo arquivos da pasta...',progress:30,overlayId:'pdfProgressOverlay'});
  try{
    await new Promise(r=>setTimeout(r,0));
    // Leitura paralela rápida em memória sem re-criptografia destrutiva
    await Promise.all(csvFiles.map(async file=>{
      const cleanName=file.name.trim();
      const text=await file.text();
      const mtime=Number(file.lastModified||Date.now());
      const size=Number(file.size||text.length);
      const rawSig=`${text.length}:${text.slice(0,48)}:${text.slice(-48)}`;
      if(window.StorageService?._rawFileCache){
        window.StorageService._rawFileCache.set(cleanName,{
          rawSig,
          rawText:text,
          mtimeMs:mtime,
          size
        });
      }
      if(window.CryptoService?.isEncryptedFile(text)){
        void window.StorageService?.readEncryptedCsv(cleanName).catch(()=>{});
      }else{
        CSVService.setCachedText(cleanName,text);
      }
    }));
    updateLoadingProgress(85,'Carregando dados da pasta...');
    await load(false);
    hideLoading();
    S.folderModal=false;
    S.message=`Pasta com ${csvFiles.length} arquivos CSV conectada com sucesso.`;
    render();
  }catch(err){
    hideLoading();
    fail('Falha ao processar arquivos da pasta: '+(err.message||err));
  }
}
async function restoreFolder(){
  S.restoring=true;
  render();
  try{
    const saved=await DirectoryPersistence.getDirectoryHandle().catch(err=>{
      console.warn('[DirectoryPersistence] Erro ao recuperar directoryHandle:',err);
      return null;
    });

    if(saved&&typeof saved.queryPermission==='function'){
      // Cenário B (Existe handle salvo no IndexedDB):
      try{
        let perm=await saved.queryPermission({mode:'read'}).catch(()=>'prompt');
        if(perm==='granted'){
          const rwPerm=await saved.queryPermission({mode:'readwrite'}).catch(()=>'prompt');
          if(rwPerm!=='granted'){
            perm=rwPerm;
          }
        }

        if(perm==='granted'){
          // Validação física de existência do diretório
          try{
            for await(const _entry of saved.keys()){
              break;
            }
            console.log('[DirectoryPersistence] Permissão concedida. Lendo arquivos CSV automaticamente da pasta:',saved.name);
            await prepare(saved);
            return;
          }catch(fsErr){
            if(fsErr?.name==='NotFoundError'||/not found/i.test(fsErr?.message||'')){
              console.warn('[DirectoryPersistence] Pasta física não encontrada no disco:',fsErr);
              await DirectoryPersistence.clearDirectoryHandle();
              S.dir=null;
              S.savedHandle=null;
              S.permissionNeeded=false;
              S.restoring=false;
              S.message='A pasta previamente selecionada não foi encontrada no computador. Por favor, selecione-a novamente.';
              render();
              return;
            }
            throw fsErr;
          }
        }

        // Se retornar 'prompt' ou 'denied': Altere a interface para o modo de Reconexão Rápida (sem abrir o seletor nativo)
        console.log('[DirectoryPersistence] Handle salvo requer autorização do usuário ('+perm+'). Exibindo Reconexão Rápida.');
        S.dir=saved;
        S.savedHandle=saved;
        S.permissionNeeded=true;
        S.restoring=false;
        render();
        return;
      }catch(permErr){
        console.warn('[DirectoryPersistence] Falha ao consultar status de permissão:',permErr);
      }
    }
  }catch(err){
    console.warn('[DirectoryPersistence] Falha ao consultar IndexedDB na inicialização:',err);
  }

  // Conexão direta e automática ao abrir o index (pasta dados do servidor):
  try{
    console.log('[SIGESP] Conectando automaticamente à pasta de dados do servidor...');
    await connectDataFolder(true);
    return;
  }catch(autoErr){
    console.warn('[SIGESP] Falha ao conectar automaticamente à pasta do servidor:',autoErr);
  }

  S.dir=null;
  S.savedHandle=null;
  S.permissionNeeded=false;
  S.restoring=false;
  render();
}
async function authorizeSaved(){
  if(denyOperatorAccess())return;
  if(_isConnectingFolder)return;
  const handle=S.savedHandle||S.dir;
  if(!handle){
    S.permissionNeeded=false;
    render();
    return;
  }
  try{
    let p='denied';
    if(typeof handle.requestPermission==='function'){
      p=await handle.requestPermission({mode:'readwrite'}).catch(()=>'denied');
      if(p!=='granted'){
        p=await handle.requestPermission({mode:'read'}).catch(()=>'denied');
      }
    }
    if(p==='granted'){
      _isConnectingFolder=true;
      S.permissionNeeded=false;
      S.restoring=true;
      render();
      try{
        await new Promise(r=>setTimeout(r,0));
        for await(const _entry of handle.keys()){
          break;
        }
        await prepare(handle);
        return;
      }catch(fsErr){
        if(fsErr?.name==='NotFoundError'||/not found/i.test(fsErr?.message||'')){
          console.warn('[DirectoryPersistence] Pasta física não encontrada após permissão:',fsErr);
          await DirectoryPersistence.clearDirectoryHandle();
          S.dir=null;
          S.savedHandle=null;
          S.permissionNeeded=false;
          S.restoring=false;
          S.message='A pasta selecionada não foi encontrada no computador (pode ter sido excluída ou renomeada). Por favor, selecione a pasta novamente.';
          render();
          return;
        }
        throw fsErr;
      }finally{
        _isConnectingFolder=false;
      }
    }
    fail('Permissão de acesso à pasta não foi concedida pelo navegador.');
  }catch(err){
    _isConnectingFolder=false;
    S.restoring=false;
    if(err?.name==='NotFoundError'||/not found/i.test(err?.message||'')){
      await DirectoryPersistence.clearDirectoryHandle();
      S.dir=null;
      S.savedHandle=null;
      S.permissionNeeded=false;
      S.message='A pasta física não foi encontrada no disco. Por favor, selecione a pasta novamente.';
      render();
      return;
    }
    fail(err.message||'Permissão negada.');
  }
}
async function changeFolderFallback(ev){
  if(ev&&typeof ev.preventDefault==='function')ev.preventDefault();
  if(denyOperatorAccess())return;
  try{
    // Chama pickFolderWithPicker imediatamente no evento de clique sem aguardar IndexedDB antes,
    // preservando o User Gesture nativo e evitando bloqueio da Main Thread.
    await pickFolderWithPicker();
  }catch(err){
    console.error('Falha ao alterar pasta:',err);
    fail(err.message||'Não foi possível alterar a pasta.');
  }
}
async function forgetFolder(){
  if(denyOperatorAccess())return;
  try{
    await DirectoryPersistence.clearDirectoryHandle();
    S.dir=null;
    S.savedHandle=null;
    S.permissionNeeded=false;
    S.message='Referência da pasta removida com sucesso.';
    render();
  }catch(error){
    console.error('Falha ao remover referência da pasta.',error);
    fail('Não foi possível remover a referência da pasta.');
  }
}
const HYBRID_CSVS=[['ocorrencias.csv','Ocorrências registradas',()=>S.occ.length,H.occ],[ENVIRONMENTAL_FILE,'Inspeções de fumaça preta',()=>(S.inspecoes||[]).length,H.inspecoes],['chaves.csv','Cadastro de chaves',()=>S.keys.length,H.keys],['movimentacao_chaves.csv','Movimentação de chaves',()=>S.moves.length,H.moves],['supervisoes_unidades.csv','Supervisões e Unidades',()=>S.supervisions.length+S.unitCatalog.length,H.org],['naturezas_ocorrencias.csv','Naturezas de ocorrência',()=>S.natureCatalog.length,H.nature],['usuarios.csv','Usuários e permissões',()=>S.users.length,H.users],['historico_sistema.csv','Histórico de auditoria',()=>S.audits.length,H.audit],['registros_apagados.csv','Registros apagados (Auditoria)',()=>(S.deletedRecords||[]).length,H.registros_apagados]];
async function downloadRawCsvFile(fileName){if(denyOperatorAccess())return;try{if(window.BackupService){await window.BackupService.exportDecryptedCsvBackup(fileName);return}const cached=CSVService.cache.get(fileName),spec=HYBRID_CSVS.find(x=>x[0]===fileName);let blob;if(cached?.rawText){blob=new Blob([cached.rawText],{type:'text/csv;charset=utf-8'})}else if(cached?.rows&&spec?.[3]){blob=new Blob([csv(cached.rows,spec[3])],{type:'text/csv;charset=utf-8'})}else{const handle=await S.dir.getFileHandle(fileName);blob=await handle.getFile()}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){console.error('Falha ao baixar CSV:',fileName,error);fail(`Não foi possível baixar o arquivo ${fileName}.`)}}
async function downloadAllServerCsvs(){if(denyOperatorAccess())return;try{if(window.BackupService){await window.BackupService.exportAllDecryptedBackups();return}showLoading('Preparando exportação dos arquivos CSV da pasta dados...',{kicker:'Backup de dados',title:'Exportando arquivos CSV...',progress:15,overlayId:'pdfProgressOverlay'});for(let i=0;i<HYBRID_CSVS.length;i++){const[name]=HYBRID_CSVS[i];updateLoadingProgress(15+Math.round(((i+1)/HYBRID_CSVS.length)*80),`Baixando ${name}...`);await downloadRawCsvFile(name);await new Promise(r=>setTimeout(r,160))}hideLoading();S.message='Todos os arquivos CSV da pasta dados foram exportados.';render()}catch(error){hideLoading();fail('Não foi possível exportar todos os arquivos CSV.')}}
async function uploadHybridCsvFiles(fileList){
  markFilePickerClosed(2000);
  if(denyOperatorAccess())return;
  if(!hasProfile(S.user,'Administrador')){S.accessDenied=true;render();return}
  const files=Array.from(fileList||[]).filter(f=>f.name&&f.name.toLowerCase().endsWith('.csv'));
  if(!files.length)return fail('Selecione pelo menos um arquivo .csv válido.');
  showLoading('Importando arquivos CSV para a pasta dados...',{kicker:'Sincronização de dados',title:'Importando CSV(s) em lote...',progress:20,overlayId:'pdfProgressOverlay'});
  try{
    await new Promise(r=>setTimeout(r,0));
    const allowed=new Set([...HYBRID_CSVS.map(x=>x[0]),'supervisoes.csv','unidades.csv']);
    const mappedEntries=files.map(f=>{
      const rawName=f.name.trim();
      let cleanName=rawName;
      const lower=cleanName.toLowerCase();
      if(lower==='ocorrencias.csv'||lower.includes('ocorrencia'))cleanName='ocorrencias.csv';
      else if(lower.includes('fumaca')||lower.includes('inspecao')||lower.includes('ambiental'))cleanName=ENVIRONMENTAL_FILE;
      else if(lower.includes('usuario'))cleanName='usuarios.csv';
      else if(lower.includes('chave')&&!lower.includes('moviment'))cleanName='chaves.csv';
      else if(lower.includes('movimentacao')||lower.includes('movimento'))cleanName='movimentacao_chaves.csv';
      else if(lower.includes('natureza'))cleanName='naturezas_ocorrencias.csv';
      else if(lower.includes('supervis')||lower.includes('unidade'))cleanName='supervisoes_unidades.csv';
      if(!allowed.has(cleanName))throw new Error(`O arquivo "${rawName}" não pertence ao catálogo padrão do SIGESP.`);
      return {file:f,targetFileName:cleanName};
    });

    let imported=[];
    if(window.BackupService?.importCsvFilesBatch){
      const batchRes=await window.BackupService.importCsvFilesBatch(mappedEntries,(done,total,currentName)=>{
        const pct=20+Math.round((done/Math.max(1,total))*65);
        updateLoadingProgress(pct,`Processando em paralelo (${done}/${total}) · ${currentName}...`);
      });
      imported=batchRes.importedFiles||[];
    }else{
      const grouped=new Map();
      for(const item of mappedEntries){
        if(!grouped.has(item.targetFileName))grouped.set(item.targetFileName,[]);
        grouped.get(item.targetFileName).push(item.file);
      }
      for(const [cleanName,groupFiles] of grouped.entries()){
        updateLoadingProgress(50,`Gravando e sincronizando ${cleanName}...`);
        const texts=await Promise.all(groupFiles.map(f=>f.text()));
        const parsed=texts.flatMap(t=>parse(t));
        let finalRows=parsed;
        let hdrs=null;
        if(cleanName==='ocorrencias.csv'){
          const existingDisk=await read('ocorrencias.csv').catch(()=>[]);
          const normalized=parsed.map((r,idx)=>normalizeOccurrenceRow(r,idx,existingDisk));
          const map=new Map();
          for(const it of existingDisk){
            const k=String(it.numero_protocolo||it.id_ocorrencia||it.id_interno||'').trim().toUpperCase();
            if(k)map.set(k,it);
          }
          for(const it of normalized){
            const k=String(it.numero_protocolo||it.id_ocorrencia||it.id_interno||'').trim().toUpperCase();
            if(k)map.set(k,it);
            else map.set(`ITEM_${map.size+1}`,it);
          }
          finalRows=Array.from(map.values());
          hdrs=H.occ;
        }
        await write(cleanName,finalRows,hdrs||H[cleanName.replace('.csv','')]);
        CSVService.invalidateCache(cleanName);
        imported.push(cleanName);
      }
    }

    const uniqueImported=[...new Set(imported)];
    if((uniqueImported.includes('supervisoes.csv')||uniqueImported.includes('unidades.csv'))&&!uniqueImported.includes('supervisoes_unidades.csv')){
      const[supervisions,units]=await Promise.all([read('supervisoes.csv'),read('unidades.csv')]),legacy=organizationRows(supervisions,units);
      if(legacy.length)await write('supervisoes_unidades.csv',legacy,H.org);
    }
    updateLoadingProgress(90,'Atualizando e recarregando o histórico...');
    if(typeof CSVService!=='undefined')CSVService.invalidateCache();
    await load(true);
    if(uniqueImported.includes('ocorrencias.csv')){
      S.page='occ-history';
      S.activeMenu='ocorrencias';
      S.historyFilters={dateFrom:'',dateTo:'',nature:'',protocol:'',general:''};
      S.currentPage=1;
    }
    hideLoading();
    render();
    updateSyncIndicatorElement();
    showToast('Importação concluída. As ocorrências estão visíveis no Histórico.','success','Sincronização de Dados');
    showUserResult('success','Importação concluída com sucesso',`Arquivo(s) atualizado(s) e normalizados na base de dados: ${uniqueImported.join(', ')}. Os registros estão disponíveis na tela de Histórico.`,'','Sincronização de dados');
  }catch(error){
    hideLoading();
    console.error('Falha ao importar arquivos CSV.',error);
    render();
    showUserResult('error','Não foi possível importar o(s) CSV(s)',error.message||'Verifique o formato dos arquivos CSV selecionados.','Importação de dados','','Fechar');
  }
}
function formatSyncTime(date=S.lastSyncTime||new Date()){
  try{
    const d=(date instanceof Date&&!isNaN(date.getTime()))?date:new Date();
    return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }catch{
    const d=new Date();
    return [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');
  }
}
function updateSyncIndicatorElement(){
  const els=document.querySelectorAll('#syncStatusText, #syncStatusTextLogin, .sync-status-text');
  const txt=`Sincronizado às ${formatSyncTime(S.lastSyncTime)}`;
  els.forEach(el=>{
    el.textContent=txt;
  });
}
function showManualRefreshingModal(){
  document.getElementById('manualRefreshingModalOverlay')?.remove();
  const overlay=document.createElement('div');
  overlay.id='manualRefreshingModalOverlay';
  overlay.className='refresh-modal-overlay';
  overlay.innerHTML=`<div class="refresh-modal-card"><div class="refresh-spinner"></div><div class="refresh-modal-text">Atualizando dados, aguarde...</div></div>`;
  document.body.appendChild(overlay);
}
function hideManualRefreshingModal(){
  document.getElementById('manualRefreshingModalOverlay')?.remove();
}
let _pollIntervalId=null;
let _isPollingActive=false;
let _lastPollStart=0;
async function smartPollSync(){
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
  if(isFilePickerBlockingSync()||S.folderModal)return;
  if(!S.dir||S.restoring||S.permissionNeeded)return;
  if(S.submitting)return;

  const now=Date.now();
  if(_isPollingActive){
    if(now - _lastPollStart > 12000){
      console.warn('[SmartPoll] Watchdog: resetando lock de polling travado.');
      _isPollingActive=false;
    }else{
      return;
    }
  }
  _isPollingActive=true;
  _lastPollStart=now;
  try{
    let dataChanged=false;

    // 1. Sincronização em tempo real de usuários (essencial na tela de login e sessão ativa)
    try{
      const rawUsersText=await fetchFreshRawCsv('usuarios.csv',{onlyIfChanged:true});
      if(rawUsersText){
        const freshUsers=parseAndConsolidateCsv(rawUsersText);
        const normalizedFreshUsers=normalizedUsers(freshUsers);
        const currentUsers=S.users||[];
        const usersChanged=(normalizedFreshUsers.length!==currentUsers.length)||
          normalizedFreshUsers.some((u,idx)=>{
            const old=currentUsers[idx];
            return !old||old.id_usuario!==u.id_usuario||old.senha_hash!==u.senha_hash||old.status!==u.status||old.perfil!==u.perfil||old.login!==u.login;
          });
        if(usersChanged){
          S.users=normalizedFreshUsers;
          CSVService.buildEntry('usuarios.csv',normalizedFreshUsers);
          window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally('usuarios.csv',normalizedFreshUsers);
          dataChanged=true;
          if(S.user){
            const current=S.users.find(user=>user.id_usuario===S.user.id_usuario);
            if(!current||current.status!=='Ativo'){
              cleanup();
              S.user=null;
              S.message='Sua sessão foi encerrada porque o usuário está inativo ou foi removido.';
              render();
              return;
            }else{
              S.user={...current,perfil:canonicalPerfil(current.perfil)};
            }
          }
        }
      }
    }catch(uErr){
      console.debug('[SmartPoll] Verificação de usuários:',uErr);
    }

    // 2. Sincronização em tempo real de ocorrências
    try{
      const rawText=await fetchFreshRawCsv('ocorrencias.csv',{onlyIfChanged:true});
      if(rawText!==null){
        const freshOcc=rawText?parseAndConsolidateCsv(rawText):[];
        const normalizedFresh=(freshOcc||[]).map((x,idx)=>normalizeOccurrenceRow(x,idx,freshOcc)).filter(Boolean);

        const prevOccKeys=new Set();
        const prevPendingKeys=new Set((S.pending||[]).map(p=>String(p.id_interno||p.id_ocorrencia||p.numero_protocolo||'').trim().toUpperCase()).filter(Boolean));
        for(const x of (S.occ||[])){
          if(x.id_interno)prevOccKeys.add(String(x.id_interno).trim());
          if(x.id_ocorrencia)prevOccKeys.add(String(x.id_ocorrencia).trim());
          if(x.numero_protocolo)prevOccKeys.add(String(x.numero_protocolo).trim().toUpperCase());
        }
        const newlyAdded=(normalizedFresh||[]).filter(item=>{
          const kInt=String(item.id_interno||'').trim();
          const kOcc=String(item.id_ocorrencia||'').trim();
          const kProto=String(item.numero_protocolo||'').trim().toUpperCase();
          const exists=(kInt&&prevOccKeys.has(kInt))||(kOcc&&prevOccKeys.has(kOcc))||(kProto&&prevOccKeys.has(kProto));
          return !exists;
        });
        const newValidated=newlyAdded.filter(isValidatedOccurrence);
        const freshPending=(normalizedFresh||[]).filter(isPendingOccurrence);
        const newPending=freshPending.filter(item=>{
          const kInt=String(item.id_interno||'').trim().toUpperCase();
          const kOcc=String(item.id_ocorrencia||'').trim().toUpperCase();
          const kProto=String(item.numero_protocolo||'').trim().toUpperCase();
          const alreadyPending=(kInt&&prevPendingKeys.has(kInt))||(kOcc&&prevPendingKeys.has(kOcc))||(kProto&&prevPendingKeys.has(kProto));
          return !alreadyPending;
        });

        if(S.user&&newValidated.length>0){
          showToast('🔔 Nova ocorrência registrada! Lista atualizada.','success','Atualização em Tempo Real');
        }
        if(S.user&&newPending.length>0&&canValidateOccurrence(S.user)){
          showToast('🔔 Nova ocorrência aguardando validação!','success','Fila de Validação');
        }

        const occChanged=(normalizedFresh.length!==(S.occ||[]).length)||
          normalizedFresh.some((item,idx)=>{
            const old=(S.occ||[])[idx];
            return !old||old.id_ocorrencia!==item.id_ocorrencia||old.versao_registro!==item.versao_registro||old.status!==item.status||old.status_validacao!==item.status_validacao;
          });

        if(occChanged||newlyAdded.length>0||newPending.length>0){
          S.occ=normalizedFresh;
          S.pending=filteredPendingOccurrences();
          CSVService.buildEntry('ocorrencias.csv',normalizedFresh);
          window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally('ocorrencias.csv',normalizedFresh);
          dataChanged=true;
        }
      }
    }catch(occErr){
      console.debug('[SmartPoll] Verificação de ocorrências:',occErr);
    }

    // 3. Sincronização em tempo real de unidades e supervisões
    try{
      const rawOrgText=await fetchFreshRawCsv('supervisoes_unidades.csv',{onlyIfChanged:true});
      if(rawOrgText!==null&&rawOrgText){
        const freshOrg=parseAndConsolidateCsv(rawOrgText);
        const freshUnits=organizationUnits(freshOrg);
        const freshSups=organizationSupervisions(freshOrg);
        const currentUnits=S.unitCatalog||[];
        const currentSups=S.supervisions||[];
        const orgChanged=(freshUnits.length!==currentUnits.length)||(freshSups.length!==currentSups.length)||
          freshUnits.some((u,idx)=>{
            const old=currentUnits[idx];
            return !old||old.id_unidade!==u.id_unidade||old.nome!==u.nome||old.ativo!==u.ativo||old.id_supervisao!==u.id_supervisao;
          });
        if(orgChanged){
          setOrganizationContext(freshOrg);
          CSVService.buildEntry('supervisoes_unidades.csv',freshOrg);
          window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally('supervisoes_unidades.csv',freshOrg);
          _lastAccessCtxSig='';
          dataChanged=true;
        }
      }
    }catch(orgErr){
      console.debug('[SmartPoll] Verificação de unidades:',orgErr);
    }

    // 4. Sincronização em tempo real de inspeções veiculares (Meio Ambiente)
    try{
      const rawEnvText=await fetchFreshRawCsv(ENVIRONMENTAL_FILE,{onlyIfChanged:true});
      if(rawEnvText!==null&&rawEnvText){
        const freshEnv=parseAndConsolidateCsv(rawEnvText);
        const currentEnv=S.inspecoes||[];
        const envChanged=(freshEnv.length!==currentEnv.length)||
          freshEnv.some((item,idx)=>{
            const old=currentEnv[idx];
            return !old||String(old.id)!==String(item.id)||old.data_hora_alteracao!==item.data_hora_alteracao||old.laudo!==item.laudo||old.motivo_nao_execucao!==item.motivo_nao_execucao;
          });
        if(envChanged){
          S.inspecoes=freshEnv;
          CSVService.buildEntry(ENVIRONMENTAL_FILE,freshEnv);
          window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally(ENVIRONMENTAL_FILE,freshEnv);
          _scopeAmbientalMemo={rowsRef:null,userKey:'',orgVer:-1,result:[]};
          _ambientalFilterMemo={rowsRef:null,filterKey:'',result:[]};
          dataChanged=true;
        }
      }
    }catch(envErr){
      console.debug('[SmartPoll] Verificação de inspeções ambientais:',envErr);
    }

    // Se o usuário estiver na tela de Nova Ocorrência e o protocolo reservado tiver entrado em conflito externo (ex: expirou após inatividade prolongada e foi utilizado), renova automaticamente
    if(S.page==='occ-register'&&S.editing&&!S.editing.id_ocorrencia&&S.editing.numero_protocolo&&!S.submitting){
      const currentProto=String(S.editing.numero_protocolo).trim().toUpperCase();
      const usedNow=(S.occ||[]).some(item=>String(item.numero_protocolo||'').trim().toUpperCase()===currentProto);
      if(usedNow){
        const occFormEl=document.getElementById('occForm');
        if(occFormEl)captureOccurrenceDraft(occFormEl);
        clearStoredActiveReservation();
        void ensureActiveProtocolReservation({forceNew:true,preserveForm:true});
      }
    }

    if(dataChanged){
      const occForm=document.getElementById('occForm');
      const userForm=document.getElementById('userForm');
      const ambForm=document.getElementById('ambientalForm');
      const loginForm=document.getElementById('login');
      const activeEl=document.activeElement;
      const apuracaoForm=document.getElementById('apuracaoForm');
      const isTyping=(occForm&&activeEl&&occForm.contains(activeEl))||
                     (userForm&&activeEl&&userForm.contains(activeEl))||
                     (ambForm&&activeEl&&ambForm.contains(activeEl))||
                     (loginForm&&activeEl&&loginForm.contains(activeEl))||
                     (apuracaoForm&&activeEl&&apuracaoForm.contains(activeEl));
      const isOccFormPage=S.page==='occ-register';
      const isAmbFormPage=S.page==='inspecao-veicular';
      const isEditingOcc=!!S.editing&&S.editing.kind!=='key'&&S.editing.kind!=='user'&&S.editing.kind!=='ambiental';
      const isEditingAmb=S.editing?.kind==='ambiental';
      const isEditingUser=S.editing?.kind==='user';
      const isValidationModalOpen=!!S.validationModal;
      const isApuracaoModalOpen=!!S.apuracaoModal;

      if(occForm)captureOccurrenceDraft(occForm);
      if(userForm)captureUserDraft(userForm);
      if(isApuracaoModalOpen&&typeof syncApuracaoFormState==='function')syncApuracaoFormState();

      if(isTyping||(isOccFormPage&&isEditingOcc)||(isAmbFormPage&&isEditingAmb)||isEditingUser||isValidationModalOpen||isApuracaoModalOpen||isFilePickerBlockingSync()||S.folderModal){
        updateSyncIndicatorElement();
      }else{
        render();
      }
    }
    S.lastSyncTime=new Date();
    updateSyncIndicatorElement();
  }catch(err){
    console.debug('[SmartPoll] Verificação silenciosa concluída:',err);
  }finally{
    _isPollingActive=false;
  }
}
function startBackgroundPolling(){
  if(_pollIntervalId)clearInterval(_pollIntervalId);
  _pollIntervalId=setInterval(()=>{
    smartPollSync().catch(()=>{});
  },5000);
}
function stopBackgroundPolling(){
  if(_pollIntervalId){
    clearInterval(_pollIntervalId);
    _pollIntervalId=null;
  }
}
async function handleManualRefresh(){
  if(S.submitting)return;
  showManualRefreshingModal();
  try{
    CSVService.invalidateCache();
    if(typeof window!=='undefined'&&window.StorageService?.invalidateCache){
      window.StorageService.invalidateCache();
    }
    await load(true);
    S.lastSyncTime=new Date();
    updateSyncIndicatorElement();
    showToast('Dados atualizados com sucesso!','success','Sincronização');
  }catch(err){
    console.error('Falha na atualização manual:',err);
    showToast(err.message||'Falha ao atualizar dados.','error','Erro na sincronização');
  }finally{
    hideManualRefreshingModal();
  }
}
if(typeof window!=='undefined'){
  window.addEventListener('focus',()=>{
    if(_isFilePickerActive){
      // Evita fechar prematuramente nos primeiros 1500ms (artefato comum de foco ao exibir a janela nativa do SO)
      if(Date.now()-_filePickerOpenedAt < 1500){
        return;
      }
      markFilePickerClosed(2500);
      return;
    }
    if(isFilePickerBlockingSync()||S.folderModal)return;
    if(S.dir&&!S.submitting&&!S.restoring&&!S.permissionNeeded){
      smartPollSync().catch(()=>{});
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(isFilePickerBlockingSync()||S.folderModal)return;
    if(document.visibilityState==='visible'&&S.dir&&!S.submitting&&!S.restoring&&!S.permissionNeeded){
      smartPollSync().catch(()=>{});
    }
  });
}

async function login(ev){
  ev.preventDefault();
  try{
    const d=Object.fromEntries(new FormData(ev.currentTarget));
    const inputLogin=String(d.login||'').trim().toLowerCase();
    const ph=await hash(d.senha);
    const u=S.users.find(x=>String(x.login||'').trim().toLowerCase()===inputLogin&&x.senha_hash===ph&&x.status==='Ativo');
    if(!u)throw Error('Login, senha ou status inválido.');
    S.user={...u,perfil:canonicalPerfil(u.perfil)};
    const isOp=hasProfile(S.user,'Operador');
    S.page=isOp?'occ-register':'dashboard';
    S.editing=isOp?{}:null;
    S.userPasswordTarget=null;
    S.modal=null;
    S.errorPopup=null;
    S.successPopup=null;
    S.accessDenied=false;
    S.activeMenu=isOp?'ocorrencias':null;
    S.message='';
    startBackgroundPolling();
    if(isOp){
      await openOccurrenceRegistration({forceNew:false});
    }else{
      render();
    }
  }catch(x){
    fail(x.message);
  }
}
function logout(){void releaseCurrentReservation();S.occurrenceDraft=null;cleanup();S.user=null;S.page='dashboard';S.editing=null;S.userPasswordTarget=null;S.modal=null;S.errorPopup=null;S.successPopup=null;S.accessDenied=false;S.activeMenu=null;S.message='';startBackgroundPolling();render()}
function fail(m){S.restoring=false;if(S.user&&S.page==='ocorrencias'){S.errorPopup={titulo:'Não foi possível salvar a ocorrência',mensagem:m};S.message=''}else S.message=m;render()}
function opts(a,v){return a.map(x=>`<option value="${esc(x)}" ${String(x)===String(v)?'selected':''}>${esc(x)}</option>`).join('')}
function alert(){return S.message?`<div class="alert">${esc(S.message)}</div>`:''}
function occurrenceFormElement(){return document.getElementById('validationOccForm')||document.getElementById('occForm')}
function occurrenceFieldNames(){return ['id_ocorrencia','gerencia','supervisao','unidade','data_ocorrencia','hora_ocorrencia','natureza_ocorrencia','area','local_especifico','tipo_vinculo','nome_envolvido','empresa_envolvido','matricula_id','telefone','documento','placa_veiculo','gerencia_envolvido','gerencia_geral','diretoria','relato_detalhado','providencias_adotadas','prioridade','status','observacoes']}
function captureOccurrenceDraft(form=occurrenceFormElement()){if(!form)return null;const raw=Object.fromEntries(new FormData(form));for(const name of occurrenceFieldNames()){const field=form.elements.namedItem(name);if(field&&'value' in field)raw[name]=field.value}if(!raw.numero_protocolo){raw.numero_protocolo=S.editing?.numero_protocolo||S.editing?._reservedProtocol||S.activeReservation?.numeroProtocolo||S.activeReservation?.protocolo||''}const isCsn=raw.tipo_vinculo==='Grupo CSN';if(isCsn){raw.documento='';raw.gerencia_envolvido=raw.gerencia_envolvido||raw.gerencia||'';raw.gerencia=raw.gerencia_envolvido;raw.gerencia_geral=raw.gerencia_geral||'';raw.diretoria=raw.diretoria||''}else{raw.matricula_id='';raw.gerencia_envolvido='';raw.gerencia='';raw.gerencia_geral='';raw.diretoria=''}if(form.id==='validationOccForm'){S.validationModal={...(S.validationModal||{}),...raw}}else{S.editing={...(S.editing||{}),...raw}}return raw}
function readOccurrenceValue(form,data,name){const field=form?.elements?.namedItem(name);if(field&&'value' in field)return String(field.value??'').trim();return String(data?.[name]??'').trim()}
function cleanup(){
  S.newPhotos.forEach(x=>x.url&&URL.revokeObjectURL(x.url));
  S.existing.forEach(x=>x.url&&URL.revokeObjectURL(x.url));
  S.newPhotos=[];
  S.existing=[];
  S.removed=[];
  S.viewUrl=null;
}
async function image(path){
  if(!path)return{path:'',url:'',missing:1};
  try{
    const clean=String(path).replace(/^[\\/]+|[\\/]+$/g,'').replace(/^anexos[\\/]/i,'').trim();
    const parts=clean.split(/[\\/]/).filter(Boolean);
    if(!parts.length)return{path,url:'',missing:1};
    
    const root=await S.dir.getDirectoryHandle('anexos',{create:false});
    let currentDir=root;
    for(let i=0;i<parts.length-1;i++){
      currentDir=await currentDir.getDirectoryHandle(parts[i]);
    }
    const fileName=parts[parts.length-1];
    const fh=await currentDir.getFileHandle(fileName);
    const file=await fh.getFile();
    const url=URL.createObjectURL(file);
    return {path,url,missing:0,file};
  }catch(err){
    console.warn('[image] Falha ao carregar anexo fotográfico:',path,err);
    return{path,url:'',missing:1};
  }
}
async function loadImages(rec){
  S.existing.forEach(x=>x.url&&URL.revokeObjectURL(x.url));
  S.existing=[];
  S.removed=[];
  S.viewUrl=null;
  const refs=String(rec?.anexos_referencias||'').split('|').filter(Boolean).filter(p=>!/\.pdf$/i.test(p.trim()));
  S.existing=await Promise.all(refs.map(image));
}
async function compress(file){
  const fileName=String(file?.name||'').toLowerCase();
  const fileType=String(file?.type||'').toLowerCase();
  const isImage=fileType.startsWith('image/')||/\.(jpe?g|png|webp|bmp|jfif)$/i.test(fileName);
  if(!isImage){
    throw new Error(`Formato inválido ou não suportado: ${file.name}. Utilize imagens JPEG, PNG ou WebP.`);
  }

  let imgBitmap=null;
  let imgElement=null;
  let srcWidth=0;
  let srcHeight=0;

  try{
    if(typeof createImageBitmap==='function'){
      try{
        imgBitmap=await createImageBitmap(file);
        srcWidth=imgBitmap.width;
        srcHeight=imgBitmap.height;
      }catch(bmpErr){
        console.warn('createImageBitmap falhou, usando fallback HTMLImageElement:',bmpErr);
      }
    }

    if(!imgBitmap){
      imgElement=await new Promise((resolve,reject)=>{
        const img=new Image();
        const objectUrl=URL.createObjectURL(file);
        img.onload=()=>resolve({img,objectUrl});
        img.onerror=()=>{
          URL.revokeObjectURL(objectUrl);
          reject(new Error(`Falha ao decodificar a imagem: ${file.name}`));
        };
        img.src=objectUrl;
      });
      srcWidth=imgElement.img.naturalWidth||imgElement.img.width;
      srcHeight=imgElement.img.naturalHeight||imgElement.img.height;
    }

    if(!srcWidth||!srcHeight){
      throw new Error(`Dimensões ilegíveis na imagem: ${file.name}`);
    }

    const scale=Math.min(1,WIDTH/srcWidth);
    const targetW=Math.max(1,Math.round(srcWidth*scale));
    const targetH=Math.max(1,Math.round(srcHeight*scale));

    const canvas=document.createElement('canvas');
    canvas.width=targetW;
    canvas.height=targetH;

    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('Não foi possível obter contexto de renderização 2D.');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,targetW,targetH);

    if(imgBitmap){
      ctx.drawImage(imgBitmap,0,0,targetW,targetH);
    }else if(imgElement){
      ctx.drawImage(imgElement.img,0,0,targetW,targetH);
    }

    const blob=await new Promise((ok,no)=>canvas.toBlob(x=>x?ok(x):no(new Error('Falha na compressão da imagem')),'image/jpeg',QUALITY));

    // Libera imediatamente os buffers de GPU do canvas
    canvas.width=0;
    canvas.height=0;

    return {blob,url:URL.createObjectURL(blob),name:file.name,size:blob.size};
  }finally{
    if(imgBitmap){
      try{imgBitmap.close()}catch{}
    }
    if(imgElement){
      try{URL.revokeObjectURL(imgElement.objectUrl)}catch{}
      imgElement.img.src='';
    }
  }
}
async function choose(files){
  markFilePickerClosed(2500);
  captureOccurrenceDraft();
  const a=Array.from(files||[]).filter(f=>f&&f.size>0);
  if(!a.length)return;
  const space=MAX-S.existing.length-S.newPhotos.length;
  if(a.length>space)return fail(`Limite de ${MAX} fotos. Restam ${space} vaga(s).`);

  showLoading('Otimizando fotos selecionadas...',{kicker:'Anexos de Evidências',title:'Processando fotos...',progress:15,overlayId:'pdfProgressOverlay'});
  try{
    const compressed=[];
    for(let i=0;i<a.length;i++){
      const file=a[i];
      const percent=Math.round(((i)/a.length)*80)+10;
      updatePdfProgress(percent,`Otimizando foto ${i+1} de ${a.length}: ${file.name}...`);
      // Cede a thread principal para o navegador atualizar frames e responder com fluidez
      await new Promise(r=>setTimeout(r,30));
      const item=await compress(file);
      compressed.push(item);
    }
    for(const item of compressed)S.newPhotos.push(item);
    S.message=`${compressed.length} foto(s) anexada(s) e otimizada(s) com sucesso.`;
    hideLoading();
    render();
  }catch(x){
    hideLoading();
    console.error('Falha ao processar fotos selecionadas:',x);
    fail(x.message||'Falha ao processar fotos selecionadas.');
  }
}
function planPhotoPaths(protocol, newPhotos = [], existingPhotos = [], removedPhotos = []){
  const used=new Set([...(existingPhotos||[]).map(x=>x.path),...((removedPhotos||[]))].map(path=>String(path).split('/').pop()));
  const planned=[];
  let n=1;
  for(let i=0;i<(newPhotos||[]).length;i++){
    while(used.has(`foto_${String(n).padStart(3,'0')}.jpg`))n++;
    const name=`foto_${String(n).padStart(3,'0')}.jpg`;
    used.add(name);
    planned.push(`${protocol}/${name}`);
    n++;
  }
  return planned;
}

async function removeFiles(removedList = S.removed){
  const list = Array.isArray(removedList) ? removedList : S.removed;
  if(!list?.length)return;
  try{
    const root=await S.dir.getDirectoryHandle('anexos',{create:false});
    await Promise.all(list.map(async p=>{
      try{
        const clean=String(p).replace(/^[\\/]+|[\\/]+$/g,'').replace(/^anexos[\\/]/i,'').trim();
        const parts=clean.split(/[\\/]/).filter(Boolean);
        if(parts.length>=2){
          const fd=await root.getDirectoryHandle(parts[0],{create:false});
          await fd.removeEntry(parts[1]);
        }
      }catch(error){
        console.warn('Não foi possível remover um anexo marcado para exclusão.',p,error);
      }
    }));
  }catch(err){
    console.warn('Não foi possível acessar a pasta de anexos para exclusão:',err);
  }
}

async function savePhotos(protocol, photosToSave = S.newPhotos, existingPhotos = S.existing, removedPhotos = S.removed){
  const photosList = Array.isArray(photosToSave) ? photosToSave : (S.newPhotos || []);
  const existingList = Array.isArray(existingPhotos) ? existingPhotos : (S.existing || []);
  const removedList = Array.isArray(removedPhotos) ? removedPhotos : (S.removed || []);

  const used=new Set([...existingList.map(x=>x.path),...removedList].map(path=>String(path).split('/').pop())),planned=[];
  let n=1;
  for(const p of photosList){
    while(used.has(`foto_${String(n).padStart(3,'0')}.jpg`))n++;
    const name=`foto_${String(n).padStart(3,'0')}.jpg`,path=`${protocol}/${name}`;
    used.add(name);
    planned.push({p,name,path});
    n++;
  }
  if(!planned.length)return [];
  const root=await S.dir.getDirectoryHandle('anexos',{create:true});
  const folder=await root.getDirectoryHandle(protocol,{create:true});
  await Promise.all(planned.map(async ({p,name,path})=>{
    for(let attempt=0;attempt<2;attempt++){
      try{
        const file=await folder.getFileHandle(name,{create:true});
        const writable=await file.createWritable();
        try{
          await writable.write(p.blob);
          await writable.close();
        }catch(error){
          try{await writable.abort()}catch(abortError){console.warn('Falha ao abortar gravação de foto:',path,abortError)}
          throw error;
        }
        break;
      }catch(error){
        if(!isOccurrenceStateConflict(error)||attempt===1)throw error;
        console.warn('Tentativa concorrente ao gravar foto, repetindo:',path,error);
      }
    }
  }));
  return planned.map(x=>x.path);
}
function gerarIdUnicoUniversal(){
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'){
    return crypto.randomUUID();
  }
  if(typeof window!=='undefined'&&window.StorageService?.generateUUID){
    return window.StorageService.generateUUID();
  }
  return 'occ-'+Date.now().toString(36)+'-'+Math.random().toString(36).substring(2,6)+'-'+Math.random().toString(36).substring(2,6);
}
function extrairNumeroIdOuProtocolo(itemOuValor){
  if(!itemOuValor)return 0;
  if(typeof itemOuValor==='number')return isFinite(itemOuValor)?itemOuValor:0;
  let val='';
  if(typeof itemOuValor==='object'){
    val=String(itemOuValor.numero_protocolo||itemOuValor.protocolo||itemOuValor.id_interno||itemOuValor.id_ocorrencia||itemOuValor.codigo_registro||'').trim();
  }else{
    val=String(itemOuValor).trim();
  }
  if(!val)return 0;
  const protoMatch=val.match(/-(\d+)$/);
  if(protoMatch)return parseInt(protoMatch[1],10)||0;
  const hashMatch=val.match(/#(\d+)/);
  if(hashMatch)return parseInt(hashMatch[1],10)||0;
  const numMatch=val.match(/\b\d+\b/);
  if(numMatch)return parseInt(numMatch[0],10)||0;
  const rawNum=parseInt(val,10);
  return isNaN(rawNum)?0:rawNum;
}
function gerarProximoId(ocorrenciasValidadas=[],ocorrenciasPendentes=[]){
  const currentYear=new Date().getFullYear();
  // Junta AMBAS as listas (validadas + pendentes + memória + registros apagados)
  const allRecords=[
    ...(ocorrenciasValidadas||[]),
    ...(ocorrenciasPendentes||[]),
    ...(S.occ||[]),
    ...(S.pending||[]),
    ...(S.deletedRecords||[])
  ];
  const numeros=[0];
  const usedProtocols=new Set();
  for(let i=0;i<allRecords.length;i++){
    const rec=allRecords[i];
    if(!rec)continue;
    const proto=rec.numero_protocolo||rec.protocolo||rec.codigo_registro;
    if(proto){
      usedProtocols.add(String(proto).trim().toUpperCase());
    }
    const num=extrairNumeroIdOuProtocolo(rec);
    if(num>0)numeros.push(num);
  }
  const maiorIdAtual=Math.max(...numeros);
  let proximoNumero=maiorIdAtual+1;
  let proximoProtocolo=`OC-${currentYear}-${String(proximoNumero).padStart(6,'0')}`;
  while(usedProtocols.has(proximoProtocolo.toUpperCase())){
    proximoNumero++;
    proximoProtocolo=`OC-${currentYear}-${String(proximoNumero).padStart(6,'0')}`;
  }
  return {
    proximoId:proximoNumero,
    maiorIdAtual:maiorIdAtual,
    protocolo:proximoProtocolo,
    proximoProtocolo:proximoProtocolo,
    numeroSequencial:proximoNumero
  };
}
function extractProtocolSeq(proto){return extrairNumeroIdOuProtocolo(proto)}
function nextOccurrenceProtocol(official=[],pending=[],deleted=[]){
  return gerarProximoId(official,pending).protocolo;
}
async function removeSavedPhotos(paths){for(const path of paths){try{const[d,n]=path.split('/'),root=await S.dir.getDirectoryHandle('anexos'),folder=await root.getDirectoryHandle(d);await folder.removeEntry(n)}catch(error){console.warn('Não foi possível remover um anexo gravado sem ocorrência associada.',path,error)}}}
function clearFieldErrors(form){form.querySelectorAll('.field-error').forEach(x=>x.classList.remove('field-error'));form.querySelectorAll('.field-error-text').forEach(x=>x.remove())}
function markFieldError(form,name,message){const field=form.elements[name];if(!field)return;field.classList.add('field-error');const note=document.createElement('div');note.className='field-error-text';note.textContent=message;field.insertAdjacentElement('afterend',note)}
function validateOccurrenceForm(form,d){
clearFieldErrors(form);
const errors=[],add=(name,message)=>{errors.push({name,message});markFieldError(form,name,message)};
for(const name of occurrenceFieldNames())d[name]=readOccurrenceValue(form,d,name);
const isCsn=d.tipo_vinculo==='Grupo CSN';
if(isCsn){d.documento='';d.gerencia_envolvido=d.gerencia_envolvido||d.gerencia||'';d.gerencia=d.gerencia_envolvido;d.gerencia_geral=d.gerencia_geral||'';d.diretoria=d.diretoria||''}
else{d.matricula_id='';d.gerencia_envolvido='';d.gerencia='';d.gerencia_geral='';d.diretoria=''}
const original=d.id_ocorrencia?S.occ.find(item=>item.id_ocorrencia===d.id_ocorrencia):null,unit=unitForName(d.unidade),historicalUnit=Boolean(original&&original.unidade===d.unidade),supervision=supervisionForUnit(d.unidade);
if(!d.unidade)add('unidade','Selecione a unidade.');
else if(!unit||!unit.id_supervisao||!supervision)add('unidade','A unidade selecionada não está vinculada a uma Supervisão.');
else if(!activeMaster(supervision)&&!historicalUnit)add('unidade','A Supervisão da unidade está inativa e não pode ser usada em novos registros.');
else if(!canAccessUnit(d.unidade))add('unidade','Seu cadastro não autoriza o registro nesta unidade.');
else if(!activeMaster(unit)&&!historicalUnit)add('unidade','A unidade selecionada está inativa e não pode ser usada em novos registros.');
else if(!historicalUnit&&normalizedMasterName(unit.nome)!==normalizedMasterName(d.unidade))add('unidade','Selecione uma Unidade ativa do cadastro.');
else if(!historicalUnit){d.unidade=unit.nome;d.supervisao=supervision.nome}
if(!d.data_ocorrencia)add('data_ocorrencia','Informe a data da ocorrência.');
if(!d.hora_ocorrencia)add('hora_ocorrencia','Informe a hora da ocorrência.');
const nature=S.natureCatalog.find(item=>normalizedMasterName(item.nome)===normalizedMasterName(d.natureza_ocorrencia)||aliasesOf(item).some(alias=>normalizedMasterName(alias)===normalizedMasterName(d.natureza_ocorrencia))),historicalNature=Boolean(original&&original.natureza_ocorrencia===d.natureza_ocorrencia);
if(!d.natureza_ocorrencia)add('natureza_ocorrencia','Selecione a natureza da ocorrência.');
else if((!nature&&!historicalNature)||(nature&&!activeMaster(nature)&&!historicalNature))add('natureza_ocorrencia','A natureza selecionada não está ativa ou não existe no cadastro.');
else if(nature&&!historicalNature&&normalizedMasterName(nature.nome)!==normalizedMasterName(d.natureza_ocorrencia))add('natureza_ocorrencia','Selecione uma Natureza ativa do cadastro.');
else if(nature&&!historicalNature)d.natureza_ocorrencia=nature.nome;
if(!d.local_especifico)add('local_especifico','Informe o local específico.');
else if(d.local_especifico.length<3)add('local_especifico','Informe pelo menos 3 caracteres no local específico.');
if(!d.relato_detalhado)add('relato_detalhado','Informe o relato detalhado.');
else if(d.relato_detalhado.length<20)add('relato_detalhado','O relato deve possuir pelo menos 20 caracteres.');
else if(d.relato_detalhado.length>5000)add('relato_detalhado','O relato não pode ultrapassar 5.000 caracteres.');
if(S.existing.length+S.newPhotos.length>MAX)errors.push({name:'photos',message:`Máximo de ${MAX} fotos por ocorrência.`});
S.editing={...(S.editing||{}),...d};
if(errors.length){form.elements.namedItem(errors[0].name)?.focus();throw new OccurrenceValidationError(errors.map(x=>x.message).join(' '))}
}
function showOccurrenceValidationError(message,category='Validação do formulário'){S.errorPopup={titulo:'Não foi possível salvar a ocorrência',mensagem:message};document.getElementById('occurrenceValidationOverlay')?.remove();const overlay=document.createElement('div');overlay.id='occurrenceValidationOverlay';overlay.className='modalbg popup-backdrop';overlay.innerHTML=`<div class="result-dialog result-error"><div class="error-strip"></div><div class="error-body"><div class="error-icon">!</div><div><div class="result-kicker error-kicker">${esc(category)}</div><h2>${esc(S.errorPopup.titulo)}</h2><p>${esc(message)}</p></div></div><div class="result-actions error-actions"><button id="reviewOccurrenceForm" class="btn error-primary">Revisar formulário</button></div></div>`;document.body.appendChild(overlay);document.getElementById('reviewOccurrenceForm')?.addEventListener('click',()=>{overlay.remove();S.errorPopup=null;document.querySelector('.field-error')?.focus()})}
function occurrenceSaveErrorMessage(error){
  if(error instanceof DataScopeError)return error.message;
  if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return'A permissão de acesso à pasta de dados precisa ser renovada.';
  if(error?.name==='NotFoundError')return'Não foi possível localizar o arquivo de ocorrências na pasta de dados.';
  if(isOccurrenceStateConflict(error))return'O arquivo foi alterado durante o salvamento. Os dados mais recentes foram relidos, mas a gravação não pôde ser concluída. Tente novamente.';
  if(/Usuário sem permissão|Conflito de versão|O protocolo já está em uso|O arquivo foi alterado|já foi gravada/i.test(String(error?.message||'')))return error.message;
  return'Não foi possível concluir o salvamento. Os dados preenchidos foram mantidos.';
}
async function ensureDataWritePermission(){if(!S.dir)throw Error('Pasta de dados indisponível.');let permission=await S.dir.queryPermission({mode:'readwrite'});if(permission==='prompt')permission=await S.dir.requestPermission({mode:'readwrite'});if(permission!=='granted'){const error=Error('A permissão de leitura e escrita não foi concedida.');error.name='NotAllowedError';throw error}}
function shouldQueueForValidation(user=S.user){return hasProfile(user,'Operador')}
function isOccurrenceStateConflict(error){
  return error?.name==='InvalidStateError'||
    error?.code==='ERRO_DE_SINCRONIZACAO'||
    /state had changed since it was read from disk|InvalidStateError|Conflito|alterado durante o salvamento/i.test(String(error?.message||''));
}
async function persistNewOccurrence(d,time,photoPaths,options={}){
  const isOperator=shouldQueueForValidation();
  const statusValue=isOperator?'pendente':'validada';
  const idUnico=d.id_interno||gerarIdUnicoUniversal();
  const clientId=d._clientId||S.editing?._clientId||S.activeReservation?.sessionId||(window.StorageService?.getClientSessionId?window.StorageService.getClientSessionId():uid());
  let reservationId=d._reservationId||S.editing?._reservationId||S.activeReservation?.reservationId||'';

  for(let attempt=0;attempt<5;attempt++){
    let protocol=String(d.numero_protocolo||S.editing?.numero_protocolo||S.activeReservation?.numeroProtocolo||S.activeReservation?.protocolo||'').trim();
    let nextNum=extrairNumeroIdOuProtocolo(protocol);

    if(attempt>0||!protocol||nextNum<=0){
      try{
        const res=await window.StorageService?.reserveProtocol(S.user?.login||'Operador',d.unidade||'',{
          clientId,
          reservationId,
          forceNew:attempt>0,
          previousProtocol:protocol
        });
        if(res?.protocolo){
          protocol=res.protocolo;
          nextNum=res.id_sequencial||extrairNumeroIdOuProtocolo(protocol);
          reservationId=res.reservationId||res.id_reserva||reservationId;
          d.numero_protocolo=protocol;
          saveStoredActiveReservation({
            reservationId,
            numeroProtocolo:protocol,
            protocolo:protocol,
            id_sequencial:nextNum,
            sessionId:clientId,
            usuario:S.user?.login||'Operador',
            dataHoraReserva:res.dataHoraReserva||new Date().toISOString(),
            status:'RESERVADO'
          });
          if(S.editing){
            S.editing.numero_protocolo=protocol;
            S.editing._reservedProtocol=protocol;
            S.editing._reservationId=reservationId;
            S.editing._reservationConfirmed=true;
          }
        }
      }catch(err){
        console.warn('[SIGESP] Falha ao reservar protocolo no endpoint:',err);
      }
    }else if(window.StorageService?.confirmProtocolForSave){
      try{
        const confirmed=await window.StorageService.confirmProtocolForSave(protocol,S.user?.login||'Operador',d.unidade||'',{
          clientId,
          reservationId,
          id_interno:idUnico,
          markUtilized:true
        });
        if(confirmed?.protocolo){
          protocol=confirmed.protocolo;
          nextNum=confirmed.id_sequencial||extrairNumeroIdOuProtocolo(protocol);
          reservationId=confirmed.reservationId||confirmed.id_reserva||reservationId;
          d.numero_protocolo=protocol;
          saveStoredActiveReservation({
            reservationId,
            numeroProtocolo:protocol,
            protocolo:protocol,
            id_sequencial:nextNum,
            sessionId:clientId,
            usuario:S.user?.login||'Operador',
            dataHoraReserva:confirmed.dataHoraReserva||new Date().toISOString(),
            status:'UTILIZADO'
          });
          if(S.editing){
            S.editing.numero_protocolo=protocol;
            S.editing._reservedProtocol=protocol;
            S.editing._reservationId=reservationId;
            S.editing._reservationConfirmed=true;
          }
        }
      }catch(confErr){
        console.warn('[SIGESP] Aviso ao confirmar protocolo antes do salvamento:',confErr);
      }
    }

    if(!protocol||nextNum<=0){
      const fallbackRes=await window.StorageService?.reserveProtocol(S.user?.login||'Operador',d.unidade||'',{
        clientId,
        forceNew:true
      });
      if(fallbackRes?.protocolo){
        protocol=fallbackRes.protocolo;
        nextNum=fallbackRes.id_sequencial||extrairNumeroIdOuProtocolo(protocol);
        reservationId=fallbackRes.reservationId||fallbackRes.id_reserva||reservationId;
      }else{
        throw new Error('Não foi possível confirmar uma reserva exclusiva de protocolo na pasta de dados compartilhada.');
      }
    }

    let savedPhotos=[];
    if(S.newPhotos.length&&photoPaths.length===0){
      savedPhotos=await savePhotos(protocol,photoPaths);
    }else{
      savedPhotos=[...photoPaths];
    }

    const loggedMatricula=String(S.user?.login||S.user?.matricula||'').trim();
    const loggedNome=String(S.user?.nome||S.user?.login||'Responsável').trim();
    const row={
      ...d,
      id_ocorrencia:String(nextNum),
      id_interno:idUnico,
      numero_protocolo:protocol,
      anexos_referencias:savedPhotos.join('|'),
      responsavel_registro:S.user.login,
      matricula_responsavel:loggedMatricula,
      responsavel:loggedMatricula?`${loggedNome} (${loggedMatricula})`:loggedNome,
      perfil_registro:canonicalPerfil(S.user.perfil),
      data_registro:time,
      versao_registro:'1',
      usuario_ultima_alteracao:S.user.login,
      status:statusValue,
      status_validacao:isOperator?'Pendente de validação':'Validada',
      validado_por:isOperator?'':S.user.login,
      data_validacao:isOperator?'':time,
      observacao_validacao:'',
      data_envio_validacao:isOperator?time:''
    };

    try{
      let savedResult=null;
      if(window.StorageService?.appendSingleRecord){
        savedResult=await window.StorageService.appendSingleRecord('ocorrencias.csv',row,H.occ,{
          isNewRecord:true,
          clientId,
          reservationId,
          signal:options?.signal
        });
      }else{
        savedResult=await CSVService.append('ocorrencias.csv',row,H.occ);
      }

      clearStoredActiveReservation();
      S.occurrenceDraft=null;
      if(S.editing?._reservedProtocol===protocol){
        S.editing._reservedProtocol=null;
        S.editing._reservationId=null;
      }

      const prevNormMap=new Map();
      for(const existingItem of (S.occ||[])){
        if(existingItem&&existingItem._norm){
          const k=`${existingItem.id_interno||existingItem.id_ocorrencia||''}:${existingItem.versao_registro||'1'}:${existingItem.status_validacao||''}:${existingItem.status||''}`;
          if(k!=='::1::') prevNormMap.set(k,existingItem);
        }
      }
      const consolidated=savedResult?._allRows||(window.StorageService?.consolidateVersionedRows
        ? window.StorageService.consolidateVersionedRows([...(S.occ||[]),row])
        : [...(S.occ||[]),row]);
      const nextOcc=consolidated.map((x,idx)=>{
        const k=`${x?.id_interno||x?.id_ocorrencia||''}:${x?.versao_registro||'1'}:${x?.status_validacao||''}:${x?.status||''}`;
        const cachedNorm=prevNormMap.get(k);
        return cachedNorm||normalizeOccurrenceRow(x,idx,consolidated);
      }).filter(Boolean);
      return { ...row, row, nextOcc };
    }catch(error){
      if(error?.code==='CONFLITO_DE_PROTOCOLO'){
        console.warn(`[SIGESP] Conflito de protocolo detectado (${protocol}); solicitando novo protocolo exclusivo...`);
        clearStoredActiveReservation();
        d.numero_protocolo='';
        if(S.editing){
          S.editing.numero_protocolo='';
          S.editing._reservedProtocol='';
          S.editing._reservationId='';
        }
        continue;
      }
      if(attempt===4)throw error;
      console.warn(`[SIGESP] Concorrência ao gravar ocorrência (tentativa ${attempt+1}/5):`,error);
      const delay=40+Math.random()*60*(attempt+1);
      await new Promise(r=>setTimeout(r,delay));
    }
  }
  throw Error('Não foi possível confirmar a gravação da ocorrência sob concorrência.');
}

async function persistEditedOccurrence(d,editingBeforeSubmit,photoPaths,initialDisk=null,options={}){
  for(let attempt=0;attempt<5;attempt++){
    const disk=attempt===0?(initialDisk||(S.occ?.length?S.occ:await read('ocorrencias.csv'))):await read('ocorrencias.csv',{force:true});
    const current=disk.find(x=>String(x.id_ocorrencia)===String(d.id_ocorrencia)||(x.id_interno&&String(x.id_interno)===String(d.id_interno||d.id_ocorrencia))||(x.numero_protocolo&&x.numero_protocolo===d.numero_protocolo));
    if(!current)throw Error('Registro não encontrado na base de dados.');
    const protocol=current.numero_protocolo;
    const finalPhotoRefs = Array.isArray(photoPaths) ? photoPaths.filter(Boolean) : [];
    const timeNow=now();
    const updated={
      ...current,
      ...d,
      id_ocorrencia:current.id_ocorrencia,
      id_interno:current.id_interno||current.id_ocorrencia,
      numero_protocolo:protocol,
      anexos_referencias:finalPhotoRefs.join('|'),
      versao_registro:String((+current.versao_registro||0)+1),
      usuario_ultima_alteracao:S.user.login,
      data_atualizacao:timeNow
    };

    try{
      let savedResult=null;
      if(window.StorageService?.appendSingleRecord){
        savedResult=await window.StorageService.appendSingleRecord('ocorrencias.csv',updated,H.occ,{
          isNewRecord:false,
          signal:options?.signal
        });
      }else{
        savedResult=await CSVService.append('ocorrencias.csv',updated,H.occ);
      }
      await removeFiles();

      const consolidated=savedResult?._allRows||(window.StorageService?.consolidateVersionedRows
        ? window.StorageService.consolidateVersionedRows([...(S.occ||[]),updated])
        : [...(S.occ||[]),updated]);
      const nextOcc=consolidated.map((x,idx)=>normalizeOccurrenceRow(x,idx,consolidated)).filter(Boolean);
      return { ...updated, row: updated, nextOcc };
    }catch(error){
      if(attempt===4)throw error;
      console.warn(`[SIGESP] Concorrência ao gravar edição (tentativa ${attempt+1}/5):`,error);
      const delay=50+Math.random()*70*(attempt+1);
      await new Promise(r=>setTimeout(r,delay));
    }
  }
  throw Error('Não foi possível confirmar a alteração da ocorrência.');
}
let _lastOccSaveClick=0;
async function saveOcc(ev){
  ev.preventDefault();
  const clickTime=Date.now();
  if(S.submitting||(clickTime-_lastOccSaveClick<1800))return;
  _lastOccSaveClick=clickTime;
  S.submitting=true;

  const form=ev.currentTarget;
  const submitButton=form?.querySelector('button[type="submit"],button.primary,button:not([type])');
  if(submitButton){
    submitButton.disabled=true;
    submitButton.classList.add('opacity-50','cursor-not-allowed');
    if(!submitButton.dataset.origText)submitButton.dataset.origText=submitButton.textContent||'Salvar ocorrência';
    submitButton.textContent='Salvando...';
  }

  let savedPhotoPaths=[];
  try{
    const isEditCandidate=Boolean(form.elements['id_ocorrencia']?.value||S.editing?.id_ocorrencia);
    if(!isEditCandidate&&_openOccRegPromise){
      try{await _openOccRegPromise;}catch{}
    }

    const d=captureOccurrenceDraft(form)||{},editingBeforeSubmit={...(S.editing||{})};
    if(hasProfile(S.user,'Operador')&&d.id_ocorrencia){
      cleanup();
      S.editing={};
      S.submitting=false;
      _lastOccSaveClick=0;
      if(submitButton){
        submitButton.disabled=false;
        submitButton.classList.remove('opacity-50','cursor-not-allowed');
        submitButton.textContent=submitButton.dataset.origText||'Salvar ocorrência';
      }
      denyOperatorAccess();
      return;
    }

    await refreshAccessContext();
    validateOccurrenceForm(form,d);
    if(!canRegisterOccurrence(S.user))throw Error('Usuário sem permissão para registrar ocorrências.');
    S.errorPopup=null;
    const pendingFlow=shouldQueueForValidation(),isEdit=!!d.id_ocorrencia;
    const time=now();

    // 1. Determinação determinística de Identificadores no milissegundo 0
    const nextIds=gerarProximoId(S.occ,S.pending);
    const activeProto=S.activeReservation?.protocolo||S.activeReservation?.numeroProtocolo||S.activeReservation?.protocol||'';
    let protocol=isEdit
      ?(d.numero_protocolo||editingBeforeSubmit.numero_protocolo||nextIds.protocolo)
      :(d.numero_protocolo||editingBeforeSubmit.numero_protocolo||editingBeforeSubmit._reservedProtocol||activeProto||nextIds.protocolo);
    if(!protocol||!protocol.trim()){
      protocol=nextIds.protocolo;
    }
    const seqFromProto=extrairNumeroIdOuProtocolo(protocol);
    const idOcc=isEdit?(d.id_ocorrencia||editingBeforeSubmit.id_ocorrencia||nextIds.proximoId):(d.id_ocorrencia||(seqFromProto>0?String(seqFromProto):String(nextIds.proximoId)));
    const idInt=isEdit?(d.id_interno||editingBeforeSubmit.id_interno||idOcc):(d.id_interno||editingBeforeSubmit.id_interno||gerarIdUnicoUniversal());
    d.numero_protocolo=protocol;
    d.id_ocorrencia=String(idOcc);
    d.id_interno=String(idInt);
    d._reservationId=editingBeforeSubmit._reservationId||S.activeReservation?.reservationId||'';
    d._clientId=editingBeforeSubmit._clientId||S.activeReservation?.sessionId||getTabSessionClientId();
    if(pendingFlow){
      d.status='pendente';
      d.status_validacao='Pendente de validação';
    }
    const supervision=supervisionForUnit(d.unidade);

    // 2. Snapshot para Rollback defensivo em caso de falha física no disco
    const prevOcc=[...(S.occ||[])];
    const prevPending=[...(S.pending||[])];
    const prevEditing=S.editing;
    const prevNewPhotos=[...S.newPhotos];
    const prevExisting=[...S.existing];
    const prevRemoved=[...S.removed];

    // 3. Objeto Otimista em Memória
    const plannedNewPaths = planPhotoPaths(protocol, prevNewPhotos, prevExisting, prevRemoved);
    const photoRefs = [...prevExisting.map(x=>x.path), ...plannedNewPaths].filter(Boolean);
    const optimisticRow=normalizeOccurrenceRow({
      ...(isEdit?(editingBeforeSubmit||{}):{}),
      ...d,
      id_ocorrencia:String(idOcc),
      id_interno:String(idInt),
      numero_protocolo:String(protocol),
      supervisao:supervision?.nome||d.supervisao||'GSP/SP',
      status:pendingFlow?'pendente':(d.status||'Registrada'),
      status_validacao:pendingFlow?'Pendente de validação':'Validada',
      perfil_registro:canonicalPerfil(S.user?.perfil||'Operador'),
      responsavel_registro:isEdit?(editingBeforeSubmit.responsavel_registro||S.user.login):S.user.login,
      anexos_referencias:photoRefs.join('|'),
      data_registro:isEdit?(editingBeforeSubmit.data_registro||time):time,
      versao_registro:isEdit?String((+editingBeforeSubmit.versao_registro||0)+1):'1',
      data_atualizacao:time,
      usuario_ultima_alteracao:S.user.login
    },0,S.occ||[]);

    // 4. ATUALIZAÇÃO INSTANTÂNEA DA INTERFACE (0 ms) COM DESDUPLICAÇÃO
    if(isEdit){
      S.occ=S.occ.map(x=>(String(x.id_ocorrencia)===String(idOcc)||String(x.id_interno)===String(idInt)||String(x.numero_protocolo).toUpperCase()===String(protocol).toUpperCase())?optimisticRow:x);
    }else{
      const existingIdx=S.occ.findIndex(x=>
        (idInt&&String(x.id_interno||'').trim()===String(idInt).trim())||
        (protocol&&String(x.numero_protocolo||'').trim().toUpperCase()===String(protocol).trim().toUpperCase())
      );
      if(existingIdx>=0){
        S.occ[existingIdx]=optimisticRow;
      }else{
        S.occ=[optimisticRow,...S.occ];
      }
    }
    S.pending=filteredPendingOccurrences();
    _occFilterMemo={rowsRef:null,query:'',result:[]};
    _histFilterMemo={rowsRef:null,filterKey:'',result:[]};
    _dashSeriesMemo={rowsRef:null,result:null};

    S.editing=null;
    cleanup();
    S.message='';
    S.successPopup={
      protocolo:protocol,
      unidade:optimisticRow.unidade,
      dataRegistro:optimisticRow.data_registro||time,
      usuario:S.user.login,
      idOcorrencia:idOcc,
      kind:pendingFlow?'pending':(isEdit?'edit':'create')
    };
    render();

    // 5. PERSISTÊNCIA ASSÍNCRONA EM BACKGROUND COM RESILIÊNCIA E WRITE LOCK
    (async()=>{
      try{
        await ensureDataWritePermission();
        if(prevNewPhotos.length){
          savedPhotoPaths=await savePhotos(protocol, prevNewPhotos, prevExisting, prevRemoved);
        }
        if(prevRemoved.length){
          await removeFiles(prevRemoved);
        }
        const finalPhotoPaths=[...prevExisting.map(x=>x.path), ...(savedPhotoPaths||[])].filter(Boolean);
        await withWriteLock('occurrences',async()=>{
          let editDisk=isEdit?await read('ocorrencias.csv',{force:true}):null;
          let saveResult=isEdit
            ?await persistEditedOccurrence(d,editingBeforeSubmit,finalPhotoPaths,editDisk)
            :await persistNewOccurrence(d,time,finalPhotoPaths);
          const row=saveResult?.row||saveResult;
          if(row){
            if(S.successPopup&&S.successPopup.idOcorrencia===idOcc&&row.numero_protocolo&&row.numero_protocolo!==S.successPopup.protocolo){
              S.successPopup.protocolo=row.numero_protocolo;
              S.successPopup.idOcorrencia=row.id_ocorrencia||idOcc;
              render();
            }
            const consolidated=window.StorageService?.consolidateVersionedRows
              ?window.StorageService.consolidateVersionedRows([...(S.occ||[]),row])
              :[...(S.occ||[]),row];
            S.occ=consolidated.map((x,idx)=>normalizeOccurrenceRow(x,idx,consolidated)).filter(Boolean);
            S.pending=filteredPendingOccurrences();
            if(typeof CSVService!=='undefined'){
              CSVService.buildEntry('ocorrencias.csv',S.occ);
            }
            window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally('ocorrencias.csv',S.occ).catch(()=>{});
          }
        },0);
        prevNewPhotos.forEach(x=>x.url&&URL.revokeObjectURL(x.url));
      }catch(bgErr){
        console.error('[Rollback] Falha ao persistir ocorrência no disco:',bgErr);
        S.occ=prevOcc;
        S.pending=prevPending;
        S.editing=prevEditing;
        S.newPhotos=prevNewPhotos;
        S.existing=prevExisting;
        S.removed=prevRemoved;
        S.successPopup=null;
        render();
        showToast(bgErr.message||'Falha ao gravar no disco. Ocorrência restaurada.','error','Erro de Gravação');
      }finally{
        S.submitting=false;
      }
    })();
  }catch(error){
    S.submitting=false;
    _lastOccSaveClick=0;
    if(submitButton){
      submitButton.disabled=false;
      submitButton.classList.remove('opacity-50','cursor-not-allowed');
      submitButton.textContent=submitButton.dataset.origText||'Salvar ocorrência';
    }
    if(error instanceof OccurrenceValidationError){
      showOccurrenceValidationError(error.message,'Validação do formulário');
    }else{
      console.error('Falha ao validar ocorrência no SIGESP.',error);
      showOccurrenceValidationError(occurrenceSaveErrorMessage(error),'Falha no salvamento');
    }
  }
}
let _toastTimer=null;
function renderToastPortal(){
let root=document.getElementById('toast-portal-root');
if(!root){root=document.createElement('div');root.id='toast-portal-root';root.className='toast-portal-root';root.setAttribute('aria-live','polite');root.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:100000!important;';document.body.appendChild(root)}
if(!S.toast){root.innerHTML='';return}
const isSuccess=S.toast.type==='success';
root.innerHTML=`<div class="toast-container" style="position:fixed;top:24px;right:24px;z-index:100000!important;display:flex;flex-direction:column;gap:10px;pointer-events:none"><div id="appToast" class="toast toast-visible ${isSuccess?'toast-success':'toast-error'}" role="alert" style="pointer-events:auto;box-shadow:0 16px 40px rgba(15,23,42,0.22);border:1px solid ${isSuccess?'#86efac':'#fca5a5'};background:${isSuccess?'#f0fdf4':'#fef2f2'};color:${isSuccess?'#14532d':'#7f1d1d'}"><div class="toast-icon">${isSuccess?`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`}</div><div class="toast-content">${S.toast.title?`<div style="font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:2px">${esc(S.toast.title)}</div>`:''}<span>${esc(S.toast.message)}</span></div><button type="button" id="closeToastPortal" class="toast-close" aria-label="Fechar notificação">×</button></div></div>`;
document.getElementById('closeToastPortal')?.addEventListener('click',()=>{S.toast=null;renderToastPortal()})}
function showToast(message,type='success',title=''){S.toast={message,type,title,id:Date.now()};if(_toastTimer)clearTimeout(_toastTimer);renderToastPortal();_toastTimer=setTimeout(()=>{S.toast=null;const toastEl=document.getElementById('appToast');if(toastEl){toastEl.classList.remove('toast-visible');setTimeout(()=>{renderToastPortal()},250)}else{renderToastPortal()}},4000)}
async function viewPendingOcc(id){
try{
const item=await findAuthorizedOccurrence(id,true);
if(!item)throw new DataScopeError('Registro não encontrado ou sem autorização para acessá-lo.');
await loadImages(item);
if(canValidateOccurrence(S.user)&&!hasProfile(S.user,'Operador')){
S.validationModal={...item};
}else{
S.modal={...item};
}
render();
}catch(error){
console.warn('Acesso negado à visualização de ocorrência pendente.',error);
fail('Registro não encontrado ou sem autorização para acessá-lo.');
}
}
async function openValidationModal(id){
  if(denyOperatorAccess())return;
  if(!canValidateOccurrence(S.user))return fail('Somente administradores e supervisores podem validar ocorrências.');
  try{
    const normId=String(id??'').trim();
    const item=(S.occ||[]).find(x=>String(x.id_ocorrencia||'').trim()===normId||String(x.id_interno||'').trim()===normId||String(x.numero_protocolo||'').trim().toUpperCase()===normId.toUpperCase());
    if(!item){
      showToast('Ocorrência não encontrada na base de dados.','error','Validação');
      return;
    }
    if(!isPendingOccurrence(item)){
      showToast('Esta ocorrência já foi validada por outro administrador.','error','Validação Concorrente');
      S.validationModal=null;
      render();
      return;
    }
    // Abertura instantânea (0ms de latência)
    S.existing=[];
    S.newPhotos=[];
    S.removed=[];
    S.validationModal={...item};
    render();

    // Carregamento de imagens em segundo plano sem travar a interface
    loadImages(item).then(()=>{
      if(isFilePickerBlockingSync()||_isFilePickerActive)return;
      if(S.validationModal&&(String(S.validationModal.id_ocorrencia)===normId||String(S.validationModal.id_interno)===normId||String(S.validationModal.numero_protocolo||'').trim().toUpperCase()===normId.toUpperCase())){
        render();
      }
    }).catch(err=>console.warn('[ValidationModal] Aviso ao carregar imagens:',err));
  }catch(error){
    console.warn('Acesso negado à ocorrência pendente.',error);
    fail('Registro não encontrado ou sem autorização para acessá-lo.');
  }
}
async function savePendingDraft(form){
  if(denyOperatorAccess())return;
  if(!canValidateOccurrence(S.user))return fail('Sem permissão para alterar ocorrências pendentes.');
  const id=String(form.elements['id_ocorrencia']?.value||'').trim();
  if(!id)return;

  const current=(S.occ||[]).find(x=>String(x.id_ocorrencia||'').trim()===id||String(x.id_interno||'').trim()===id||String(x.numero_protocolo||'').trim()===id);
  if(!current)return fail('Ocorrência pendente não encontrada.');

  const raw=Object.fromEntries(new FormData(form));
  if(raw.tipo_vinculo==='Grupo CSN'){
    raw.documento='';
    raw.gerencia_envolvido=raw.gerencia_envolvido||raw.gerencia||'';
    raw.gerencia=raw.gerencia_envolvido;
    raw.gerencia_geral=raw.gerencia_geral||'';
    raw.diretoria=raw.diretoria||'';
  }else if(raw.tipo_vinculo){
    raw.matricula_id='';
    raw.gerencia_envolvido='';
    raw.gerencia='';
    raw.gerencia_geral='';
    raw.diretoria='';
  }
  const finalUnit=raw.unidade||current.unidade;
  const linkedSupervision=supervisionForUnit(finalUnit);

  // Snapshot anterior para rollback defensivo
  const prevOcc=[...(S.occ||[])];
  const prevPending=[...(S.pending||[])];
  const prevNewPhotos=[...S.newPhotos];
  const prevExisting=[...S.existing];
  const prevRemoved=[...S.removed];

  const plannedNewPaths = planPhotoPaths(current.numero_protocolo, prevNewPhotos, prevExisting, prevRemoved);
  const photoPaths=[...prevExisting.map(x=>x.path), ...plannedNewPaths].filter(Boolean);
  const updated={
    ...current,
    ...raw,
    id_ocorrencia:current.id_ocorrencia,
    id_interno:current.id_interno||current.id_ocorrencia,
    numero_protocolo:current.numero_protocolo,
    supervisao:linkedSupervision?.nome||raw.supervisao||current.supervisao,
    unidade:finalUnit,
    anexos_referencias:photoPaths.join('|'),
    status:'pendente',
    status_validacao:'Pendente de validação',
    observacao_validacao:raw.observacoes??current.observacao_validacao??'',
    versao_registro:String((+current.versao_registro||0)+1),
    usuario_ultima_alteracao:S.user.login,
    data_atualizacao:now()
  };

  // 1. ATUALIZAÇÃO INSTANTÂNEA DA INTERFACE (0 ms)
  S.occ=S.occ.map(x=>(String(x.id_ocorrencia)===id||String(x.id_interno)===id)?updated:x);
  S.pending=filteredPendingOccurrences();
  S.validationModal=null;
  cleanup();
  hideLoading();
  render();
  showToast('Alterações salvas com sucesso','success');

  // 2. PERSISTÊNCIA ASSÍNCRONA EM BACKGROUND COM WRITE LOCK
  (async()=>{
    try{
      await ensureDataWritePermission();
      let savedNew=[];
      if(prevNewPhotos.length){
        savedNew=await savePhotos(current.numero_protocolo, prevNewPhotos, prevExisting, prevRemoved);
      }
      if(prevRemoved.length){
        await removeFiles(prevRemoved);
      }
      const finalPhotoPaths=[...prevExisting.map(x=>x.path), ...savedNew].filter(Boolean);
      await withWriteLock('occurrences',async()=>{
        const updatedWithPhotos={
          ...updated,
          anexos_referencias:finalPhotoPaths.join('|')
        };
        let savedResult=null;
        if(window.StorageService?.appendSingleRecord){
          savedResult=await window.StorageService.appendSingleRecord('ocorrencias.csv',updatedWithPhotos,H.occ,{isNewRecord:false});
        }else{
          savedResult=await CSVService.append('ocorrencias.csv',updatedWithPhotos,H.occ);
        }
        if(typeof CSVService!=='undefined'){
          CSVService.buildEntry('ocorrencias.csv',S.occ);
        }
        window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally('ocorrencias.csv',S.occ).catch(()=>{});
      });
      prevNewPhotos.forEach(x=>x.url&&URL.revokeObjectURL(x.url));
    }catch(err){
      console.error('[Rollback] Falha ao persistir rascunho de validação no disco:',err);
      S.occ=prevOcc;
      S.pending=prevPending;
      render();
      showToast(err.message||'Falha ao gravar no disco. Rascunho restaurado.','error','Erro ao salvar');
    }
  })();
}
async function validatePendingOcc(id,form=null){
  if(hasProfile(S.user,'Operador'))return denyOperatorAccess();
  if(!canValidateOccurrence(S.user))return fail('Somente administradores e supervisores podem validar ocorrências.');

  const normId=String(id??'').trim();
  const current=(S.occ||[]).find(x=>String(x.id_ocorrencia||'').trim()===normId||String(x.id_interno||'').trim()===normId||String(x.numero_protocolo||'').trim().toUpperCase()===normId.toUpperCase());
  if(!current)return fail('Ocorrência não encontrada na base de dados.');

  if(!isPendingOccurrence(current)){
    S.validationModal=null;
    cleanup();
    render();
    showToast('Esta ocorrência já foi validada por outro administrador.','error','Validação Concorrente');
    return;
  }

  const formData=form?Object.fromEntries(new FormData(form)):{};
  if(formData.tipo_vinculo==='Grupo CSN'){
    formData.documento='';
    formData.gerencia_envolvido=formData.gerencia_envolvido||formData.gerencia||'';
    formData.gerencia=formData.gerencia_envolvido;
    formData.gerencia_geral=formData.gerencia_geral||'';
    formData.diretoria=formData.diretoria||'';
  }else if(formData.tipo_vinculo){
    formData.matricula_id='';
    formData.gerencia_envolvido='';
    formData.gerencia='';
    formData.gerencia_geral='';
    formData.diretoria='';
  }
  const finalUnit=formData.unidade||current.unidade;
  const linkedSupervision=supervisionForUnit(finalUnit);

  const prevOcc=[...(S.occ||[])];
  const prevPending=[...(S.pending||[])];
  const prevNewPhotos=[...S.newPhotos];
  const prevExisting=[...S.existing];
  const prevRemoved=[...S.removed];

  const idIntVal=String(current.id_interno||formData.id_interno||current.id_ocorrencia||'').trim()||String(current.id_ocorrencia||'').trim();
  const timeNow=now();
  const plannedNewPaths = planPhotoPaths(current.numero_protocolo, prevNewPhotos, prevExisting, prevRemoved);
  const photoPaths=[...prevExisting.map(x=>x.path), ...plannedNewPaths].filter(Boolean);

  const updatedRow={
    ...current,
    ...formData,
    id_ocorrencia:String(current.id_ocorrencia),
    id_interno:idIntVal,
    numero_protocolo:String(current.numero_protocolo),
    supervisao:linkedSupervision?.nome||formData.supervisao||current.supervisao,
    unidade:finalUnit,
    anexos_referencias:photoPaths.join('|'),
    status:'Registrada',
    status_validacao:'Validada',
    data_validacao:timeNow,
    validado_por:S.user.login,
    observacao_validacao:formData.observacoes||current.observacao_validacao||current.observacoes||'Aprovado pela validação',
    versao_registro:String((+current.versao_registro||0)+1),
    usuario_ultima_alteracao:S.user.login,
    data_atualizacao:timeNow
  };

  // 1. ATUALIZAÇÃO INSTANTÂNEA DA INTERFACE (0 ms)
  S.validationModal=null;
  cleanup();
  hideLoading();
  S.occ=S.occ.map(x=>(String(x.id_ocorrencia)===normId||String(x.id_interno)===normId||String(x.numero_protocolo)===String(current.numero_protocolo))?updatedRow:x);
  S.pending=filteredPendingOccurrences();
  _apuracaoFilterMemo={rowsRef:null,fKey:'',result:[]};
  _occFilterMemo={rowsRef:null,query:'',result:[]};
  _histFilterMemo={rowsRef:null,filterKey:'',result:[]};
  render();
  showToast('Ocorrência validada com sucesso','success');

  // 2. PERSISTÊNCIA ASSÍNCRONA EM BACKGROUND COM RESILIÊNCIA E WRITE LOCK
  (async()=>{
    try{
      await ensureDataWritePermission();
      let savedNew=[];
      if(prevNewPhotos.length){
        savedNew=await savePhotos(current.numero_protocolo, prevNewPhotos, prevExisting, prevRemoved);
      }
      if(prevRemoved.length){
        await removeFiles(prevRemoved);
      }
      const finalPhotoPaths=[...prevExisting.map(x=>x.path), ...savedNew].filter(Boolean);
      await withWriteLock('occurrences',async()=>{
        const finalRow={
          ...updatedRow,
          anexos_referencias:finalPhotoPaths.join('|')
        };
        let savedResult=null;
        if(window.StorageService?.appendSingleRecord){
          savedResult=await window.StorageService.appendSingleRecord('ocorrencias.csv',finalRow,H.occ,{isNewRecord:false});
        }else{
          savedResult=await CSVService.append('ocorrencias.csv',finalRow,H.occ);
        }
        await window.StorageService?.updateOccurrenceInLegacyBase?.(finalRow);
        if(typeof CSVService!=='undefined'){
          CSVService.buildEntry('ocorrencias.csv',S.occ);
        }
        window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally('ocorrencias.csv',S.occ).catch(()=>{});
        const stat=await window.StorageService?.getFileStat('ocorrencias.csv').catch(()=>null);
        if(stat){
          _freshCsvMeta.set('ocorrencias.csv',{mtimeMs:stat.mtimeMs,size:stat.size,rawSig:''});
        }
      });
      prevNewPhotos.forEach(x=>x.url&&URL.revokeObjectURL(x.url));
    }catch(bgErr){
      console.error('[Rollback] Falha ao persistir validação no disco:',bgErr);
      S.occ=prevOcc;
      S.pending=prevPending;
      render();
      showToast(bgErr.message||'Falha ao gravar validação no disco. Ocorrência restaurada.','error','Erro na Validação');
    }
  })();
}
async function deletePendingOcc(id){
  if(hasProfile(S.user,'Operador'))return denyOperatorAccess();
  if(!canValidateOccurrence(S.user))return fail('Somente administradores e supervisores podem excluir ocorrências pendentes.');
  
  const normId=String(id??'').trim();
  const prevOcc=[...(S.occ||[])];
  const prevPending=[...(S.pending||[])];
  
  // Optimistic UI: Fecha o modal imediatamente e remove o registro da interface sem latência (0ms)
  S.deletePendingTarget=null;
  S.occ=(S.occ||[]).filter(x=>String(x.id_ocorrencia||'').trim()!==normId&&(!x.id_interno||String(x.id_interno).trim()!==normId)&&String(x.numero_protocolo||'').trim().toUpperCase()!==normId.toUpperCase());
  S.pending=filteredPendingOccurrences();
  render();
  showToast('Ocorrência pendente excluída com sucesso.','success','Fila de Validação');

  // Persistência assíncrona em background com rollback seguro
  (async()=>{
    try{
      await ensureDataWritePermission();
      await withWriteLock('occurrences',async()=>{
        await refreshAccessContext();
        const rawText=await fetchFreshRawCsv('ocorrencias.csv');
        const freshRows=parseAndConsolidateCsv(rawText);
        const target=freshRows.find(x=>String(x.id_ocorrencia||'').trim()===normId||String(x.id_interno||'').trim()===normId||String(x.numero_protocolo||'').trim().toUpperCase()===normId.toUpperCase());
        if(target){
          assertUnitAccess(target.unidade);
          const auditItem={
            id_exclusao:uid(),
            modulo_origem:'Ocorrências',
            data_hora_exclusao:now(),
            administrador:S.user?.login||'admin',
            id_registro:target.id_ocorrencia||normId,
            codigo_registro:target.numero_protocolo||normId,
            dados_originais:JSON.stringify(target),
            motivo_exclusao:'Exclusão de ocorrência pendente pelo validador'
          };
          if(window.StorageService?.appendRecord){
            await window.StorageService.appendRecord('registros_apagados.csv',auditItem,H.registros_apagados);
          }else{
            const currentDeleted=await read('registros_apagados.csv').catch(()=>[]);
            await write('registros_apagados.csv',[auditItem,...currentDeleted],H.registros_apagados);
          }
          const nextRows=freshRows.filter(x=>String(x.id_ocorrencia||'').trim()!==normId&&(!x.id_interno||String(x.id_interno).trim()!==normId)&&String(x.numero_protocolo||'').trim().toUpperCase()!==normId.toUpperCase());
          await write('ocorrencias.csv',nextRows,H.occ);
        }
        await window.StorageService?.deleteOccurrenceRecord?.(target?.numero_protocolo||target?.id_ocorrencia||normId);
        await window.StorageService?.deleteOccurrenceRecord?.(normId);
      });
    }catch(error){
      console.error('Falha na persistência da exclusão de ocorrência pendente:',error);
      // Rollback automático caso a persistência física falhe
      S.occ=prevOcc;
      S.pending=prevPending;
      render();
      showToast(error.message||'Não foi possível confirmar a exclusão no disco. Ocorrência restaurada.','error','Erro na exclusão');
    }
  })();
}

async function executeRecordDeletion(){
  if(!isAdministratorUser(S.user)){
    fail('Apenas Administradores possuem autorização para excluir registros.');
    S.deleteRecordTarget=null;
    render();
    return;
  }
  const target=S.deleteRecordTarget;
  if(!target)return;
  const {modulo,id,code}=target;

  // Snapshot para rollback defensivo
  const prevOcc=[...(S.occ||[])];
  const prevPending=[...(S.pending||[])];
  const prevKeys=[...(S.keys||[])];
  const prevInsp=[...(S.inspecoes||[])];

  // Optimistic UI: Fecha modal de confirmação imediatamente e remove da interface (0ms)
  S.deleteRecordTarget=null;
  if(modulo==='Ocorrências'){
    S.occ=(S.occ||[]).filter(x=>x.id_ocorrencia!==id&&x.numero_protocolo!==id);
    S.pending=filteredPendingOccurrences();
  }else if(modulo==='Chaves'){
    S.keys=(S.keys||[]).filter(x=>x.id_chave!==id&&x.codigo!==id);
  }else if(modulo==='Meio Ambiente'){
    S.inspecoes=(S.inspecoes||[]).filter(x=>String(x.id)!==String(id));
  }
  render();
  showToast(`Registro de ${modulo} (${code||id}) excluído com sucesso.`,'success');

  // Persistência em background (Auditoria + Exclusão nos CSVs e IndexedDB)
  (async()=>{
    try{
      await ensureDataWritePermission();
      const time=now();
      const adminUser=S.user?.login||'admin';

      if(modulo==='Ocorrências'){
        await withWriteLock('occurrences',async()=>{
          const occList=await read('ocorrencias.csv');
          const original=occList.find(x=>x.id_ocorrencia===id||x.numero_protocolo===id);
          if(!original)return;
          const auditItem={
            id_exclusao:uid(),
            modulo_origem:'Ocorrências',
            data_hora_exclusao:time,
            administrador:adminUser,
            id_registro:original.id_ocorrencia||id,
            codigo_registro:original.numero_protocolo||code||id,
            dados_originais:JSON.stringify(original),
            motivo_exclusao:'Exclusão definitiva solicitada por Administrador'
          };
          if(window.StorageService?.appendRecord){
            await window.StorageService.appendRecord('registros_apagados.csv',auditItem,H.registros_apagados);
          }else{
            const currentDeleted=await read('registros_apagados.csv').catch(()=>[]);
            await write('registros_apagados.csv',[auditItem,...currentDeleted],H.registros_apagados);
          }
          const updatedList=occList.filter(x=>x.id_ocorrencia!==original.id_ocorrencia&&x.numero_protocolo!==original.numero_protocolo);
          await write('ocorrencias.csv',updatedList,H.occ);
          await window.StorageService?.deleteOccurrenceRecord?.(original.numero_protocolo||original.id_ocorrencia||id);
          await window.StorageService?.deleteOccurrenceRecord?.(id);
        });
      }else if(modulo==='Chaves'){
        await withWriteLock('keys',async()=>{
          const keysList=await read('chaves.csv');
          const original=keysList.find(x=>x.id_chave===id||x.codigo===id);
          if(!original)return;
          const auditItem={
            id_exclusao:uid(),
            modulo_origem:'Chaves',
            data_hora_exclusao:time,
            administrador:adminUser,
            id_registro:original.id_chave||id,
            codigo_registro:original.codigo||code||id,
            dados_originais:JSON.stringify(original),
            motivo_exclusao:'Exclusão definitiva solicitada por Administrador'
          };
          if(window.StorageService?.appendRecord){
            await window.StorageService.appendRecord('registros_apagados.csv',auditItem,H.registros_apagados);
          }else{
            const currentDeleted=await read('registros_apagados.csv').catch(()=>[]);
            await write('registros_apagados.csv',[auditItem,...currentDeleted],H.registros_apagados);
          }
          const updatedKeys=keysList.filter(x=>x.id_chave!==original.id_chave);
          await write('chaves.csv',updatedKeys,H.keys);
        });
      }else if(modulo==='Meio Ambiente'){
        await withWriteLock('ambiental',async()=>{
          const inspList=await read(ENVIRONMENTAL_FILE);
          const original=inspList.find(x=>String(x.id)===String(id));
          if(!original)return;
          const auditItem={
            id_exclusao:uid(),
            modulo_origem:'Meio Ambiente',
            data_hora_exclusao:time,
            administrador:adminUser,
            id_registro:original.id||id,
            codigo_registro:original.placa||code||id,
            dados_originais:JSON.stringify(original),
            motivo_exclusao:'Exclusão definitiva solicitada por Administrador'
          };
          if(window.StorageService?.appendRecord){
            await window.StorageService.appendRecord('registros_apagados.csv',auditItem,H.registros_apagados);
          }else{
            const currentDeleted=await read('registros_apagados.csv').catch(()=>[]);
            await write('registros_apagados.csv',[auditItem,...currentDeleted],H.registros_apagados);
          }
          const updatedInsp=inspList.filter(x=>String(x.id)!==String(original.id));
          await write(ENVIRONMENTAL_FILE,updatedInsp,H.inspecoes);
        });
      }

      S.deletedRecords=await read('registros_apagados.csv').catch(()=>[]);
      try{
        await withWriteLock('system-audit',async()=>{
          const disk=await read('historico_sistema.csv').catch(()=>[]);
          const auditLog={
            id_auditoria:uid(),
            data_hora:time,
            usuario:adminUser,
            perfil:S.user?.perfil||'Administrador',
            modulo:modulo.toUpperCase(),
            acao:'REGISTRO_EXCLUIDO',
            id_registro:id,
            codigo_registro:code||id,
            detalhes:`Registro de ${modulo} (${code||id}) excluído e arquivado em registros_apagados.csv`
          };
          S.audits=await write('historico_sistema.csv',[auditLog,...disk],H.audit);
        });
      }catch(auditErr){
        console.warn('Registro no histórico do sistema falhou:',auditErr);
      }
    }catch(error){
      console.error('Falha ao persistir exclusão do registro:',error);
      // Rollback defensivo imediato
      if(modulo==='Ocorrências'){
        S.occ=prevOcc;
        S.pending=prevPending;
      }else if(modulo==='Chaves'){
        S.keys=prevKeys;
      }else if(modulo==='Meio Ambiente'){
        S.inspecoes=prevInsp;
      }
      render();
      showToast(error.message||'Falha ao gravar exclusão no disco. Registro restaurado.','error','Erro na exclusão');
    }
  })();
}
const ACTIVE_RESERVATION_STORAGE_KEY='SIGESP_ACTIVE_PROTOCOL_RESERVATION';
function getTabSessionClientId(){
  return window.StorageService?.getClientSessionId?window.StorageService.getClientSessionId():uid();
}
function loadStoredActiveReservation(userLogin=''){
  const currentSessionId=getTabSessionClientId();
  if(S.activeReservation&&S.activeReservation.numeroProtocolo&&S.activeReservation.sessionId===currentSessionId){
    const protoUpper=String(S.activeReservation.numeroProtocolo).trim().toUpperCase();
    const alreadyPersisted=(S.occ||[]).some(item=>String(item.numero_protocolo||'').trim().toUpperCase()===protoUpper);
    if(!alreadyPersisted)return S.activeReservation;
  }
  try{
    if(typeof sessionStorage!=='undefined'){
      const raw=sessionStorage.getItem(ACTIVE_RESERVATION_STORAGE_KEY);
      if(raw){
        const parsed=JSON.parse(raw);
        const proto=String(parsed?.numeroProtocolo||parsed?.protocolo||'').trim().toUpperCase();
        const ageMs=Date.now()-(Number(parsed?.savedAtMs)||0);
        const sameSession=!parsed?.sessionId||parsed.sessionId===currentSessionId;
        const sameUser=!userLogin||!parsed?.usuario||String(parsed.usuario).toLowerCase()===String(userLogin).toLowerCase();
        const alreadyPersisted=(S.occ||[]).some(item=>String(item.numero_protocolo||'').trim().toUpperCase()===proto);
        if(proto&&sameSession&&sameUser&&ageMs>=0&&ageMs<30*60*1000&&!alreadyPersisted){
          S.activeReservation=parsed;
          return parsed;
        }
      }
    }
  }catch{}
  return null;
}
function saveStoredActiveReservation(res){
  if(!res||!(res.numeroProtocolo||res.protocolo))return;
  const normalized={
    reservationId:res.reservationId||res.id_reserva||'',
    numeroProtocolo:String(res.numeroProtocolo||res.protocolo).trim(),
    protocolo:String(res.protocolo||res.numeroProtocolo).trim(),
    id_sequencial:Number(res.id_sequencial)||extrairNumeroIdOuProtocolo(res.numeroProtocolo||res.protocolo),
    sessionId:res.sessionId||res.clientId||getTabSessionClientId(),
    usuario:res.usuario||res.user||S.user?.login||'Operador',
    dataHoraReserva:res.dataHoraReserva||new Date().toISOString(),
    status:res.status||'RESERVADO',
    savedAtMs:Date.now()
  };
  S.activeReservation=normalized;
  try{
    if(typeof sessionStorage!=='undefined'){
      sessionStorage.setItem(ACTIVE_RESERVATION_STORAGE_KEY,JSON.stringify(normalized));
    }
  }catch{}
}
function clearStoredActiveReservation(){
  S.activeReservation=null;
  try{
    if(typeof sessionStorage!=='undefined'){
      sessionStorage.removeItem(ACTIVE_RESERVATION_STORAGE_KEY);
    }
  }catch{}
}
async function releaseCurrentReservation(){
  const active=S.activeReservation||loadStoredActiveReservation(S.user?.login||'');
  const proto=S.editing?._reservedProtocol||active?.numeroProtocolo||'';
  const clientId=S.editing?._clientId||active?.sessionId||getTabSessionClientId();
  const reservationId=S.editing?._reservationId||active?.reservationId||'';
  clearStoredActiveReservation();
  if(S.editing){
    S.editing._reservedProtocol=null;
    S.editing._reservationId=null;
    S.editing._reservationConfirmed=false;
  }
  if(proto){
    try{
      await window.StorageService?.releaseProtocol(proto,S.user?.login||'Operador',clientId,reservationId);
    }catch(e){}
  }
}

let _lastProtocolRenewal=0;
function renewProtocolHeartbeat(protocol){
  if(!protocol)return;
  const nowTime=Date.now();
  if(nowTime-_lastProtocolRenewal<30000)return; // throttle 30s
  _lastProtocolRenewal=nowTime;
  const active=S.activeReservation||loadStoredActiveReservation(S.user?.login||'');
  const clientId=S.editing?._clientId||active?.sessionId||getTabSessionClientId();
  const reservationId=S.editing?._reservationId||active?.reservationId||'';
  window.StorageService?.renewProtocol(protocol,S.user?.login||'Operador',{clientId,reservationId}).then(res=>{
    if(res&&(res.conflict||res.expired)){
      clearStoredActiveReservation();
      if(S.page==='occ-register'&&S.editing&&!S.editing.id_ocorrencia&&!S.submitting){
        void ensureActiveProtocolReservation({forceNew:true,preserveForm:true});
      }
    }
  }).catch(()=>{});
}

let _openOccRegPromise=null;
async function ensureActiveProtocolReservation(options={}){
  if(_openOccRegPromise)return _openOccRegPromise;
  const forceNew=Boolean(options.forceNew);
  const preserveForm=Boolean(options.preserveForm);
  const clientId=getTabSessionClientId();
  const userLogin=S.user?.login||'Operador';
  const existingRes=!forceNew?loadStoredActiveReservation(userLogin):null;

  if(!existingRes||forceNew){
    S.reservingProtocol=true;
    if(S.editing&&!S.editing.id_ocorrencia&&!S.editing.numero_protocolo){
      const quickProto=gerarProximoId(S.occ,S.pending).protocolo;
      S.editing.numero_protocolo=quickProto;
      S.editing._reservedProtocol=quickProto;
      S.editing._reservationConfirmed=false;
    }
    if(S.page==='occ-register')render();
  }

  _openOccRegPromise=(async()=>{
    try{
      const res=await window.StorageService?.reserveProtocol(userLogin,S.editing?.unidade||'',{
        clientId,
        reservationId:existingRes?.reservationId||'',
        preferredProtocol:existingRes?.numeroProtocolo||'',
        forceNew
      });
      if(res?.protocolo){
        saveStoredActiveReservation({
          reservationId:res.reservationId||res.id_reserva||existingRes?.reservationId||'',
          numeroProtocolo:res.protocolo,
          protocolo:res.protocolo,
          id_sequencial:res.id_sequencial||extrairNumeroIdOuProtocolo(res.protocolo),
          sessionId:clientId,
          usuario:userLogin,
          dataHoraReserva:res.dataHoraReserva||new Date().toISOString(),
          status:'RESERVADO'
        });
        S.reservingProtocol=false;
        if(S.page==='occ-register'&&(!S.editing?.id_ocorrencia)){
          const formEl=preserveForm?document.getElementById('occForm'):null;
          const draft=formEl?captureOccurrenceDraft(formEl):(S.editing||{});
          S.editing={
            ...draft,
            numero_protocolo:res.protocolo,
            _reservedProtocol:res.protocolo,
            _reservationId:res.reservationId||res.id_reserva||'',
            _reservationConfirmed:true,
            _clientId:clientId
          };
          render();
        }
      }
      return res;
    }catch(err){
      S.reservingProtocol=false;
      console.warn('[SIGESP] Falha na reserva centralizada de protocolo:',err);
      if(S.page==='occ-register')render();
      return null;
    }finally{
      _openOccRegPromise=null;
    }
  })();

  return _openOccRegPromise;
}

async function openOccurrenceRegistration(options={}){
  const isEvent=options&&(typeof options.preventDefault==='function'||options instanceof Event);
  const opts=isEvent?{}:(options||{});
  const forceNew=Boolean(opts.forceNew);
  const clearDraft=Boolean(opts.clearDraft);

  if(clearDraft||forceNew){
    cleanup();
    S.occurrenceDraft=null;
  }
  if(forceNew&&opts.releaseExisting){
    await releaseCurrentReservation();
  }else if(forceNew){
    clearStoredActiveReservation();
  }

  const clientId=getTabSessionClientId();
  const userLogin=S.user?.login||'Operador';
  const storedRes=!forceNew?loadStoredActiveReservation(userLogin):null;
  const draftToRestore=(!forceNew&&!clearDraft&&S.occurrenceDraft)?{...S.occurrenceDraft}:{};
  delete draftToRestore.id_ocorrencia;

  S.successPopup=null;
  S.modal=null;
  S.errorPopup=null;
  const instantProto=storedRes?.numeroProtocolo||gerarProximoId(S.occ,S.pending).protocolo;
  S.editing={
    ...draftToRestore,
    numero_protocolo:storedRes?.numeroProtocolo||instantProto,
    _reservedProtocol:storedRes?.numeroProtocolo||instantProto,
    _reservationId:storedRes?.reservationId||'',
    _reservationConfirmed:Boolean(storedRes?.numeroProtocolo),
    _clientId:clientId
  };
  S.reservingProtocol=!storedRes?.numeroProtocolo;
  S.page='occ-register';
  S.activeMenu='ocorrencias';
  S.message='';
  render();

  await ensureActiveProtocolReservation({forceNew,preserveForm:true});
}
async function editOcc(id){if(hasProfile(S.user,'Operador')){denyOperatorAccess();return}try{const r=await findAuthorizedOccurrence(id);S.modal=null;S.successPopup=null;await loadImages(r);S.editing={...r};S.page='occ-register';S.activeMenu='ocorrencias';render()}catch(error){console.warn('Acesso negado à edição de ocorrência.',error);fail('Registro não encontrado ou sem autorização para acessá-lo.')}}
async function viewOcc(id){try{const r=await findAuthorizedOccurrence(id);S.editing=null;await loadImages(r);S.modal={...r};render()}catch(error){console.warn('Acesso negado à visualização de ocorrência.',error);fail('Registro não encontrado ou sem autorização para acessá-lo.')}}

async function auditUser(action,user,details){if(denyOperatorAccess()||denyUserManagement())return;if(!canManageUsers()){const error=Error('Sem permissão para administrar usuários.');error.name='UserPermissionError';throw error}const target=await CSVService.findById('usuarios.csv',user.id_usuario,'id_usuario');if(!target)throw Error('Usuário não encontrado.');assertUserTargetPermission(target);await withWriteLock('system-audit',async()=>{const item={id_auditoria:uid(),data_hora:now(),usuario:S.user.login,perfil:S.user.perfil,modulo:'USUARIOS',acao:action,id_registro:target.id_usuario,codigo_registro:target.login,detalhes:details};if(window.StorageService?.appendRecord){await window.StorageService.appendRecord('historico_sistema.csv',item,H.audit,{isNewRecord:true});S.audits=[item,...(S.audits||[])];CSVService.buildEntry('historico_sistema.csv',S.audits)}else{const disk=await read('historico_sistema.csv'),next=[item,...disk];S.audits=await write('historico_sistema.csv',next,H.audit);CSVService.buildEntry('historico_sistema.csv',S.audits)}})}
function allowedProfiles(){if(hasProfile(S.user,'Administrador'))return['Administrador','Supervisor','Líder','Operador','Consulta'];if(hasProfile(S.user,'Supervisor'))return['Supervisor','Líder','Operador','Consulta'];return['Operador','Consulta']}
let userSaveInProgress=false;
let userPasswordInProgress=false;
let userRemovalInProgress=false;
class UserFormValidationError extends Error{}
class UserDuplicateError extends Error{}
class UserPersistenceError extends Error{}
class UserRemovalNotFoundError extends Error{}
class UserRemovalBlockedError extends Error{}
class UserRemovalPersistenceError extends Error{}
class UserRemovalAuditError extends Error{}
class UserRemovalRollbackError extends Error{}
class UserAuditError extends Error{}
class UserRollbackError extends Error{}
class UserTargetRestrictedError extends Error{}
class UserPasswordValidationError extends Error{}
class UserPasswordPersistenceError extends Error{}
class UserPasswordAuditError extends Error{}
class UserPasswordNotFoundError extends Error{}
class OrganizationPersistenceError extends Error{}
class OrganizationAuditError extends Error{}
class OrganizationRollbackError extends Error{}
function sameUserRecord(left,right){if(!left||!right)return false;for(let i=0;i<H.users.length;i++){const k=H.users[i];if(String(left[k]??'')!==String(right[k]??''))return false}return true}
function validateUserForm(form,data,edit){
const errors=[];
if(!String(data.nome||'').trim())errors.push(['nome','Informe o nome completo.']);
if(!String(data.login||'').trim())errors.push(['login','Informe o login.']);
if(!edit&&String(data.senha||'').length<8)errors.push(['senha','A senha deve ter no mínimo 8 caracteres.']);
if(!allowedProfiles().some(profile=>normalizePerfil(profile)===normalizePerfil(data.perfil)))errors.push(['perfil','Selecione um perfil permitido para o usuário logado.']);
if(!['Ativo','Inativo'].includes(data.status))errors.push(['status','Selecione um status válido.']);
const profile=canonicalPerfil(data.perfil),supervision=S.supervisions.find(item=>item.id_supervisao===data.supervisao_id&&activeMaster(item)),existing=edit?S.users.find(user=>user.id_usuario===data.id_usuario):null,lockedForeignScope=Boolean(existing&&hasProfile(S.user,'Supervisor')&&existing.supervisao_id!==S.user.supervisao_id&&data.supervisao_id===existing.supervisao_id&&normalizePerfil(data.perfil)===normalizePerfil(existing.perfil)),preservedInactiveScope=Boolean(existing&&existing.supervisao_id===data.supervisao_id&&normalizePerfil(data.perfil)===normalizePerfil(existing.perfil)&&S.supervisions.some(item=>item.id_supervisao===data.supervisao_id));
if(profile!=='Administrador'&&!supervision&&!lockedForeignScope&&!preservedInactiveScope)errors.push(['supervisao_id','Selecione uma Supervisão ativa.']);
if(profile==='Administrador'&&hasProfile(S.user,'Supervisor'))errors.push(['perfil','Supervisores não podem cadastrar Administradores.']);
if(hasProfile(S.user,'Supervisor')&&data.supervisao_id!==S.user.supervisao_id&&!lockedForeignScope)errors.push(['supervisao_id','Só é permitido atribuir usuários à sua própria Supervisão.']);
if(['Líder','Operador','Consulta'].includes(profile)&&!lockedForeignScope){
const assigned=String(data.unidades_permitidas||'').split('|').filter(Boolean),valid=new Set(S.unitCatalog.filter(unit=>unit.id_supervisao===data.supervisao_id&&(activeMaster(unit)||(existing&&assignedUnitIds(existing).includes(unit.id_unidade)))).map(unit=>unit.id_unidade));
if(!assigned.length)errors.push(['unidades_permitidas','Selecione ao menos uma Unidade autorizada.']);
else if(assigned.some(id=>!valid.has(id)))errors.push(['unidades_permitidas','Todas as Unidades devem pertencer à Supervisão selecionada.']);
}
if(errors.length){form.elements.namedItem(errors[0][0])?.focus();const error=new UserFormValidationError(errors.map(([,message])=>message).join(' '));throw error}
}
function captureUserDraft(form){const existing=(S.editing?.kind==='user'?S.editing.data:{})||{};const data=Object.fromEntries(new FormData(form)),assigned=form.elements.namedItem('unidades_permitidas');if(assigned?.multiple)data.unidades_permitidas=[...assigned.selectedOptions].map(option=>option.value).join('|');const merged={...existing,...data};S.editing={kind:'user',data:merged};return merged}
function userSaveError(error){
if(error instanceof UserFormValidationError)return{category:'Validação do cadastro',message:error.message};
if(error instanceof UserDuplicateError)return{category:'Usuário duplicado',message:'Já existe um usuário com esse login. Escolha outro login.'};
if(error?.name==='UserPermissionError')return{category:'Permissão insuficiente',message:'Seu perfil não possui autorização para administrar usuários.'};
if(error?.name==='OrganizationPermissionError')return{category:'Permissão insuficiente',message:error.message};
if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return{category:'Permissão de acesso',message:'A permissão de acesso à pasta de dados precisa ser renovada.'};
if(error?.name==='NotFoundError')return{category:'Arquivo de usuários',message:'Não foi possível localizar ou acessar o arquivo de usuários na pasta de dados.'};
if(error instanceof OrganizationAuditError)return{category:'Falha na auditoria',message:'A alteração organizacional foi desfeita porque não foi possível registrar a auditoria.'};
if(error instanceof OrganizationRollbackError)return{category:'Falha ao desfazer a operação',message:'Não foi possível confirmar a restauração dos dados organizacionais. Verifique os arquivos CSV antes de tentar novamente.'};
if(error instanceof OrganizationPersistenceError)return{category:'Falha ao salvar',message:'Não foi possível confirmar a gravação organizacional. Verifique os arquivos CSV.'};
if(error instanceof UserAuditError)return{category:'Falha na auditoria',message:error.message};
if(error instanceof UserRollbackError)return{category:'Falha ao desfazer a operação',message:'A auditoria falhou e não foi possível confirmar a restauração dos dados anteriores. Verifique o cadastro antes de tentar novamente.'};
if(error instanceof UserPersistenceError)return{category:'Falha ao salvar',message:'Não foi possível confirmar a gravação do usuário. Os dados preenchidos foram mantidos.'};
if(/Perfil não permitido|Usuário não encontrado|administrador principal/i.test(String(error?.message||'')))return{category:'Validação do cadastro',message:error.message};
return{category:'Falha ao salvar',message:'Não foi possível concluir o salvamento. Os dados preenchidos foram mantidos.'}
}
function showUserResult(type,title,message,category='',successKicker='Cadastro concluído',errorButton='Revisar cadastro'){
document.getElementById('userResultOverlay')?.remove();
const overlay=document.createElement('div');
overlay.id='userResultOverlay';overlay.className='modalbg popup-backdrop';
overlay.innerHTML=type==='success'?`<div class="result-dialog result-success"><div class="result-header"><div class="result-icon">✓</div><div class="result-kicker">${esc(successKicker)}</div><h2>${esc(title)}</h2><p>${esc(message)}</p></div><div class="result-body"><div class="result-actions"><button id="closeUserResult" class="btn success-primary">Fechar</button></div></div></div>`:`<div class="result-dialog result-error"><div class="error-strip"></div><div class="error-body"><div class="error-icon">!</div><div><div class="result-kicker error-kicker">${esc(category)}</div><h2>${esc(title)}</h2><p>${esc(message)}</p></div></div><div class="result-actions error-actions"><button id="closeUserResult" class="btn error-primary">${esc(errorButton)}</button></div></div>`;
document.body.appendChild(overlay);
document.getElementById('closeUserResult')?.addEventListener('click',()=>{overlay.remove();if(type==='error'&&errorButton==='Revisar cadastro')document.querySelector('#userForm [name="nome"]')?.focus()})
}
async function organizationAudit(action,id,name){await withWriteLock('system-audit',async()=>{const rows=await read('historico_sistema.csv'),item={id_auditoria:uid(),data_hora:now(),usuario:S.user.login,perfil:S.user.perfil,modulo:'ORGANIZACAO',acao:action,id_registro:id,codigo_registro:name,detalhes:name},next=[item,...rows];const saved=await write('historico_sistema.csv',next,H.audit);if(!saved.some(row=>row.id_auditoria===item.id_auditoria))throw new OrganizationAuditError();S.audits=saved})}
async function commitOrganizationChange(file,headers,before,after,action,id,name){const confirmed=await write(file,after,headers);if(!confirmed||confirmed.length!==after.length)throw new OrganizationPersistenceError();try{await organizationAudit(action,id,name)}catch(error){console.error('Falha ao registrar alteração organizacional na auditoria.',error);try{await write(file,before,headers)}catch(rollbackError){console.error('Falha ao restaurar cadastro organizacional após erro na auditoria.',rollbackError);throw new OrganizationRollbackError()}throw error instanceof OrganizationAuditError?error:new OrganizationAuditError()}}
function masterEntityName(entity){return entity==='supervision'?'Supervisão':entity==='unit'?'Unidade':'Natureza de Ocorrência'}
function masterEntityRecords(entity){return entity==='supervision'||entity==='supervisions'?S.supervisions:entity==='unit'||entity==='units'?S.unitCatalog:S.natureCatalog}
function findMasterRecord(entity,id){return masterEntityRecords(entity).find(item=>(entity==='nature'?item.id_natureza:entity==='unit'?item.id_unidade:item.id_supervisao)===id)}
function openMasterEditor(entity,id=''){if(!hasProfile(S.user,'Administrador')){S.accessDenied=true;return render()}const record=id?findMasterRecord(entity,id):null;S.masterConfirmation=null;S.masterEditor={entity,id,data:record?{...record}: {}};render()}
function masterRows(entity,before,data,id){const type=entity==='supervision'?'SUPERVISAO':entity==='unit'?'UNIDADE':'';if(entity==='nature'){const current=before.find(item=>item.id_natureza===id);return before.map(item=>item.id_natureza===id?{...item,nome:data.nome,aliases:masterAliases(current?.aliases,current?.nome,data.nome)}:item).concat(current?[]:[{id_natureza:id,nome:data.nome,ativo:'1',aliases:'[]'}])}const current=before.find(item=>item.tipo===type&&item.id===id),next=before.map(item=>item.tipo===type&&item.id===id?{...item,nome:data.nome,supervisao_id:entity==='unit'?data.supervisao_id:'',aliases:entity==='unit'?masterAliases(item.aliases,item.nome,data.nome):''}:item);if(!current)next.push({tipo:type,id,nome:data.nome,supervisao_id:entity==='unit'?data.supervisao_id:'',ativo:'1',aliases:'[]'});return next}
function masterAliases(serialized,oldName,newName){const aliases=(()=>{try{return JSON.parse(serialized||'[]')}catch{return[]}})(),values=[...aliases];if(oldName&&normalizedMasterName(oldName)!==normalizedMasterName(newName)&&!values.some(value=>normalizedMasterName(value)===normalizedMasterName(oldName)))values.push(oldName);return JSON.stringify(values)}
async function saveMasterData(ev){
  ev.preventDefault();
  if(S.masterBusy)return;
  const form=ev.target,editor=S.masterEditor;
  if(!editor)return;

  const data=Object.fromEntries(new FormData(form)),entity=editor.entity,id=editor.id||uid(),name=String(data.nome||'').trim();
  if(!name){
    showUserResult('error','Não foi possível salvar a configuração',`Informe o nome de ${masterEntityName(entity)}.`,'Configurações','Configuração salva','Fechar');
    return;
  }

  // Pre-validate uniqueness in-memory
  const currentCatalog=masterEntityRecords(entity);
  const duplicate=entity==='nature'?currentCatalog.some(item=>item.id_natureza!==editor.id&&normalizedMasterName(item.nome)===normalizedMasterName(name)):currentCatalog.some(item=>(entity==='unit'?item.id_unidade:item.id_supervisao)!==editor.id&&normalizedMasterName(item.nome)===normalizedMasterName(name));
  if(duplicate){
    showUserResult('error','Não foi possível salvar a configuração',`Já existe ${entity==='nature'?'uma natureza':`uma ${masterEntityName(entity)}`} com esse nome.`,'Configurações','Configuração salva','Fechar');
    return;
  }
  if(entity==='unit'&&!S.supervisions.some(item=>item.id_supervisao===data.supervisao_id&&activeMaster(item))){
    showUserResult('error','Não foi possível salvar a configuração','Selecione uma Supervisão ativa para a Unidade.','Configurações','Configuração salva','Fechar');
    return;
  }

  // Snapshots for defensive rollback
  const prevSupervisions=[...S.supervisions];
  const prevUnits=[...S.unitCatalog];
  const prevNatures=[...S.natureCatalog];

  // Optimistic UI: update catalogs immediately (0ms)
  if(entity==='nature'){
    const current=S.natureCatalog.find(item=>item.id_natureza===id);
    S.natureCatalog=S.natureCatalog.map(item=>item.id_natureza===id?{...item,nome:name,aliases:masterAliases(current?.aliases,current?.nome,name)}:item).concat(current?[]:[{id_natureza:id,nome:name,ativo:'1',aliases:'[]'}]);
    CSVService.buildEntry('naturezas_ocorrencias.csv',S.natureCatalog);
  }else if(entity==='unit'){
    const current=S.unitCatalog.find(item=>item.id_unidade===id);
    S.unitCatalog=S.unitCatalog.map(item=>item.id_unidade===id?{...item,nome:name,id_supervisao:data.supervisao_id,aliases:masterAliases(item.aliases,item.nome,name)}:item).concat(current?[]:[{id_unidade:id,nome:name,id_supervisao:data.supervisao_id,ativo:'1',aliases:'[]'}]);
  }else if(entity==='supervision'){
    const current=S.supervisions.find(item=>item.id_supervisao===id);
    S.supervisions=S.supervisions.map(item=>item.id_supervisao===id?{...item,nome:name}:item).concat(current?[]:[{id_supervisao:id,nome:name,ativo:'1'}]);
  }

  S.masterEditor=null;
  S.masterConfirmation=null;
  S.message='';
  hideLoading();
  render();
  showUserResult('success',`${masterEntityName(editor.entity)} ${editor.id?'alterada':'cadastrada'} com sucesso.`,`${name} foi salva com sucesso.`,'','Configuração salva');

  // Background worker: persist to disk with write locks and audit trail
  (async()=>{
    S.masterBusy=true;
    try{
      await refreshAccessContext();
      assertAdministrator();
      await ensureDataWritePermission();
      await withWriteLock('organization-catalog',async()=>{
        const before=await read(entity==='nature'?'naturezas_ocorrencias.csv':'supervisoes_unidades.csv');
        const after=masterRows(entity,before,{...data,nome:name},id);
        await commitOrganizationChange(entity==='nature'?'naturezas_ocorrencias.csv':'supervisoes_unidades.csv',entity==='nature'?H.nature:H.org,before,after,`${entity.toUpperCase()}_${editor.id?'ALTERADA':'CADASTRADA'}`,id,name);
        if(entity==='unit'||entity==='supervision'){
          setOrganizationContext(after);
          CSVService.buildEntry('supervisoes_unidades.csv',after);
          try{
            if(entity==='unit'){
              const curUnits=organizationUnits(after).map(u=>({id_unidade:u.id_unidade,nome:u.nome,id_supervisao:u.id_supervisao}));
              await write('unidades.csv',curUnits,H.units).catch(()=>{});
            }else{
              const curSups=organizationSupervisions(after).map(s=>({id_supervisao:s.id_supervisao,nome:s.nome}));
              await write('supervisoes.csv',curSups,H.supervisions).catch(()=>{});
            }
          }catch(mirrorErr){console.debug('[saveMasterData] Espelho:',mirrorErr);}
        }else if(entity==='nature'){
          S.natureCatalog=after;
          CSVService.buildEntry('naturezas_ocorrencias.csv',after);
        }
      });
      _lastAccessCtxSig='';
      CSVService.invalidateCache('supervisoes_unidades.csv');
      CSVService.invalidateCache('naturezas_ocorrencias.csv');
      await refreshAccessContext();
    }catch(error){
      console.error('Falha ao salvar configuração mestre em segundo plano:',error);
      S.supervisions=prevSupervisions;
      S.unitCatalog=prevUnits;
      S.natureCatalog=prevNatures;
      render();
      const reason=error instanceof UserFormValidationError?error.message:userSaveError(error).message;
      showUserResult('error','Não foi possível salvar a configuração',reason,'Configurações','Configuração salva','Fechar');
    }finally{
      S.masterBusy=false;
    }
  })();
}
async function requestMasterDeactivation(entity,id){if(S.masterBusy)return;S.masterBusy=true;let failure=null;try{await refreshAccessContext();assertAdministrator();const record=findMasterRecord(entity,id);if(!record)throw new OrganizationPersistenceError();const turningOn=!activeMaster(record),name=record.nome;let dependencies=[];if(entity==='supervision'){const linkedUnits=S.unitCatalog.filter(unit=>unit.id_supervisao===id),linkedUsers=S.users.filter(user=>effectiveSupervisionId(user)===id);dependencies=[`${linkedUnits.length} Unidade(s) vinculada(s)`,`${linkedUsers.length} usuário(s) vinculado(s)`]}else if(entity==='unit'){const aliasSet=new Set([name,...aliasesOf(record)].map(normalizedMasterName)),[occ,pending,keys]=await Promise.all([read('ocorrencias.csv'),read('ocorrencias_pendentes.csv',{optional:true}),read('chaves.csv')]),userCount=S.users.filter(user=>assignedUnitIds(user).includes(id)).length;let historyCount=0;for(let i=0;i<occ.length;i++)if(aliasSet.has(normalizedMasterName(occ[i].unidade)))historyCount++;for(let i=0;i<pending.length;i++)if(aliasSet.has(normalizedMasterName(pending[i].unidade)))historyCount++;const keyCount=keys.filter(item=>aliasSet.has(normalizedMasterName(item.unidade))).length;dependencies=[`${userCount} usuário(s) vinculado(s)`,`${historyCount} ocorrência(s) histórica(s)`,`${keyCount} chave(s) vinculada(s)`]}else{const aliasSet=new Set([name,...aliasesOf(record)].map(normalizedMasterName)),[occ,pending]=await Promise.all([read('ocorrencias.csv'),read('ocorrencias_pendentes.csv',{optional:true})]);let count=0;for(let i=0;i<occ.length;i++)if(aliasSet.has(normalizedMasterName(occ[i].natureza_ocorrencia)))count++;for(let i=0;i<pending.length;i++)if(aliasSet.has(normalizedMasterName(pending[i].natureza_ocorrencia)))count++;dependencies=[`${count} ocorrência(s) histórica(s)`]}S.masterConfirmation={entity,id,name,active:turningOn,dependencies:dependencies.filter(text=>!/^0 /.test(text))};if(!S.masterConfirmation.dependencies.length)S.masterConfirmation.dependencies=['Nenhuma dependência encontrada'];}catch(error){failure=error;console.error('Falha ao verificar dependências da configuração.',error);S.masterConfirmation={error:userSaveError(error).message}}finally{S.masterBusy=false}render()}
async function deactivateMasterRecord(){
  if(S.masterBusy||!S.masterConfirmation||S.masterConfirmation.error)return;
  const confirmation=S.masterConfirmation;

  // Snapshots for rollback
  const prevSupervisions=[...S.supervisions];
  const prevUnits=[...S.unitCatalog];
  const prevNatures=[...S.natureCatalog];
  const nextStatus=confirmation.active?'1':'0';

  // Optimistic UI: update catalogs immediately (0ms)
  if(confirmation.entity==='nature'){
    S.natureCatalog=S.natureCatalog.map(item=>item.id_natureza===confirmation.id?{...item,ativo:nextStatus}:item);
    CSVService.buildEntry('naturezas_ocorrencias.csv',S.natureCatalog);
  }else if(confirmation.entity==='unit'){
    S.unitCatalog=S.unitCatalog.map(item=>item.id_unidade===confirmation.id?{...item,ativo:nextStatus}:item);
  }else if(confirmation.entity==='supervision'){
    S.supervisions=S.supervisions.map(item=>item.id_supervisao===confirmation.id?{...item,ativo:nextStatus}:item);
  }

  S.masterConfirmation=null;
  hideLoading();
  render();
  showUserResult('success',`${masterEntityName(confirmation.entity)} ${confirmation.active?'reativada':'inativada'} com sucesso.`,`${confirmation.name} foi atualizada sem apagar referências históricas.`,'','Configuração atualizada');

  // Background worker: persist to disk
  (async()=>{
    S.masterBusy=true;
    try{
      await refreshAccessContext();
      assertAdministrator();
      await ensureDataWritePermission();
      await withWriteLock('organization-catalog',async()=>{
        const isNature=confirmation.entity==='nature',file=isNature?'naturezas_ocorrencias.csv':'supervisoes_unidades.csv',headers=isNature?H.nature:H.org,before=await read(file);
        if(confirmation.active&&confirmation.entity==='unit'){
          const unit=before.find(item=>item.tipo==='UNIDADE'&&item.id===confirmation.id);
          if(!S.supervisions.some(item=>item.id_supervisao===unit?.supervisao_id&&activeMaster(item)))throw new UserFormValidationError('Reative primeiro a Supervisão vinculada à Unidade.');
        }
        let changed=false;
        const after=before.map(item=>{
          const id=isNature?item.id_natureza:item.id;
          if(id!==confirmation.id)return item;
          if(String(item.ativo??'1')!==nextStatus)changed=true;
          return{...item,ativo:nextStatus};
        });
        if(!changed)throw new UserFormValidationError('A configuração já está com esse status.');
        await commitOrganizationChange(file,headers,before,after,`${confirmation.entity.toUpperCase()}_${confirmation.active?'REATIVADA':'INATIVADA'}`,confirmation.id,confirmation.name);
      });
      await refreshAccessContext();
    }catch(error){
      console.error('Falha ao alterar status da configuração em segundo plano:',error);
      S.supervisions=prevSupervisions;
      S.unitCatalog=prevUnits;
      S.natureCatalog=prevNatures;
      render();
      showUserResult('error','Não foi possível atualizar a configuração',error instanceof UserFormValidationError?error.message:userSaveError(error).message,'Configurações','Configuração atualizada','Fechar');
    }finally{
      S.masterBusy=false;
    }
  })();
}
function denyUserTargetAccess(){S.userPasswordTarget=null;if(S.editing?.kind==='user')S.editing=null;S.accessDenied='user-target';render()}
function handleUserTargetDenied(error){if(!(error instanceof UserTargetRestrictedError))return false;denyUserTargetAccess();return true}
function userPasswordError(error){
if(error instanceof UserPasswordValidationError)return{category:'Validação de senha',message:error.message};
if(error instanceof UserPasswordNotFoundError)return{category:'Usuário indisponível',message:'O usuário selecionado não está mais disponível. Atualize a tela e tente novamente.'};
if(error instanceof UserPasswordPersistenceError)return{category:'Falha ao salvar',message:'Não foi possível confirmar a gravação da nova senha. Tente novamente.'};
if(error instanceof UserPasswordAuditError)return{category:'Falha na auditoria',message:'Não foi possível registrar a alteração na auditoria. A alteração foi desfeita; tente novamente.'};
if(error instanceof UserRollbackError)return{category:'Falha ao desfazer a operação',message:'Não foi possível confirmar a restauração dos dados anteriores. Verifique o usuário antes de tentar novamente.'};
if(error?.name==='UserPermissionError')return{category:'Permissão insuficiente',message:'Seu perfil não possui autorização para alterar senhas.'};
if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return{category:'Permissão de acesso',message:'A permissão de acesso à pasta de dados precisa ser renovada.'};
if(error?.name==='NotFoundError')return{category:'Arquivo de usuários',message:'Não foi possível localizar ou acessar o arquivo de usuários na pasta de dados.'};
return{category:'Falha ao salvar',message:'Ocorreu um erro ao salvar a nova senha. Verifique o acesso à pasta de dados e tente novamente.'}
}
async function editUser(id){
if(denyOperatorAccess()||denyUserManagement())return;
try{const users=await read('usuarios.csv'),target=users.find(user=>user.id_usuario===id);if(!target)throw Error('Usuário não encontrado.');assertUserTargetPermission(target);S.users=users.map(user=>({...user,perfil:canonicalPerfil(user.perfil)}));S.userPasswordTarget=null;S.userModalTab='geral';S.editing={kind:'user',data:{...target,perfil:canonicalPerfil(target.perfil)}};render()}
catch(error){if(handleUserTargetDenied(error))return;if(error?.name!=='UserPermissionError')console.error('Falha ao carregar o usuário para edição.',error);fail(error?.name==='UserPermissionError'?'Seu perfil não possui autorização para administrar usuários.':'Não foi possível carregar o usuário selecionado.')}
}
function denyUserRemovalTargetAccess(){S.userRemovalTarget=null;S.accessDenied='remove-user-target';render()}
function userRemovalError(error){
if(error instanceof UserRemovalBlockedError)return error.message;
if(error instanceof UserRemovalNotFoundError)return'O usuário selecionado não está mais disponível. Atualize a lista e tente novamente.';
if(error instanceof UserRemovalPersistenceError)return'Não foi possível confirmar a gravação da remoção. A conta foi preservada; atualize a lista e tente novamente.';
if(error instanceof UserRemovalAuditError)return'Não foi possível registrar a remoção na auditoria. A conta foi preservada; tente novamente.';
if(error instanceof UserRemovalRollbackError)return'Não foi possível confirmar a restauração da conta após uma falha. Verifique o arquivo de usuários antes de tentar novamente.';
if(error?.name==='UserPermissionError')return'Seu perfil não possui autorização para remover este usuário.';
if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return'A permissão de acesso à pasta de dados precisa ser renovada.';
if(error?.name==='NotFoundError')return'Não foi possível localizar o arquivo de usuários na pasta de dados.';
return'Não foi possível concluir a remoção. Verifique o acesso à pasta de dados e tente novamente.';
}
async function openUserRemoval(id){
if(userRemovalInProgress)return;
if(S.page!=='usuarios'||!canManageUsers()){showUserResult('error','Não foi possível remover o usuário','Seu perfil não possui autorização para remover este usuário.','Permissão insuficiente','','Fechar');return}
try{
await refreshAccessContext();
const users=await read('usuarios.csv'),target=users.find(user=>user.id_usuario===id);
if(!target)throw new UserRemovalNotFoundError();
assertUserTargetPermission(target);
if(!manageableUsers().some(user=>user.id_usuario===target.id_usuario))throw new UserRemovalNotFoundError();
S.userRemovalTarget={id:target.id_usuario,nome:target.nome,login:target.login,perfil:canonicalPerfil(target.perfil)};
S.accessDenied=false;
render()
}catch(error){
if(error instanceof UserTargetRestrictedError){denyUserRemovalTargetAccess();return}
if(!(error instanceof UserRemovalNotFoundError)&&error?.name!=='UserPermissionError')console.error('Falha ao validar o usuário selecionado para remoção.',error);
render();
showUserResult('error','Não foi possível remover o usuário',userRemovalError(error),'Permissão insuficiente','','Fechar')
}
}
async function auditRemovedUser(user){
await withWriteLock('system-audit',async()=>{
const disk=await read('historico_sistema.csv'),item={id_auditoria:uid(),data_hora:now(),usuario:S.user.login,perfil:S.user.perfil,modulo:'USUARIOS',acao:'USUARIO_REMOVIDO',id_registro:user.id_usuario,codigo_registro:user.login,detalhes:`${user.nome}; ${canonicalPerfil(user.perfil)}; conta removida`},next=[item,...disk];
const confirmed=await write('historico_sistema.csv',next,H.audit);
if(!confirmed.some(row=>row.id_auditoria===item.id_auditoria))throw new UserRemovalAuditError();
S.audits=confirmed
})
}
async function restoreRemovedUser(target,index){
try{
const latest=await read('usuarios.csv');
if(latest.some(user=>user.id_usuario===target.id_usuario))throw new UserRemovalRollbackError();
const restored=[...latest];restored.splice(Math.min(index,restored.length),0,target);
const confirmed=await write('usuarios.csv',restored,H.users);
if(!sameUserRecord(confirmed.find(user=>user.id_usuario===target.id_usuario),target))throw new UserRemovalRollbackError();
S.users=normalizedUsers(confirmed)
}catch(error){
console.error('Falha ao restaurar o usuário após erro na auditoria de remoção.',error);
try{S.users=normalizedUsers(await read('usuarios.csv'))}catch(readError){console.error('Falha ao confirmar o estado do cadastro após rollback da remoção.',readError)}
throw new UserRemovalRollbackError()
}
}
async function removeUser(id){
  if(userRemovalInProgress)return;
  if(!id||!canManageUsers()||S.page!=='usuarios'){
    showUserResult('error','Não foi possível remover o usuário','Seu perfil não possui autorização para remover este usuário.','Permissão insuficiente','','Fechar');
    return;
  }
  const target=S.users.find(user=>user.id_usuario===id);
  if(!target){
    showUserResult('error','Não foi possível remover o usuário','O usuário selecionado não está mais disponível. Atualize a lista e tente novamente.','Usuário indisponível','','Fechar');
    return;
  }
  if(S.user?.id_usuario===target.id_usuario){
    showUserResult('error','Não foi possível remover o usuário','Não é possível remover o usuário atualmente conectado.','Operação não permitida','','Fechar');
    return;
  }
  const activeAdministrators=S.users.filter(user=>isAdministratorUser(user)&&user.status==='Ativo');
  if(isAdministratorUser(target)&&target.status==='Ativo'&&activeAdministrators.length<=1){
    showUserResult('error','Não foi possível remover o usuário','Não é possível remover o último Administrador ativo do sistema.','Operação não permitida','','Fechar');
    return;
  }

  // Snapshots for defensive rollback
  const prevUsers=[...S.users];
  const targetIndex=S.users.findIndex(user=>user.id_usuario===id);

  // Optimistic UI: remove immediately (0ms)
  S.users=S.users.filter(user=>user.id_usuario!==id);
  S.userRemovalTarget=null;
  S.userPasswordTarget=null;
  if(S.editing?.kind==='user'&&S.editing.data?.id_usuario===id)S.editing=null;
  hideLoading();
  render();
  showUserResult('success','Usuário removido com sucesso','O acesso do usuário foi removido e os registros históricos foram preservados.','','Remoção concluída');

  // Background worker: persist to disk with write lock and audit trail
  (async()=>{
    userRemovalInProgress=true;
    try{
      await ensureDataWritePermission();
      await withWriteLock('users',async()=>{
        await refreshAccessContext();
        await ensureDataWritePermission();
        const users=await read('usuarios.csv'),matches=users.map((user,index)=>({user,index})).filter(entry=>entry.user.id_usuario===id);
        if(matches.length!==1)throw new UserRemovalNotFoundError();
        const{user:diskTarget,index}=matches[0];
        assertUserTargetPermission(diskTarget);
        if(!manageableUsers().some(user=>user.id_usuario===diskTarget.id_usuario))throw new UserRemovalNotFoundError();
        if(S.user.id_usuario===diskTarget.id_usuario)throw new UserRemovalBlockedError('Não é possível remover o usuário atualmente conectado.');
        const diskAdmins=users.filter(user=>isAdministratorUser(user)&&user.status==='Ativo');
        if(isAdministratorUser(diskTarget)&&diskTarget.status==='Ativo'&&diskAdmins.length<=1)throw new UserRemovalBlockedError('Não é possível remover o último Administrador ativo do sistema.');
        const next=users.filter(user=>user.id_usuario!==diskTarget.id_usuario);
        const confirmed=await write('usuarios.csv',next,H.users);
        if(confirmed.some(user=>user.id_usuario===diskTarget.id_usuario)||csv(confirmed,H.users)!==csv(next,H.users)){
          if(!confirmed.some(user=>user.id_usuario===diskTarget.id_usuario))await restoreRemovedUser(diskTarget,index);
          throw new UserRemovalPersistenceError();
        }
        S.users=normalizedUsers(confirmed);
        try{await auditRemovedUser(diskTarget)}catch(error){console.error('Falha ao registrar a remoção do usuário na auditoria.',error);await restoreRemovedUser(diskTarget,index);throw error instanceof UserRemovalAuditError?error:new UserRemovalAuditError()}
      });
    }catch(error){
      console.error('Falha ao remover usuário em segundo plano:',error);
      S.users=prevUsers;
      render();
      showUserResult('error','Não foi possível remover o usuário',userRemovalError(error),error instanceof UserRemovalBlockedError?'Operação não permitida':error?.name==='UserPermissionError'?'Permissão insuficiente':'Falha ao remover','','Fechar');
    }finally{
      userRemovalInProgress=false;
    }
  })();
}
async function openUserPassword(id){
if(denyOperatorAccess()||denyUserManagement())return;
try{const users=await read('usuarios.csv'),target=users.find(user=>user.id_usuario===id);if(!target)throw Error('Usuário não encontrado.');assertUserTargetPermission(target);S.users=users.map(user=>({...user,perfil:canonicalPerfil(user.perfil)}));S.editing=null;S.userPasswordTarget=target.id_usuario;render()}
catch(error){if(handleUserTargetDenied(error))return;if(error?.name!=='UserPermissionError')console.error('Falha ao localizar o usuário para alteração de senha.',error);fail(error?.name==='UserPermissionError'?'Seu perfil não possui autorização para alterar senhas.':'O usuário selecionado não está mais disponível.')}
}
function userPasswordModal(){
if(!S.userPasswordTarget||S.page!=='usuarios'||!canManageUsers())return'';
const target=manageableUsers().find(user=>user.id_usuario===S.userPasswordTarget);if(!target)return'';
return `<div class="modalbg popup-backdrop"><div class="card modal" style="max-width:480px"><button id="closeUserPassword" class="close" type="button" aria-label="Fechar">×</button><h2>Alterar Senha</h2><p class="muted">Usuário: ${esc(target.nome)} (${esc(target.login)})</p><form id="userPasswordForm" class="stack" novalidate><input type="hidden" name="id_usuario" value="${esc(target.id_usuario)}"><label for="newUserPassword">Nova senha</label><input id="newUserPassword" class="field" name="senha" type="password" autocomplete="new-password" required><label for="confirmUserPassword">Confirmar nova senha</label><input id="confirmUserPassword" class="field" name="confirmar_senha" type="password" autocomplete="new-password" required><div class="row"><button type="submit" class="btn primary">Salvar nova senha</button><button id="cancelUserPassword" type="button" class="btn">Cancelar</button></div></form></div></div>`
}
async function saveUserPassword(ev){
  ev.preventDefault();
  if(userPasswordInProgress)return;
  if(denyOperatorAccess()||denyUserManagement())return;
  if(!canManageUsers()){fail('Seu perfil não possui autorização para alterar senhas.');return;}

  const form=ev.currentTarget,data=Object.fromEntries(new FormData(form)),id=String(data.id_usuario||'');
  const password=String(data.senha||''),confirmation=String(data.confirmar_senha||'');

  if(password.length<8){
    showUserResult('error','Não foi possível alterar a senha','A senha deve ter no mínimo 8 caracteres.','Validação de senha','','Fechar');
    return;
  }
  if(password!==confirmation){
    showUserResult('error','Não foi possível alterar a senha','A nova senha e a confirmação não conferem.','Validação de senha','','Fechar');
    return;
  }

  // Snapshots for defensive rollback
  const prevUsers=[...S.users];

  // Optimistic UI: close modal immediately (0ms)
  S.userPasswordTarget=null;
  S.message='';
  hideLoading();
  render();
  showUserResult('success','Senha alterada com sucesso','A nova senha foi salva e está disponível no sistema.','','Alteração concluída');

  // Background worker: hash password, persist to disk with write lock and audit trail
  (async()=>{
    userPasswordInProgress=true;
    try{
      await ensureDataWritePermission();
      await withWriteLock('users',async()=>{
        const disk=await read('usuarios.csv'),target=disk.find(user=>user.id_usuario===id);
        if(!target)throw new UserPasswordNotFoundError();
        assertUserTargetPermission(target);
        const time=now(),newHash=await hash(password);
        const row={...target,senha_hash:newHash,versao_registro:String((+target.versao_registro||0)+1),data_atualizacao:time,usuario_ultima_alteracao:S.user.login};
        const next=disk.map(user=>user.id_usuario===id?row:user);
        const confirmed=await write('usuarios.csv',next,H.users);
        const persisted=confirmed.find(user=>user.id_usuario===id&&user.senha_hash===row.senha_hash&&user.versao_registro===row.versao_registro);
        if(!persisted)throw new UserPasswordPersistenceError();
        S.users=confirmed;
        try{await auditUser('USUARIO_SENHA_ALTERADA',persisted,`${persisted.nome}; senha alterada`)}catch(error){
          console.error('Falha ao registrar a alteração de senha na auditoria.',error);
          try{
            const latest=await read('usuarios.csv'),current=latest.find(user=>user.id_usuario===id);if(!sameUserRecord(current,row))throw new UserRollbackError();
            const restored=latest.map(user=>user.id_usuario===id?target:user);const checked=await write('usuarios.csv',restored,H.users);
            if(!sameUserRecord(checked.find(user=>user.id_usuario===id),target))throw new UserRollbackError();S.users=checked;
          }catch(rollbackError){console.error('Falha ao restaurar a senha após erro na auditoria.',rollbackError);throw new UserRollbackError()}
          if(error instanceof UserTargetRestrictedError)throw error;
          throw new UserPasswordAuditError();
        }
      });
    }catch(error){
      console.error('Falha ao alterar senha do usuário em segundo plano:',error);
      S.users=prevUsers;
      render();
      const failure=userPasswordError(error);
      showUserResult('error','Não foi possível alterar a senha',failure.message,failure.category,'','Fechar');
    }finally{
      userPasswordInProgress=false;
    }
  })();
}
async function saveUser(ev){
  ev.preventDefault();
  if(userSaveInProgress)return;
  if(denyOperatorAccess()||denyUserManagement())return;
  if(!canManageUsers()){fail('Sem permissão para administrar usuários.');return;}

  const form=ev.currentTarget,d=captureUserDraft(form),edit=!!d.id_usuario;
  const profile=canonicalPerfil(d.perfil);
  const lockedForeignScope=Boolean(edit&&hasProfile(S.user,'Supervisor')&&S.users.some(user=>user.id_usuario===d.id_usuario&&effectiveSupervisionId(user)!==effectiveSupervisionId(S.user)&&normalizePerfil(user.perfil)===normalizePerfil(d.perfil)));
  if(profile==='Administrador'){d.supervisao_id='';d.unidades_permitidas='*'}
  else if(profile==='Supervisor'&&!lockedForeignScope)d.unidades_permitidas='';
  else if(!lockedForeignScope)d.unidades_permitidas=userUnitNames(d.unidades_permitidas).join('|');

  try{
    validateUserForm(form,d,edit);
  }catch(err){
    const failure=userSaveError(err);
    showUserResult('error',edit?'Não foi possível salvar o usuário':'Não foi possível cadastrar o usuário',failure.message,failure.category);
    return;
  }

  const login=String(d.login).trim();
  if(S.users.some(x=>String(x.login??'').trim().toLowerCase()===login.toLowerCase()&&x.id_usuario!==d.id_usuario)){
    showUserResult('error',edit?'Não foi possível salvar o usuário':'Não foi possível cadastrar o usuário','Já existe um usuário com esse login. Escolha outro login.','Usuário duplicado');
    return;
  }

  // Snapshots for defensive rollback
  const prevUsers=[...S.users];
  const prevUserSession=S.user?{...S.user}:null;
  const time=now();

  let optimisticRow;
  if(edit){
    const cur=S.users.find(x=>x.id_usuario===d.id_usuario);
    if(!cur){
      showUserResult('error','Não foi possível salvar o usuário','Usuário não encontrado.','Validação do cadastro');
      return;
    }
    optimisticRow={...cur,nome:String(d.nome).trim(),login,perfil:canonicalPerfil(d.perfil),unidades_permitidas:d.unidades_permitidas,supervisao_id:d.supervisao_id,status:d.status,senha_hash:cur.senha_hash,versao_registro:String((+cur.versao_registro||0)+1),data_atualizacao:time,usuario_ultima_alteracao:S.user.login};
    S.users=S.users.map(x=>x.id_usuario===cur.id_usuario?optimisticRow:x);
  }else{
    optimisticRow={id_usuario:uid(),nome:String(d.nome).trim(),login,senha_hash:'',perfil:canonicalPerfil(d.perfil),unidades_permitidas:d.unidades_permitidas,supervisao_id:d.supervisao_id,status:d.status,data_criacao:time,ultimo_acesso:'',versao_registro:'1',data_atualizacao:time,usuario_ultima_alteracao:S.user.login};
    S.users=[optimisticRow,...S.users];
  }

  if(edit&&optimisticRow.id_usuario===S.user?.id_usuario)S.user=optimisticRow.status==='Ativo'?{...optimisticRow,perfil:canonicalPerfil(optimisticRow.perfil)}:null;

  // Optimistic UI: complete immediately (0ms)
  S.editing=null;
  S.message='';
  hideLoading();
  render();
  showUserResult('success',edit?'Usuário atualizado com sucesso':'Usuário cadastrado com sucesso',edit?'As alterações foram salvas e estão disponíveis no sistema.':'O novo usuário foi cadastrado e está disponível no sistema.','',edit?'Alteração concluída':'Cadastro concluído');

  // Background worker: hash password (if new), persist to disk with write locks and audit trail
  (async()=>{
    userSaveInProgress=true;
    try{
      await refreshAccessContext();
      await ensureDataWritePermission();
      let persistedUser=null;
      await withWriteLock('users',async()=>{
        const disk=await read('usuarios.csv');
        if(edit){const target=disk.find(x=>x.id_usuario===d.id_usuario);if(!target)throw Error('Usuário não encontrado.');assertUserTargetPermission(target)}
        if(disk.some(x=>String(x.login??'').trim().toLowerCase()===login.toLowerCase()&&x.id_usuario!==d.id_usuario))throw new UserDuplicateError();
        let row,next,action;
        if(edit){
          const cur=disk.find(x=>x.id_usuario===d.id_usuario);
          if(!cur)throw Error('Usuário não encontrado.');
          assertUserTargetPermission(cur);
          if(hasProfile(S.user,'Supervisor')&&cur.supervisao_id!==S.user.supervisao_id&&(d.supervisao_id!==cur.supervisao_id||d.unidades_permitidas!==cur.unidades_permitidas||canonicalPerfil(d.perfil)!==canonicalPerfil(cur.perfil)))throw new UserFormValidationError('Supervisores podem alterar apenas os dados básicos de usuários de outras Supervisões.');
          if(cur.login==='admin'&&d.status!=='Ativo')throw Error('O administrador principal não pode ser bloqueado.');
          row={...cur,nome:String(d.nome).trim(),login,perfil:canonicalPerfil(d.perfil),unidades_permitidas:d.unidades_permitidas,supervisao_id:d.supervisao_id,status:d.status,senha_hash:cur.senha_hash,versao_registro:String((+cur.versao_registro||0)+1),data_atualizacao:time,usuario_ultima_alteracao:S.user.login};
          next=disk.map(x=>x.id_usuario===cur.id_usuario?row:x);action='USUARIO_EDITADO';
        }else{
          row={id_usuario:optimisticRow.id_usuario,nome:String(d.nome).trim(),login,senha_hash:await hash(d.senha),perfil:canonicalPerfil(d.perfil),unidades_permitidas:d.unidades_permitidas,supervisao_id:d.supervisao_id,status:d.status,data_criacao:time,ultimo_acesso:'',versao_registro:'1',data_atualizacao:time,usuario_ultima_alteracao:S.user.login};
          next=[row,...disk];action='USUARIO_CADASTRADO';
        }
        const confirmed=await write('usuarios.csv',next,H.users),persisted=confirmed.find(x=>x.id_usuario===row.id_usuario&&x.login===row.login&&x.senha_hash===row.senha_hash&&x.perfil===row.perfil&&x.unidades_permitidas===row.unidades_permitidas&&x.supervisao_id===row.supervisao_id&&x.status===row.status);
        if(!persisted)throw new UserPersistenceError();
        S.users=confirmed;
        persistedUser=persisted;
        try{await auditUser(action,persisted,`${persisted.nome}; ${persisted.perfil}; ${persisted.status}`)}catch(error){
          console.error('Falha ao registrar o cadastro de usuário na auditoria.',error);
          try{
            const latest=await read('usuarios.csv'),current=latest.find(x=>x.id_usuario===row.id_usuario),original=disk.find(x=>x.id_usuario===row.id_usuario);
            let restored;
            if(edit){
              if(sameUserRecord(current,row))restored=latest.map(x=>x.id_usuario===row.id_usuario?original:x);
              else if(sameUserRecord(current,original))restored=latest;
              else throw new UserRollbackError();
            }else if(!current)restored=latest;
            else if(sameUserRecord(current,row))restored=latest.filter(x=>x.id_usuario!==row.id_usuario);
            else throw new UserRollbackError();
            const checked=csv(restored,H.users)!==csv(latest,H.users)?await write('usuarios.csv',restored,H.users):latest;
            if(csv(checked,H.users)!==csv(restored,H.users))throw new UserRollbackError();
            S.users=checked;
          }catch(rollbackError){console.error('Falha ao desfazer o cadastro após erro na auditoria.',rollbackError);throw new UserRollbackError()}
          throw new UserAuditError(edit?'Não foi possível registrar as alterações na auditoria. As alterações foram desfeitas; tente novamente.':'Não foi possível registrar o cadastro na auditoria. O usuário não foi cadastrado; tente novamente.');
        }
      });
      if(edit&&persistedUser?.id_usuario===S.user?.id_usuario)S.user=persistedUser.status==='Ativo'?{...persistedUser,perfil:canonicalPerfil(persistedUser.perfil)}:null;
    }catch(error){
      console.error('Falha ao salvar usuário em segundo plano:',error);
      S.users=prevUsers;
      S.user=prevUserSession;
      S.editing={kind:'user',data:{...d}};
      render();
      const failure=userSaveError(error);
      showUserResult('error',edit?'Não foi possível salvar o usuário':'Não foi possível cadastrar o usuário',failure.message,failure.category);
    }finally{
      userSaveInProgress=false;
    }
  })();
}
async function toggleUser(id){
  if(denyOperatorAccess()||denyUserManagement())return;
  if(!canManageUsers())return fail('Sem permissão para administrar usuários.');

  const cur=S.users.find(user=>user.id_usuario===id);
  if(!cur)return fail('Usuário não encontrado.');
  if(cur.login==='admin')return fail('O administrador principal não pode ser bloqueado.');

  // Snapshots for defensive rollback
  const prevUsers=[...S.users];
  const status=cur.status==='Ativo'?'Inativo':'Ativo';
  const row={...cur,status,versao_registro:String((+cur.versao_registro||0)+1),data_atualizacao:now(),usuario_ultima_alteracao:S.user.login};

  // Optimistic UI: update immediately (0ms)
  S.users=S.users.map(user=>user.id_usuario===id?row:user);
  S.message=status==='Ativo'?'Usuário reativado.':'Usuário bloqueado.';
  render();
  showToast(S.message,'success');

  // Background worker: persist to disk with write locks and audit trail
  (async()=>{
    try{
      await ensureDataWritePermission();
      await withWriteLock('users',async()=>{
        const disk=await read('usuarios.csv'),diskCur=disk.find(user=>user.id_usuario===id);
        if(!diskCur)throw Error('Usuário não encontrado.');
        assertUserTargetPermission(diskCur);
        if(diskCur.login==='admin')throw Error('O administrador principal não pode ser bloqueado.');
        const diskRow={...diskCur,status,versao_registro:String((+diskCur.versao_registro||0)+1),data_atualizacao:now(),usuario_ultima_alteracao:S.user.login};
        const next=disk.map(user=>user.id_usuario===id?diskRow:user);
        const confirmed=await write('usuarios.csv',next,H.users);
        if(!confirmed.some(user=>sameUserRecord(user,diskRow)))throw Error('Não foi possível confirmar a alteração do usuário.');
        S.users=confirmed;
        await auditUser(status==='Ativo'?'USUARIO_REATIVADO':'USUARIO_BLOQUEADO',diskRow,`${diskRow.nome}; ${diskRow.perfil}`);
      });
    }catch(error){
      console.error('Falha ao alterar o status do usuário em segundo plano:',error);
      S.users=prevUsers;
      render();
      fail(error?.name==='UserPermissionError'?'Sem permissão para administrar usuários.':error?.message||'Não foi possível alterar o usuário.');
    }
  })();
}
// saveKey implementation consolidated in Chaves Module
async function saveAmbientalInspection(ev){
  ev.preventDefault();
  const form=ev.currentTarget;
  if(!form.reportValidity())return;
  const raw=Object.fromEntries(new FormData(form));
  if(!S.user){fail('Sessão inválida.');return;}

  const input=normalizeAmbientalRow(raw),edit=Boolean(raw.id),isSim=String(input.realizar_monitoramento||'Sim').trim()==='Sim';
  if(!input.data){fail('Informe a data da inspeção.');return;}
  if(isSim){
    if(!input.placa||!input.transportadora||!input.laudo||!input.observacao){
      fail('Preencha todos os campos obrigatórios da inspeção.');
      return;
    }
  }else if(!input.motivo_nao_execucao){
    fail('Selecione a justificativa da não execução.');
    return;
  }

  const loggedNome=S.user.nome||'';
  const loggedMatricula=String(S.user.login||S.user.matricula||'').trim();
  const responsavelFinal=raw.responsavel?.trim()||(loggedMatricula?`${loggedNome} (${loggedMatricula})`:loggedNome);
  const matriculaFinal=raw.matricula_responsavel?.trim()||loggedMatricula;

  const time=now();
  const userUnits=authorizedUnitRecords(S.user);
  const defaultUnit=(userUnits.length?userUnits[0].nome:'')||assignedUnitIds(S.user)[0]||'';
  const defaultSupervisao=effectiveSupervisionId(S.user)||(supervisionForUnit(defaultUnit)?.nome)||'';

  let row;
  if(edit){
    const current=(S.inspecoes||[]).find(item=>String(item.id)===String(input.id));
    if(!current){fail('Inspeção não encontrada.');return;}
    row={...current,...input,nota:'',responsavel:responsavelFinal,matricula_responsavel:matriculaFinal,usuario_registro:current.usuario_registro||S.user.login,unidade:String(input.unidade||current.unidade||defaultUnit),supervisao:String(input.supervisao||current.supervisao||defaultSupervisao),data_hora_registro:current.data_hora_registro||time,data_hora_alteracao:time,alterado_por:S.user.login};
  }else{
    const newId=uid();
    row={id:newId,...input,nota:'',responsavel:responsavelFinal,matricula_responsavel:matriculaFinal,usuario_registro:S.user.login,data_hora_registro:time,data_hora_alteracao:'',alterado_por:'',unidade:String(input.unidade||defaultUnit),supervisao:String(input.supervisao||defaultSupervisao)};
  }

  if(row.realizar_monitoramento==='Sim'){
    row.motivo_nao_execucao='';
  }else{
    row.placa='';row.transportadora='';row.nota='';row.laudo='';row.observacao='';
  }

  // Snapshots for defensive rollback
  const prevInspecoes=[...(S.inspecoes||[])];

  // Optimistic UI: update immediately (0ms)
  if(edit){
    S.inspecoes=(S.inspecoes||[]).map(item=>String(item.id)===String(row.id)?row:item);
  }else{
    S.inspecoes=[row,...(S.inspecoes||[])];
  }
  CSVService.buildEntry(ENVIRONMENTAL_FILE,S.inspecoes);
  _scopeAmbientalMemo={rowsRef:null,userKey:'',orgVer:-1,result:[]};
  _ambientalFilterMemo={rowsRef:null,filterKey:'',result:[]};

  S.editing=null;
  S.page='hist-inspecoes';
  S.activeMenu='meio-ambiente';
  S.message=edit?'Inspeção alterada com sucesso':'Inspeção registrada com sucesso';
  hideLoading();
  render();
  showToast(edit?'Inspeção alterada com sucesso':'Inspeção registrada com sucesso','success');

  // Background worker: persist to disk with write locks
  (async()=>{
    try{
      await refreshAccessContext();
      await ensureDataWritePermission();
      if(!canAccessPage('inspecao-veicular'))throw new DataScopeError('Seu perfil não possui autorização para registrar inspeções.');
      await withWriteLock('ambiental',async()=>{
        const disk=await read(ENVIRONMENTAL_FILE,{force:true});
        if(edit){
          const next=disk.map(item=>String(item.id)===String(row.id)?row:item);
          if(window.StorageService?.appendSingleRecord){
            await window.StorageService.appendSingleRecord(ENVIRONMENTAL_FILE,row,H.inspecoes,{isNewRecord:false});
          }else{
            await write(ENVIRONMENTAL_FILE,next,H.inspecoes);
          }
        }else{
          if(window.StorageService?.appendRecord){
            await window.StorageService.appendRecord(ENVIRONMENTAL_FILE,row,H.inspecoes,{isNewRecord:true});
          }else{
            const next=[row,...disk.filter(item=>String(item.id)!==String(row.id))];
            await write(ENVIRONMENTAL_FILE,next,H.inspecoes);
          }
        }
      });
    }catch(error){
      console.error('Falha ao salvar inspeção ambiental em segundo plano:',error);
      S.inspecoes=prevInspecoes;
      CSVService.buildEntry(ENVIRONMENTAL_FILE,S.inspecoes);
      render();
      fail(error instanceof DataScopeError?error.message:error.message||'Não foi possível salvar a inspeção.');
    }
  })();
}
function folderSelectionModal(){if(!S.folderModal)return'';const currentFolder=S.dir?.name||'dados';return `<div class="modalbg popup-backdrop"><div class="card modal" style="max-width:540px"><button type="button" class="close cancelFolderModal" aria-label="Fechar">×</button><h2>Gerenciar Pasta de Dados</h2><p class="muted">Os dados do SIGESP são persistidos nos arquivos CSV contidos na pasta de dados.</p><div style="margin:16px 0;padding:12px;background:#f8fafc;border:1px solid #dce5f2;border-radius:10px;font-size:13px"><div style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#16a34a"></span><span>Pasta atualmente em uso: <b>${esc(currentFolder)}</b></span></div><p style="margin:6px 0 0;color:#65758f;font-size:12px">Referência padrão: pasta <b>dados</b> na mesma pasta do <code>index.html</code>.</p></div><div class="stack" style="gap:10px"><button type="button" id="chooseAutoFolder" class="btn primary" style="text-align:left;padding:12px"><div style="font-weight:700">1. Usar pasta automática “dados” (Recomendado)</div><small style="opacity:.9;font-weight:400">Conecta diretamente à pasta dados ao lado do index.html com persistência direta e leitura rápida.</small></button><button type="button" id="chooseNativeFolder" class="btn" style="text-align:left;padding:12px"><div style="font-weight:700">2. Selecionar pasta no computador (File System API)</div><small style="color:#65758f;font-weight:400">Abre o seletor nativo do sistema operacional / navegador para escolher uma pasta no seu disco.</small></button><label class="btn" style="text-align:left;padding:12px;cursor:pointer;display:block"><div style="font-weight:700">3. Importar pasta de arquivos CSV...</div><small style="color:#65758f;font-weight:400">Compatível com todos os navegadores e quadros incorporados (seleciona a pasta via navegador).</small><input id="folderPickerInput" class="hidden" type="file" webkitdirectory directory multiple></label></div><div class="row" style="justify-content:flex-end;margin-top:18px"><button type="button" id="cancelFolderModal" class="btn">Fechar</button></div></div></div>`}
function restoringV(){
  return `<div class="center"><div class="card" style="max-width:440px;text-align:center"><div style="font-size:32px;margin-bottom:12px">⏳</div><h1>SIGESP</h1><p class="muted">Verificando integridade e permissões da pasta de dados...</p></div></div>`;
}
function connectV(){
  const folderName=S.dir?.name||'dados';
  return `<div class="center">
    <div class="card" style="max-width:480px;text-align:center">
      <div style="font-size:36px;margin-bottom:12px">🛡️</div>
      <h1>SIGESP</h1>
      <p class="muted" style="margin-bottom:18px">Selecione a pasta onde estão armazenados os arquivos CSV do sistema.</p>
      ${alert()}
      <div class="stack" style="gap:12px;margin-top:16px">
        <button id="selectNative" class="btn primary" style="padding:12px;font-size:15px;font-weight:700">
          Selecionar Pasta de CSVs
        </button>
        <button id="selectAuto" class="btn" style="font-size:13px">
          Usar pasta automática (dados)
        </button>
        <label class="btn" style="display:block;text-align:center;cursor:pointer;font-size:13px;color:#64748b">
          Importar pasta de dados...
          <input id="folderInputDirect" class="hidden" type="file" webkitdirectory directory multiple>
        </label>
      </div>
    </div>
    ${folderSelectionModal()}
  </div>`;
}
function permissionV(){
  const folderName=S.savedHandle?.name||S.dir?.name||'dados';
  return `<div class="center">
    <div class="card" style="max-width:500px;text-align:center">
      <div style="font-size:36px;margin-bottom:12px">📁</div>
      <h1>Reconexão de Pasta</h1>
      <p class="muted" style="margin-bottom:16px">O navegador requer sua autorização para revalidar a leitura dos arquivos da pasta:</p>
      
      <div style="margin:0 auto 20px;padding:12px 16px;background:#f8fafc;border:1px solid #dce5f2;border-radius:10px;display:inline-flex;align-items:center;gap:8px;font-size:14px;color:#1e293b">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#0284c7"></span>
        <span>Pasta configurada: <strong>${esc(folderName)}</strong></span>
      </div>

      ${alert()}

      <div class="stack" style="gap:10px;margin-top:10px">
        <button id="authorize" class="btn primary" style="padding:12px;font-size:15px;font-weight:700">
          Permitir acesso à pasta ${esc(folderName)}
        </button>
        <div class="row" style="justify-content:center;margin-top:4px;gap:8px">
          <button id="changeFolderBtn" class="btn" style="color:#64748b;border-color:#cbd5e1;font-size:13px">
            Alterar pasta
          </button>
          <button id="forget" class="btn danger" style="padding:4px 8px;font-size:12px">
            Redefinir conexão
          </button>
        </div>
      </div>
    </div>
    ${folderSelectionModal()}
  </div>`;
}
function loginV(){
  const folderName=S.dir?.name||'dados';
  return `<div class="login">
    <div class="login-card-container">
      <div class="login-card">
        <div class="login-header">
          <div class="login-shield-badge" aria-hidden="true">
            <svg width="62" height="62" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="shieldGrad" x1="12" y1="5" x2="52" y2="58" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#2563eb"/>
                  <stop offset="45%" stop-color="#1e40af"/>
                  <stop offset="100%" stop-color="#0b1e36"/>
                </linearGradient>
                <linearGradient id="shieldBorder" x1="32" y1="4" x2="32" y2="60" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#bfdbfe"/>
                  <stop offset="100%" stop-color="#1d4ed8"/>
                </linearGradient>
                <linearGradient id="coreGlow" x1="32" y1="10" x2="32" y2="50" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.35"/>
                  <stop offset="100%" stop-color="#1e40af" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <path d="M32 5L51 13C51 29 44.5 47 32 56C19.5 47 13 29 13 13L32 5Z" fill="url(#shieldGrad)" stroke="url(#shieldBorder)" stroke-width="2" stroke-linejoin="round"/>
              <path d="M32 9.5L47.5 16C47.5 29 42 44 32 51.5C22 44 16.5 29 16.5 16L32 9.5Z" fill="url(#coreGlow)" stroke="#93c5fd" stroke-opacity="0.3" stroke-width="1.2"/>
              <path d="M32 19C28.686 19 26 21.686 26 25C26 27.32 27.32 29.33 29.24 30.33L28 38H36L34.76 30.33C36.68 29.33 38 27.32 38 25C38 21.686 35.314 19 32 19Z" fill="#ffffff"/>
              <circle cx="32" cy="24" r="2.2" fill="#1e40af"/>
            </svg>
          </div>
          <h1 class="login-brand-title">SIGESP</h1>
          <p class="login-brand-subtitle">Sistema Integrado de Segurança Patrimonial</p>
        </div>

        <div class="login-folder-status">
          <div class="login-folder-info">
            <span class="login-folder-dot" title="Status da pasta"></span>
            <span>Pasta: <b>${esc(folderName)}</b></span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="sync-status-badge" id="syncStatusBadgeLogin" title="Sincronização em tempo real ativa" style="font-size:11px;padding:3px 9px;margin:0">
              <span class="sync-pulse-dot" style="width:6px;height:6px" aria-hidden="true"></span>
              <span id="syncStatusTextLogin" class="sync-status-text">Sincronizado às ${formatSyncTime()}</span>
            </div>
            <button id="changeFolderLogin" type="button" class="login-folder-btn" title="Selecionar outra pasta de dados">Alterar pasta</button>
          </div>
        </div>

        ${alert()}

        <form id="login" class="login-form">
          <div class="login-input-group">
            <label class="login-input-label" for="loginInput">Identificação / Login</label>
            <div class="login-input-wrap">
              <span class="login-input-icon" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
              <input id="loginInput" class="field login-field" name="login" required placeholder="Digite seu login ou matrícula" autocomplete="username">
            </div>
          </div>

          <div class="login-input-group">
            <label class="login-input-label" for="senhaInput">Senha de Acesso</label>
            <div class="login-input-wrap">
              <span class="login-input-icon" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
              <input id="senhaInput" class="field login-field" name="senha" type="password" required placeholder="••••••••" autocomplete="current-password">
            </div>
          </div>

          <button type="submit" class="btn primary login-btn">
            <span>Acessar Sistema</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
          </button>
        </form>

        <div class="login-footer-notice">
          <div class="login-footer-text">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>Acesso Restrito — Uso Exclusivo Autorizado</span>
          </div>
          <div class="login-footer-sub">Ambiente Corporativo Seguro · Criptografia AES-GCM 256 bits</div>
        </div>
      </div>
    </div>
    ${folderSelectionModal()}
  </div>`;
}
function normalizedMonth(value){const s=String(value||'').trim();if(/^\d{4}-\d{2}/.test(s))return s.slice(0,7);if(/^\d{2}\/\d{2}\/\d{4}/.test(s)){const parts=s.split('/');return `${parts[2]}-${parts[1]}`}return''}
function corporateMonthLabel(key){if(!key)return'Sem data';const [year,month]=key.split('-'),names=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];return `${names[(Number(month)||1)-1]}/${year}`}
let _dashSeriesMemo={rowsRef:null,result:null};
function dashboardSeries(scopedRows=null){const rows=scopedRows||scope(S.occ);if(_dashSeriesMemo.rowsRef===rows&&_dashSeriesMemo.result)return _dashSeriesMemo.result;const monthly={},unitMonthly={};for(let i=0,len=rows.length;i<len;i++){const item=rows[i],month=normalizedMonth(item.data_ocorrencia||item.data_registro);if(!month)continue;monthly[month]=(monthly[month]||0)+1;const unit=item.unidade||'Sem unidade';(unitMonthly[unit]??={})[month]=(unitMonthly[unit]?.[month]||0)+1}const months=Object.keys(monthly).sort().slice(-12),units=Object.keys(unitMonthly).sort(),res={months,totals:months.map(month=>monthly[month]||0),units,unitMonthly};_dashSeriesMemo={rowsRef:rows,result:res};return res}
function monthlyBars(series){const max=Math.max(1,...series.totals);if(!series.months.length)return'<div class="chart-empty">Nenhuma ocorrência com data válida.</div>';return `<div class="monthly-chart">${series.months.map((month,index)=>{const value=series.totals[index],height=Math.max(8,value/max*100);return `<div class="month-column"><div class="month-value">${value}</div><div class="month-bar-wrap"><div class="month-bar" style="height:${height}%"></div></div><div class="month-label">${corporateMonthLabel(month)}</div></div>`}).join('')}</div>`}
function unitMonthlyTable(series){if(!series.months.length)return'<div class="chart-empty">Nenhuma ocorrência com data válida.</div>';const colors=['#2254df','#0f766e','#b45309','#7c3aed','#be123c','#0369a1'];const max=Math.max(1,...series.units.flatMap(unit=>series.months.map(month=>series.unitMonthly[unit]?.[month]||0)));return `<div class="unit-legend">${series.units.map((unit,index)=>`<span><i style="background:${colors[index%colors.length]}"></i>${esc(unit)}</span>`).join('')}</div><div class="unit-month-chart">${series.months.map(month=>`<div class="unit-month-group"><div class="unit-bars">${series.units.map((unit,index)=>{const value=series.unitMonthly[unit]?.[month]||0,height=value?Math.max(8,value/max*100):0;return `<div class="unit-bar" title="${esc(unit)}: ${value}" style="height:${height}%;background:${colors[index%colors.length]}"><span>${value||''}</span></div>`}).join('')}</div><div class="month-label">${corporateMonthLabel(month)}</div></div>`).join('')}</div>`}
let _scopeAmbientalMemo={rowsRef:null,userKey:'',orgVer:-1,result:[]};
function scopeAmbiental(rows,user=S.user){if(!rows||!rows.length)return[];const uKey=userAccessCacheKey(user);if(user===S.user&&_scopeAmbientalMemo.rowsRef===rows&&_scopeAmbientalMemo.userKey===uKey&&_scopeAmbientalMemo.orgVer===_orgCatalogVersion)return _scopeAmbientalMemo.result;const safe=rows.filter(Boolean);if(hasProfile(user,'Administrador')){if(user===S.user)_scopeAmbientalMemo={rowsRef:rows,userKey:uKey,orgVer:_orgCatalogVersion,result:safe};return safe}const supId=String(effectiveSupervisionId(user)),isSup=hasProfile(user,'Supervisor'),filtered=safe.filter(row=>{const unit=String(row?.unidade||'').trim();if(isSup){const supervision=String(row?.supervisao||'').trim();return !supervision||supervision===supId}return !unit||canAccessUnit(unit,user)});if(user===S.user)_scopeAmbientalMemo={rowsRef:rows,userKey:uKey,orgVer:_orgCatalogVersion,result:filtered};return filtered}
async function ensureAmbientalCsv(){try{if(CSVService.hasValidCache(ENVIRONMENTAL_FILE))return true;await ensure(ENVIRONMENTAL_FILE,H.inspecoes);return true}catch(error){console.error('Falha ao garantir a presença do CSV de inspeções.',error);throw error}}
function ambientalStatusBadge(value){const status=String(value||'').trim();if(status==='Aprovado')return '<span class="status-badge success">APROVADO</span>';if(status==='Reprovado')return '<span class="status-badge danger">REPROVADO</span>';return '<span class="status-badge warning">NÃO REALIZADO</span>'}
function normalizeAmbientalRow(raw={}){const row={...raw};row.realizar_monitoramento=String(row.realizar_monitoramento||'Sim').trim()==='Não'?'Não':'Sim';const laudo=String(row.laudo||'').trim();const allowedLaudo=['Aprovado','Reprovado'];if(row.realizar_monitoramento==='Sim'){row.motivo_nao_execucao='';row.laudo=allowedLaudo.includes(laudo)?laudo:'';}else{row.placa='';row.transportadora='';row.nota='';row.laudo='';row.observacao='';row.motivo_nao_execucao=String(row.motivo_nao_execucao||'').trim()||'';}return row}
function ambientalDashboardStats(rows){let total=rows.length,realizados=0,naoRealizados=0,aprovados=0,reprovados=0;for(let i=0;i<total;i++){const x=rows[i],mon=String(x.realizar_monitoramento||'').trim();if(mon==='Sim'){realizados++;const l=String(x.laudo||'').trim();if(l==='Aprovado')aprovados++;else if(l==='Reprovado')reprovados++}else if(mon==='Não')naoRealizados++}const taxa=realizados?((aprovados/realizados)*100):0;return{total,realizados,naoRealizados,aprovados,reprovados,taxa}}
function ambientalDashboardChart(rows){const byDate={};for(const row of rows){const key=String(row.data||'').trim();if(!key)continue;byDate[key]=(byDate[key]||0)+1}const labels=Object.keys(byDate).sort().slice(-6);const values=labels.map(key=>byDate[key]||0);const max=Math.max(1,...values);const bars=labels.map((label,index)=>{const value=values[index],height=Math.max(8,(value/max)*100);return `<div class="ambiental-small-bar-wrap" style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end"><span class="bar-data-label" style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:4px;line-height:1">${value}</span><div class="ambiental-small-bar" style="height:${height}%" title="${value} inspeção(ões) em ${label}"></div><span>${esc(label.slice(5))}</span></div>`}).join('');return labels.length?`<div class="ambiental-mini-chart">${bars}</div>`:`<div class="chart-empty">Nenhum registro disponível para o período selecionado.</div>`}
function ambientalDashboard(){if(!S.user)return '';const rows=scopeAmbiental(S.inspecoes||[]),stats=ambientalDashboardStats(rows),period=ambientalDashboardChart(rows),reasonCounts=new Map();let laudoAprov=0,laudoReprov=0;for(let i=0,len=rows.length;i<len;i++){const item=rows[i],mot=String(item.motivo_nao_execucao||'').trim(),ld=String(item.laudo||'').trim();if(mot)reasonCounts.set(mot,(reasonCounts.get(mot)||0)+1);if(ld==='Aprovado')laudoAprov++;else if(ld==='Reprovado')laudoReprov++}const reasons=ENVIRONMENTAL_REASONS.map(label=>({label,count:reasonCounts.get(label)||0})).filter(item=>item.count>0),laudos=[['Aprovado',laudoAprov],['Reprovado',laudoReprov]];return `<div class="section-block"><div class="dashboard-heading"><div><h2>MEIO AMBIENTE</h2><p class="muted">Monitoramento de Fumaça Preta</p></div><span class="dashboard-period">Dados reais do CSV</span></div><div class="grid metrics">${[['TOTAL DE REGISTROS',stats.total],['TOTAL DE MONITORAMENTOS REALIZADOS',stats.realizados],['TOTAL DE MONITORAMENTOS NÃO REALIZADOS',stats.naoRealizados],['TOTAL DE APROVADOS',stats.aprovados],['TOTAL DE REPROVADOS',stats.reprovados],['TAXA DE APROVAÇÃO',`${stats.taxa.toFixed(1)}%`]].map(([label,value])=>`<div class="card metric-card"><span class="metric-label">${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join('')}</div><div class="corporate-dashboard-grid"><section class="card chart-card"><div class="chart-title"><div><h3>Monitoramentos por período</h3><p>Evolução dos registros por data</p></div><span class="chart-badge">Período</span></div>${period}</section><section class="card chart-card"><div class="chart-title"><div><h3>Resultado dos Laudos</h3><p>Comparativo aprovados x reprovados</p></div><span class="chart-badge">Laudos</span></div><div class="ambiental-stack">${laudos.map(([label,count])=>`<div class="ambiental-legend-row"><span>${esc(label)}</span><strong>${count}</strong></div>`).join('')}</div></section></div><div class="corporate-dashboard-grid"><section class="card chart-card"><div class="chart-title"><div><h3>Execução dos Monitoramentos</h3><p>Realizados x não realizados</p></div><span class="chart-badge">Execução</span></div><div class="ambiental-stack"><div class="ambiental-legend-row"><span>Realizados</span><strong>${stats.realizados}</strong></div><div class="ambiental-legend-row"><span>Não realizados</span><strong>${stats.naoRealizados}</strong></div></div></section><section class="card chart-card"><div class="chart-title"><div><h3>Motivos da não execução</h3><p>Distribuição dos motivos registrados</p></div><span class="chart-badge">Motivos</span></div><div class="ambiental-stack">${reasons.length?reasons.map(item=>`<div class="ambiental-legend-row"><span>${esc(item.label)}</span><strong>${item.count}</strong></div>`).join(''):`<div class="chart-empty">Nenhum motivo registrado.</div>`}</div></section></div></div>`}
function ambientalFormPage(){const x=S.editing?.kind==='ambiental'?S.editing.data||{}:{};const registro=normalizeAmbientalRow(x);const isSim=String(registro.realizar_monitoramento||'Sim').trim()==='Sim';const loggedNome=S.user?.nome||'Usuário Autenticado';const loggedMatricula=String(S.user?.login||S.user?.matricula||'N/A').trim();const responsavelDisplay=registro.responsavel||(loggedMatricula?`${loggedNome} (${loggedMatricula})`:loggedNome);return `<div class="card"><div class="page-title"><div><h2>INSPEÇÃO VEICULAR</h2><p class="muted">Monitoramento de Fumaça Preta · Meio Ambiente</p></div></div><form id="ambientalForm" novalidate><input type="hidden" name="id" value="${esc(registro.id||'')}"><input type="hidden" name="responsavel_nome" value="${esc(loggedNome)}"><input type="hidden" name="responsavel_matricula" value="${esc(loggedMatricula)}"><input type="hidden" name="matricula_responsavel" value="${esc(loggedMatricula)}"><input type="hidden" name="responsavel" value="${esc(responsavelDisplay)}"><div class="section">Informações do monitoramento</div><div class="formgrid"><label class="c6"><span class="label">Data da Inspeção</span><input class="field" type="date" name="data" value="${esc(registro.data||new Date().toISOString().slice(0,10))}" required></label><label class="c6"><span class="label">Realizar Monitoramento?</span><select class="field" name="realizar_monitoramento" id="ambientalRealizarMonitoramento"><option value="Sim" ${isSim?'selected':''}>Sim</option><option value="Não" ${!isSim?'selected':''}>Não</option></select></label></div><div id="secVeiculo" style="display:${isSim?'block':'none'}"><div class="section" style="margin-top:20px">Dados do Veículo e Avaliação</div><div class="formgrid"><label class="c6"><span class="label">Placa do Veículo</span><input class="field" name="placa" placeholder="Ex: ABC-1234" value="${esc(registro.placa||'')}" ${isSim?'required':''} ${!isSim?'disabled':''}></label><label class="c6"><span class="label">Transportadora</span><input class="field" name="transportadora" placeholder="Nome da empresa ou transportadora" value="${esc(registro.transportadora||'')}" ${isSim?'required':''} ${!isSim?'disabled':''}></label><label class="c12"><span class="label">Laudo da Inspeção</span><select class="field" name="laudo" ${isSim?'required':''} ${!isSim?'disabled':''}><option value="">Selecionar laudo</option><option value="Aprovado" ${String(registro.laudo||'')==='Aprovado'?'selected':''}>Aprovado</option><option value="Reprovado" ${String(registro.laudo||'')==='Reprovado'?'selected':''}>Reprovado</option></select></label><label class="c12"><span class="label">Observações Técnicas</span><textarea class="field" name="observacao" rows="4" placeholder="Observações e constatações técnicas..." ${isSim?'required':''} ${!isSim?'disabled':''}>${esc(registro.observacao||'')}</textarea></label></div></div><div id="secNaoExecucao" style="display:${!isSim?'block':'none'}"><div class="section" style="margin-top:20px;color:#b91c1c">Justificativa da Não Execução</div><div class="formgrid"><label class="c12"><span class="label" style="color:#b91c1c;font-weight:600">Justificativa Obrigatória</span><select class="field" name="motivo_nao_execucao" id="ambientalMotivoNaoExecucao" ${!isSim?'required':''} ${isSim?'disabled':''}><option value="">Selecione o motivo da não realização do monitoramento...</option>${ENVIRONMENTAL_REASONS.map(reason=>`<option value="${esc(reason)}" ${String(registro.motivo_nao_execucao||'')===reason?'selected':''}>${esc(reason)}</option>`).join('')}</select><small style="color:#64748b;font-size:12px;margin-top:4px;display:block">A seleção da justificativa é indispensável quando o monitoramento não for realizado.</small></label></div></div><div class="section" style="margin-top:24px">Responsável pela Inspeção</div><div class="formgrid"><div class="c12"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:14px 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px"><div style="display:flex;align-items:center;gap:12px;min-width:200px"><div style="width:40px;height:40px;border-radius:8px;background:#1e40af;color:#fff;display:grid;place-items:center;font-weight:700;font-size:16px;flex-shrink:0">${esc((loggedNome.charAt(0)||'U').toUpperCase())}</div><div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Responsável Autenticado (Captura Automática)</div><div style="font-size:15px;font-weight:600;color:#0f172a;margin-top:2px">${esc(loggedNome)}</div></div></div><div style="text-align:right;min-width:140px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Login do Responsável</div><div style="font-size:13.5px;font-weight:700;color:#1e40af;font-family:monospace;margin-top:2px;word-break:break-all">${esc(loggedMatricula)}</div></div></div></div></div><div class="row" style="justify-content:flex-end;margin-top:24px;gap:10px"><button type="button" class="btn" data-page="hist-inspecoes">Cancelar</button><button type="submit" class="btn primary">${S.editing?.kind==='ambiental'?'Salvar Alterações':'Salvar Inspeção'}</button></div></form></div>`}
let _ambientalFilterMemo={rowsRef:null,filterKey:'',result:[]};
function filteredAmbientalInspecoes(){const f=S.ambientalFilters||{},rows=scopeAmbiental(S.inspecoes||[]),fKey=`${f.dateFrom||''}|${f.dateTo||''}|${f.placa||''}|${f.transportadora||''}|${f.realizado||''}|${f.laudo||''}|${f.responsavel||''}|${f.unidade||''}|${f.supervisao||''}|${f.general||''}`;if(_ambientalFilterMemo.rowsRef===rows&&_ambientalFilterMemo.filterKey===fKey)return _ambientalFilterMemo.result;const query=String(f.general||'').trim().toLowerCase(),qPlaca=String(f.placa||'').toLowerCase(),qTransp=String(f.transportadora||'').toLowerCase(),qResp=String(f.responsavel||'').toLowerCase();const res=rows.filter(item=>{const date=String(item.data||'').trim();if(f.dateFrom&&(!date||date<f.dateFrom))return false;if(f.dateTo&&(!date||date>f.dateTo))return false;if(qPlaca&&String(item.placa||'').toLowerCase().indexOf(qPlaca)===-1)return false;if(qTransp&&String(item.transportadora||'').toLowerCase().indexOf(qTransp)===-1)return false;if(f.realizado&&String(item.realizar_monitoramento||'')!==f.realizado)return false;if(f.laudo&&String(item.laudo||'')!==f.laudo)return false;if(qResp&&String(item.responsavel||'').toLowerCase().indexOf(qResp)===-1)return false;if(f.unidade&&String(item.unidade||'')!==f.unidade)return false;if(f.supervisao&&String(item.supervisao||'')!==f.supervisao)return false;if(query&&`${item.placa||''} ${item.transportadora||''} ${item.responsavel||''} ${item.observacao||''} ${item.motivo_nao_execucao||''}`.toLowerCase().indexOf(query)===-1)return false;return true});_ambientalFilterMemo={rowsRef:rows,filterKey:fKey,result:res};return res}
function ambientalHistoryTotalPages(){const total=filteredAmbientalInspecoes().length;return Math.max(1,Math.ceil(total/S.pageSize))}
function pagedAmbientalInspecoes(){const rows=filteredAmbientalInspecoes();const total=ambientalHistoryTotalPages();S.currentPage=Math.min(Math.max(1,S.currentPage),total);const start=(S.currentPage-1)*S.pageSize;return rows.slice(start,start+S.pageSize)}
function ambientalHistoryPage(){const allFiltered=filteredAmbientalInspecoes(),rows=pagedAmbientalInspecoes(),totalPages=ambientalHistoryTotalPages(),f=S.ambientalFilters||{},allUnits=[...new Set((S.inspecoes||[]).map(item=>item.unidade).filter(Boolean))].sort(),allSupervisoes=[...new Set((S.inspecoes||[]).map(item=>item.supervisao).filter(Boolean))].sort();return `<div class="row between"><div><h2>HISTÓRICO DE INSPEÇÕES</h2><p class="muted">Monitoramento de Fumaça Preta</p></div><button type="button" class="btn primary ambiental-new">Nova inspeção</button></div><div class="card"><div class="history-filter-grid"><label><span class="label">Data inicial</span><input id="ambientalDateFrom" class="field" type="date" value="${esc(f.dateFrom||'')}"></label><label><span class="label">Data final</span><input id="ambientalDateTo" class="field" type="date" value="${esc(f.dateTo||'')}"></label><label><span class="label">Placa</span><input id="ambientalPlaca" class="field" value="${esc(f.placa||'')}" placeholder="Placa"></label><label><span class="label">Transportadora</span><input id="ambientalTransportadora" class="field" value="${esc(f.transportadora||'')}" placeholder="Transportadora"></label><label><span class="label">Monitoramento</span><select id="ambientalRealizado" class="field"><option value="">Todos</option><option value="Sim" ${f.realizado==='Sim'?'selected':''}>Sim</option><option value="Não" ${f.realizado==='Não'?'selected':''}>Não</option></select></label><label><span class="label">Laudo</span><select id="ambientalLaudo" class="field"><option value="">Todos</option><option value="Aprovado" ${f.laudo==='Aprovado'?'selected':''}>Aprovado</option><option value="Reprovado" ${f.laudo==='Reprovado'?'selected':''}>Reprovado</option></select></label><label><span class="label">Responsável</span><input id="ambientalResponsavel" class="field" value="${esc(f.responsavel||'')}" placeholder="Responsável"></label><label><span class="label">Unidade</span><select id="ambientalUnidade" class="field"><option value="">Todas</option>${allUnits.map(item=>`<option value="${esc(item)}" ${f.unidade===item?'selected':''}>${esc(item)}</option>`).join('')}</select></label><label><span class="label">Supervisão</span><select id="ambientalSupervisao" class="field"><option value="">Todas</option>${allSupervisoes.map(item=>`<option value="${esc(item)}" ${f.supervisao===item?'selected':''}>${esc(item)}</option>`).join('')}</select></label><label class="history-general"><span class="label">Pesquisa geral</span><input id="ambientalGeneral" class="field" value="${esc(f.general||'')}" placeholder="Buscar registro..."></label></div><div class="row between" style="margin-top:14px"><button id="clearAmbientalFilters" class="btn">Limpar filtros</button><span class="muted">${allFiltered.length} registros · Página ${S.currentPage} de ${totalPages}</span></div></div><div class="card"><div class="tablewrap"><table class="table"><thead><tr><th>Data</th><th>Placa</th><th>Transportadora</th><th>Monitoramento</th><th>Laudo</th><th>Responsável</th><th>Ações</th></tr></thead><tbody>${rows.length?rows.map(item=>`<tr><td>${esc(item.data||'')}</td><td>${esc(item.placa||'')}</td><td>${esc(item.transportadora||'')}</td><td>${esc(item.realizar_monitoramento||'Não')}</td><td>${String(item.laudo||'') ? ambientalStatusBadge(item.laudo) : ambientalStatusBadge('Não realizado')}</td><td>${esc(formatAmbientalResponsible(item))}</td><td class="actions"><button class="viewAmbiental" data-id="${esc(item.id||'')}" title="Visualizar">👁️</button><button class="editAmbiental" data-id="${esc(item.id||'')}" title="Editar">✏️</button>${isAdministratorUser(S.user)?`<button class="deleteRecordPrompt" data-modulo="Meio Ambiente" data-id="${esc(item.id||'')}" data-code="${esc(item.placa||item.id||'Sem placa')}" data-detail="${esc(item.transportadora||'')} · ${esc(item.laudo||'Não realizado')}" title="Excluir Inspeção">🗑️</button>`:''}</td></tr>`).join(''):`<tr><td colspan="7" class="muted">Nenhum registro disponível para o período selecionado.</td></tr>`}</tbody></table></div><div class="row between" style="margin-top:14px"><button id="ambientalPrev" class="btn" ${S.currentPage<=1?'disabled':''}>◀ Anterior</button><button id="ambientalNext" class="btn" ${S.currentPage>=totalPages?'disabled':''}>Próxima ▶</button></div></div>`}
function photos(editable, inputId = 'photos'){
  const old=S.existing.map((p,i)=>`<div class="photo">${p.missing?'<div style="height:110px;display:grid;place-items:center">Imagem não encontrada</div>':`<img class="zoom" data-url="${p.url}" src="${p.url}">`}<small>${esc(p.path)}</small>${editable?`<button type="button" class="removeOld btn" data-i="${i}">Remover</button>`:''}</div>`).join(''),
  fresh=S.newPhotos.map((p,i)=>`<div class="photo"><img class="zoom" data-url="${p.url}" src="${p.url}"><small>${esc(p.name)} · ${Math.round(p.size/1024)} KB</small><button type="button" class="removeNew btn" data-i="${i}">Remover</button></div>`).join(''),
  count=S.existing.length+S.newPhotos.length;
  return `<div class="photos">${old}${fresh}${editable&&count<MAX?`<label for="${inputId}" class="add-photo" role="button" tabindex="0" style="cursor:pointer">📷<br>Adicionar foto</label><input id="${inputId}" class="hidden photoFileInput" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple>`:''}</div>${editable?`<p class="muted">${count} de ${MAX}. Imagens otimizadas automaticamente (até ${WIDTH}px, JPEG ${Math.round(QUALITY*100)}%).</p>`:''}`;
}
function selectOptions(items,value){return items.map(item=>{const optionValue=typeof item==='string'?item:item.value,label=typeof item==='string'?item:item.label;return `<option value="${esc(optionValue)}" ${optionValue===value?'selected':''}>${esc(label)}</option>`}).join('')}
function occForm(){
const x=S.editing||{},availableUnits=units(),historicalUnit=unitForName(x.unidade);
if(x.id_ocorrencia&&historicalUnit&&canAccessUnit(x.unidade)&&!availableUnits.includes(x.unidade))availableUnits.push(x.unidade);
const selectedUnit=availableUnits.includes(x.unidade)?x.unidade:(availableUnits[0]||''),supervision=supervisionForUnit(selectedUnit),activeNatures=S.natureCatalog.filter(activeMaster).map(item=>item.nome),natureOptions=[...activeNatures];
if(x.id_ocorrencia&&x.natureza_ocorrencia&&!natureOptions.includes(x.natureza_ocorrencia))natureOptions.push(x.natureza_ocorrencia);
const selectedNature=natureOptions.includes(x.natureza_ocorrencia)?x.natureza_ocorrencia:(natureOptions[0]||''),today=new Date().toISOString().slice(0,10),tm=new Date().toTimeString().slice(0,5);
const rawVinculo=x.tipo_vinculo||'Terceiro',vinculo=(rawVinculo==='Próprio'||rawVinculo==='Grupo CSN')?'Grupo CSN':rawVinculo,isCsn=vinculo==='Grupo CSN';
return `<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
    <h2 style="margin:0">${x.id_ocorrencia?'Editar':'Nova'} ocorrência</h2>
    ${x.id_ocorrencia && x.numero_protocolo ? `
      <div data-protocol-tag="confirmed" style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:20px;font-size:13px;color:#047857;font-weight:700">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 2px #d1fae5"></span>
        <span>Protocolo: <b>${esc(x.numero_protocolo)}</b></span>
      </div>
    ` : (x.numero_protocolo && x._reservationConfirmed !== false && !S.reservingProtocol) ? `
      <div data-protocol-tag="reserved" data-reservation-id="${esc(x._reservationId||S.activeReservation?.reservationId||'')}" style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:20px;font-size:13px;color:#047857;font-weight:700">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 2px #d1fae5"></span>
        <span>Protocolo Reservado: <b>${esc(x.numero_protocolo)}</b></span>
      </div>
    ` : `
      <div data-protocol-tag="reserving" style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:20px;font-size:13px;color:#475569;font-weight:700">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 0 2px #fef3c7"></span>
        <span>Reservando protocolo...</span>
      </div>
    `}
  </div>
  <form id="occForm" novalidate>
  <input type="hidden" name="id_ocorrencia" value="${esc(x.id_ocorrencia||'')}">
  <input type="hidden" name="numero_protocolo" value="${esc(x.numero_protocolo||'')}">
  <div class="section">Estrutura organizacional</div><div class="formgrid"><label class="c4"><span class="label">Gerência</span><input class="field" name="gerencia" value="${esc(x.gerencia||'GSP/SP')}"></label><label class="c4"><span class="label">Supervisão</span><input class="field" name="supervisao" value="${esc(x.supervisao||supervision?.nome||'')}" readonly></label><label class="c4"><span class="label">Unidade</span><select class="field" name="unidade" ${availableUnits.length?'':'disabled'}>${availableUnits.length?selectOptions(availableUnits,selectedUnit):'<option value="">Nenhuma unidade autorizada</option>'}</select></label><label class="c6 col-datetime"><span class="label">Data</span><input class="field" type="date" name="data_ocorrencia" value="${esc(x.data_ocorrencia||today)}"></label><label class="c6 col-datetime"><span class="label">Hora</span><input class="field" type="time" name="hora_ocorrencia" value="${esc(x.hora_ocorrencia||tm)}"></label><label class="c12"><span class="label">Natureza</span><select class="field" name="natureza_ocorrencia"><option value="">Selecione uma natureza</option>${selectOptions(natureOptions,selectedNature)}${natureOptions.length?'':'<option value="" disabled>Nenhuma natureza ativa cadastrada</option>'}</select></label><label class="c6"><span class="label">Área</span><input class="field" name="area" value="${esc(x.area||'')}"></label><label class="c6"><span class="label">Local específico</span><input class="field" name="local_especifico" value="${esc(x.local_especifico||'')}" required></label></div><div class="section">Identificação do envolvido e relato</div><div class="formgrid"><label class="c4"><span class="label">Tipo de Vínculo</span><select class="field" name="tipo_vinculo" id="occTipoVinculo"><option value="Terceiro" ${vinculo==='Terceiro'?'selected':''}>Terceiro</option><option value="Visitante" ${vinculo==='Visitante'?'selected':''}>Visitante</option><option value="Motorista" ${vinculo==='Motorista'?'selected':''}>Motorista</option><option value="Grupo CSN" ${isCsn?'selected':''}>Grupo CSN</option></select></label><label class="c8"><span class="label whitespace-nowrap min-w-fit">Nome Completo do Envolvido</span><input class="field" name="nome_envolvido" id="occNomeEnvolvido" value="${esc(x.nome_envolvido||'')}" placeholder="Nome do envolvido"></label><label class="c6"><span class="label">Empresa</span><input class="field" name="empresa_envolvido" id="occEmpresaEnvolvido" value="${esc(x.empresa_envolvido||(isCsn?'Grupo CSN':''))}" placeholder="Empresa"></label>${isCsn?`<label class="c6"><span class="label">Matrícula</span><input class="field" name="matricula_id" id="occMatriculaId" value="${esc(x.matricula_id||'')}" placeholder="Informe a matrícula CSN"></label>`:`<label class="c6"><span class="label">Documento</span><input class="field" name="documento" id="occDocumento" value="${esc(x.documento||'')}" placeholder="RG, CPF ou CNH"></label>`}<label class="c6"><span class="label">Telefone</span><input class="field" name="telefone" id="occTelefone" value="${esc(x.telefone||'')}" placeholder="(00) 00000-0000"></label><label class="c6"><span class="label">Placa</span><input class="field" name="placa_veiculo" id="occPlacaVeiculo" value="${esc(x.placa_veiculo||'')}" placeholder="ABC-1234"></label>${isCsn?`<label class="c4"><span class="label">Gerência</span><input class="field" name="gerencia_envolvido" id="occGerenciaEnvolvido" value="${esc(x.gerencia_envolvido||x.gerencia||'')}" placeholder="Informe a gerência"></label><label class="c4"><span class="label">Gerência Geral</span><input class="field" name="gerencia_geral" id="occGerenciaGeral" value="${esc(x.gerencia_geral||'')}" placeholder="Informe a gerência geral"></label><label class="c4"><span class="label">Diretoria</span><input class="field" name="diretoria" id="occDiretoria" value="${esc(x.diretoria||'')}" placeholder="Informe a diretoria"></label>`:''}<label class="c12"><span class="label">Relato detalhado</span><textarea class="field" rows="7" maxlength="5000" name="relato_detalhado" id="occRelatoDetalhado" required>${esc(x.relato_detalhado||'')}</textarea></label><label class="c6"><span class="label">Prioridade</span><select class="field" name="prioridade">${opts(PRI,x.prioridade||'Média')}</select></label><label class="c6"><span class="label">Status</span><select class="field" name="status">${opts(OST,x.status||'Registrada')}</select></label><label class="c12"><span class="label">Providências</span><textarea class="field" rows="4" name="providencias_adotadas">${esc(x.providencias_adotadas||'')}</textarea></label></div><div class="section">Evidências fotográficas</div><div class="photo-zone">${photos(true)}</div><div class="row" style="justify-content:flex-end;margin-top:18px"><button type="button" id="cancelOcc" class="btn">Cancelar</button><button class="btn primary" ${S.submitting?'disabled':''}>${S.submitting?'Salvando...':'Salvar ocorrência'}</button></div></form></div>`
}
const _occRowIndex=new WeakMap();
function getOccSearchMeta(x){let m=_occRowIndex.get(x);if(m)return m;m={dateKey:occurrenceDateKey(x.data_ocorrencia||x.data_registro),proto:`${x.numero_protocolo||''} ${x.id_ocorrencia||''}`.toLowerCase(),general:`${x.nome_envolvido||''} ${x.unidade||''} ${x.local_especifico||''} ${x.relato_detalhado||''}`.toLowerCase(),full:''};_occRowIndex.set(x,m);return m}
function occurrenceDateKey(value){
  const v=String(value||'').trim();
  if(!v)return'';
  const m1=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(v);
  if(m1)return `${m1[1]}-${m1[2].padStart(2,'0')}-${m1[3].padStart(2,'0')}`;
  const m2=/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(v);
  if(m2)return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  const dt=new Date(v);
  if(!isNaN(dt.getTime()))return dt.toISOString().slice(0,10);
  return'';
}
let _occNaturesMemo={rowsRef:null,natRef:null,result:[]};
function occurrenceNatures(){const scoped=scope(S.occ);if(_occNaturesMemo.rowsRef===scoped&&_occNaturesMemo.natRef===S.natureCatalog)return _occNaturesMemo.result;const set=new Set(S.natureCatalog.flatMap(item=>[item.nome,...aliasesOf(item)]));for(let i=0,len=scoped.length;i<len;i++){const n=scoped[i].natureza_ocorrencia;if(n)set.add(n)}const res=[...set].sort((a,b)=>a.localeCompare(b,'pt-BR'));_occNaturesMemo={rowsRef:scoped,natRef:S.natureCatalog,result:res};return res}
let _histFilterMemo={rowsRef:null,filterKey:'',result:[]};
function filteredHistoryOccurrences(){
  const f=S.historyFilters,
        validOnly=(S.occ||[]).filter(isValidatedOccurrence),
        scoped=scope(validOnly),
        protocol=String(f.protocol||'').trim().toLowerCase(),
        general=String(f.general||'').trim().toLowerCase(),
        fKey=`${f.dateFrom||''}|${f.dateTo||''}|${f.nature||''}|${protocol}|${general}`;
  if(_histFilterMemo.rowsRef===scoped&&_histFilterMemo.filterKey===fKey)return _histFilterMemo.result;
  const res=scoped.filter(x=>{
    if(f.nature&&x.natureza_ocorrencia!==f.nature)return false;
    const meta=getOccSearchMeta(x);
    if(f.dateFrom&&(!meta.dateKey||meta.dateKey<f.dateFrom))return false;
    if(f.dateTo&&(!meta.dateKey||meta.dateKey>f.dateTo))return false;
    if(protocol&&meta.proto.indexOf(protocol)===-1)return false;
    if(general&&meta.general.indexOf(general)===-1)return false;
    return true;
  });
  _histFilterMemo={rowsRef:scoped,filterKey:fKey,result:res};
  return res;
}
function occurrenceHistoryTotalPages(){return Math.max(1,Math.ceil(filteredHistoryOccurrences().length/S.pageSize))}
function pagedHistoryOccurrences(){const all=filteredHistoryOccurrences(),total=Math.max(1,Math.ceil(all.length/S.pageSize));S.currentPage=Math.min(Math.max(1,S.currentPage),total);const start=(S.currentPage-1)*S.pageSize;return all.slice(start,start+S.pageSize)}
function historyFiltersBar(){const f=S.historyFilters;return `<div class="history-filter-card card"><div class="history-filter-header"><div><h3>Filtros do histórico</h3><p>Refine a consulta sem recarregar o sistema</p></div><button id="clearHistoryFilters" class="btn">Limpar filtros</button></div><div class="history-filter-grid"><label><span class="label">Data inicial</span><input id="historyDateFrom" class="field" type="date" value="${esc(f.dateFrom)}"></label><label><span class="label">Data final</span><input id="historyDateTo" class="field" type="date" value="${esc(f.dateTo)}"></label><label><span class="label">Natureza</span><select id="historyNature" class="field"><option value="">Todas</option>${occurrenceNatures().map(x=>`<option value="${esc(x)}" ${x===f.nature?'selected':''}>${esc(x)}</option>`).join('')}</select></label><label><span class="label">Pesquisar protocolo</span><input id="historyProtocol" class="field" value="${esc(f.protocol)}" placeholder="Pesquisar protocolo..."></label><label class="history-general"><span class="label">Pesquisa geral</span><input id="historyGeneral" class="field" value="${esc(f.general)}" placeholder="Nome, unidade, local ou descrição..."></label></div></div>`}
function filteredPendingOccurrences(){
  const list=S.occ||[];
  const validatedInts=new Set();
  const validatedOccs=new Set();
  const validatedProtos=new Set();

  for(let i=0,len=list.length;i<len;i++){
    const item=list[i];
    if(isValidatedOccurrence(item)){
      const idInt=String(item.id_interno||'').trim();
      const idOcc=String(item.id_ocorrencia||'').trim();
      const proto=String(item.numero_protocolo||'').trim().toUpperCase();
      if(idInt)validatedInts.add(idInt);
      if(idOcc)validatedOccs.add(idOcc);
      if(proto)validatedProtos.add(proto);
    }
  }

  const map=new Map();
  for(let i=0,len=list.length;i<len;i++){
    const item=list[i];
    if(!isPendingOccurrence(item))continue;

    const idInt=String(item.id_interno||'').trim();
    const idOcc=String(item.id_ocorrencia||'').trim();
    const proto=String(item.numero_protocolo||'').trim().toUpperCase();

    if(idInt&&validatedInts.has(idInt))continue;
    if(idOcc&&validatedOccs.has(idOcc))continue;
    if(proto&&validatedProtos.has(proto))continue;

    const k=idInt||idOcc||proto;
    if(k&&!map.has(k)){
      map.set(k,item);
    }
  }
  return scope([...map.values()]);
} 
function pendingValidationPage(){const rows=filteredPendingOccurrences();return `<div class="row between history-title"><div><h2>Validação de Ocorrências</h2><p class="muted">Ocorrências aguardando aprovação e conferência da supervisão</p></div></div><div class="card history-table-card"><div class="tablewrap"><table class="table history-table"><thead><tr><th>Protocolo</th><th>Data</th><th>Hora</th><th>Unidade</th><th>Natureza</th><th>Registrado por</th><th>Status</th><th style="min-width:180px">Ações</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td><b>${esc(x.numero_protocolo)}</b></td><td>${esc(x.data_ocorrencia)}</td><td>${esc(x.hora_ocorrencia)}</td><td>${esc(x.unidade)}</td><td>${esc(x.natureza_ocorrencia)}</td><td>${esc(formatOccurrenceResponsible(x))}</td><td><span class="status-pill pending-pill">${esc(x.status_validacao || 'Pendente de validação')}</span></td><td class="actions" style="display:flex;gap:8px;align-items:center;white-space:nowrap"><button type="button" class="btn-validate-occ openValidationModal" data-id="${esc(x.id_ocorrencia)}" title="Revisar e Validar Ocorrência"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span>Validar Ocorrência</span></button><button type="button" class="btn-delete-occ promptDeletePending" data-id="${esc(x.id_ocorrencia)}" data-protocol="${esc(x.numero_protocolo)}" data-unit="${esc(x.unidade)}" title="Excluir Ocorrência Pendente"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg><span>Excluir</span></button></td></tr>`).join(''):`<tr><td colspan="8"><p class="muted" style="text-align:center;padding:24px">Nenhuma ocorrência aguardando validação no momento.</p></td></tr>`}</tbody></table></div></div>`}
function occurrenceHistoryPage(){
  const all=filteredHistoryOccurrences(),rows=pagedHistoryOccurrences(),total=occurrenceHistoryTotalPages(),start=all.length?(S.currentPage-1)*S.pageSize+1:0,end=Math.min(S.currentPage*S.pageSize,all.length);
  return `<div class="row between history-title">
    <div><h2>Histórico de Ocorrências</h2><p class="muted">Consulta e gestão dos registros cadastrados</p></div>
    <div style="display:flex;gap:10px;align-items:center">
      ${isAdministratorUser(S.user)?`<label class="btn" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px" title="Importar arquivo CSV de ocorrências">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <span>Importar CSV</span>
        <input id="historyImportCsvInput" class="hidden" type="file" accept=".csv" multiple>
      </label>`:''}
      <button id="historyRegisterOccurrence" class="btn primary">Registrar ocorrência</button>
    </div>
  </div>
  ${historyFiltersBar()}
  <div class="card history-table-card">
    <div class="tablewrap">
      <table class="table history-table">
        <thead><tr><th class="col-protocol whitespace-nowrap">Protocolo</th><th class="col-date whitespace-nowrap">Data</th><th class="col-time whitespace-nowrap">Hora</th><th class="col-unit whitespace-nowrap">Unidade</th><th class="col-nature whitespace-nowrap">Natureza</th><th class="col-responsible whitespace-nowrap">Responsável / Matrícula</th><th class="col-status whitespace-nowrap">Status</th><th class="col-actions whitespace-nowrap">Ações</th></tr></thead>
        <tbody>${rows.length?rows.map(x=>`<tr><td class="col-protocol whitespace-nowrap"><b>${esc(x.numero_protocolo)}</b></td><td class="col-date whitespace-nowrap">${esc(x.data_ocorrencia)}</td><td class="col-time whitespace-nowrap">${esc(x.hora_ocorrencia)}</td><td class="col-unit whitespace-nowrap">${esc(x.unidade)}</td><td class="col-nature whitespace-nowrap">${esc(x.natureza_ocorrencia)}</td><td class="col-responsible whitespace-nowrap">${esc(formatOccurrenceResponsible(x))}</td><td class="col-status whitespace-nowrap"><span class="status-pill">${esc(x.status)}</span></td><td class="actions col-actions whitespace-nowrap"><button class="viewOcc" data-id="${x.id_ocorrencia}" title="Visualizar">👁️</button><button class="editOcc" data-id="${x.id_ocorrencia}" title="Editar">✏️</button><button class="pdfOcc" data-id="${x.id_ocorrencia}" title="Gerar Relatório em PDF" style="display:inline-flex;align-items:center;justify-content:center;padding:2px">${adobePdfIcon(16)}</button>${isAdministratorUser(S.user)?`<button class="deleteRecordPrompt" data-modulo="Ocorrências" data-id="${x.id_ocorrencia}" data-code="${esc(x.numero_protocolo)}" data-detail="${esc(x.unidade)} · ${esc(x.natureza_ocorrencia)}" title="Excluir Ocorrência">🗑️</button>`:''}</td></tr>`).join(''):`<tr><td colspan="8" style="text-align:center;padding:32px 16px;color:#64748b;font-size:14px">Nenhuma ocorrência encontrada no histórico.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="history-pagination">
      <span>Mostrando ${start}-${end} de ${all.length} registros · Página ${S.currentPage} de ${total}</span>
      <div class="row">
        <button id="historyFirst" class="btn" ${S.currentPage<=1?'disabled':''}>Primeira</button>
        <button id="historyPrev" class="btn" ${S.currentPage<=1?'disabled':''}>Anterior</button>
        <button id="historyNext" class="btn" ${S.currentPage>=total?'disabled':''}>Próxima</button>
        <button id="historyLast" class="btn" ${S.currentPage>=total?'disabled':''}>Última</button>
      </div>
    </div>
  </div>`}
function adobePdfIcon(size=16,extraClass=''){
  return `<svg class="adobe-pdf-icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;flex-shrink:0" aria-hidden="true"><rect width="24" height="24" rx="4" fill="#dc2626"/><path d="M19.38 5.75c-.4-.4-.95-.6-1.6-.6-1.25 0-2.4.67-3.4 1.98a25.8 25.8 0 0 0-2.3 3.92 23.3 23.3 0 0 0-4.8 3.02c-1 .6-2.2 1.25-2.7 1.9-.4.5-.5 1-.4 1.5.2.8.9 1.28 1.9 1.28 1.3 0 2.5-.95 3.7-2.75.7-.36 1.4-.7 2.1-1.02 1.1-.47 2.1-.86 3-1.12 1.1.7 2.1 1.1 2.8 1.1 1.1 0 1.7-.67 1.7-1.53 0-1.1-1.1-2.03-2.9-2.64-.4-1.2-.95-2.6-1.55-4 .6-.86 1.2-1.3 1.7-1.3.4 0 .6.2.7.46.1.4-.2.9-.6 1.2l.75.75c.85-.64 1.25-1.42 1.25-2.17 0-1-.68-1.7-1.6-1.7zm-10.6 11.8c-.6 0-.8-.4-.8-.8 0-.43.3-.9 1-1.4.37-.25.83-.54 1.33-.86-.96 1.9-1.39 3.06-1.53 3.06zm5.97-5.4c.43-1.07.86-2.14 1.2-3.03.6 1.07 1.1 2.18 1.54 3.22-.79.25-1.68.57-2.74 1.03v-.04c-.03-.4-.03-.78 0-1.18zm3.64 1c1.28.43 1.96 1 1.96 1.57 0 .36-.2.57-.57.57-.54 0-1.32-.54-2.18-1.43.25-.25.5-.5.79-.71z" fill="#ffffff"/></svg>`;
}
function pdfSafe(value,fallback='Não informado'){const text=String(value??'').trim();return text||fallback}
function pdfDateTime(value){if(!value)return'Não informado';const date=new Date(value);return Number.isNaN(date.getTime())?pdfSafe(value):date.toLocaleString('pt-BR')}
function pdfFileName(protocol){return `OCORRENCIA_${String(protocol||'SEM_PROTOCOLO').replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`}
function pdfApuracaoFileName(protocol){return `APURACAO_${String(protocol||'SEM_PROTOCOLO').replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`}
function showLoading(message='Processando...',options={}){const {kicker='Processamento corporativo',title='SIGESP',progress=8,showProgress=true,overlayId='pdfProgressOverlay'}=options;S.pdfProgress={...(S.pdfProgress||{}),progress,status:message};document.getElementById(overlayId)?.remove();const overlay=document.createElement('div');overlay.id=overlayId;overlay.className='modalbg pdf-overlay loading-overlay';overlay.style.cssText='position:fixed;inset:0;z-index:99999!important;display:grid;place-items:center;background:rgba(7,28,53,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';overlay.innerHTML=`<div class="pdf-progress-dialog"><div class="pdf-spinner"></div><div><div class="pdf-kicker">${esc(kicker)}</div><h2>${esc(title)}</h2><p id="pdfProgressStatus">${esc(message)}</p>${showProgress?`<div class="pdf-progress-track"><div id="pdfProgressBar" class="pdf-progress-bar" style="width:${Math.min(100,Math.max(0,progress))}%"></div></div><strong id="pdfProgressValue">${Math.round(progress)}%</strong>`:''}</div></div>`;document.body.appendChild(overlay);return overlay}
function updateLoadingProgress(progress,status){S.pdfProgress={...(S.pdfProgress||{}),progress,status};const bar=document.getElementById('pdfProgressBar'),value=document.getElementById('pdfProgressValue'),label=document.getElementById('pdfProgressStatus');if(bar)bar.style.width=`${Math.min(100,Math.max(0,progress))}%`;if(value)value.textContent=`${Math.round(progress)}%`;if(label)label.textContent=status}
function hideLoading(){document.getElementById('pdfProgressOverlay')?.remove();document.getElementById('loadingOverlay')?.remove();S.pdfProgress=null}
function showPdfProgress(protocol){showLoading('Preparando dados da ocorrência...',{kicker:'Exportação corporativa',title:'Gerando relatório da ocorrência...',progress:8,overlayId:'pdfProgressOverlay'})}
function updatePdfProgress(progress,status){updateLoadingProgress(progress,status)}
function closePdfProgress(){hideLoading()}
function showPdfResult(success,message,fileName=''){closePdfProgress();const overlay=document.createElement('div');overlay.className='modalbg popup-backdrop';overlay.id='pdfResultOverlay';overlay.style.cssText='position:fixed;inset:0;z-index:99999!important;display:grid;place-items:center;background:rgba(7,28,53,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';overlay.innerHTML=`<div class="pdf-result-dialog ${success?'pdf-result-success':'pdf-result-error'}"><div class="pdf-result-icon">${success?'✓':'!'}</div><h2>${success?'Relatório PDF gerado com sucesso.':'Não foi possível gerar o relatório PDF.'}</h2><p>${esc(message)}</p>${fileName?`<div class="pdf-file-name">${esc(fileName)}</div>`:''}<button id="closePdfResult" class="btn ${success?'pdf-success-btn':'pdf-error-btn'}">Fechar</button></div>`;document.body.appendChild(overlay);document.getElementById('closePdfResult')?.addEventListener('click',()=>overlay.remove())}
async function qrDataUrl(text){
  try{
    const holder=document.createElement('div');
    holder.style.cssText='position:fixed;left:-9999px;top:-9999px;width:160px;height:160px';
    document.body.appendChild(holder);
    const safeText=String(text||'').slice(0,80);
    new QRCode(holder,{text:safeText,width:160,height:160,colorDark:'#0b2440',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.L});
    await new Promise(r=>setTimeout(r,35));
    const canvas=holder.querySelector('canvas'),img=holder.querySelector('img'),data=canvas?canvas.toDataURL('image/png'):img?.src;
    holder.remove();
    return data||null;
  }catch(err){
    console.warn('QR Code generation fallback:',err);
    return null;
  }
}
async function imageForPdf(path){
  const item=await image(path);
  if(!item||!item.url)return null;
  try{
    let bitmap;
    if(item.file){
      bitmap=await createImageBitmap(item.file);
    }else{
      const response=await fetch(item.url);
      const blob=await response.blob();
      bitmap=await createImageBitmap(blob);
    }
    const max=1500;
    const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const targetW=Math.max(1,Math.round(bitmap.width*scale));
    const targetH=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');
    canvas.width=targetW;
    canvas.height=targetH;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(bitmap,0,0,targetW,targetH);
    bitmap.close();
    const data=canvas.toDataURL('image/jpeg',.84);
    canvas.width=0;
    canvas.height=0;
    return{data,width:targetW,height:targetH,path};
  }catch(err){
    console.warn('[imageForPdf] Falha ao processar imagem para PDF:',path,err);
    return null;
  }
}
async function generateOccurrencePdf(id){const occurrence=S.occ.find(x=>x.id_ocorrencia===id);if(!occurrence)return showPdfResult(false,'A ocorrência selecionada não foi encontrada. Verifique o histórico e tente novamente.');if(!occurrence.numero_protocolo||!occurrence.relato_detalhado)return showPdfResult(false,'Os dados essenciais da ocorrência estão ausentes ou corrompidos.');if(!window.jspdf?.jsPDF||!window.QRCode)return showPdfResult(false,'As bibliotecas de geração do PDF não foram carregadas.');showPdfProgress(occurrence.numero_protocolo);await new Promise(r=>setTimeout(r,20));try{updatePdfProgress(14,'Validando dados e rastreabilidade...');const paths=String(occurrence.anexos_referencias||'').split('|').filter(Boolean),photoPaths=paths.filter(x=>/\.(jpe?g|png|webp)$/i.test(x)),documentPaths=paths.filter(x=>!photoPaths.includes(x));const photos=[];for(let i=0;i<photoPaths.length;i++){updatePdfProgress(18+Math.round((i/Math.max(1,photoPaths.length))*30),`Processando evidência fotográfica ${i+1} de ${photoPaths.length}...`);const pic=await imageForPdf(photoPaths[i]);if(pic)photos.push(pic)}updatePdfProgress(52,'Montando o documento executivo...');const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true}),pageW=210,pageH=297,margin=16,contentW=178,footerY=286,issued=new Date(),issuedText=issued.toLocaleString('pt-BR');let y=18;const blue=[11,55,92],lightBlue=[233,241,249],gray=[79,93,110],lightGray=[244,247,250],green=[22,101,52];const ensure=(need=16)=>{if(y+need>footerY-8){doc.addPage();y=18;return true}return false};const text=(value,x,width,size=9,color=gray,style='normal')=>{doc.setFont('helvetica',style);doc.setFontSize(size);doc.setTextColor(...color);const lines=doc.splitTextToSize(pdfSafe(value,''),width);ensure(lines.length*(size*.38)+4);doc.text(lines,x,y);y+=lines.length*(size*.38)+2};const section=title=>{ensure(14);doc.setFillColor(...blue);doc.roundedRect(margin,y,contentW,9,2,2,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(title.toUpperCase(),margin+4,y+6);y+=13};const fieldGrid=(items,cols=2)=>{const gap=4,cellW=(contentW-gap*(cols-1))/cols;for(let i=0;i<items.length;i+=cols){const row=items.slice(i,i+cols),heights=row.map(([label,value])=>{doc.setFontSize(9);return doc.splitTextToSize(pdfSafe(value),cellW-8).length*4+12}),h=Math.max(22,...heights);ensure(h+3);row.forEach(([label,value],idx)=>{const x=margin+idx*(cellW+gap);doc.setFillColor(...lightGray);doc.setDrawColor(219,227,236);doc.roundedRect(x,y,cellW,h,2,2,'FD');doc.setTextColor(...gray);doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.text(label.toUpperCase(),x+4,y+5);doc.setTextColor(20,36,58);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(doc.splitTextToSize(pdfSafe(value),cellW-8),x+4,y+11)});y+=h+3}};const longBlock=(title,value)=>{section(title);ensure(20);doc.setFillColor(250,251,253);doc.setDrawColor(220,227,235);const lines=doc.splitTextToSize(pdfSafe(value),contentW-10);let index=0;while(index<lines.length){const available=Math.max(1,Math.floor((footerY-y-14)/4));if(available<3){doc.addPage();y=18;section(`${title} - Continuação`);continue}const chunk=lines.slice(index,index+available),h=chunk.length*4+10;doc.setFillColor(250,251,253);doc.setDrawColor(220,227,235);doc.roundedRect(margin,y,contentW,h,2,2,'FD');doc.setTextColor(35,48,65);doc.setFont('helvetica','normal');doc.setFontSize(9.2);doc.text(chunk,margin+5,y+7);y+=h+4;index+=chunk.length}};
// Header
 doc.setFillColor(...blue);doc.rect(0,0,pageW,34,'F');doc.setFillColor(255,255,255);doc.roundedRect(margin,7,18,18,4,4,'F');doc.setTextColor(...blue);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('SP',margin+4.4,18.5);doc.setTextColor(255,255,255);doc.setFontSize(15);doc.text('SIGESP',margin+24,13);doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.text('Sistema Integrado de Gestão da Segurança Patrimonial',margin+24,18);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('RELATÓRIO DE OCORRÊNCIA',margin+24,25);y=42;
section('Identificação da ocorrência');fieldGrid([['Protocolo',occurrence.numero_protocolo],['Status',occurrence.status],['Data',occurrence.data_ocorrencia],['Hora',occurrence.hora_ocorrencia],['Unidade',occurrence.unidade],['Local específico',occurrence.local_especifico],['Natureza',occurrence.natureza_ocorrencia],['Responsável pelo registro',formatOccurrenceResponsible(occurrence)]]);
section('Dados da ocorrência');fieldGrid([['Classificação / Prioridade',occurrence.prioridade],['Categoria / Natureza',occurrence.natureza_ocorrencia],['Envolvido',occurrence.nome_envolvido],['Empresa',occurrence.empresa_envolvido],['Área',occurrence.area],['Turno',occurrence.turno||'Não informado'],['Matrícula / ID',occurrence.matricula_id],['Documento / Placa',`${pdfSafe(occurrence.documento,'-')} / ${pdfSafe(occurrence.placa_veiculo,'-')}`]]);
longBlock('Relato completo',occurrence.relato_detalhado);longBlock('Análise dos fatos',occurrence.analise_fatos||occurrence.relato_detalhado);longBlock('Providências adotadas',occurrence.providencias_adotadas);if(occurrence.observacoes)longBlock('Observações',occurrence.observacoes);
section('Rastreabilidade');fieldGrid([['Data do registro',pdfDateTime(occurrence.data_registro)],['Última atualização',pdfDateTime(occurrence.data_atualizacao)],['Usuário criador',occurrence.responsavel_registro],['Última alteração',occurrence.usuario_ultima_alteracao],['Data da exportação',issuedText],['Versão do registro',occurrence.versao_registro]]);
const qr=await qrDataUrl(`PROTOCOLO:${occurrence.numero_protocolo}\nDATA:${occurrence.data_ocorrencia}\nUNIDADE:${occurrence.unidade}`);ensure(35);if(qr){doc.addImage(qr,'PNG',margin,y,28,28);doc.setTextColor(...gray);doc.setFontSize(8);doc.text('QR Code de rastreabilidade',margin+33,y+7);doc.setFontSize(9);doc.setTextColor(20,36,58);doc.text(doc.splitTextToSize(`Protocolo: ${occurrence.numero_protocolo}\nData: ${occurrence.data_ocorrencia}\nUnidade: ${occurrence.unidade}`,130),margin+33,y+13);y+=33}
if(documentPaths.length){section('Documentos anexados');documentPaths.forEach((path,index)=>text(`${index+1}. ${path}`,margin+3,contentW-6,8.5));}
if(photos.length){section('Anexos fotográficos');for(let i=0;i<photos.length;i+=2){const row=photos.slice(i,i+2),cellW=(contentW-6)/2,maxImageH=58,captionH=10,rowH=maxImageH+captionH+6;ensure(rowH);row.forEach((photo,j)=>{const x=margin+j*(cellW+6),ratio=photo.width/photo.height;let w=cellW-4,h=w/ratio;if(h>maxImageH){h=maxImageH;w=h*ratio}const ix=x+(cellW-w)/2,iy=y+(maxImageH-h)/2;doc.setDrawColor(210,219,230);doc.roundedRect(x,y,cellW,rowH-2,2,2,'S');doc.addImage(photo.data,'JPEG',ix,iy,w,h,undefined,'FAST');doc.setTextColor(...gray);doc.setFontSize(8);doc.text(`Foto ${i+j+1} - Evidência da Ocorrência`,x+cellW/2,y+maxImageH+6,{align:'center'})});y+=rowH}}
updatePdfProgress(86,'Aplicando rodapé, paginação e acabamento...');const pages=doc.getNumberOfPages();for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor(190,201,214);doc.line(margin,281,pageW-margin,281);doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(...gray);doc.text('SIGESP - Sistema Integrado de Gestão da Segurança Patrimonial',margin,286);doc.text(`Data de Emissão: ${issuedText}`,pageW/2,286,{align:'center'});doc.text(`Página ${page} de ${pages}`,pageW-margin,286,{align:'right'})}updatePdfProgress(97,'Finalizando o download...');const fileName=pdfFileName(occurrence.numero_protocolo);doc.save(fileName);updatePdfProgress(100,'Relatório concluído.');setTimeout(()=>showPdfResult(true,'O relatório executivo foi gerado e baixado automaticamente.',fileName),250)}catch(error){console.error(error);showPdfResult(false,'Verifique os dados da ocorrência e tente novamente.')}}
async function generateApuracaoPdf(id){
  let occurrence=(S.occ||[]).find(x=>String(x.id_ocorrencia)===String(id)||String(x.id_interno)===String(id)||String(x.numero_protocolo)===String(id));
  if(!occurrence){
    try{ occurrence=await searchOccurrenceInFiles(id); }catch{}
  }
  if(!occurrence)return showPdfResult(false,'A ocorrência selecionada não foi encontrada. Verifique os registros e tente novamente.');
  if(!occurrence.numero_protocolo)return showPdfResult(false,'Os dados essenciais da ocorrência estão ausentes ou corrompidos.');
  if(!window.jspdf?.jsPDF||!window.QRCode)return showPdfResult(false,'As bibliotecas de geração do PDF não foram carregadas.');
  showPdfProgress(occurrence.numero_protocolo);
  await new Promise(r=>setTimeout(r,20));
  try{
    updatePdfProgress(14,'Validando dados investigativos e anexos...');
    const ap=extractApuracaoData(occurrence);
    const apuradorNome=S.user.nome?`${S.user.nome} (${S.user.login})`:(S.user.login||'Não informado');
    const allRefs=String(occurrence.anexos_referencias||'').split('|').map(p=>p.trim()).filter(Boolean);
    const photoPaths=allRefs.filter(x=>/\.(jpe?g|png|webp)$/i.test(x));
    const pdfPaths=allRefs.filter(x=>/\.pdf$/i.test(x));
    const photos=[];
    for(let i=0;i<photoPaths.length;i++){
      updatePdfProgress(18+Math.round((i/Math.max(1,photoPaths.length))*30),`Processando evidência fotográfica ${i+1} de ${photoPaths.length}...`);
      const pic=await imageForPdf(photoPaths[i]);
      if(pic)photos.push(pic);
    }
    updatePdfProgress(52,'Montando o relatório executivo de apuração...');
    const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
    const pageW=210,pageH=297,margin=16,contentW=178,footerY=286,issued=new Date(),issuedText=issued.toLocaleString('pt-BR');
    let y=18;
    const blue=[11,55,92],lightBlue=[233,241,249],gray=[79,93,110],lightGray=[244,247,250];
    const ensure=(need=16)=>{if(y+need>footerY-8){doc.addPage();y=18;return true}return false};
    const text=(value,x,width,size=9,color=gray,style='normal')=>{doc.setFont('helvetica',style);doc.setFontSize(size);doc.setTextColor(...color);const lines=doc.splitTextToSize(pdfSafe(value,''),width);ensure(lines.length*(size*.38)+4);doc.text(lines,x,y);y+=lines.length*(size*.38)+2};
    const section=title=>{ensure(14);doc.setFillColor(...blue);doc.roundedRect(margin,y,contentW,9,2,2,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text(title.toUpperCase(),margin+4,y+6);y+=13};
    const fieldGrid=(items,cols=2)=>{const gap=4,cellW=(contentW-gap*(cols-1))/cols;for(let i=0;i<items.length;i+=cols){const row=items.slice(i,i+cols),heights=row.map(([label,value])=>{doc.setFontSize(9);return doc.splitTextToSize(pdfSafe(value),cellW-8).length*4+12}),h=Math.max(22,...heights);ensure(h+3);row.forEach(([label,value],idx)=>{const x=margin+idx*(cellW+gap);doc.setFillColor(...lightGray);doc.setDrawColor(219,227,236);doc.roundedRect(x,y,cellW,h,2,2,'FD');doc.setTextColor(...gray);doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.text(label.toUpperCase(),x+4,y+5);doc.setTextColor(20,36,58);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(doc.splitTextToSize(pdfSafe(value),cellW-8),x+4,y+11)});y+=h+3}};
    const longBlock=(title,value)=>{section(title);ensure(20);doc.setFillColor(250,251,253);doc.setDrawColor(220,227,235);const lines=doc.splitTextToSize(pdfSafe(value),contentW-10);let index=0;while(index<lines.length){const available=Math.max(1,Math.floor((footerY-y-14)/4));if(available<3){doc.addPage();y=18;section(`${title} - Continuação`);continue}const chunk=lines.slice(index,index+available),h=chunk.length*4+10;doc.setFillColor(250,251,253);doc.setDrawColor(220,227,235);doc.roundedRect(margin,y,contentW,h,2,2,'FD');doc.setTextColor(35,48,65);doc.setFont('helvetica','normal');doc.setFontSize(9.2);doc.text(chunk,margin+5,y+7);y+=h+4;index+=chunk.length}};

    doc.setFillColor(...blue);doc.rect(0,0,pageW,34,'F');doc.setFillColor(255,255,255);doc.roundedRect(margin,7,18,18,4,4,'F');doc.setTextColor(...blue);doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text('SP',margin+4.4,18.5);doc.setTextColor(255,255,255);doc.setFontSize(15);doc.text('SIGESP',margin+24,13);doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.text('Sistema Integrado de Gestão da Segurança Patrimonial',margin+24,18);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('RELATÓRIO DE APURAÇÃO DE SEGURANÇA FÍSICA',margin+24,25);y=42;

    section('1. Identificação da ocorrência e status da apuração');fieldGrid([['Protocolo',occurrence.numero_protocolo],['Status da Apuração',ap.status],['Gravidade da Ocorrência',ap.prioridade||occurrence.prioridade],['Data / Hora do Incidente',`${occurrence.data_ocorrencia} às ${occurrence.hora_ocorrencia||'Não informada'}`],['Unidade Operacional',occurrence.unidade],['Supervisão / Setor',`${pdfSafe(occurrence.supervisao,'Não informada')} / ${pdfSafe(occurrence.area,'Geral')}`],['Natureza da Ocorrência',occurrence.natureza_ocorrencia],['Responsável pelo Registro',formatOccurrenceResponsible(occurrence)]]);
    section('2. Dados do incidente e partes envolvidas');fieldGrid([['Nome do Envolvido',pdfSafe(occurrence.nome_envolvido,'Não identificado')],['Tipo de Vínculo',occurrence.tipo_vinculo||'Terceiro'],['Empresa',pdfSafe(occurrence.empresa_envolvido,'Não informada')],['Matrícula / ID',pdfSafe(occurrence.matricula_id,'Não informado')],['Documento',pdfSafe(occurrence.documento,'Não informado')],['Placa do Veículo',pdfSafe(occurrence.placa_veiculo,'Não informado')],['Local Específico',pdfSafe(occurrence.local_especifico,'Não informado')],['Turno Operacional',pdfSafe(occurrence.turno,'Não informado')]]);

    longBlock('3. Relato inicial do fato registrado',occurrence.relato_detalhado||'Sem relato original registrado.');
    longBlock('4. Averiguações de campo e diligências investigativas',ap.notas||'Nenhuma nota investigativa inserida.');
    longBlock('5. Conclusão e parecer da gestão de segurança física',ap.conclusao||'Apuração em andamento, parecer conclusivo pendente.');
    longBlock('6. Plano de ação e medidas corretivas / preventivas',ap.planoAcao||occurrence.providencias_adotadas||'Nenhuma medida corretiva cadastrada.');

    section('7. Rastreabilidade e auditoria da apuração');fieldGrid([['Apurador Responsável',apuradorNome],['Data da Apuração',pdfDateTime(ap.dataApuracao||occurrence.data_atualizacao)],['Data do Registro Inicial',pdfDateTime(occurrence.data_registro)],['Última Atualização',pdfDateTime(occurrence.data_atualizacao)],['Usuário da Alteração',occurrence.usuario_ultima_alteracao||S.user?.login||'Não informado'],['Versão do Registro',occurrence.versao_registro||'1.0']]);

    const qr=await qrDataUrl(`PROTOCOLO:${occurrence.numero_protocolo}\nSTATUS:${ap.status}`);
    ensure(35);
    if(qr){
      doc.addImage(qr,'PNG',margin,y,28,28);
      doc.setTextColor(...gray);
      doc.setFontSize(8);
      doc.text('QR Code de Autenticidade e Rastreabilidade',margin+33,y+7);
      doc.setFontSize(9);
      doc.setTextColor(20,36,58);
      doc.text(doc.splitTextToSize(`Protocolo: ${occurrence.numero_protocolo}\nStatus Apuração: ${ap.status}\nUnidade: ${occurrence.unidade}\nClassificação: ${ap.prioridade||occurrence.prioridade}`,130),margin+33,y+13);
      y+=33;
    }

    if(pdfPaths.length){
      section('8. Laudos periciais e documentos anexados');
      pdfPaths.forEach((path,index)=>text(`${index+1}. ${path.split('/').pop()} (${path})`,margin+3,contentW-6,8.5));
    }

    if(photos.length){
      section('9. Evidências fotográficas da ocorrência');
      for(let i=0;i<photos.length;i+=2){
        const row=photos.slice(i,i+2),cellW=(contentW-6)/2,maxImageH=58,captionH=10,rowH=maxImageH+captionH+6;
        ensure(rowH);
        row.forEach((photo,j)=>{
          const x=margin+j*(cellW+6),ratio=photo.width/photo.height;
          let w=cellW-4,h=w/ratio;
          if(h>maxImageH){h=maxImageH;w=h*ratio}
          const ix=x+(cellW-w)/2,iy=y+(maxImageH-h)/2;
          doc.setDrawColor(210,219,230);
          doc.roundedRect(x,y,cellW,rowH-2,2,2,'S');
          doc.addImage(photo.data,'JPEG',ix,iy,w,h,undefined,'FAST');
          doc.setTextColor(...gray);
          doc.setFontSize(8);
          doc.text(`Foto ${i+j+1} - Evidência de Campo`,x+cellW/2,y+maxImageH+6,{align:'center'});
        });
        y+=rowH;
      }
    }

    updatePdfProgress(86,'Aplicando rodapé corporativo e paginação...');
    const pages=doc.getNumberOfPages();
    for(let page=1;page<=pages;page++){
      doc.setPage(page);
      doc.setDrawColor(190,201,214);
      doc.line(margin,281,pageW-margin,281);
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...gray);
      doc.text('SIGESP - Sistema Integrado de Gestão da Segurança Patrimonial · Relatório de Apuração',margin,286);
      doc.text(`Data de Emissão: ${issuedText}`,pageW/2,286,{align:'center'});
      doc.text(`Página ${page} de ${pages}`,pageW-margin,286,{align:'right'});
    }

    updatePdfProgress(97,'Finalizando o download...');
    const fileName=pdfApuracaoFileName(occurrence.numero_protocolo);
    doc.save(fileName);
    updatePdfProgress(100,'Relatório de apuração concluído.');
    setTimeout(()=>showPdfResult(true,'O relatório de apuração foi gerado e baixado automaticamente.',fileName),250);
  }catch(error){
    console.error('Falha ao gerar relatório de apuração em PDF:',error);
    showPdfResult(false,'Verifique os dados da apuração e tente novamente.');
  }
}
let _occFilterMemo={rowsRef:null,query:'',result:[]};
function filteredOccurrences(){
  const validOnly=(S.occ||[]).filter(isValidatedOccurrence),
        scoped=scope(validOnly),
        q=String(S.query||'').trim().toLowerCase();
  if(!q)return scoped;
  if(_occFilterMemo.rowsRef===scoped&&_occFilterMemo.query===q)return _occFilterMemo.result;
  const res=scoped.filter(x=>{
    const m=getOccSearchMeta(x);
    if(!m.full)m.full=Object.values(x).join(' ').toLowerCase();
    return m.full.indexOf(q)!==-1;
  });
  _occFilterMemo={rowsRef:scoped,query:q,result:res};
  return res;
}
function occurrenceTotalPages(){return Math.max(1,Math.ceil(filteredOccurrences().length/S.pageSize))}
function pagedOccurrences(){const all=filteredOccurrences(),total=Math.max(1,Math.ceil(all.length/S.pageSize));if(S.currentPage>total)S.currentPage=total;if(S.currentPage<1)S.currentPage=1;const start=(S.currentPage-1)*S.pageSize;return all.slice(start,start+S.pageSize)}
function occList(){const all=filteredOccurrences(),rows=pagedOccurrences(),total=occurrenceTotalPages(),start=all.length?(S.currentPage-1)*S.pageSize+1:0,end=Math.min(S.currentPage*S.pageSize,all.length);return `<div class="row between"><h2>Registro de ocorrências</h2><button id="newOcc" class="btn primary">Nova ocorrência</button></div><div class="card"><input id="search" class="field" placeholder="Pesquisar" value="${esc(S.query)}"><div class="tablewrap"><table class="table"><tr><th>Protocolo</th><th>Unidade</th><th>Natureza</th><th>Status</th><th>Fotos</th><th>Ações</th></tr>${rows.map(x=>`<tr><td>${esc(x.numero_protocolo)}</td><td>${esc(x.unidade)}</td><td>${esc(x.natureza_ocorrencia)}</td><td>${esc(x.status)}</td><td>${String(x.anexos_referencias||'').split('|').filter(Boolean).length}</td><td class="actions"><button class="viewOcc" data-id="${x.id_ocorrencia}">👁️</button><button class="editOcc" data-id="${x.id_ocorrencia}">✏️</button>${isAdministratorUser(S.user)?`<button class="deleteRecordPrompt" data-modulo="Ocorrências" data-id="${x.id_ocorrencia}" data-code="${esc(x.numero_protocolo)}" data-detail="${esc(x.unidade)} · ${esc(x.natureza_ocorrencia)}" title="Excluir Ocorrência">🗑️</button>`:''}</td></tr>`).join('')}</table></div><div class="row between" style="margin-top:14px"><span class="muted">Exibindo ${start}–${end} de ${all.length} ocorrências · Página ${S.currentPage} de ${total}</span><div class="row"><button id="prevPage" class="btn" ${S.currentPage<=1?'disabled':''}>◀ Anterior</button><button id="nextPage" class="btn" ${S.currentPage>=total?'disabled':''}>Próxima ▶</button></div></div></div>`}
// ==========================================================================
// MÓDULO DE APURAÇÃO DE OCORRÊNCIAS (GESTÃO EXECUTIVA DE SEGURANÇA FÍSICA)
// ==========================================================================

function extractApuracaoData(occ){
  if(!occ)return{status:'Registrada',prioridade:'Média',notas:'',conclusao:'',planoAcao:'',responsavel:'',data:''};
  let notas=occ.apuracao_notas!=null?occ.apuracao_notas:(occ.notas_apuracao||'');
  let conclusao=occ.apuracao_conclusao!=null?occ.apuracao_conclusao:(occ.conclusao_apuracao||'');
  let planoAcao=occ.apuracao_plano_acao!=null?occ.apuracao_plano_acao:(occ.plano_acao||'');
  let responsavel=occ.apuracao_responsavel||'';
  let data=occ.apuracao_data||'';

  const obs=String(occ.observacao_validacao||occ.observacoes||'').trim();
  const prov=String(occ.providencias_adotadas||'').trim();
  if(!planoAcao&&prov)planoAcao=prov;

  if(!notas&&!conclusao&&obs.includes('[APURAÇÃO]')){
    const parts=obs.split('[APURAÇÃO]').pop();
    const mNotas=/NOTAS:\s*([\s\S]*?)(?=\s*\|\s*CONCLUS[ÃA]O:|$)/i.exec(parts);
    const mConcl=/CONCLUS[ÃA]O:\s*([\s\S]*?)(?=\s*\|\s*PLANO DE A[ÇC][ÃA]O:|$)/i.exec(parts);
    const mPlano=/PLANO DE A[ÇC][ÃA]O:\s*([\s\S]*?)(?=\s*\|\s*RESPONS[ÁA]VEL:|$)/i.exec(parts);
    const mResp=/RESPONS[ÁA]VEL:\s*([\s\S]*?)(?=\s*\|\s*DATA:|$)/i.exec(parts);
    const mData=/DATA:\s*([\s\S]*?)$/i.exec(parts);
    if(mNotas&&!notas)notas=mNotas[1].trim();
    if(mConcl&&!conclusao)conclusao=mConcl[1].trim();
    if(mPlano&&!planoAcao)planoAcao=mPlano[1].trim();
    if(mResp&&!responsavel)responsavel=mResp[1].trim();
    if(mData&&!data)data=mData[1].trim();
  }else if(!notas&&!conclusao&&obs&&obs!=='Aprovado pela validação'){
    notas=obs;
  }

  return{
    status:normalizeApuracaoStatus(occ.status_apuracao||occ.status),
    prioridade:occ.prioridade||'Média',
    notas,
    conclusao,
    planoAcao,
    responsavel,
    data
  };
}

function normalizeApuracaoStatus(st){
  const s=String(st||'').trim().toLowerCase();
  if(s==='em apuração'||s==='em apuracao')return 'Em Apuração';
  if(s==='encerrada'||s==='concluída'||s==='concluida')return 'Encerrada';
  return 'Registrada';
}

function formatApuracaoObservacao(originalObs,apuracao){
  let baseObs=String(originalObs||'').trim();
  if(baseObs.includes('[APURAÇÃO]')){
    baseObs=baseObs.split('[APURAÇÃO]')[0].trim();
  }
  const cleanNotas=String(apuracao.notas||'').replace(/[\r\n]+/g,' ').trim();
  const cleanConcl=String(apuracao.conclusao||'').replace(/[\r\n]+/g,' ').trim();
  const cleanPlano=String(apuracao.planoAcao||'').replace(/[\r\n]+/g,' ').trim();
  const block=`[APURAÇÃO] NOTAS: ${cleanNotas} | CONCLUSÃO: ${cleanConcl} | PLANO DE AÇÃO: ${cleanPlano} | RESPONSÁVEL: ${apuracao.responsavel} | DATA: ${apuracao.data}`;
  return baseObs?`${baseObs} ${block}`:block;
}

async function auditApuracaoAction(action,occ,details){
  try{
    await withWriteLock('audits',async()=>{
      const item={
        id_auditoria:uid(),
        data_hora:now(),
        usuario:S.user?.login||'sistema',
        perfil:S.user?.perfil||'Administrador',
        modulo:'APURACAO',
        acao:action,
        id_registro:occ.id_ocorrencia||'',
        codigo_registro:occ.numero_protocolo||occ.id_ocorrencia||'',
        detalhes:details
      };
      if(window.StorageService?.appendRecord){
        await window.StorageService.appendRecord('historico_sistema.csv',item,H.audit,{isNewRecord:true});
        S.audits=[item,...(S.audits||[])];
        CSVService.buildEntry('historico_sistema.csv',S.audits);
      }else{
        const disk=await read('historico_sistema.csv').catch(()=>[]);
        const next=[item,...disk];
        S.audits=await write('historico_sistema.csv',next,H.audit);
        CSVService.buildEntry('historico_sistema.csv',S.audits);
      }
    });
  }catch(err){console.warn('Falha ao registrar auditoria de apuração:',err)}
}

function apuracaoKpis(rows){
  const total=rows.length;
  let countRegistrada=0,countEmApuracao=0,countEncerrada=0,countCritica=0,countAlta=0;
  for(let i=0;i<total;i++){
    const st=normalizeApuracaoStatus(rows[i].status);
    if(st==='Em Apuração')countEmApuracao++;
    else if(st==='Encerrada')countEncerrada++;
    else countRegistrada++;

    const pri=String(rows[i].prioridade||'').trim().toLowerCase();
    if(pri==='crítica'||pri==='critica')countCritica++;
    else if(pri==='alta')countAlta++;
  }
  return{total,countRegistrada,countEmApuracao,countEncerrada,countCritica,countAlta};
}

let _apuracaoFilterMemo={rowsRef:null,fKey:'',result:[]};
function filteredApuracaoOccurrences(){
  const allScoped=scope((S.occ||[]).filter(isValidatedOccurrence));
  const f=S.apuracaoFilters||{};
  const fKey=`${f.dateFrom||''}|${f.dateTo||''}|${f.priority||''}|${f.nature||''}|${f.status||''}|${f.general||''}`;
  if(_apuracaoFilterMemo.rowsRef===allScoped&&_apuracaoFilterMemo.fKey===fKey)return _apuracaoFilterMemo.result;

  const qFrom=String(f.dateFrom||'').trim();
  const qTo=String(f.dateTo||'').trim();
  const qPri=String(f.priority||'').trim().toLowerCase();
  const qNat=String(f.nature||'').trim().toLowerCase();
  const qSt=String(f.status||'').trim();
  const query=String(f.general||'').trim().toLowerCase();

  const res=allScoped.filter(item=>{
    const dOcc=String(item.data_ocorrencia||item.data_registro||'').trim();
    if(qFrom&&(!dOcc||dOcc<qFrom))return false;
    if(qTo&&(!dOcc||dOcc>qTo))return false;

    if(qPri){
      const curPri=String(item.prioridade||'').trim().toLowerCase();
      if(curPri!==qPri)return false;
    }
    if(qNat){
      const curNat=String(item.natureza_ocorrencia||'').trim().toLowerCase();
      if(curNat!==qNat)return false;
    }
    if(qSt){
      const curSt=normalizeApuracaoStatus(item.status);
      if(curSt!==qSt)return false;
    }
    if(query){
      const ap=extractApuracaoData(item);
      const fullText=`${item.numero_protocolo||''} ${item.unidade||''} ${item.supervisao||''} ${item.natureza_ocorrencia||''} ${item.nome_envolvido||''} ${item.empresa_envolvido||''} ${item.relato_detalhado||''} ${ap.notas} ${ap.conclusao} ${ap.planoAcao}`.toLowerCase();
      if(fullText.indexOf(query)===-1)return false;
    }
    return true;
  });

  _apuracaoFilterMemo={rowsRef:allScoped,fKey,result:res};
  return res;
}

function apuracaoTotalPages(){
  return Math.max(1,Math.ceil(filteredApuracaoOccurrences().length/S.pageSize));
}
function pagedApuracaoOccurrences(){
  const rows=filteredApuracaoOccurrences(),total=apuracaoTotalPages();
  S.apuracaoCurrentPage=Math.min(Math.max(1,S.apuracaoCurrentPage||1),total);
  const start=(S.apuracaoCurrentPage-1)*S.pageSize;
  return rows.slice(start,start+S.pageSize);
}

function priorityBadgeHtml(priority){
  const p=String(priority||'Média').trim();
  const pLow=p.toLowerCase();
  if(pLow==='crítica'||pLow==='critica')return `<span class="priority-badge priority-critica">CRÍTICA</span>`;
  if(pLow==='alta')return `<span class="priority-badge priority-alta">ALTA</span>`;
  if(pLow==='baixa')return `<span class="priority-badge priority-baixa">BAIXA</span>`;
  return `<span class="priority-badge priority-media">MÉDIA</span>`;
}

function apuracaoStatusBadgeHtml(status){
  const s=normalizeApuracaoStatus(status);
  if(s==='Em Apuração')return `<span class="apuracao-status-badge apuracao-status-active"><span class="apuracao-dot apuracao-dot-active"></span>Em Apuração</span>`;
  if(s==='Encerrada')return `<span class="apuracao-status-badge apuracao-status-done"><span class="apuracao-dot apuracao-dot-done"></span>Concluída</span>`;
  return `<span class="apuracao-status-badge apuracao-status-pending"><span class="apuracao-dot apuracao-dot-pending"></span>Não Iniciada</span>`;
}

function apuracaoOccurrencesPage(){
  if(denyOperatorAccess())return '';
  const allScoped=scope((S.occ||[]).filter(isValidatedOccurrence));
  const kpis=apuracaoKpis(allScoped);
  const rows=pagedApuracaoOccurrences();
  const allFiltered=filteredApuracaoOccurrences();
  const totalPages=apuracaoTotalPages();
  const f=S.apuracaoFilters||{};
  const allNatures=occurrenceNatures();

  return `<div class="apuracao-container">
    <div class="apuracao-header row between">
      <div>
        <h2 style="margin:0;font-size:22px;font-weight:900;letter-spacing:-0.02em;color:#0f172a">Apuração de Ocorrências</h2>
        <p class="muted" style="margin:4px 0 0;font-size:13px">Gestão investigativa, pareceres conclusivos e planos de ação da segurança patrimonial</p>
      </div>
      <span class="dashboard-period">Gestão Corporativa</span>
    </div>

    <!-- KPIs Executivos de Apuração -->
    <div class="apuracao-kpis-grid">
      <div class="apuracao-kpi-card kpi-total">
        <div class="apuracao-kpi-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>Total Ocorrências</div>
        <div class="apuracao-kpi-value">${kpis.total}</div>
        <div class="apuracao-kpi-sub">Ocorrências no escopo ativo</div>
      </div>
      <div class="apuracao-kpi-card kpi-pending">
        <div class="apuracao-kpi-title" style="color:#475569"><span class="apuracao-dot apuracao-dot-pending"></span>Não Iniciadas</div>
        <div class="apuracao-kpi-value" style="color:#475569">${kpis.countRegistrada}</div>
        <div class="apuracao-kpi-sub">Aguardando início de diligências</div>
      </div>
      <div class="apuracao-kpi-card kpi-active">
        <div class="apuracao-kpi-title" style="color:#b45309"><span class="apuracao-dot apuracao-dot-active"></span>Em Apuração</div>
        <div class="apuracao-kpi-value" style="color:#b45309">${kpis.countEmApuracao}</div>
        <div class="apuracao-kpi-sub">Investigações em andamento</div>
      </div>
      <div class="apuracao-kpi-card kpi-done">
        <div class="apuracao-kpi-title" style="color:#047857"><span class="apuracao-dot apuracao-dot-done"></span>Concluídas</div>
        <div class="apuracao-kpi-value" style="color:#047857">${kpis.countEncerrada}</div>
        <div class="apuracao-kpi-sub">Encerradas com plano de ação</div>
      </div>
      <div class="apuracao-kpi-card kpi-critica">
        <div class="apuracao-kpi-title" style="color:#dc2626"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Alta Gravidade</div>
        <div class="apuracao-kpi-value" style="color:#dc2626">${kpis.countCritica + kpis.countAlta}</div>
        <div class="apuracao-kpi-sub">${kpis.countCritica} críticas · ${kpis.countAlta} altas</div>
      </div>
    </div>

    <!-- Filtros de Busca -->
    <div class="card history-filter-card">
      <div class="history-filter-header">
        <div>
          <h3>Filtros de Apuração</h3>
          <p>Filtre por período, gravidade, tipo ou status da apuração</p>
        </div>
        <button type="button" id="clearApuracaoFilters" class="btn">Limpar filtros</button>
      </div>
      <div class="history-filter-grid">
        <label><span class="label">Data inicial</span><input id="apuracaoDateFrom" class="field" type="date" value="${esc(f.dateFrom||'')}"></label>
        <label><span class="label">Data final</span><input id="apuracaoDateTo" class="field" type="date" value="${esc(f.dateTo||'')}"></label>
        <label><span class="label">Gravidade</span><select id="apuracaoPriority" class="field"><option value="">Todas</option><option value="Crítica" ${f.priority==='Crítica'?'selected':''}>Crítica</option><option value="Alta" ${f.priority==='Alta'?'selected':''}>Alta</option><option value="Média" ${f.priority==='Média'?'selected':''}>Média</option><option value="Baixa" ${f.priority==='Baixa'?'selected':''}>Baixa</option></select></label>
        <label><span class="label">Status da Apuração</span><select id="apuracaoStatus" class="field"><option value="">Todos</option><option value="Registrada" ${f.status==='Registrada'?'selected':''}>Não Iniciada</option><option value="Em Apuração" ${f.status==='Em Apuração'?'selected':''}>Em Apuração</option><option value="Encerrada" ${f.status==='Encerrada'?'selected':''}>Concluída / Encerrada</option></select></label>
        <label><span class="label">Natureza / Tipo</span><select id="apuracaoNature" class="field"><option value="">Todas as naturezas</option>${allNatures.map(n=>`<option value="${esc(n)}" ${f.nature===n?'selected':''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="history-general"><span class="label">Pesquisa geral</span><input id="apuracaoGeneral" class="field" value="${esc(f.general||'')}" placeholder="Buscar por protocolo, unidade, envolvido, relato ou notas investigativas..."></label>
      </div>
    </div>

    <!-- Tabela Executiva de Ocorrências para Apuração -->
    <div class="card history-table-card">
      <div class="tablewrap">
        <table class="table history-table">
          <thead>
            <tr>
              <th class="col-protocol whitespace-nowrap">Protocolo</th>
              <th class="col-date whitespace-nowrap">Data / Hora</th>
              <th class="col-unit whitespace-nowrap">Unidade</th>
              <th class="col-nature whitespace-nowrap">Natureza</th>
              <th class="whitespace-nowrap">Gravidade</th>
              <th class="col-apuracao-status whitespace-nowrap">Status da Apuração</th>
              <th class="col-apuracao-actions whitespace-nowrap" style="text-align:right">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(x=>{
              return `<tr>
                <td class="col-protocol whitespace-nowrap"><b>${esc(x.numero_protocolo)}</b></td>
                <td class="col-date whitespace-nowrap">${esc(x.data_ocorrencia)} <small class="muted">${esc(x.hora_ocorrencia||'')}</small></td>
                <td class="col-unit whitespace-nowrap">${esc(x.unidade)}</td>
                <td class="col-nature whitespace-nowrap">${esc(x.natureza_ocorrencia)}</td>
                <td class="whitespace-nowrap">${priorityBadgeHtml(x.prioridade)}</td>
                <td class="col-apuracao-status whitespace-nowrap">${apuracaoStatusBadgeHtml(x.status)}</td>
                <td class="col-apuracao-actions actions whitespace-nowrap" style="text-align:right">
                  <button type="button" class="btn-open-apuracao openApuracaoModal" data-id="${esc(x.id_ocorrencia)}" title="Gerenciar Apuração">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <span>Apuração</span>
                  </button>
                  <button type="button" class="pdfApuracao btn" data-id="${esc(x.id_ocorrencia)}" title="Exportar Relatório de Apuração em PDF" style="display:inline-flex;align-items:center;justify-content:center;padding:5px 8px;border-color:#fca5a5;background:#fef2f2;border-radius:6px">${adobePdfIcon(16)}</button>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="7" style="text-align:center;padding:36px;color:#64748b;font-size:14px">Nenhuma ocorrência encontrada para os filtros selecionados.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="history-pagination">
        <span>Mostrando ${rows.length?((S.apuracaoCurrentPage-1)*S.pageSize+1):0}–${Math.min(S.apuracaoCurrentPage*S.pageSize,allFiltered.length)} de ${allFiltered.length} ocorrências · Página ${S.apuracaoCurrentPage} de ${totalPages}</span>
        <div class="row">
          <button id="apuracaoPrev" class="btn" ${S.apuracaoCurrentPage<=1?'disabled':''}>◀ Anterior</button>
          <button id="apuracaoNext" class="btn" ${S.apuracaoCurrentPage>=totalPages?'disabled':''}>Próxima ▶</button>
        </div>
      </div>
    </div>
  </div>`;
}

function formatFileSize(bytes){
  if(!bytes||bytes<=0)return '0 KB';
  if(bytes<1024*1024)return `${Math.round(bytes/1024)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

function renderApuracaoPdfList(){
  const existing = S.apuracaoExistingPdfs || [];
  const fresh = S.apuracaoNewPdfs || [];
  const total = existing.length + fresh.length;
  if(total === 0){
    return `<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:16px;text-align:center;color:#64748b;font-size:13px">
      Nenhum laudo pericial ou documento PDF anexado a esta apuração.
    </div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:8px">
    ${existing.map((item, idx)=>`
      <div class="apuracao-pdf-card">
        <div class="apuracao-pdf-info">
          <div class="apuracao-pdf-icon" style="background:#fee2e2;display:grid;place-items:center;border-radius:6px;width:32px;height:32px;flex-shrink:0">
            ${adobePdfIcon(20)}
          </div>
          <div style="min-width:0">
            <div class="apuracao-pdf-name" title="${esc(item.name)}">${esc(item.name)}</div>
            <div class="apuracao-pdf-meta">
              <span class="apuracao-pdf-badge-saved">Salvo na Pasta</span>
              <span>${esc(item.path)}</span>
            </div>
          </div>
        </div>
        <div class="apuracao-pdf-actions">
          <button type="button" class="btn downloadApuracaoPdf" data-path="${esc(item.path)}" title="Baixar / Visualizar PDF" style="padding:5px 10px;font-size:12px;display:inline-flex;align-items:center;gap:6px">
            ${adobePdfIcon(14)}
            <span>Baixar</span>
          </button>
          <button type="button" class="btn removeExistingApuracaoPdf" data-idx="${idx}" title="Remover anexo" style="padding:5px 8px;font-size:12px;color:#dc2626">✕</button>
        </div>
      </div>
    `).join('')}
    ${fresh.map((item, idx)=>`
      <div class="apuracao-pdf-card">
        <div class="apuracao-pdf-info">
          <div class="apuracao-pdf-icon" style="background:#fee2e2;display:grid;place-items:center;border-radius:6px;width:32px;height:32px;flex-shrink:0">
            ${adobePdfIcon(20)}
          </div>
          <div style="min-width:0">
            <div class="apuracao-pdf-name" title="${esc(item.name)}">${esc(item.name)}</div>
            <div class="apuracao-pdf-meta">
              <span class="apuracao-pdf-badge-new">Novo</span>
              <span>${formatFileSize(item.size)}</span>
            </div>
          </div>
        </div>
        <div class="apuracao-pdf-actions">
          <button type="button" class="btn removeNewApuracaoPdf" data-idx="${idx}" title="Remover da lista" style="padding:5px 8px;font-size:12px;color:#dc2626">✕</button>
        </div>
      </div>
    `).join('')}
  </div>`;
}

async function downloadApuracaoPdf(path){
  try{
    if(!S.dir)throw new Error('Acesso à pasta local não disponível.');
    const parts=String(path).trim().split('/');
    if(parts.length!==2)throw new Error('Caminho do arquivo inválido.');
    const [protocolFolder, fileName]=parts;
    const root=await S.dir.getDirectoryHandle('anexos');
    const folder=await root.getDirectoryHandle(protocolFolder);
    const fh=await folder.getFileHandle(fileName);
    const file=await fh.getFile();
    const url=URL.createObjectURL(file);
    const a=document.createElement('a');
    a.href=url;
    a.download=fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },2000);
  }catch(err){
    console.error('Falha ao baixar laudo PDF:',err);
    showToast(err.message||'Não foi possível baixar o arquivo PDF.','error','Download de Anexo');
  }
}

async function saveApuracaoPdfs(protocol, newPdfs, trackedPaths=[]){
  if(!newPdfs||!newPdfs.length)return [];
  if(!S.dir)throw new Error('Diretório de dados não conectado.');
  const existingNames=new Set((S.apuracaoExistingPdfs||[]).map(x=>x.path.split('/').pop()));
  const planned=[];
  let n=1;
  for(let i=0;i<newPdfs.length;i++){
    const pdfItem=newPdfs[i];
    const origName=(pdfItem.name||'laudo.pdf').replace(/[^a-zA-Z0-9._-]/g,'_');
    const cleanName=origName.toLowerCase().endsWith('.pdf')?origName:`${origName}.pdf`;
    let finalName=`laudo_${cleanName}`;
    while(existingNames.has(finalName)){
      finalName=`laudo_${n}_${cleanName}`;
      n++;
    }
    existingNames.add(finalName);
    const path=`${protocol}/${finalName}`;
    planned.push({pdfItem,finalName,path});
    trackedPaths.push(path);
  }
  if(!planned.length)return [];
  const root=await S.dir.getDirectoryHandle('anexos',{create:true});
  const folder=await root.getDirectoryHandle(protocol,{create:true});
  await Promise.all(planned.map(async ({pdfItem,finalName,path})=>{
    for(let attempt=0;attempt<2;attempt++){
      try{
        const fh=await folder.getFileHandle(finalName,{create:true});
        const writable=await fh.createWritable();
        try{
          await writable.write(pdfItem.file);
          await writable.close();
        }catch(writeErr){
          try{await writable.abort()}catch(e){}
          throw writeErr;
        }
        break;
      }catch(err){
        if(!isOccurrenceStateConflict(err)||attempt===1)throw err;
      }
    }
  }));
  return planned.map(x=>x.path);
}

async function loadApuracaoPhotos(occ){
  if(S.apuracaoPhotos&&S.apuracaoPhotos.length){
    S.apuracaoPhotos.forEach(p=>p.url&&URL.revokeObjectURL(p.url));
  }
  S.apuracaoPhotos=[];
  const refs=String(occ?.anexos_referencias||'').split('|').map(p=>p.trim()).filter(p=>p&&!/\.pdf$/i.test(p));
  if(!refs.length)return [];
  S.apuracaoPhotos=await Promise.all(refs.map(image));
  return S.apuracaoPhotos;
}

function renderApuracaoPhotos(){
  const photos=S.apuracaoPhotos||[];
  if(!photos.length){
    return `<div style="background:#ffffff;border:1px dashed #cbd5e1;border-radius:8px;padding:12px;text-align:center;color:#64748b;font-size:12px">
      Nenhuma fotografia anexada no registro desta ocorrência.
    </div>`;
  }
  return `<div class="apuracao-photos-grid">
    ${photos.map((p,idx)=>`
      <div class="apuracao-photo-item">
        ${p.missing ? `
          <div style="height:90px;display:grid;place-items:center;background:#f1f5f9;color:#94a3b8;font-size:11px;text-align:center;padding:4px">
            Foto não encontrada
          </div>
        ` : `
          <img class="zoom apuracao-thumb" data-url="${p.url}" src="${p.url}" alt="Foto da ocorrência ${idx+1}" title="Clique para ampliar">
        `}
        <span class="apuracao-photo-name" title="${esc(p.path)}">${esc(p.path.split('/').pop())}</span>
      </div>
    `).join('')}
  </div>`;
}

function syncApuracaoFormState(){
  const form=document.getElementById('apuracaoForm');
  if(!form||!S.apuracaoModal)return;
  const statusEl=form.elements['status_apuracao'];
  const prioEl=form.elements['prioridade'];
  const notasEl=form.elements['notas_investigativas'];
  const conclEl=form.elements['conclusao'];
  const planoEl=form.elements['plano_acao'];
  if(statusEl)S.apuracaoModal.status_apuracao=statusEl.value;
  if(prioEl)S.apuracaoModal.prioridade=prioEl.value;
  if(notasEl)S.apuracaoModal.apuracao_notas=notasEl.value;
  if(conclEl)S.apuracaoModal.apuracao_conclusao=conclEl.value;
  if(planoEl)S.apuracaoModal.apuracao_plano_acao=planoEl.value;
}

function apuracaoModal(){
  if(!S.apuracaoModal)return '';
  const x=S.apuracaoModal;
  const ap=extractApuracaoData(x);
  const currentStatus=ap.status;
  const currentPri=ap.prioridade;
  const apuradorNome=S.user.nome?`${S.user.nome} (${S.user.login})`:S.user.login;
  const totalPdfs=(S.apuracaoExistingPdfs?.length||0)+(S.apuracaoNewPdfs?.length||0);

  return `<div class="modalbg popup-backdrop" style="z-index:1000;overflow-y:auto;padding:20px 12px">
    <div class="apuracao-modal-card" role="dialog" aria-modal="true" aria-labelledby="apuracaoModalTitle">
      <!-- Cabeçalho -->
      <div class="apuracao-modal-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:10px;background:#1e3a8a;color:#ffffff;display:grid;place-items:center;font-size:18px">
            🔍
          </div>
          <div>
            <div style="display:flex;align-items:center;gap:10px">
              <h2 id="apuracaoModalTitle" style="margin:0;font-size:18px;font-weight:900;color:#0f172a">Apuração de Segurança Física · Protocolo ${esc(x.numero_protocolo||'Novo')}</h2>
              ${priorityBadgeHtml(x.prioridade)}
            </div>
            <p style="margin:3px 0 0;font-size:12.5px;color:#64748b">
              Unidade <b>${esc(x.unidade)}</b> · Registrado em ${esc(x.data_ocorrencia)} às ${esc(x.hora_ocorrencia)}
            </p>
          </div>
        </div>
        <button type="button" class="close closeApuracaoModal" aria-label="Fechar" style="font-size:24px;cursor:pointer;background:transparent;border:0;color:#64748b">×</button>
      </div>

      <!-- Corpo -->
      <div class="apuracao-modal-body">
        <!-- Sumário Executivo do Fato -->
        <div class="apuracao-summary-box">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:8px">
            <span style="font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#475569">Resumo Operacional da Ocorrência</span>
            <span style="font-size:12px;font-weight:700;color:#1e3a8a">Natureza: ${esc(x.natureza_ocorrencia)}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 14px;font-size:12.5px">
            <div style="min-width:0;word-break:break-word;overflow-wrap:anywhere"><span class="muted">Local:</span> <b>${esc(x.area||'Geral')} / ${esc(x.local_especifico||'Geral')}</b></div>
            <div style="min-width:0;word-break:break-word;overflow-wrap:anywhere"><span class="muted">Envolvido:</span> <b style="word-break:break-word;overflow-wrap:anywhere">${esc(x.nome_envolvido||'Não identificado')}</b></div>
            <div style="min-width:0;word-break:break-word;overflow-wrap:anywhere"><span class="muted">Vínculo / Empresa:</span> <b style="word-break:break-word;overflow-wrap:anywhere">${esc(x.tipo_vinculo||'Terceiro')}${x.empresa_envolvido?` (${esc(x.empresa_envolvido)})`:''}</b></div>
            <div style="min-width:0;word-break:break-word;overflow-wrap:anywhere"><span class="muted">Matrícula / Doc:</span> <b>${esc(x.matricula_id||x.documento||'Não informado')}</b></div>
            ${(x.placa_veiculo||x.veiculo_placa)?`<div style="min-width:0;word-break:break-word;overflow-wrap:anywhere"><span class="muted">Veículo / Placa:</span> <b>${esc(x.placa_veiculo||x.veiculo_placa)}</b></div>`:''}
          </div>
          <div style="margin-top:6px;padding-top:8px;border-top:1px dashed #cbd5e1">
            <span class="muted" style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:4px">Relato do Fato Registrado:</span>
            <p style="margin:0;font-size:13px;color:#1e293b;line-height:1.45;background:#ffffff;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;white-space:pre-wrap;max-height:120px;overflow-y:auto">${esc(x.relato_detalhado||'Nenhum relato detalhado registrado.')}</p>
          </div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#475569;display:flex;align-items:center;gap:6px">
                📷 Fotografias Anexadas no Registro (${(S.apuracaoPhotos||[]).length})
              </span>
              ${(S.apuracaoPhotos||[]).length ? `<span class="muted" style="font-size:11px">Clique na imagem para ampliar</span>` : ''}
            </div>
            ${renderApuracaoPhotos()}
          </div>
        </div>

        <!-- Formulário da Apuração -->
        <form id="apuracaoForm" class="stack" novalidate>
          <input type="hidden" name="id_ocorrencia" value="${esc(x.id_ocorrencia||'')}">

          <div class="apuracao-form-section">
            <div class="apuracao-section-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <span>1. Classificação e Status da Apuração</span>
            </div>
            <div class="formgrid">
              <label class="c6">
                <span class="label">Status da Apuração</span>
                <select class="field" name="status_apuracao" required style="font-weight:700">
                  <option value="Registrada" ${currentStatus==='Registrada'?'selected':''}>Não Iniciada (Registrada)</option>
                  <option value="Em Apuração" ${currentStatus==='Em Apuração'?'selected':''}>Em Apuração (Investigação Ativa)</option>
                  <option value="Encerrada" ${currentStatus==='Encerrada'?'selected':''}>Encerrada / Concluída</option>
                </select>
              </label>
              <label class="c6">
                <span class="label">Reclassificação de Gravidade</span>
                <select class="field" name="prioridade" style="font-weight:700">
                  <option value="Baixa" ${currentPri==='Baixa'?'selected':''}>Baixa</option>
                  <option value="Média" ${currentPri==='Média'?'selected':''}>Média</option>
                  <option value="Alta" ${currentPri==='Alta'?'selected':''}>Alta</option>
                  <option value="Crítica" ${currentPri==='Crítica'?'selected':''}>Crítica</option>
                </select>
              </label>
            </div>
          </div>

          <div class="apuracao-form-section">
            <div class="apuracao-section-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>2. Diligências e Notas Investigativas</span>
            </div>
            <label>
              <span class="label">Notas Investigativas (Averiguações de Campo, Depoimentos e Análise de CFTV)</span>
              <textarea class="field" name="notas_investigativas" rows="4" placeholder="Descreva as diligências realizadas: oitivas de testemunhas, verificação de gravações de câmeras de segurança, auditoria de catracas ou constatações no local...">${esc(ap.notas)}</textarea>
            </label>
          </div>

          <div class="apuracao-form-section">
            <div class="apuracao-section-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span>3. Conclusão e Parecer da Apuração</span>
            </div>
            <label>
              <span class="label">Conclusão do Gestor de Segurança</span>
              <textarea class="field" name="conclusao" rows="3" placeholder="Parecer conclusivo sobre o incidente: determinação de autoria, nexo de causalidade, falha operacional, negligência ou dolo constatado...">${esc(ap.conclusao)}</textarea>
            </label>
            <label>
              <span class="label">Plano de Ação e Medidas Preventivas / Corretivas</span>
              <textarea class="field" name="plano_acao" rows="3" placeholder="Medidas adotadas: advertência, plano de melhoria na portaria, reparo em cerca perimetral, comunicação ao RH/Jurídico, reforço de ronda...">${esc(ap.planoAcao)}</textarea>
            </label>
          </div>

          <!-- Seção 4: Anexos e Laudos Periciais em PDF -->
          <div class="apuracao-form-section">
            <div class="apuracao-section-title" style="justify-content:space-between">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>4. Laudos Periciais e Documentos (Máx. 3 PDFs)</span>
              </div>
              <span style="font-size:11.5px;color:#64748b;font-weight:700">
                ${totalPdfs} / 3 anexos
              </span>
            </div>
            ${renderApuracaoPdfList()}
            ${totalPdfs < 3 ? `
              <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
                <input type="file" id="apuracaoPdfInput" accept="application/pdf,.pdf" multiple style="display:none">
                <button type="button" id="btnChooseApuracaoPdf" class="btn" style="background:#f1f5f9;border:1px solid #cbd5e1;font-weight:700;display:inline-flex;align-items:center;gap:6px;font-size:12.5px">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Adicionar Documento / Laudo PDF
                </button>
                <span class="muted" style="font-size:11.5px">Documentos aceitos: arquivos no formato .pdf (máx. 3 por ocorrência).</span>
              </div>
            ` : `
              <div style="font-size:12px;color:#b45309;background:#fefce8;padding:8px 12px;border-radius:8px;border:1px solid #fef08a">
                Limite de 3 laudos periciais / PDFs atingido para esta ocorrência. Remova um arquivo caso necessite substituir.
              </div>
            `}
          </div>

          <!-- Auditoria / Responsável -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:12px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="color:#1e3a8a;font-weight:800">Apurador:</span>
              <span>${esc(apuradorNome)}</span>
            </div>
            <div style="color:#64748b">
              Rastreabilidade corporativa gravada no CSV de ocorrências e auditoria
            </div>
          </div>
        </form>
      </div>

      <!-- Rodapé -->
      <div class="apuracao-modal-footer">
        <button type="button" class="btn exportApuracaoPdfModal" data-id="${esc(x.id_ocorrencia)}" style="display:inline-flex;align-items:center;gap:6px;font-weight:700;color:#991b1b;border-color:#fca5a5;background:#fef2f2;margin-right:auto" title="Exportar Relatório Completo de Apuração em PDF">
          ${adobePdfIcon(16)}
          <span>Exportar Relatório PDF</span>
        </button>
        <button type="button" class="btn closeApuracaoModal">Cancelar</button>
        <button type="submit" form="apuracaoForm" class="btn primary" style="background:#1e3a8a;border-color:#1e3a8a;font-weight:700;display:inline-flex;align-items:center;gap:6px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Salvar Apuração
        </button>
      </div>
    </div>
  </div>`;
}

async function saveApuracao(id,form){
  if(!id)return;
  if(!hasProfile(S.user,'Administrador','Supervisor','Líder')&&!isAdministratorUser(S.user)){
    return fail('Seu perfil não possui autorização para apurar ocorrências.');
  }
  try{
    if(typeof syncApuracaoFormState==='function')syncApuracaoFormState();
    const normId=String(id).trim();

    // Identifica ocorrência e protocolo de forma imediata em memória
    const current=(S.occ||[]).find(x=>String(x.id_ocorrencia||'').trim()===normId||String(x.id_interno||'').trim()===normId||String(x.numero_protocolo||'').trim()===normId);
    if(!current)return fail('Ocorrência não encontrada na base de dados.');
    const protocolName=String(current.numero_protocolo||current.id_ocorrencia||id).trim();

    const formData=form?Object.fromEntries(new FormData(form)):{};
    const newStatus=formData.status_apuracao||S.apuracaoModal?.status_apuracao||formData.status||current.status||'Em Apuração';
    const newPrioridade=formData.prioridade||S.apuracaoModal?.prioridade||current.prioridade||'Média';
    const notas=String(formData.notas_investigativas!=null?formData.notas_investigativas:(S.apuracaoModal?.apuracao_notas||'')).trim();
    const conclusao=String(formData.conclusao!=null?formData.conclusao:(S.apuracaoModal?.apuracao_conclusao||'')).trim();
    const planoAcao=String(formData.plano_acao!=null?formData.plano_acao:(S.apuracaoModal?.apuracao_plano_acao||'')).trim();
    const timeNow=now();
    const apuradorNome=S.user.nome?`${S.user.nome} (${S.user.login})`:S.user.login;

    // Snapshot para rollback defensivo
    const prevOcc=[...(S.occ||[])];
    const prevNewPdfs=[...(S.apuracaoNewPdfs||[])];
    const prevExistingPdfs=[...(S.apuracaoExistingPdfs||[])];

    const existingRefs=String(current.anexos_referencias||'').split('|').map(p=>p.trim()).filter(Boolean);
    const nonPdfRefs=existingRefs.filter(p=>!/\.pdf$/i.test(p));
    const retainedPdfRefs=(S.apuracaoExistingPdfs||[]).map(p=>p.path);
    const newPdfsEstimated=prevNewPdfs.map(item=>`${protocolName}/laudo_${(item.name||'laudo.pdf').replace(/[^a-zA-Z0-9._-]/g,'_')}`);
    const allAnexos=[...nonPdfRefs, ...retainedPdfRefs, ...newPdfsEstimated];

    const formattedObs=formatApuracaoObservacao(current.observacao_validacao||current.observacoes,{
      notas,
      conclusao,
      planoAcao,
      responsavel:apuradorNome,
      data:timeNow
    });

    const updatedRow={
      ...current,
      status:newStatus,
      status_apuracao:newStatus,
      status_validacao:'Validada',
      prioridade:newPrioridade,
      anexos_referencias:allAnexos.join('|'),
      providencias_adotadas:planoAcao||current.providencias_adotadas||'',
      observacao_validacao:formattedObs,
      apuracao_notas:notas,
      apuracao_conclusao:conclusao,
      apuracao_plano_acao:planoAcao,
      apuracao_responsavel:apuradorNome,
      apuracao_data:timeNow,
      versao_registro:String((+current.versao_registro||0)+1),
      usuario_ultima_alteracao:S.user.login,
      data_atualizacao:timeNow
    };

    // 1. ATUALIZAÇÃO INSTANTÂNEA DA INTERFACE (0 ms)
    if(S.apuracaoPhotos&&S.apuracaoPhotos.length){
      S.apuracaoPhotos.forEach(p=>p.url&&URL.revokeObjectURL(p.url));
      S.apuracaoPhotos=[];
    }
    S.apuracaoNewPdfs=[];
    S.apuracaoExistingPdfs=[];
    S.apuracaoModal=null;
    hideLoading();

    S.occ=S.occ.map(x=>(String(x.id_ocorrencia)===normId||String(x.id_interno)===normId||String(x.numero_protocolo)===String(current.numero_protocolo))?updatedRow:x);
    _apuracaoFilterMemo={rowsRef:null,fKey:'',result:[]};
    _occFilterMemo={rowsRef:null,query:'',result:[]};
    _histFilterMemo={rowsRef:null,filterKey:'',result:[]};
    render();
    showToast(`Apuração do protocolo ${protocolName} salva com sucesso!`,'success','Apuração Atualizada');

    // 2. PERSISTÊNCIA ASSÍNCRONA EM BACKGROUND COM RESILIÊNCIA E WRITE LOCK
    (async()=>{
      try{
        await ensureDataWritePermission();
        let newlySavedPdfPaths=[];
        if(prevNewPdfs.length>0){
          newlySavedPdfPaths=await saveApuracaoPdfs(protocolName,prevNewPdfs);
        }
        await withWriteLock('occurrences',async()=>{
          const finalAllAnexos=[...nonPdfRefs, ...retainedPdfRefs, ...newlySavedPdfPaths].join('|');
          const finalRow={...updatedRow, anexos_referencias:finalAllAnexos};
          let savedResult=null;
          if(window.StorageService?.appendSingleRecord){
            savedResult=await window.StorageService.appendSingleRecord('ocorrencias.csv',finalRow,H.occ,{isNewRecord:false});
          }else{
            savedResult=await CSVService.append('ocorrencias.csv',finalRow,H.occ);
          }
          if(typeof CSVService!=='undefined'){
            CSVService.buildEntry('ocorrencias.csv',S.occ);
          }
          window.StorageService?.IndexedDBEngine?.saveRecordsBulkLocally('ocorrencias.csv',S.occ).catch(()=>{});
          const stat=await window.StorageService?.getFileStat('ocorrencias.csv').catch(()=>null);
          if(stat){
            _freshCsvMeta.set('ocorrencias.csv',{mtimeMs:stat.mtimeMs,size:stat.size,rawSig:''});
          }
        });
        await auditApuracaoAction('APURACAO_ATUALIZADA',updatedRow,`Status: ${updatedRow.status} | Gravidade: ${updatedRow.prioridade}`);
      }catch(bgErr){
        console.error('[Rollback] Falha ao persistir apuração no disco:',bgErr);
        S.occ=prevOcc;
        render();
        showToast(bgErr.message||'Falha ao gravar apuração no disco. Operação desfeita.','error','Erro na Apuração');
      }
    })();
  }catch(error){
    hideLoading();
    console.error('Falha ao processar apuração:',error);
    showToast(error.message||'Não foi possível salvar a apuração da ocorrência.','error','Erro na Apuração');
  }
}

// ==========================================================================
// MÓDULO DE CHAVES & CAUTELA (CLAVICULÁRIO CORPORATIVO)
// ==========================================================================

function normalizeKeyStatus(status){
  const s=String(status||'').trim().toLowerCase();
  if(s==='retirada'||s==='em uso'||s==='indisponível')return 'Retirada';
  return 'Livre';
}
function isKeyLivre(key){return normalizeKeyStatus(key?.status)==='Livre'}
function isKeyRetirada(key){return normalizeKeyStatus(key?.status)==='Retirada'}

function getActiveKeyMovement(keyId){
  if(!S.moves||!S.moves.length)return null;
  const list=S.moves.filter(m=>String(m.id_chave)===String(keyId)||String(m.codigo_chave)===String(keyId));
  if(!list.length)return null;
  const openMove=list.find(m=>String(m.tipo_movimento).toLowerCase()==='retirada'&&!m.data_hora_devolucao);
  if(openMove)return openMove;
  const sorted=[...list].sort((a,b)=>String(b.data_hora_retirada||'').localeCompare(String(a.data_hora_retirada||'')));
  return sorted[0]||null;
}

function getKeyMovements(keyId){
  if(!S.moves||!S.moves.length)return [];
  return S.moves
    .filter(m=>String(m.id_chave)===String(keyId)||String(m.codigo_chave)===String(keyId))
    .sort((a,b)=>String(b.data_hora_retirada||'').localeCompare(String(a.data_hora_retirada||'')));
}

function formatKeyDateTime(isoStr){
  if(!isoStr)return '—';
  try{
    const d=new Date(isoStr);
    if(isNaN(d.getTime()))return String(isoStr);
    return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }catch{return String(isoStr)}
}

function filteredKeys(){
  const scoped=scope(S.keys||[]);
  const query=(S.keySearchQuery||'').toLowerCase().trim();
  const statusFilter=S.keyStatusFilter||'todos';
  const unitFilter=S.keyUnitFilter||'';

  return scoped.filter(k=>{
    const livre=isKeyLivre(k);
    if(statusFilter==='livre'&&!livre)return false;
    if(statusFilter==='retirada'&&livre)return false;
    if(unitFilter&&k.unidade!==unitFilter)return false;
    if(query){
      const activeMove=isKeyRetirada(k)?getActiveKeyMovement(k.id_chave):null;
      const matchCode=String(k.codigo||'').toLowerCase().includes(query);
      const matchDesc=String(k.descricao||'').toLowerCase().includes(query);
      const matchSetor=String(k.setor||'').toLowerCase().includes(query);
      const matchUnidade=String(k.unidade||'').toLowerCase().includes(query);
      const matchRetirante=activeMove?String(activeMove.retirante||'').toLowerCase().includes(query):false;
      const matchMatricula=activeMove?String(activeMove.matricula_documento||'').toLowerCase().includes(query):false;
      if(!matchCode&&!matchDesc&&!matchSetor&&!matchUnidade&&!matchRetirante&&!matchMatricula)return false;
    }
    return true;
  });
}

// Validação Estrita (Schema Zod-like)
function validateKeyWithdrawForm(data){
  const errors={};
  if(!data.data||!String(data.data).trim()){
    errors.data='A data da retirada é obrigatória.';
  }else if(!/^\d{4}-\d{2}-\d{2}$/.test(String(data.data).trim())){
    errors.data='Formato de data inválido (AAAA-MM-DD).';
  }
  if(!data.hora||!String(data.hora).trim()){
    errors.hora='A hora da retirada é obrigatória.';
  }else if(!/^\d{2}:\d{2}$/.test(String(data.hora).trim())){
    errors.hora='Formato de hora inválido (HH:MM).';
  }
  const nome=String(data.nome||'').trim();
  if(!nome){
    errors.nome='O nome de quem está retirando a chave é obrigatório.';
  }else if(nome.length<3){
    errors.nome='O nome deve ter pelo menos 3 caracteres.';
  }
  const matricula=String(data.matricula||'').trim();
  if(!matricula){
    errors.matricula='A matrícula ou documento de identificação é obrigatório.';
  }else if(matricula.length<2){
    errors.matricula='A matrícula deve ter pelo menos 2 caracteres.';
  }
  return {valid:Object.keys(errors).length===0,errors};
}

function validateKeyReturnForm(data){
  const errors={};
  if(!data.data||!String(data.data).trim()){
    errors.data='A data de devolução é obrigatória.';
  }else if(!/^\d{4}-\d{2}-\d{2}$/.test(String(data.data).trim())){
    errors.data='Formato de data inválido (AAAA-MM-DD).';
  }
  if(!data.hora||!String(data.hora).trim()){
    errors.hora='A hora de devolução é obrigatória.';
  }else if(!/^\d{2}:\d{2}$/.test(String(data.hora).trim())){
    errors.hora='Formato de hora inválido (HH:MM).';
  }
  const nome=String(data.nome||'').trim();
  if(!nome){
    errors.nome='O nome de quem está devolvendo a chave é obrigatório.';
  }else if(nome.length<3){
    errors.nome='O nome deve ter pelo menos 3 caracteres.';
  }
  const matricula=String(data.matricula||'').trim();
  if(!matricula){
    errors.matricula='A matrícula ou documento é obrigatório.';
  }else if(matricula.length<2){
    errors.matricula='A matrícula deve ter pelo menos 2 caracteres.';
  }
  return {valid:Object.keys(errors).length===0,errors};
}

async function auditKeyAction(action,key,details){
  try{
    await withWriteLock('system-audit',async()=>{
      const item={
        id_auditoria:uid(),
        data_hora:now(),
        usuario:S.user?.login||'sistema',
        perfil:S.user?.perfil||'Operador',
        modulo:'CHAVES',
        acao:action,
        id_registro:key.id_chave||'',
        codigo_registro:key.codigo||'',
        detalhes:details
      };
      if(window.StorageService?.appendRecord){
        await window.StorageService.appendRecord('historico_sistema.csv',item,H.audit,{isNewRecord:true});
        S.audits=[item,...(S.audits||[])];
        CSVService.buildEntry('historico_sistema.csv',S.audits);
      }else{
        const disk=await read('historico_sistema.csv').catch(()=>[]);
        const next=[item,...disk];
        S.audits=await write('historico_sistema.csv',next,H.audit);
        CSVService.buildEntry('historico_sistema.csv',S.audits);
      }
    });
  }catch(err){console.warn('Falha ao registrar auditoria de chave:',err)}
}

async function executeKeyWithdrawal(keyId,formData){
  const key=S.keys.find(k=>k.id_chave===keyId);
  if(!key)throw new Error('Chave não encontrada no sistema.');
  assertUnitAccess(key.unidade);

  const time=now();
  const moveId=uid();
  const dateTimeStr=`${formData.data}T${formData.hora}:00`;

  const moveRow={
    id_movimento:moveId,
    id_chave:key.id_chave,
    codigo_chave:key.codigo,
    tipo_movimento:'Retirada',
    retirante:formData.nome.trim(),
    matricula_documento:formData.matricula.trim(),
    data_hora_retirada:dateTimeStr,
    data_hora_devolucao:'',
    observacoes:(formData.observacoes||'').trim(),
    usuario_registro:S.user.login,
    versao_registro:'1',
    data_atualizacao:time
  };

  const updatedKey={
    ...key,
    status:'Retirada',
    versao_registro:String((+key.versao_registro||0)+1),
    data_atualizacao:time,
    usuario_ultima_alteracao:S.user.login
  };

  // Optimistic UI: snapshot previous state for rollback guarantee
  const prevKeys=[...S.keys];
  const prevMoves=[...S.moves];

  // Update in-memory state and UI immediately (0ms latency)
  S.moves=[moveRow,...(S.moves||[])];
  S.keys=S.keys.map(k=>k.id_chave===updatedKey.id_chave?updatedKey:k);
  CSVService.buildEntry('movimentacao_chaves.csv',S.moves);
  CSVService.buildEntry('chaves.csv',S.keys);

  S.keyWithdrawTarget=null;
  S.keyModalErrors={};
  hideLoading();
  render();
  showToast(`Chave ${key.codigo} retirada com sucesso por ${formData.nome}.`,'success');

  // Background worker: persist to disk with write locks and audit trail
  (async()=>{
    try{
      await ensureDataWritePermission();
      await withWriteLock('moves',async()=>{
        const diskMoves=await read('movimentacao_chaves.csv',{force:true});
        if(window.StorageService?.appendRecord){
          await window.StorageService.appendRecord('movimentacao_chaves.csv',moveRow,H.moves,{isNewRecord:true});
        }else{
          const nextMoves=[moveRow,...(diskMoves||[])];
          await write('movimentacao_chaves.csv',nextMoves,H.moves);
        }
      });

      await withWriteLock('keys',async()=>{
        const diskKeys=await read('chaves.csv',{force:true});
        const nextKeys=diskKeys.map(k=>k.id_chave===updatedKey.id_chave?updatedKey:k);
        if(window.StorageService?.appendSingleRecord){
          await window.StorageService.appendSingleRecord('chaves.csv',updatedKey,H.keys,{isNewRecord:false});
        }else{
          await write('chaves.csv',nextKeys,H.keys);
        }
      });

      await auditKeyAction('CHAVE_RETIRADA',updatedKey,`Chave ${key.codigo} retirada por ${formData.nome} (${formData.matricula})`);
    }catch(err){
      console.error('Falha ao processar retirada de chave em segundo plano:',err);
      S.keys=prevKeys;
      S.moves=prevMoves;
      CSVService.buildEntry('movimentacao_chaves.csv',S.moves);
      CSVService.buildEntry('chaves.csv',S.keys);
      render();
      fail(err.message||'Não foi possível registrar a retirada da chave.');
    }
  })();
}

async function executeKeyReturn(keyId,formData){
  const key=S.keys.find(k=>k.id_chave===keyId);
  if(!key)throw new Error('Chave não encontrada no sistema.');
  assertUnitAccess(key.unidade);

  const time=now();
  const dateTimeStr=`${formData.data}T${formData.hora}:00`;
  const activeMove=getActiveKeyMovement(key.id_chave);

  let updatedMove;
  if(activeMove){
    const obsDevolucao=formData.observacoes?`Devolução: ${formData.observacoes.trim()}`:'';
    const finalObs=activeMove.observacoes?(obsDevolucao?`${activeMove.observacoes} | ${obsDevolucao}`:activeMove.observacoes):obsDevolucao;
    updatedMove={
      ...activeMove,
      tipo_movimento:'Devolução',
      data_hora_devolucao:dateTimeStr,
      observacoes:finalObs,
      versao_registro:String((+activeMove.versao_registro||0)+1),
      data_atualizacao:time
    };
  }else{
    updatedMove={
      id_movimento:uid(),
      id_chave:key.id_chave,
      codigo_chave:key.codigo,
      tipo_movimento:'Devolução',
      retirante:formData.nome.trim(),
      matricula_documento:formData.matricula.trim(),
      data_hora_retirada:dateTimeStr,
      data_hora_devolucao:dateTimeStr,
      observacoes:(formData.observacoes||'').trim(),
      usuario_registro:S.user.login,
      versao_registro:'1',
      data_atualizacao:time
    };
  }

  const updatedKey={
    ...key,
    status:'Livre',
    versao_registro:String((+key.versao_registro||0)+1),
    data_atualizacao:time,
    usuario_ultima_alteracao:S.user.login
  };

  // Optimistic UI: snapshot previous state for rollback guarantee
  const prevKeys=[...S.keys];
  const prevMoves=[...S.moves];

  // Update in-memory state and UI immediately (0ms latency)
  if(activeMove){
    S.moves=S.moves.map(m=>m.id_movimento===updatedMove.id_movimento?updatedMove:m);
  }else{
    S.moves=[updatedMove,...(S.moves||[])];
  }
  S.keys=S.keys.map(k=>k.id_chave===updatedKey.id_chave?updatedKey:k);
  CSVService.buildEntry('movimentacao_chaves.csv',S.moves);
  CSVService.buildEntry('chaves.csv',S.keys);

  S.keyReturnTarget=null;
  S.keyModalErrors={};
  hideLoading();
  render();
  showToast(`Chave ${key.codigo} devolvida ao claviculário com sucesso.`,'success');

  // Background worker: persist to disk with write locks and audit trail
  (async()=>{
    try{
      await ensureDataWritePermission();
      await withWriteLock('moves',async()=>{
        const diskMoves=await read('movimentacao_chaves.csv',{force:true});
        let nextMoves;
        if(activeMove){
          nextMoves=diskMoves.map(m=>m.id_movimento===updatedMove.id_movimento?updatedMove:m);
          if(window.StorageService?.appendSingleRecord){
            await window.StorageService.appendSingleRecord('movimentacao_chaves.csv',updatedMove,H.moves,{isNewRecord:false});
          }else{
            await write('movimentacao_chaves.csv',nextMoves,H.moves);
          }
        }else{
          nextMoves=[updatedMove,...(diskMoves||[])];
          if(window.StorageService?.appendRecord){
            await window.StorageService.appendRecord('movimentacao_chaves.csv',updatedMove,H.moves,{isNewRecord:true});
          }else{
            await write('movimentacao_chaves.csv',nextMoves,H.moves);
          }
        }
      });

      await withWriteLock('keys',async()=>{
        const diskKeys=await read('chaves.csv',{force:true});
        const nextKeys=diskKeys.map(k=>k.id_chave===updatedKey.id_chave?updatedKey:k);
        if(window.StorageService?.appendSingleRecord){
          await window.StorageService.appendSingleRecord('chaves.csv',updatedKey,H.keys,{isNewRecord:false});
        }else{
          await write('chaves.csv',nextKeys,H.keys);
        }
      });

      await auditKeyAction('CHAVE_DEVOLVIDA',updatedKey,`Chave ${key.codigo} devolvida por ${formData.nome} (${formData.matricula})`);
    }catch(err){
      console.error('Falha ao processar devolução de chave em segundo plano:',err);
      S.keys=prevKeys;
      S.moves=prevMoves;
      CSVService.buildEntry('movimentacao_chaves.csv',S.moves);
      CSVService.buildEntry('chaves.csv',S.keys);
      render();
      fail(err.message||'Não foi possível registrar a devolução da chave.');
    }
  })();
}

async function saveKey(ev){
  ev.preventDefault();
  if(!canManageKeys(S.user)){S.accessDenied=true;render();return;}
  const form=ev.currentTarget;
  const d=Object.fromEntries(new FormData(form));
  const codigo=String(d.codigo||'').trim().toUpperCase();
  const descricao=String(d.descricao||'').trim();
  const setor=String(d.setor||'').trim();
  const unidade=String(d.unidade||'').trim();
  const status=normalizeKeyStatus(d.status||'Livre');
  const observacoes=String(d.observacoes||'').trim();

  if(!codigo){fail('O código da chave é obrigatório.');return;}
  if(!descricao){fail('A descrição da chave é obrigatória.');return;}
  if(!setor){fail('O setor/departamento é obrigatório.');return;}
  if(!unidade){fail('A unidade é obrigatória.');return;}
  assertUnitAccess(unidade);

  const isEdit=Boolean(d.id_chave);
  const time=now();
  let keyRow;
  if(isEdit){
    const existing=S.keys.find(k=>k.id_chave===d.id_chave);
    if(!existing){fail('Chave não encontrada para edição.');return;}
    keyRow={
      ...existing,
      codigo,
      descricao,
      setor,
      unidade,
      status,
      observacoes,
      versao_registro:String((+existing.versao_registro||0)+1),
      data_atualizacao:time,
      usuario_ultima_alteracao:S.user.login
    };
  }else{
    const duplicate=S.keys.some(k=>String(k.codigo||'').trim().toUpperCase()===codigo&&k.unidade===unidade);
    if(duplicate){fail(`Já existe uma chave cadastrada com o código "${codigo}" na unidade ${unidade}.`);return;}
    keyRow={
      id_chave:uid(),
      codigo,
      descricao,
      setor,
      unidade,
      status,
      observacoes,
      versao_registro:'1',
      data_atualizacao:time,
      usuario_ultima_alteracao:S.user.login
    };
  }

  // Optimistic UI: snapshot previous state
  const prevKeys=[...S.keys];

  // Update in-memory state and UI immediately (0ms latency)
  if(isEdit){
    S.keys=S.keys.map(k=>k.id_chave===keyRow.id_chave?keyRow:k);
  }else{
    S.keys=[keyRow,...(S.keys||[])];
  }
  CSVService.buildEntry('chaves.csv',S.keys);

  S.editing=null;
  hideLoading();
  render();
  showToast(`Chave ${keyRow.codigo} salva com sucesso.`,'success');

  // Background worker: persist to disk with write lock and audit trail
  (async()=>{
    try{
      await ensureDataWritePermission();
      await withWriteLock('keys',async()=>{
        const diskKeys=await read('chaves.csv',{force:true});
        let nextKeys;
        if(isEdit){
          nextKeys=diskKeys.map(k=>k.id_chave===keyRow.id_chave?keyRow:k);
          if(window.StorageService?.appendSingleRecord){
            await window.StorageService.appendSingleRecord('chaves.csv',keyRow,H.keys,{isNewRecord:false});
          }else{
            await write('chaves.csv',nextKeys,H.keys);
          }
        }else{
          nextKeys=[keyRow,...(diskKeys||[])];
          if(window.StorageService?.appendRecord){
            await window.StorageService.appendRecord('chaves.csv',keyRow,H.keys,{isNewRecord:true});
          }else{
            await write('chaves.csv',nextKeys,H.keys);
          }
        }
      });

      await auditKeyAction(isEdit?'CHAVE_ALTERADA':'CHAVE_CADASTRADA',keyRow,`Chave ${keyRow.codigo} (${keyRow.descricao}) salva na unidade ${keyRow.unidade}`);
    }catch(err){
      console.error('Falha ao salvar chave em segundo plano:',err);
      S.keys=prevKeys;
      CSVService.buildEntry('chaves.csv',S.keys);
      render();
      fail(err.message||'Não foi possível salvar o cadastro da chave.');
    }
  })();
}

// Modais do Módulo de Chaves
function keyWithdrawModal(){
  const targetKey=S.keyWithdrawTarget;
  if(!targetKey)return '';
  const nowObj=new Date();
  const todayIso=nowObj.toISOString().slice(0,10);
  const currentTimeStr=String(nowObj.getHours()).padStart(2,'0')+':'+String(nowObj.getMinutes()).padStart(2,'0');
  const errors=S.keyModalErrors||{};
  const currentData=targetKey._draft||{};

  return `<div class="modalbg popup-backdrop" id="modalKeyWithdraw">
    <div class="key-modal" role="dialog" aria-modal="true" aria-labelledby="withdrawTitle">
      <div class="key-modal-header header-withdraw">
        <div>
          <h3 id="withdrawTitle">🔑 Retirar Chave (Cautela)</h3>
          <p>Informe os dados obrigatórios do solicitante da chave</p>
        </div>
        <button type="button" class="key-modal-close closeKeyWithdrawModal" aria-label="Fechar">×</button>
      </div>
      <form id="keyWithdrawForm" novalidate>
        <input type="hidden" name="id_chave" value="${esc(targetKey.id_chave)}">
        <div class="key-modal-body">
          <div class="key-summary-strip">
            <div class="key-summary-icon">🔑</div>
            <div>
              <div class="key-summary-code">${esc(targetKey.codigo)}</div>
              <div class="key-summary-desc">${esc(targetKey.descricao)} · <b>${esc(targetKey.unidade)}</b> (${esc(targetKey.setor)})</div>
            </div>
          </div>

          <div class="key-form-stack">
            <div class="key-datetime-grid">
              <div>
                <label class="key-input-label">Data da Retirada<span class="key-input-req">*</span></label>
                <input type="date" name="data" class="field ${errors.data?'field-error':''}" value="${esc(currentData.data||todayIso)}" required>
                ${errors.data?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.data)}</div>`:''}
              </div>
              <div>
                <label class="key-input-label">Hora da Retirada<span class="key-input-req">*</span></label>
                <input type="time" name="hora" class="field ${errors.hora?'field-error':''}" value="${esc(currentData.hora||currentTimeStr)}" required>
                ${errors.hora?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.hora)}</div>`:''}
              </div>
            </div>

            <div>
              <label class="key-input-label">Nome de quem está pegando a chave<span class="key-input-req">*</span></label>
              <input type="text" name="nome" class="field ${errors.nome?'field-error':''}" placeholder="Ex: Carlos Silva" value="${esc(currentData.nome||'')}" required autofocus>
              ${errors.nome?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.nome)}</div>`:''}
            </div>

            <div>
              <label class="key-input-label">Matrícula ou Documento<span class="key-input-req">*</span></label>
              <input type="text" name="matricula" class="field ${errors.matricula?'field-error':''}" placeholder="Ex: MT-5541 ou RG/CPF" value="${esc(currentData.matricula||'')}" required>
              ${errors.matricula?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.matricula)}</div>`:''}
            </div>

            <div>
              <label class="key-input-label">Finalidade / Observações</label>
              <textarea name="observacoes" class="field" placeholder="Ex: Manutenção preventiva no quadro elétrico..." rows="2">${esc(currentData.observacoes||'')}</textarea>
            </div>
          </div>
        </div>
        <div class="key-modal-footer">
          <button type="button" class="btn closeKeyWithdrawModal">Cancelar</button>
          <button type="submit" class="btn-action-withdraw" style="flex:none;padding:10px 22px">Confirmar Retirada</button>
        </div>
      </form>
    </div>
  </div>`;
}

function keyReturnModal(){
  const targetKey=S.keyReturnTarget;
  if(!targetKey)return '';
  const nowObj=new Date();
  const todayIso=nowObj.toISOString().slice(0,10);
  const currentTimeStr=String(nowObj.getHours()).padStart(2,'0')+':'+String(nowObj.getMinutes()).padStart(2,'0');
  const errors=S.keyModalErrors||{};
  const currentData=targetKey._draft||{};
  const lastMove=getActiveKeyMovement(targetKey.id_chave);

  return `<div class="modalbg popup-backdrop" id="modalKeyReturn">
    <div class="key-modal" role="dialog" aria-modal="true" aria-labelledby="returnTitle">
      <div class="key-modal-header header-return">
        <div>
          <h3 id="returnTitle">↩️ Devolver Chave ao Claviculário</h3>
          <p>Confirme a entrega física da chave e seu estado</p>
        </div>
        <button type="button" class="key-modal-close closeKeyReturnModal" aria-label="Fechar">×</button>
      </div>
      <form id="keyReturnForm" novalidate>
        <input type="hidden" name="id_chave" value="${esc(targetKey.id_chave)}">
        <div class="key-modal-body">
          <div class="key-summary-strip">
            <div class="key-summary-icon" style="background:#d1fae5;color:#065f46">↩️</div>
            <div>
              <div class="key-summary-code">${esc(targetKey.codigo)}</div>
              <div class="key-summary-desc">${esc(targetKey.descricao)} · <b>${esc(targetKey.unidade)}</b></div>
              ${lastMove?`<div style="margin-top:6px;font-size:12px;color:#9a3412;background:#ffedd5;padding:4px 8px;border-radius:6px;display:inline-block">Retirada por: <b>${esc(lastMove.retirante)}</b> (${esc(lastMove.matricula_documento)}) em ${formatKeyDateTime(lastMove.data_hora_retirada)}</div>`:''}
            </div>
          </div>

          <div class="key-form-stack">
            <div class="key-datetime-grid">
              <div>
                <label class="key-input-label">Data da Devolução<span class="key-input-req">*</span></label>
                <input type="date" name="data" class="field ${errors.data?'field-error':''}" value="${esc(currentData.data||todayIso)}" required>
                ${errors.data?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.data)}</div>`:''}
              </div>
              <div>
                <label class="key-input-label">Hora da Devolução<span class="key-input-req">*</span></label>
                <input type="time" name="hora" class="field ${errors.hora?'field-error':''}" value="${esc(currentData.hora||currentTimeStr)}" required>
                ${errors.hora?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.hora)}</div>`:''}
              </div>
            </div>

            <div>
              <label class="key-input-label">Nome de quem está devolvendo<span class="key-input-req">*</span></label>
              <input type="text" name="nome" class="field ${errors.nome?'field-error':''}" placeholder="Ex: Carlos Silva" value="${esc(currentData.nome||lastMove?.retirante||'')}" required autofocus>
              ${errors.nome?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.nome)}</div>`:''}
            </div>

            <div>
              <label class="key-input-label">Matrícula ou Documento<span class="key-input-req">*</span></label>
              <input type="text" name="matricula" class="field ${errors.matricula?'field-error':''}" placeholder="Ex: MT-5541 ou RG/CPF" value="${esc(currentData.matricula||lastMove?.matricula_documento||'')}" required>
              ${errors.matricula?`<div class="key-field-error"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${esc(errors.matricula)}</div>`:''}
            </div>

            <div>
              <label class="key-input-label">Observações sobre a Devolução / Estado da Chave</label>
              <textarea name="observacoes" class="field" placeholder="Ex: Chave entregue em perfeito estado no claviculário..." rows="2">${esc(currentData.observacoes||'')}</textarea>
            </div>
          </div>
        </div>
        <div class="key-modal-footer">
          <button type="button" class="btn closeKeyReturnModal">Cancelar</button>
          <button type="submit" class="btn-action-return" style="flex:none;padding:10px 22px">Confirmar Devolução</button>
        </div>
      </form>
    </div>
  </div>`;
}

function keyHistoryModal(){
  const targetKey=S.keyHistoryTarget;
  if(!targetKey)return '';
  const moves=getKeyMovements(targetKey.id_chave);

  return `<div class="modalbg popup-backdrop" id="modalKeyHistory">
    <div class="card modal" style="max-width:840px" role="dialog" aria-modal="true" aria-labelledby="historyKeyTitle">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:14px;margin-bottom:16px">
        <div>
          <h2 id="historyKeyTitle" style="margin:0;font-size:20px;font-weight:800">Histórico de Movimentações · ${esc(targetKey.codigo)}</h2>
          <p class="muted" style="margin:4px 0 0;font-size:13px">${esc(targetKey.descricao)} · Unidade: <b>${esc(targetKey.unidade)}</b> (${esc(targetKey.setor)})</p>
        </div>
        <button type="button" class="close closeKeyHistoryModal" aria-label="Fechar">×</button>
      </div>
      <div class="tablewrap" style="max-height:55vh;overflow-y:auto">
        <table class="table">
          <thead>
            <tr>
              <th>Status / Tipo</th>
              <th>Responsável</th>
              <th>Matrícula</th>
              <th>Retirada</th>
              <th>Devolução</th>
              <th>Observações</th>
              <th>Operador</th>
            </tr>
          </thead>
          <tbody>
            ${moves.length?moves.map(m=>{
              const isPendente=!m.data_hora_devolucao;
              return `<tr>
                <td>
                  <span class="key-status-badge ${isPendente?'key-badge-taken':'key-badge-free'}" style="font-size:11px;padding:3px 8px">
                    <span class="${isPendente?'key-dot-taken':'key-dot-free'}"></span>
                    ${esc(m.tipo_movimento||(isPendente?'Retirada':'Devolvida'))}
                  </span>
                </td>
                <td><b>${esc(m.retirante||'—')}</b></td>
                <td>${esc(m.matricula_documento||'—')}</td>
                <td class="whitespace-nowrap">${formatKeyDateTime(m.data_hora_retirada)}</td>
                <td class="whitespace-nowrap">${m.data_hora_devolucao?formatKeyDateTime(m.data_hora_devolucao):'<span style="color:#b45309;font-weight:800;font-size:11.5px">● Em Aberto</span>'}</td>
                <td style="max-width:180px;font-size:12px">${esc(m.observacoes||'—')}</td>
                <td><small class="muted">${esc(m.usuario_registro||'—')}</small></td>
              </tr>`;
            }).join(''):`<tr><td colspan="7" style="text-align:center;padding:32px;color:#64748b">Nenhuma movimentação registrada para esta chave até o momento.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:18px">
        <button type="button" class="btn closeKeyHistoryModal">Fechar</button>
      </div>
    </div>
  </div>`;
}

// Aba 2: Cautela de Chaves
function keysCautelaTab(){
  const allScoped=scope(S.keys||[]);
  const filtered=filteredKeys();
  const total=allScoped.length;
  const freeCount=allScoped.filter(isKeyLivre).length;
  const takenCount=allScoped.filter(isKeyRetirada).length;
  const unitSet=new Set(allScoped.map(k=>k.unidade).filter(Boolean));
  const statusFilter=S.keyStatusFilter||'todos';
  const viewMode=S.keyViewMode||'grid';
  const userUnitsList=authorizedUnitRecords(S.user).map(u=>u.nome);

  return `<div class="keys-cautela-section">
    <!-- KPIs Operacionais -->
    <div class="keys-kpi-grid">
      <div class="key-kpi-card kpi-total">
        <div class="key-kpi-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5-2 2 1.5 1.5-7 7a2.121 2.121 0 0 0 3 3l7-7 1.5 1.5 2-2-1.5-1.5L20 4l2-2z"/></svg>Acervo Total</div>
        <div class="key-kpi-value">${total}</div>
        <div class="key-kpi-sub">Chaves cadastradas no claviculário</div>
      </div>
      <div class="key-kpi-card kpi-free">
        <div class="key-kpi-title" style="color:#047857"><span class="key-dot-free"></span>Chaves Livres</div>
        <div class="key-kpi-value" style="color:#047857">${freeCount}</div>
        <div class="key-kpi-sub">Disponíveis para retirada imediata</div>
      </div>
      <div class="key-kpi-card kpi-taken">
        <div class="key-kpi-title" style="color:#be123c"><span class="key-dot-taken"></span>Chaves Retiradas</div>
        <div class="key-kpi-value" style="color:#be123c">${takenCount}</div>
        <div class="key-kpi-sub">Em uso operacional em campo</div>
      </div>
      <div class="key-kpi-card kpi-unit">
        <div class="key-kpi-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Unidades</div>
        <div class="key-kpi-value">${unitSet.size}</div>
        <div class="key-kpi-sub">Pontos de controle ativos</div>
      </div>
    </div>

    <!-- Barra de Ferramentas / Filtros -->
    <div class="keys-toolbar">
      <div class="keys-toolbar-row">
        <div class="keys-search-wrap">
          <span class="keys-search-icon">🔍</span>
          <input type="text" id="keySearch" class="field keys-search-input" placeholder="Buscar por código, descrição, setor ou responsável..." value="${esc(S.keySearchQuery||'')}">
        </div>

        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <select id="keyUnitFilter" class="field" style="width:auto;min-width:160px">
            <option value="">Todas as Unidades</option>
            ${userUnitsList.map(u=>`<option value="${esc(u)}" ${S.keyUnitFilter===u?'selected':''}>${esc(u)}</option>`).join('')}
          </select>

          <div class="keys-status-filters" role="group" aria-label="Filtro de status">
            <button type="button" class="keys-status-btn ${statusFilter==='todos'?'active':''}" data-status="todos">Todas (${total})</button>
            <button type="button" class="keys-status-btn ${statusFilter==='livre'?'active':''}" data-status="livre">Livres (${freeCount})</button>
            <button type="button" class="keys-status-btn ${statusFilter==='retirada'?'active':''}" data-status="retirada">Retiradas (${takenCount})</button>
          </div>

          <div class="keys-view-toggle" role="group" aria-label="Alternar exibição">
            <button type="button" class="keys-view-btn ${viewMode==='grid'?'active':''}" data-view="grid" title="Visualização em Cards">🗂️ Cards</button>
            <button type="button" class="keys-view-btn ${viewMode==='table'?'active':''}" data-view="table" title="Visualização em Tabela">📑 Tabela</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Conteúdo: Grid ou Tabela -->
    ${viewMode==='grid'?`
      <div class="keys-cards-grid">
        ${filtered.length?filtered.map(k=>{
          const livre=isKeyLivre(k);
          const activeMove=livre?null:getActiveKeyMovement(k.id_chave);

          return `<div class="key-card ${livre?'status-livre':'status-retirada'}">
            <div>
              <div class="key-card-header">
                <div class="key-card-code">
                  <span style="font-size:16px">🔑</span>
                  <span>${esc(k.codigo)}</span>
                </div>
                ${livre?`
                  <span class="key-badge-free"><span class="key-dot-free"></span>Livre</span>
                `:`
                  <span class="key-badge-taken"><span class="key-dot-taken"></span>Retirada</span>
                `}
              </div>

              <div class="key-card-body">
                <h4 class="key-card-desc">${esc(k.descricao)}</h4>
                <div class="key-card-meta">
                  <span class="key-meta-item">📍 ${esc(k.unidade)}</span>
                  <span class="key-meta-item">🏷️ ${esc(k.setor)}</span>
                </div>

                ${!livre&&activeMove?`
                  <div class="key-holder-banner">
                    <div class="key-holder-title">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Posse Operacional Ativa
                    </div>
                    <div class="key-holder-name">${esc(activeMove.retirante)} · Matrícula: ${esc(activeMove.matricula_documento)}</div>
                    <div class="key-holder-time">Retirada em: ${formatKeyDateTime(activeMove.data_hora_retirada)}</div>
                    ${activeMove.observacoes?`<div style="margin-top:3px;font-size:11.5px;color:#7c2d12;font-style:italic">"${esc(activeMove.observacoes)}"</div>`:''}
                  </div>
                `:`
                  <div class="key-free-notice">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <span>Disponível no claviculário para cautela.</span>
                  </div>
                `}
              </div>
            </div>

            <div class="key-card-footer">
              ${livre?`
                <button type="button" class="btn-action-withdraw promptWithdrawKey" data-id="${esc(k.id_chave)}" title="Registrar Retirada da Chave">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 2l-2 2m-1.5 1.5L14 9l-1.5-1.5-2 2 1.5 1.5-7 7a2.121 2.121 0 0 0 3 3l7-7 1.5 1.5 2-2-1.5-1.5L20 4l2-2z"/></svg>
                  <span>Retirar Chave</span>
                </button>
              `:`
                <button type="button" class="btn-action-return promptReturnKey" data-id="${esc(k.id_chave)}" title="Registrar Devolução da Chave">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                  <span>Devolver Chave</span>
                </button>
              `}
              <button type="button" class="btn-action-history viewKeyHistory" data-id="${esc(k.id_chave)}" title="Ver Histórico de Movimentações">
                <span>Histórico</span>
              </button>
            </div>
          </div>`;
        }).join(''):`
          <div class="card" style="grid-column:1/-1;text-align:center;padding:48px 20px">
            <div style="font-size:36px;margin-bottom:10px">🔍</div>
            <h3 style="margin:0 0 6px">Nenhuma chave encontrada</h3>
            <p class="muted" style="margin:0">Tente ajustar seus termos de pesquisa ou filtros de status e unidade.</p>
          </div>
        `}
      </div>
    `:`
      <div class="card tablewrap" style="padding:0">
        <table class="table history-table">
          <thead>
            <tr>
              <th class="whitespace-nowrap">Código</th>
              <th>Descrição</th>
              <th>Setor</th>
              <th>Unidade</th>
              <th>Status</th>
              <th>Responsável Atual</th>
              <th class="whitespace-nowrap" style="text-align:right">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length?filtered.map(k=>{
              const livre=isKeyLivre(k);
              const activeMove=livre?null:getActiveKeyMovement(k.id_chave);

              return `<tr>
                <td class="whitespace-nowrap"><b>${esc(k.codigo)}</b></td>
                <td>${esc(k.descricao)}</td>
                <td>${esc(k.setor)}</td>
                <td>${esc(k.unidade)}</td>
                <td>
                  ${livre?`
                    <span class="key-badge-free"><span class="key-dot-free"></span>Livre</span>
                  `:`
                    <span class="key-badge-taken"><span class="key-dot-taken"></span>Retirada</span>
                  `}
                </td>
                <td>
                  ${!livre&&activeMove?`
                    <div style="font-size:12.5px;line-height:1.3">
                      <b>${esc(activeMove.retirante)}</b> (${esc(activeMove.matricula_documento)})
                      <div class="muted" style="font-size:11px">${formatKeyDateTime(activeMove.data_hora_retirada)}</div>
                    </div>
                  `:`<span class="muted">—</span>`}
                </td>
                <td style="text-align:right">
                  <div style="display:inline-flex;gap:6px;align-items:center">
                    ${livre?`
                      <button type="button" class="btn-action-withdraw promptWithdrawKey" data-id="${esc(k.id_chave)}" style="min-height:36px;padding:6px 12px;font-size:12px">
                        <span>Retirar Chave</span>
                      </button>
                    `:`
                      <button type="button" class="btn-action-return promptReturnKey" data-id="${esc(k.id_chave)}" style="min-height:36px;padding:6px 12px;font-size:12px">
                        <span>Devolver Chave</span>
                      </button>
                    `}
                    <button type="button" class="btn-action-history viewKeyHistory" data-id="${esc(k.id_chave)}" style="min-height:36px;padding:6px 10px;font-size:12px">
                      <span>Histórico</span>
                    </button>
                  </div>
                </td>
              </tr>`;
            }).join(''):`
              <tr><td colspan="7" style="text-align:center;padding:36px;color:#64748b">Nenhuma chave encontrada com os filtros selecionados.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    `}
  </div>`;
}

// Aba 1: Cadastro de Chaves (Acesso Restrito: Líder, Supervisor e Admin)
function keyForm(){
  const x=S.editing?.kind==='key'?S.editing.data:{};
  const isEdit=Boolean(x.id_chave);
  const userUnitsList=authorizedUnitRecords(S.user).map(u=>u.nome);
  const defaultUnit=(userUnitsList.length?userUnitsList[0]:'')||units()[0];

  return `<div class="card" style="position:sticky;top:20px">
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px">
      <h3 style="margin:0;font-size:17px;font-weight:800">${isEdit?'Editar Chave':'Cadastrar Nova Chave'}</h3>
      ${isEdit?`<button type="button" id="cancelKeyEdit" class="btn" style="font-size:12px;padding:5px 9px">Cancelar</button>`:''}
    </div>
    <form id="keyForm" class="stack" novalidate>
      <input type="hidden" name="id_chave" value="${esc(x.id_chave||'')}">
      
      <div>
        <label class="key-input-label">Código da Chave<span class="key-input-req">*</span></label>
        <input class="field" name="codigo" required value="${esc(x.codigo||'')}" placeholder="Ex: CH-MC-05" style="text-transform:uppercase" autofocus>
      </div>

      <div>
        <label class="key-input-label">Descrição / Local<span class="key-input-req">*</span></label>
        <input class="field" name="descricao" required value="${esc(x.descricao||'')}" placeholder="Ex: Porta Principal Almoxarifado">
      </div>

      <div>
        <label class="key-input-label">Setor / Departamento<span class="key-input-req">*</span></label>
        <input class="field" name="setor" required value="${esc(x.setor||'')}" placeholder="Ex: Almoxarifado, TI, Manutenção...">
      </div>

      <div>
        <label class="key-input-label">Unidade<span class="key-input-req">*</span></label>
        <select class="field" name="unidade">${opts(userUnitsList.length?userUnitsList:units(),x.unidade||defaultUnit)}</select>
      </div>

      <div>
        <label class="key-input-label">Status Inicial<span class="key-input-req">*</span></label>
        <select class="field" name="status">
          <option value="Livre" ${normalizeKeyStatus(x.status)==='Livre'?'selected':''}>Livre (Disponível no claviculário)</option>
          <option value="Retirada" ${normalizeKeyStatus(x.status)==='Retirada'?'selected':''}>Retirada (Em uso operacional)</option>
        </select>
      </div>

      <div>
        <label class="key-input-label">Observações</label>
        <textarea class="field" name="observacoes" placeholder="Ex: Cópia reserva no armário da supervisão..." rows="2">${esc(x.observacoes||'')}</textarea>
      </div>

      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="submit" class="btn primary" style="flex:1;padding:11px;font-weight:700">${isEdit?'Salvar Alterações':'Cadastrar Chave'}</button>
      </div>
    </form>
  </div>`;
}

function keysCadastroTab(){
  if(!canManageKeys(S.user)){
    return `<div class="card" style="text-align:center;padding:48px 24px">
      <div style="font-size:42px;margin-bottom:12px">🔒</div>
      <h3 style="margin:0 0 8px;color:#991b1b">Acesso Restrito ao Cadastro de Chaves</h3>
      <p class="muted" style="max-width:500px;margin:0 auto">Apenas usuários com perfil de Líder, Supervisor ou Administrador possuem permissão para cadastrar ou editar o acervo de chaves.</p>
    </div>`;
  }

  const allKeys=scope(S.keys||[]);

  return `<div class="grid two">
    ${keyForm()}
    <div class="card tablewrap" style="padding:0">
      <div style="padding:16px 18px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">
        <h3 style="margin:0;font-size:16px;font-weight:800">Chaves Cadastradas (${allKeys.length})</h3>
        <span class="muted" style="font-size:12.5px">Gestão de acervo</span>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th class="whitespace-nowrap">Código</th>
            <th>Descrição</th>
            <th>Setor</th>
            <th>Unidade</th>
            <th>Status</th>
            <th class="whitespace-nowrap" style="text-align:right">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${allKeys.length?allKeys.map(x=>{
            const livre=isKeyLivre(x);
            return `<tr>
              <td class="whitespace-nowrap"><b>${esc(x.codigo)}</b></td>
              <td>${esc(x.descricao)}</td>
              <td>${esc(x.setor)}</td>
              <td>${esc(x.unidade)}</td>
              <td>
                ${livre?`
                  <span class="key-badge-free" style="font-size:11px;padding:3px 8px"><span class="key-dot-free"></span>Livre</span>
                `:`
                  <span class="key-badge-taken" style="font-size:11px;padding:3px 8px"><span class="key-dot-taken"></span>Retirada</span>
                `}
              </td>
              <td class="actions" style="text-align:right;justify-content:flex-end">
                <button type="button" class="editKey" data-id="${esc(x.id_chave)}" title="Editar Chave">✏️</button>
                <button type="button" class="viewKeyHistory" data-id="${esc(x.id_chave)}" title="Ver Histórico">📜</button>
                ${isAdministratorUser(S.user)?`<button type="button" class="deleteRecordPrompt" data-modulo="Chaves" data-id="${esc(x.id_chave)}" data-code="${esc(x.codigo)}" data-detail="${esc(x.descricao)} · ${esc(x.unidade)}" title="Excluir Chave">🗑️</button>`:''}
              </td>
            </tr>`;
          }).join(''):`<tr><td colspan="6" style="text-align:center;padding:36px;color:#64748b">Nenhuma chave cadastrada. Utilize o formulário ao lado para cadastrar.</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>`;
}

function keysPage(){
  const canManage=canManageKeys(S.user);
  if(S.page==='chaves-cadastro'&&!canManage){
    S.page='chaves-cautela';
    S.keysTab='cautela';
  }
  if(!S.keysTab||(S.keysTab==='cadastro'&&!canManage)){
    S.keysTab=S.page==='chaves-cadastro'&&canManage?'cadastro':'cautela';
  }

  const allKeys=scope(S.keys||[]);
  const cautelaCount=allKeys.length;
  const totalKeys=allKeys.length;

  return `<div class="keys-container">
    <div class="keys-header">
      <div class="row between" style="align-items:flex-start">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:26px">🔑</span>
            <div>
              <h2 style="margin:0;font-size:23px;font-weight:900;letter-spacing:-0.02em">Controle de Chaves & Claviculário</h2>
              <p class="muted" style="margin:4px 0 0;font-size:13px">Gestão de cautelas, retiradas, devoluções e acervo operacional</p>
            </div>
          </div>
        </div>
        ${canManage&&S.keysTab==='cautela'?`
          <button type="button" class="btn primary" id="btnGoToCadastro" style="display:inline-flex;align-items:center;gap:6px">
            <span style="font-weight:900">＋</span>
            <span>Cadastrar Chave</span>
          </button>
        `:''}
      </div>

      <!-- Abas Corporativas (RBAC) -->
      <div class="keys-tabs-container">
        <button type="button" class="keys-tab-btn ${S.keysTab==='cautela'?'active':''}" id="tabCautela">
          <span style="font-size:15px">🔑</span>
          <span>Cautela de Chaves</span>
          <span class="keys-tab-badge">${cautelaCount}</span>
        </button>
        ${canManage?`
          <button type="button" class="keys-tab-btn ${S.keysTab==='cadastro'?'active':''}" id="tabCadastro">
            <span style="font-size:15px">📋</span>
            <span>Cadastro de Chaves</span>
            <span class="keys-tab-badge">${totalKeys}</span>
          </button>
        `:''}
      </div>
    </div>

    <!-- Conteúdo da Aba Ativa -->
    ${S.keysTab==='cadastro'?keysCadastroTab():keysCautelaTab()}
  </div>`;
}

function userUnitNames(value){return String(value||'').split('|').map(name=>name.trim()).filter(Boolean)}
function userSupervisionOptions(selectedId,includeExisting=false){const options=S.supervisions.filter(item=>(activeMaster(item)&&(!hasProfile(S.user,'Supervisor')||item.id_supervisao===effectiveSupervisionId(S.user)))||(includeExisting&&item.id_supervisao===selectedId));return `<option value="">Selecione uma Supervisão</option>${selectOptions(options.map(item=>({value:item.id_supervisao,label:item.nome})),selectedId)}`}
function userScopeFields(profile,supervisionId,assignedValue,locked=false){if(locked){return `<input type="hidden" name="supervisao_id" value="${esc(supervisionId)}"><input type="hidden" name="unidades_permitidas" value="${esc(assignedValue||'')}"><p class="muted">Escopo: ${esc(userScopeSummary({perfil:profile,supervisao_id:supervisionId,unidades_permitidas:assignedValue}))}. Somente Administradores podem alterar esse escopo.</p>`}if(hasProfile({perfil:profile},'Administrador'))return `<input type="hidden" name="supervisao_id" value=""><input type="hidden" name="unidades_permitidas" value="*"><p class="muted">Acesso a todas as unidades.</p>`;const supervisionField=`<label><span class="label">Supervisão</span><select class="field" name="supervisao_id" required>${userSupervisionOptions(supervisionId,true)}</select></label>`;if(hasProfile({perfil:profile},'Supervisor'))return `${supervisionField}<input type="hidden" name="unidades_permitidas" value=""><p class="muted">O Supervisor herda as unidades ativas vinculadas à Supervisão selecionada.</p>`;const assigned=new Set(assignedUnitIds({unidades_permitidas:assignedValue})),available=S.unitCatalog.filter(unit=>unit.id_supervisao===supervisionId&&activeMaster(unit)),assignedInactive=S.unitCatalog.filter(unit=>unit.id_supervisao===supervisionId&&!activeMaster(unit)&&assigned.has(unit.id_unidade));return `${supervisionField}<label><span class="label">Unidades autorizadas</span><select class="field" name="unidades_permitidas" multiple size="${Math.max(2,Math.min(5,available.length+assignedInactive.length))}">${[...available,...assignedInactive].map(unit=>`<option value="${esc(unit.id_unidade)}" ${assigned.has(unit.id_unidade)?'selected':''}>${esc(unit.nome)}${activeMaster(unit)?'':' (Inativa)'}</option>`).join('')}</select></label>`}
function userScopeSummary(user){if(hasProfile(user,'Administrador'))return'Todas as unidades';if(hasProfile(user,'Supervisor')){const supervision=_supervisionLookupMap.get(effectiveSupervisionId(user))||S.supervisions.find(item=>item.id_supervisao===effectiveSupervisionId(user));return supervision?`Supervisão: ${supervision.nome}`:'Sem Supervisão'}const names=assignedUnitIds(user).map(id=>S.unitCatalog.find(unit=>unit.id_unidade===id)?.nome).filter(Boolean);return names.join(', ')||userUnitNames(user.unidades_permitidas).join(', ')||'Sem unidades'}
async function exportScopedData(buttonId){try{await refreshAccessContext();if(!canAccessPage('relatorios'))throw new DataScopeError('Seu perfil não pode exportar relatórios.');const occurrences=buttonId==='exportOcc',rows=await read(occurrences?'ocorrencias.csv':'chaves.csv');download(occurrences?'ocorrencias.csv':'chaves.csv',scope(rows),occurrences?H.occ:H.keys)}catch(error){console.error('Falha ao exportar dados no SIGESP.',error);fail(error instanceof DataScopeError?'Seu perfil não possui autorização para exportar estes dados.':'Não foi possível atualizar os dados antes da exportação.')}}
function userAvatarInitials(name){
  const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return 'US';
  if(parts.length===1)return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}

function userProfileBadge(perfil){
  const p=canonicalPerfil(perfil);
  let badgeClass='user-badge-operator';
  let icon='🛡️';
  if(p==='Administrador'){
    badgeClass='user-badge-admin';
    icon='⚡';
  }else if(p==='Supervisor'){
    badgeClass='user-badge-supervisor';
    icon='👔';
  }
  return `<span class="user-badge-role ${badgeClass}"><span style="font-size:11px">${icon}</span>${esc(p)}</span>`;
}

function userStatusBadge(status){
  const ativo=String(status||'').trim()==='Ativo';
  return ativo
    ? `<span class="user-status-active"><span class="user-dot-active"></span>Ativo</span>`
    : `<span class="user-status-inactive"><span class="user-dot-inactive"></span>Inativo</span>`;
}

function filteredManageableUsers(){
  const all=manageableUsers();
  const q=(S.userSearchQuery||'').toLowerCase().trim();
  const profFilter=S.userProfileFilter||'todos';
  const statusFilter=S.userStatusFilter||'todos';

  return all.filter(u=>{
    if(profFilter!=='todos'&&canonicalPerfil(u.perfil)!==canonicalPerfil(profFilter))return false;
    if(statusFilter!=='todos'&&String(u.status||'').toLowerCase()!==statusFilter.toLowerCase())return false;
    if(q){
      const mNome=String(u.nome||'').toLowerCase().includes(q);
      const mLogin=String(u.login||'').toLowerCase().includes(q);
      const mPerfil=String(u.perfil||'').toLowerCase().includes(q);
      const mScope=String(userScopeSummary(u)||'').toLowerCase().includes(q);
      if(!mNome&&!mLogin&&!mPerfil&&!mScope)return false;
    }
    return true;
  });
}

function userFormModal(){
  if(!S.editing||S.editing.kind!=='user')return '';
  const selected=S.editing.data||{};
  const baseUser=selected?.id_usuario?(manageableUsers().find(user=>user.id_usuario===selected.id_usuario)||S.users.find(user=>user.id_usuario===selected.id_usuario)||{}):{};
  const x={...baseUser,...selected};
  const isEdit=Boolean(x.id_usuario);
  const profiles=allowedProfiles();
  const matchedProfile=profiles.find(p=>canonicalPerfil(p)===canonicalPerfil(x.perfil))||profiles[0];
  const profile=matchedProfile;
  x.perfil=profile;

  const currentTab=S.userModalTab||'geral';
  const lockedForeignScope=Boolean(x.id_usuario&&hasProfile(S.user,'Supervisor')&&effectiveSupervisionId(x)!==effectiveSupervisionId(S.user));
  const supervisionId=lockedForeignScope?effectiveSupervisionId(x):(effectiveSupervisionId(x)||(hasProfile(S.user,'Supervisor')?effectiveSupervisionId(S.user):''));
  const profileOptions=profiles.map(p=>`<option value="${esc(p)}" ${canonicalPerfil(p)===canonicalPerfil(profile)?'selected':''}>${esc(p)}</option>`).join('');
  const profileField=lockedForeignScope
    ? `<input type="hidden" name="perfil" value="${esc(profile)}"><div class="user-scope-banner">Perfil restrito: <b>${esc(profile)}</b>. Somente Administradores podem alterar perfil e escopo de usuários de outra Supervisão.</div>`
    : `<div class="user-form-group"><label class="user-field-label">Perfil de Acesso Corporativo<span class="key-input-req">*</span></label><select class="field" name="perfil" id="userPerfilSelect">${profileOptions}</select></div>`;
  const scopeFields=userScopeFields(profile,supervisionId,x.unidades_permitidas,lockedForeignScope);

  return `<div class="modalbg popup-backdrop" id="modalUserFormOverlay">
    <div class="user-modal-card" role="dialog" aria-modal="true" aria-labelledby="userModalTitle">
      <div class="user-modal-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="user-modal-avatar-preview">${userAvatarInitials(x.nome||'Novo Usuário')}</div>
          <div>
            <h3 id="userModalTitle" style="margin:0;font-size:18px;font-weight:800">${isEdit?'Editar Usuário':'Cadastrar Novo Usuário'}</h3>
            <p style="margin:2px 0 0;font-size:12.5px;color:#64748b">${isEdit?`Atualização de cadastro · ${esc(x.login||'')}`:'Preencha os dados e permissões do usuário'}</p>
          </div>
        </div>
        <button type="button" class="key-modal-close closeUserModal" aria-label="Fechar">×</button>
      </div>

      <!-- Abas Internas do Modal -->
      <div class="user-modal-tabs" role="tablist">
        <button type="button" class="user-tab-btn ${currentTab==='geral'?'active':''}" data-usertab="geral">
          <span>👤 Identificação & Acesso</span>
        </button>
        <button type="button" class="user-tab-btn ${currentTab==='escopo'?'active':''}" data-usertab="escopo">
          <span>🏢 Lotação & Unidades</span>
        </button>
        <button type="button" class="user-tab-btn ${currentTab==='permissoes'?'active':''}" data-usertab="permissoes">
          <span>🛡️ Perfil & Status</span>
        </button>
      </div>

      <form id="userForm" novalidate>
        <input type="hidden" name="id_usuario" value="${esc(x.id_usuario||'')}">

        <div class="user-modal-body">
          <!-- Aba 1: Identificação -->
          <div class="user-tab-pane ${currentTab==='geral'?'active':''}" id="paneUserGeral">
            <div class="user-form-stack">
              <div class="user-form-group">
                <label class="user-field-label">Nome Completo do Usuário<span class="key-input-req">*</span></label>
                <input class="field" name="nome" required value="${esc(x.nome||'')}" placeholder="Ex: Carlos Eduardo da Silva" autofocus>
              </div>

              <div class="user-form-grid-2">
                <div class="user-form-group">
                  <label class="user-field-label">Identificação / Login Único<span class="key-input-req">*</span></label>
                  <input class="field" name="login" required value="${esc(x.login||'')}" placeholder="Ex: carlos.silva ou matrícula" autocomplete="username">
                  <small style="font-size:11px;color:#64748b;margin-top:4px;display:block">O login aceitará maiúsculas ou minúsculas no momento do acesso.</small>
                </div>
                ${!isEdit?`
                  <div class="user-form-group">
                    <label class="user-field-label">Senha de Acesso Inicial<span class="key-input-req">*</span></label>
                    <input class="field" name="senha" type="password" value="${esc(x.senha||'')}" required placeholder="Mínimo 8 caracteres" autocomplete="new-password">
                    <small style="font-size:11px;color:#64748b;margin-top:4px;display:block">A senha é criptografada e segura com hash PBKDF2.</small>
                  </div>
                `:`
                  <div class="user-form-group">
                    <label class="user-field-label">Senha Cadastrada</label>
                    <div style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#64748b;display:flex;align-items:center;justify-content:space-between">
                      <span>••••••••••••</span>
                      <button type="button" class="btn changeUserPassword" data-id="${esc(x.id_usuario)}" style="padding:4px 8px;font-size:11px">Alterar Senha</button>
                    </div>
                  </div>
                `}
              </div>
            </div>
          </div>

          <!-- Aba 2: Escopo e Lotação -->
          <div class="user-tab-pane ${currentTab==='escopo'?'active':''}" id="paneUserEscopo">
            <div class="user-form-stack">
              ${scopeFields}
            </div>
          </div>

          <!-- Aba 3: Perfil e Status -->
          <div class="user-tab-pane ${currentTab==='permissoes'?'active':''}" id="paneUserPermissoes">
            <div class="user-form-stack">
              ${profileField}
              <div class="user-form-group">
                <label class="user-field-label">Status da Conta<span class="key-input-req">*</span></label>
                <select class="field" name="status">
                  ${opts(['Ativo','Inativo'],x.status||'Ativo')}
                </select>
                <small style="font-size:11.5px;color:#64748b;margin-top:4px;display:block">Usuários inativos têm o acesso bloqueado imediatamente em tempo real.</small>
              </div>
            </div>
          </div>
        </div>

        <div class="user-modal-footer">
          <button type="button" class="btn closeUserModal">Cancelar</button>
          <button type="submit" class="btn primary" style="padding:10px 24px;font-weight:700">
            ${isEdit?'Salvar Alterações':'Cadastrar Usuário'}
          </button>
        </div>
      </form>
    </div>
  </div>`;
}

function userForm(){
  return '';
}

function usersPage(){
  const allUsers=manageableUsers();
  const filtered=filteredManageableUsers();
  const total=allUsers.length;
  const activeCount=allUsers.filter(u=>u.status==='Ativo').length;
  const inactiveCount=allUsers.filter(u=>u.status!=='Ativo').length;
  const adminCount=allUsers.filter(u=>canonicalPerfil(u.perfil)==='Administrador').length;
  const supervisorCount=allUsers.filter(u=>canonicalPerfil(u.perfil)==='Supervisor').length;
  const operatorCount=allUsers.filter(u=>canonicalPerfil(u.perfil)==='Operador').length;

  const viewMode=S.userViewMode||'grid';
  const profFilter=S.userProfileFilter||'todos';
  const statFilter=S.userStatusFilter||'todos';

  return `<div class="users-section-container">
    <!-- Cabeçalho Principal -->
    <div class="users-header">
      <div class="row between" style="align-items:flex-start">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="users-header-icon" aria-hidden="true">👥</div>
          <div>
            <h2 style="margin:0;font-size:23px;font-weight:900;letter-spacing:-0.02em">Gestão de Usuários & Permissões</h2>
            <p class="muted" style="margin:4px 0 0;font-size:13px">Administração centralizada de acessos, lotações e permissões de segurança (RBAC)</p>
          </div>
        </div>
        <button type="button" id="newUser" class="btn primary" style="display:inline-flex;align-items:center;gap:6px;padding:10px 18px;font-weight:700">
          <span style="font-weight:900;font-size:16px">＋</span>
          <span>Novo Usuário</span>
        </button>
      </div>
    </div>

    <!-- KPIs Corporativos de Acesso -->
    <div class="users-kpi-grid">
      <div class="user-kpi-card kpi-total">
        <div class="user-kpi-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Total de Usuários
        </div>
        <div class="user-kpi-value">${total}</div>
        <div class="user-kpi-sub">Cadastros no escopo ativo</div>
      </div>
      <div class="user-kpi-card kpi-active">
        <div class="user-kpi-title" style="color:#047857">
          <span class="user-dot-active"></span>Usuários Ativos
        </div>
        <div class="user-kpi-value" style="color:#047857">${activeCount}</div>
        <div class="user-kpi-sub">Com permissão de login habilitada</div>
      </div>
      <div class="user-kpi-card kpi-inactive">
        <div class="user-kpi-title" style="color:#be123c">
          <span class="user-dot-inactive"></span>Bloqueados / Inativos
        </div>
        <div class="user-kpi-value" style="color:#be123c">${inactiveCount}</div>
        <div class="user-kpi-sub">Acesso revogado ao sistema</div>
      </div>
      <div class="user-kpi-card kpi-roles">
        <div class="user-kpi-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Distribuição por Perfil
        </div>
        <div class="user-roles-breakdown">
          <span>⚡ <b>${adminCount}</b> Adm</span>
          <span>·</span>
          <span>👔 <b>${supervisorCount}</b> Sup</span>
          <span>·</span>
          <span>🛡️ <b>${operatorCount}</b> Op</span>
        </div>
        <div class="user-kpi-sub">Papeis de acesso atribuídos</div>
      </div>
    </div>

    <!-- Barra de Ferramentas / Filtros -->
    <div class="users-toolbar">
      <div class="users-toolbar-row">
        <div class="users-search-wrap">
          <span class="users-search-icon">🔍</span>
          <input type="text" id="userSearchInput" class="field users-search-input" placeholder="Buscar por nome, login ou unidade autorizada..." value="${esc(S.userSearchQuery||'')}">
        </div>

        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <select id="userProfileFilter" class="field" style="width:auto;min-width:160px">
            <option value="todos">Todos os Perfis</option>
            <option value="Administrador" ${profFilter==='Administrador'?'selected':''}>Administradores (${adminCount})</option>
            <option value="Supervisor" ${profFilter==='Supervisor'?'selected':''}>Supervisores (${supervisorCount})</option>
            <option value="Operador" ${profFilter==='Operador'?'selected':''}>Operadores (${operatorCount})</option>
          </select>

          <div class="users-status-filters" role="group" aria-label="Filtro de status de usuário">
            <button type="button" class="users-status-btn ${statFilter==='todos'?'active':''}" data-userstatus="todos">Todos (${total})</button>
            <button type="button" class="users-status-btn ${statFilter==='ativo'?'active':''}" data-userstatus="ativo">Ativos (${activeCount})</button>
            <button type="button" class="users-status-btn ${statFilter==='inativo'?'active':''}" data-userstatus="inativo">Inativos (${inactiveCount})</button>
          </div>

          <div class="users-view-toggle" role="group" aria-label="Alternar exibição de usuários">
            <button type="button" class="users-view-btn ${viewMode==='grid'?'active':''}" data-userview="grid" title="Visualização em Cards">🗂️ Cards</button>
            <button type="button" class="users-view-btn ${viewMode==='table'?'active':''}" data-userview="table" title="Visualização em Tabela">📑 Tabela</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Conteúdo: Grid de Cards ou Tabela -->
    ${viewMode==='grid'?`
      <div class="users-cards-grid">
        ${filtered.length?filtered.map(u=>{
          const ativo=u.status==='Ativo';
          const initials=userAvatarInitials(u.nome);
          const scopeText=userScopeSummary(u);
          const isCurrent=S.user?.id_usuario===u.id_usuario;

          return `<div class="user-card ${ativo?'status-active':'status-inactive'}">
            <div>
              <div class="user-card-header">
                <div style="display:flex;align-items:center;gap:12px;min-width:0">
                  <div class="user-avatar" title="${esc(u.nome)}">${initials}</div>
                  <div style="min-width:0">
                    <h4 class="user-card-name" title="${esc(u.nome)}">${esc(u.nome)}</h4>
                    <div class="user-card-login">@${esc(u.login)}${isCurrent?' <span class="user-self-pill">Você</span>':''}</div>
                  </div>
                </div>
                ${userStatusBadge(u.status)}
              </div>

              <div class="user-card-body">
                <div style="margin-bottom:10px">
                  ${userProfileBadge(u.perfil)}
                </div>

                <div class="user-scope-box">
                  <div class="user-scope-title">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    Lotação & Escopo Autorizado
                  </div>
                  <div class="user-scope-desc" title="${esc(scopeText)}">${esc(scopeText)}</div>
                </div>
              </div>
            </div>

            <div class="user-card-footer">
              <div class="user-actions-row">
                <button type="button" class="btn editUser user-btn-action" data-id="${esc(u.id_usuario)}" title="Editar dados e permissões do usuário">
                  <span>✏️</span>
                  <span>Editar</span>
                </button>
                <button type="button" class="btn changeUserPassword user-btn-action" data-id="${esc(u.id_usuario)}" title="Alterar senha de acesso">
                  <span>🔑</span>
                  <span>Senha</span>
                </button>
                ${u.login!=='admin'?`
                  <button type="button" class="btn toggleUser user-btn-action" data-id="${esc(u.id_usuario)}" title="${ativo?'Bloquear acesso':'Reativar acesso'}">
                    <span>${ativo?'🔒':'🔓'}</span>
                    <span>${ativo?'Bloquear':'Reativar'}</span>
                  </button>
                `:''}
                ${!isCurrent&&u.login!=='admin'?`
                  <button type="button" class="btn danger removeUser user-btn-action" data-id="${esc(u.id_usuario)}" title="Remover usuário">
                    <span>🗑️</span>
                  </button>
                `:''}
              </div>
            </div>
          </div>`;
        }).join(''):`
          <div class="user-card-empty">
            <span style="font-size:36px">👤</span>
            <h4 style="margin:8px 0 4px;font-size:16px;font-weight:700">Nenhum usuário encontrado</h4>
            <p class="muted" style="margin:0;font-size:13px">Nenhum registro corresponde aos filtros ou busca informada.</p>
          </div>
        `}
      </div>
    `:`
      <div class="card tablewrap" style="border-radius:14px;border:1.5px solid #e2e8f0;box-shadow:0 4px 14px rgba(15,23,42,0.04)">
        <table class="table">
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Login</th>
              <th>Perfil</th>
              <th>Supervisão / Unidades</th>
              <th>Status</th>
              <th style="min-width:240px">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length?filtered.map(x=>{
              const isCurrent=S.user?.id_usuario===x.id_usuario;
              return `<tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px">
                    <div class="user-avatar" style="width:32px;height:32px;font-size:12px">${userAvatarInitials(x.nome)}</div>
                    <div>
                      <b>${esc(x.nome)}</b>
                      ${isCurrent?' <span class="user-self-pill">Você</span>':''}
                    </div>
                  </div>
                </td>
                <td style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:#0f172a">@${esc(x.login)}</td>
                <td>${userProfileBadge(x.perfil)}</td>
                <td style="max-width:260px;font-size:12.5px">${esc(userScopeSummary(x))}</td>
                <td>${userStatusBadge(x.status)}</td>
                <td class="actions" style="white-space:nowrap">
                  <button type="button" class="btn editUser" data-id="${esc(x.id_usuario)}" title="Editar" style="padding:4px 8px;font-size:12px">✏️ Editar</button>
                  <button type="button" class="btn changeUserPassword" data-id="${esc(x.id_usuario)}" style="padding:4px 8px;font-size:12px">🔑 Senha</button>
                  ${x.login!=='admin'?`
                    <button type="button" class="btn toggleUser" data-id="${esc(x.id_usuario)}" title="${x.status==='Ativo'?'Bloquear':'Reativar'}" style="padding:4px 8px;font-size:12px">
                      ${x.status==='Ativo'?'🔒 Bloquear':'🔓 Reativar'}
                    </button>
                  `:''}
                  ${!isCurrent&&x.login!=='admin'?`
                    <button type="button" class="btn danger removeUser" data-id="${esc(x.id_usuario)}" title="Remover usuário" style="padding:4px 8px;font-size:12px">🗑️</button>
                  `:''}
                </td>
              </tr>`;
            }).join(''):`<tr><td colspan="6" style="text-align:center;padding:32px;color:#64748b">Nenhum usuário encontrado.</td></tr>`}
          </tbody>
        </table>
      </div>
    `}
  </div>`;
}
function userRemovalModal(){const target=S.userRemovalTarget;if(!target||S.page!=='usuarios'||!canManageUsers())return'';return `<div class="modalbg popup-backdrop"><div class="result-dialog result-error" role="dialog" aria-modal="true" aria-labelledby="removeUserTitle"><div class="error-strip"></div><div class="error-body"><div class="error-icon">!</div><div><div class="result-kicker error-kicker">Confirmação necessária</div><h2 id="removeUserTitle">REMOVER USUÁRIO</h2><p>Tem certeza de que deseja remover este usuário?</p><div class="detail"><b>Nome</b><p>${esc(target.nome)}</p><b>Login</b><p>${esc(target.login)}</p><b>Perfil</b><p>${esc(target.perfil)}</p></div><p>Esta ação removerá o acesso deste usuário ao SIGESP.</p></div></div><div class="result-actions error-actions"><button id="cancelUserRemoval" type="button" class="btn">Cancelar</button><button id="confirmUserRemoval" type="button" class="btn danger">Remover Usuário</button></div></div></div>`}
function auditPage(){return `<h2>Auditoria</h2><div class="card tablewrap"><table class="table"><tr><th>Data</th><th>Usuário</th><th>Módulo</th><th>Ação</th><th>Detalhes</th></tr>${S.audits.map(item=>`<tr><td>${esc(item.data_hora)}</td><td>${esc(item.usuario)}</td><td>${esc(item.modulo)}</td><td>${esc(item.acao)}</td><td>${esc(item.detalhes)}</td></tr>`).join('')}</table></div>`}
function reportsPage(){return `<h2>Relatórios</h2><div class="grid metrics"><div class="card"><h3>Ocorrências</h3><button id="exportOcc" class="btn">Exportar CSV</button></div><div class="card"><h3>Chaves</h3><button id="exportKeys" class="btn">Exportar CSV</button></div></div>`}
function settingsSearchForm(placeholder){return `<form id="settingsSearch" class="row"><input class="field" name="query" value="${esc(S.settingsSearch)}" placeholder="${esc(placeholder)}"><button class="btn">Pesquisar</button></form>`}
function settingsMasterList(){const entity=S.settingsTab,query=normalizedMasterName(S.settingsSearch),admin=hasProfile(S.user,'Administrador');let rows=masterEntityRecords(entity).filter(item=>{const parent=entity==='units'?(_supervisionLookupMap.get(item.id_supervisao)?.nome||''):'';return !query||normalizedMasterName(`${item.nome} ${parent}`).includes(query)});rows.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));let table='';if(entity==='supervisions'){table=`<table class="table"><tr><th>Supervisão</th><th>Unidades</th><th>Usuários</th><th>Status</th><th>Ações</th></tr>${rows.map(item=>`<tr><td>${esc(item.nome)}</td><td>${S.unitCatalog.filter(unit=>unit.id_supervisao===item.id_supervisao).length}</td><td>${S.users.filter(user=>effectiveSupervisionId(user)===item.id_supervisao).length}</td><td>${activeMaster(item)?'Ativa':'Inativa'}</td><td class="actions">${admin?`<button class="editMaster" data-entity="supervision" data-id="${esc(item.id_supervisao)}" title="Editar">✏️</button><button class="deactivateMaster btn" data-entity="supervision" data-id="${esc(item.id_supervisao)}">${activeMaster(item)?'Inativar':'Reativar'}</button>`:'-'}</td></tr>`).join('')}</table>`}else if(entity==='units'){table=`<table class="table"><tr><th>Unidade</th><th>Supervisão</th><th>Status</th><th>Ações</th></tr>${rows.map(item=>`<tr><td>${esc(item.nome)}</td><td>${esc(_supervisionLookupMap.get(item.id_supervisao)?.nome||'Sem Supervisão')}</td><td>${activeMaster(item)?'Ativa':'Inativa'}</td><td class="actions">${admin?`<button class="editMaster" data-entity="unit" data-id="${esc(item.id_unidade)}" title="Editar">✏️</button><button class="deactivateMaster btn" data-entity="unit" data-id="${esc(item.id_unidade)}">${activeMaster(item)?'Inativar':'Reativar'}</button>`:'-'}</td></tr>`).join('')}</table>`}else{const natureFreq=new Map();for(let i=0;i<S.occ.length;i++){const k=normalizedMasterName(S.occ[i].natureza_ocorrencia);if(k)natureFreq.set(k,(natureFreq.get(k)||0)+1)}for(let i=0;i<S.pending.length;i++){const k=normalizedMasterName(S.pending[i].natureza_ocorrencia);if(k)natureFreq.set(k,(natureFreq.get(k)||0)+1)}table=`<table class="table"><tr><th>Natureza de Ocorrência</th><th>Status</th><th>Usos históricos</th><th>Ações</th></tr>${rows.map(item=>{const names=new Set([item.nome,...aliasesOf(item)].map(normalizedMasterName));let count=0;for(const nKey of names)count+=natureFreq.get(nKey)||0;return `<tr><td>${esc(item.nome)}</td><td>${activeMaster(item)?'Ativa':'Inativa'}</td><td>${count}</td><td class="actions">${admin?`<button class="editMaster" data-entity="nature" data-id="${esc(item.id_natureza)}" title="Editar">✏️</button><button class="deactivateMaster btn" data-entity="nature" data-id="${esc(item.id_natureza)}">${activeMaster(item)?'Inativar':'Reativar'}</button>`:'-'}</td></tr>`}).join('')}</table>`}return `<div class="card settings-list"><div class="row between"><div><h3>${masterEntityName(entity==='supervisions'?'supervision':entity==='units'?'unit':'nature')}</h3><p class="muted">${entity==='supervisions'?'Cadastro das Supervisões organizacionais.':entity==='units'?'Unidades vinculadas às respectivas Supervisões.':'Naturezas disponíveis para novos registros de ocorrência.'}</p></div>${admin?`<button class="btn primary newMaster" data-entity="${entity==='supervisions'?'supervision':entity==='units'?'unit':'nature'}">Cadastrar ${entity==='supervisions'?'Supervisão':entity==='units'?'Unidade':'Natureza'}</button>`:''}</div>${settingsSearchForm('Pesquisar por nome...')}<div class="tablewrap">${table||'<p class="muted">Nenhum cadastro encontrado.</p>'}</div></div>`}
function settingsMasterEditor(){if(!S.masterEditor||!hasProfile(S.user,'Administrador'))return'';const{entity,id,data}=S.masterEditor,title=`${id?'Editar':'Cadastrar'} ${masterEntityName(entity)}`,supOptions=S.supervisions.filter(item=>activeMaster(item)||(id&&item.id_supervisao===data.id_supervisao)).map(item=>({value:item.id_supervisao,label:item.nome}));return `<div class="modalbg popup-backdrop"><div class="card modal"><button type="button" class="close cancelMasterEditor" aria-label="Fechar">×</button><h2>${esc(title)}</h2><form id="masterDataForm" class="stack"><label><span class="label">Nome</span><input class="field" name="nome" value="${esc(data.nome||'')}" required maxlength="120"></label>${entity==='unit'?`<label><span class="label">Supervisão</span><select class="field" name="supervisao_id" required><option value="">Selecione uma Supervisão</option>${selectOptions(supOptions,data.id_supervisao||'')}</select></label>`:''}<div class="row" style="justify-content:flex-end"><button type="button" id="cancelMasterEditor" class="btn">Cancelar</button><button type="submit" class="btn primary" ${S.masterBusy?'disabled':''}>Salvar</button></div></form></div></div>`}
function masterConfirmationModal(){const item=S.masterConfirmation;if(!item)return'';const title=item.error?'Não foi possível verificar dependências':`Confirmar ${item.active?'reativação':'inativação'}?`,message=item.error?item.error:`Tem certeza de que deseja ${item.active?'reativar':'inativar'} ${masterEntityName(item.entity)} “${item.name}”?`;return `<div class="modalbg popup-backdrop"><div class="result-dialog result-error"><div class="error-strip"></div><div class="error-body"><div class="error-icon">!</div><div><div class="result-kicker error-kicker">Confirmação necessária</div><h2>${esc(title)}</h2><p>${esc(message)}</p>${item.dependencies?.length?`<p class="muted">Dependências: ${esc(item.dependencies.join('; '))}. Os registros históricos e vínculos serão preservados; a inativação impede novos usos.</p>`:''}</div></div><div class="result-actions error-actions"><button id="cancelMasterConfirmation" class="btn">Cancelar</button>${item.error?'':`<button id="confirmMasterDeactivation" class="btn danger">${item.active?'Reativar':'Inativar'}</button>`}</div></div></div>`}
function settingsPage(){const tabs=[['supervisions','Supervisões'],['units','Unidades'],['natures','Naturezas de Ocorrência']],admin=hasProfile(S.user,'Administrador');return `<div class="settings-heading"><h2>Configurações</h2><p class="muted">Administração centralizada dos dados mestres e persistência automática do SIGESP.</p></div><div class="settings-tabs" role="tablist">${tabs.map(([id,label])=>`<button class="btn settingsTab ${S.settingsTab===id?'primary':''}" data-tab="${id}" role="tab" aria-selected="${S.settingsTab===id}">${label}</button>`).join('')}</div>${settingsMasterList()}<div class="card settings-folder"><div class="row between"><div><h3>Armazenamento Automático de Dados (Pasta dados)</h3><p class="muted">Os dados são lidos e salvos automaticamente na pasta <b>dados</b> (localizada no mesmo diretório do index.html), protegidos por criptografia nativa AES-GCM de 256 bits.</p></div><div class="row"><button id="syncServerFolder" type="button" class="btn">Sincronizar pasta dados</button><button id="selectFolderSettings" type="button" class="btn">Selecionar outra pasta...</button><button id="downloadAllCsvs" type="button" class="btn primary">Baixar todos os CSVs</button>${admin?`<label class="btn" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">Importar CSV(s)<input id="uploadCsvInput" class="hidden" type="file" accept=".csv" multiple></label>`:''}</div></div><div class="status" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px"><span>Pasta ativa: <b>${esc(S.dir?.name||'dados')}</b> · Persistência centralizada</span><span style="display:inline-flex;align-items:center;gap:6px;background:rgba(22,163,74,0.12);color:#166534;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600">🔒 Criptografia AES-GCM 256 bits (Web Crypto API) Ativa</span></div><div class="tablewrap" style="margin-top:12px"><table class="table"><thead><tr><th>Arquivo CSV</th><th>Descrição</th><th>Registros carregados</th><th>Ação</th></tr></thead><tbody>${HYBRID_CSVS.map(([file,desc,countFn])=>`<tr><td><b>${esc(file)}</b></td><td>${esc(desc)}</td><td>${countFn()}</td><td><button type="button" class="btn downloadSingleCsv" data-file="${esc(file)}" style="padding:6px 10px;font-size:12px">Baixar CSV</button></td></tr>`).join('')}</tbody></table></div></div>`}
function dashboardPage(){if(denyOperatorAccess())return'';const rows=scope(S.occ||[]),series=dashboardSeries(rows),summary={},unitCounts={};for(let i=0,len=rows.length;i<len;i++){const item=rows[i],st=normalizeApuracaoStatus(item.status),un=String(item.unidade||item.local_ocorrencia||'Sem unidade').trim();summary[st]=(summary[st]||0)+1;unitCounts[un]=(unitCounts[un]||0)+1}const pendingCount=filteredPendingOccurrences().length;const catalogUnits=authorizedUnitRecords();for(let i=0,len=catalogUnits.length;i<len;i++){const uName=String(catalogUnits[i]?.nome||'').trim();if(uName&&!(uName in unitCounts)){unitCounts[uName]=0}}const periods=series.months.slice(-6),totals=series.totals.slice(-6),unitEntries=Object.entries(unitCounts),topUnits=unitEntries.sort((a,b)=>b[1]-a[1]).slice(0,5),featured=ambientalDashboard();const registeredUnitsCount=catalogUnits.length||S.unitCatalog.length;const unitsWithOccurrences=unitEntries.filter(([un,count])=>un!=='Sem unidade'&&count>0).length;return `<div class="section-block"><div class="dashboard-heading"><div><h2>DASHBOARD</h2><p class="muted">Visão geral operativa do SIGESP</p></div><span class="dashboard-period">Últimos 6 meses</span></div><div class="grid metrics">${[['Total de registros',rows.length],['Ocorrências pendentes',pendingCount],['Em apuração',summary['Em Apuração']||0],['Encerradas',summary['Encerrada']||0],['Unidades cadastradas',registeredUnitsCount],['Unidades com registros',unitsWithOccurrences]].map(([label,value])=>`<div class="card metric-card"><span class="metric-label">${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join('')}</div><div class="corporate-dashboard-grid"><section class="card chart-card"><div class="chart-title"><div><h3>Evolução operacional</h3><p>Ocorrências por período</p></div><span class="chart-badge">Período</span></div>${periods.length?`<div class="ambiental-mini-chart">${periods.map((month,index)=>{const value=totals[index]||0;const maxTotal=Math.max(1,...totals);const height=Math.max(8,(value/maxTotal)*100);return `<div class="ambiental-small-bar-wrap" style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end"><span class="bar-data-label" style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:4px;line-height:1">${value}</span><div class="ambiental-small-bar" style="height:${height}%" title="${value} ocorrência(s) em ${corporateMonthLabel(month)}"></div><span>${esc(corporateMonthLabel(month).slice(0,6))}</span></div>`}).join('')}</div>`:`<div class="chart-empty">Nenhum dado disponível para o período.</div>`}</section><section class="card chart-card"><div class="chart-title"><div><h3>Top unidades</h3><p>Registros por unidade no escopo</p></div><span class="chart-badge">Unidades</span></div><div class="ambiental-stack">${topUnits.length?topUnits.map(([unit,count])=>`<div class="ambiental-legend-row"><span>${esc(unit)}</span><strong>${count}</strong></div>`).join(''):`<div class="chart-empty">Sem registros para exibir.</div>`}</div></section></div>${featured}</div>`}
const unguardedRestrictedViews={dashboard:dashboardPage,occList,occurrenceHistoryPage,pendingValidationPage,apuracaoOccurrencesPage,usersPage,auditPage,reportsPage,settingsPage};
function dashboard(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.dashboard();}
occList=function(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.occList()};
occurrenceHistoryPage=function(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.occurrenceHistoryPage()};
pendingValidationPage=function(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.pendingValidationPage()};
apuracaoOccurrencesPage=function(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.apuracaoOccurrencesPage()};
usersPage=function(){if(denyOperatorAccess()||denyUserManagement())return'';return unguardedRestrictedViews.usersPage()};
auditPage=function(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.auditPage()};
reportsPage=function(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.reportsPage()};
settingsPage=function(){if(denyOperatorAccess())return'';return unguardedRestrictedViews.settingsPage()};
const unguardedPdfGeneration=generateOccurrencePdf,unguardedApuracaoPdfGeneration=generateApuracaoPdf,unguardedDownload=download;
generateOccurrencePdf=async function(id){try{await findAuthorizedOccurrence(id);return await unguardedPdfGeneration(id)}catch(error){console.warn('Geração de PDF bloqueada para registro fora do escopo.',error);return showPdfResult(false,'Registro não encontrado ou sem autorização para acessá-lo.')}};
generateApuracaoPdf=async function(id){try{await findAuthorizedOccurrence(id);return await unguardedApuracaoPdfGeneration(id)}catch(error){console.warn('Geração de PDF de apuração bloqueada para registro fora do escopo.',error);return showPdfResult(false,'Registro não encontrado ou sem autorização para acessá-lo.')}};
download=function(...args){if(denyOperatorAccess())return;return unguardedDownload(...args)};
function modal(){if(!S.modal)return '';const x=S.modal;if(x?.kind==='ambiental'){const r=x.data||{},isSim=String(r.realizar_monitoramento||'Sim').trim()==='Sim';const rResp=formatAmbientalResponsible(r);const rUser=getOccurrenceResponsibleUser({responsavel:r.responsavel,matricula_responsavel:r.matricula_responsavel,usuario_registro:r.usuario_registro});const rLogin=rUser?.login||r.matricula_responsavel||'Não informado';const details=[[`ID`,r.id],[`Data da Inspeção`,r.data],[`Monitoramento`,r.realizar_monitoramento||'Não'],[`Placa`,r.placa],[`Transportadora`,r.transportadora],[`Laudo`,r.laudo],[`Observação`,r.observacao],[`Justificativa`,r.motivo_nao_execucao],[`Responsável`,rResp],[`Login / Matrícula`,rLogin],[`Unidade`,r.unidade],[`Supervisão`,r.supervisao],[`Usuário do registro`,r.usuario_registro],[`Data/hora do registro`,r.data_hora_registro],[`Data/hora da alteração`,r.data_hora_alteracao],[`Alterado por`,r.alterado_por]];const summary=details.filter(([,value])=>String(value??'').trim()).map(([label,value])=>`<div class="detail break-words min-w-0"><b>${esc(label)}</b><p class="break-words">${esc(value || 'Não informado')}</p></div>`).join('');return `<div class="modalbg"><div class="card modal break-words"><button id="closeModal" class="close">×</button><h2>Inspeção veicular</h2><p class="muted">Monitoramento de Fumaça Preta · Meio Ambiente</p>${summary?`<div class="detail-grid">${summary}</div>`:''}</div></div>`}const details=[['Protocolo',x.numero_protocolo],['Data',x.data_ocorrencia],['Hora',x.hora_ocorrencia],['Gerência',x.gerencia||x.gerencia_envolvido],['Supervisão',x.supervisao],['Unidade',x.unidade],['Área',x.area],['Local específico',x.local_especifico],['Natureza',x.natureza_ocorrencia],['Vínculo',x.tipo_vinculo],['Nome do envolvido',x.nome_envolvido],['Empresa',x.empresa_envolvido],['Matrícula/ID',x.matricula_id],['Telefone',x.telefone],['Documento',x.documento],['Placa',x.placa_veiculo],['Gerência Geral',x.gerencia_geral],['Diretoria',x.diretoria],['Prioridade',x.prioridade],['Status',x.status],['Responsável',formatOccurrenceResponsible(x)],['Matrícula / Login do responsável',getOccurrenceResponsibleMatricula(x)||'Não informado'],['Perfil',x.perfil_registro],['Data de registro',x.data_registro]];const summary=details.filter(([,v])=>String(v??'').trim()).map(([label,value])=>`<div class="detail break-words min-w-0"><b>${esc(label)}</b><p class="break-words">${esc(value || 'Não informado')}</p></div>`).join('');return `<div class="modalbg"><div class="card modal break-words"><button id="closeModal" class="close">×</button><h2>${esc(x.numero_protocolo || 'Ocorrência')}</h2>${summary ? `<div class="detail-grid min-w-0">${summary}</div>` : ''}<div class="detail break-words min-w-0" style="margin-top:12px"><b>Relato</b><p class="break-words">${esc(x.relato_detalhado || 'Não informado')}</p></div><div class="detail break-words min-w-0" style="margin-top:10px"><b>Providências adotadas</b><p class="break-words">${esc(x.providencias_adotadas || 'Não informado')}</p></div>${x.observacoes?`<div class="detail"><b>Observações</b><p>${esc(x.observacoes)}</p></div>`:''}<h3>Fotos anexadas</h3><div class="photo-zone">${S.existing.length||S.newPhotos.length?photos(false):'<p class="muted">Nenhuma foto anexada.</p>'}</div></div></div>`}
function successModal(){if(!S.successPopup)return'';const x=S.successPopup,date=x.dataRegistro?new Date(x.dataRegistro).toLocaleString('pt-BR'):'Não informado';const kind=x.kind||'create';const title=kind==='edit'?'Ocorrência alterada com sucesso':kind==='pending'?'Ocorrência encaminhada para validação':'Ocorrência registrada com sucesso';const subtitle=kind==='edit'?'A ocorrência foi atualizada no SIGESP.':kind==='pending'?'A ocorrência foi registrada e está aguardando aprovação para entrar no histórico.':'O registro foi gravado no SIGESP.';return `<div class="modalbg popup-backdrop"><div class="result-dialog result-success"><div class="result-header"><div class="result-icon">✓</div><div class="result-kicker">Registro concluído</div><h2>${title}</h2><p>${subtitle}</p></div><div class="result-body"><div class="protocol-box"><span>Protocolo da ocorrência</span><strong>${esc(x.protocolo)}</strong></div><div class="result-details"><div><span>Unidade</span><b>${esc(x.unidade||'Não informada')}</b></div><div><span>Data e hora</span><b>${esc(date)}</b></div><div><span>Responsável</span><b>${esc(x.usuario)}</b></div></div><div class="result-actions"><button id="copyProtocol" class="btn">Copiar protocolo</button><button id="viewSuccessOccurrence" class="btn success-primary">Visualizar ocorrência</button><button id="newSuccessOccurrence" class="btn">Nova ocorrência</button><button id="closeSuccess" class="btn">Fechar</button></div></div></div></div>`}
function errorModal(){if(!S.errorPopup)return'';return `<div class="modalbg popup-backdrop"><div class="result-dialog result-error"><div class="error-strip"></div><div class="error-body"><div class="error-icon">!</div><div><div class="result-kicker error-kicker">Validação do formulário</div><h2>${esc(S.errorPopup.titulo)}</h2><p>${esc(S.errorPopup.mensagem)}</p></div></div><div class="result-actions error-actions"><button id="closeError" class="btn error-primary">Revisar formulário</button></div></div></div>`}
function accessDeniedModal(){if(!S.accessDenied)return'';const message=S.accessDenied==='user-target'?'Seu perfil não possui permissão para gerenciar este usuário.':S.accessDenied==='remove-user-target'?'Seu perfil não possui permissão para remover este usuário.':'Seu perfil não possui permissão para acessar esta funcionalidade.';return `<div id="accessDeniedOverlay" class="modalbg popup-backdrop"><div class="result-dialog result-error"><div class="error-strip"></div><div class="error-body"><div class="error-icon">!</div><div><div class="result-kicker error-kicker">Acesso restrito</div><h2>ACESSO RESTRITO</h2><p>${message}</p></div></div><div class="result-actions error-actions"><button id="closeAccessDenied" class="btn error-primary">Entendi</button></div></div></div>`}
function validationModal(){
if(!S.validationModal)return '';
const x=S.validationModal;
const availableUnits=units(),historicalUnit=unitForName(x.unidade);
if(x.id_ocorrencia&&historicalUnit&&canAccessUnit(x.unidade)&&!availableUnits.includes(x.unidade))availableUnits.push(x.unidade);
const selectedUnit=availableUnits.includes(x.unidade)?x.unidade:(availableUnits[0]||'');
const supervision=supervisionForUnit(selectedUnit);
const activeNatures=S.natureCatalog.filter(activeMaster).map(item=>item.nome);
const natureOptions=[...activeNatures];
if(x.id_ocorrencia&&x.natureza_ocorrencia&&!natureOptions.includes(x.natureza_ocorrencia))natureOptions.push(x.natureza_ocorrencia);
const selectedNature=natureOptions.includes(x.natureza_ocorrencia)?x.natureza_ocorrencia:(natureOptions[0]||'');
const dateFormatted=x.data_registro?new Date(x.data_registro).toLocaleString('pt-BR'):x.data_ocorrencia;
const rawValVinculo=x.tipo_vinculo||'Terceiro',valVinculo=(rawValVinculo==='Próprio'||rawValVinculo==='Grupo CSN')?'Grupo CSN':rawValVinculo,isValCsn=valVinculo==='Grupo CSN';
return `<div class="modalbg popup-backdrop validation-modal-backdrop" style="z-index:1000;overflow-y:auto;padding:24px 12px">
<div class="card modal modal-validation" role="dialog" aria-modal="true" aria-labelledby="validationModalTitle" style="max-height:92vh;display:flex;flex-direction:column;padding:0;overflow:hidden">
<div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;background:#ffffff;display:flex;justify-content:space-between;align-items:flex-start">
<div style="display:flex;align-items:flex-start;gap:12px">
<div style="width:42px;height:42px;border-radius:10px;background:#ecfdf5;color:#16a34a;display:flex;align-items:center;justify-content:center;flex-shrink:0">
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
</div>
<div>
<div style="display:flex;align-items:center;gap:10px;margin-bottom:3px">
<h2 id="validationModalTitle" style="margin:0;font-size:18px;font-weight:800;color:#0f172a">Validação de Ocorrência · Protocolo ${esc(x.numero_protocolo||'Novo')}</h2>
<span class="status-pill pending-pill" style="font-size:11px;font-weight:700">Aguardando Validação</span>
</div>
<p style="margin:0;font-size:12.5px;color:#64748b">
Registrado por <b>${esc(formatOccurrenceResponsible(x))}</b> (${esc(x.perfil_registro||'Operador')}) em ${esc(dateFormatted)}
</p>
</div>
</div>
<button type="button" id="closeValidationModal" class="close" aria-label="Fechar" style="font-size:24px;cursor:pointer;background:transparent;border:0;color:#64748b">×</button>
</div>
<div style="padding:20px 24px;overflow-y:auto;flex:1">
<form id="validationOccForm" novalidate>
<input type="hidden" name="id_ocorrencia" value="${esc(x.id_ocorrencia||'')}">
<input type="hidden" name="id_interno" value="${esc(x.id_interno||'')}">
<input type="hidden" name="numero_protocolo" value="${esc(x.numero_protocolo||'')}">
<div class="validation-section">
<div class="validation-section-title"><span>1</span> Dados Gerais e Estrutura Organizacional</div>
<div class="formgrid">
<label class="c4"><span class="label">Gerência</span><input class="field" name="gerencia" value="${esc(x.gerencia||'GSP/SP')}"></label>
<label class="c4"><span class="label">Supervisão</span><input class="field" id="validationSupervisao" name="supervisao" value="${esc(x.supervisao||supervision?.nome||'')}" readonly style="background:#f1f5f9;cursor:not-allowed"></label>
<label class="c4"><span class="label">Unidade</span><select class="field" id="validationUnidade" name="unidade" ${availableUnits.length?'':'disabled'}>${availableUnits.length?selectOptions(availableUnits,selectedUnit):'<option value="">Nenhuma unidade autorizada</option>'}</select></label>
<label class="c6 col-datetime"><span class="label">Data da Ocorrência</span><input class="field" type="date" name="data_ocorrencia" value="${esc(x.data_ocorrencia||'')}" required></label>
<label class="c6 col-datetime"><span class="label">Hora da Ocorrência</span><input class="field" type="time" name="hora_ocorrencia" value="${esc(x.hora_ocorrencia||'')}" required></label>
<label class="c12"><span class="label">Natureza da Ocorrência</span><select class="field" name="natureza_ocorrencia" required><option value="">Selecione uma natureza</option>${selectOptions(natureOptions,selectedNature)}</select></label>
<label class="c6"><span class="label">Área</span><input class="field" name="area" value="${esc(x.area||'')}" placeholder="Ex.: Portaria, Estacionamento..."></label>
<label class="c6"><span class="label">Local Específico</span><input class="field" name="local_especifico" value="${esc(x.local_especifico||'')}" required placeholder="Ex.: Acesso de veículos, Portão 02..."></label>
<label class="c6"><span class="label">Prioridade</span><select class="field" name="prioridade">${opts(PRI,x.prioridade||'Média')}</select></label>
<label class="c6"><span class="label">Status Operacional</span><select class="field" name="status">${opts(OST,x.status||'Registrada')}</select></label>
</div>
</div>
<div class="validation-section">
<div class="validation-section-title"><span>2</span> Identificação dos Envolvidos</div>
<div class="formgrid">
<label class="c4"><span class="label">Tipo de Vínculo</span><select class="field" name="tipo_vinculo" id="validationTipoVinculo"><option value="Terceiro" ${valVinculo==='Terceiro'?'selected':''}>Terceiro</option><option value="Visitante" ${valVinculo==='Visitante'?'selected':''}>Visitante</option><option value="Motorista" ${valVinculo==='Motorista'?'selected':''}>Motorista</option><option value="Grupo CSN" ${isValCsn?'selected':''}>Grupo CSN</option></select></label>
<label class="c8"><span class="label whitespace-nowrap min-w-fit">Nome Completo do Envolvido</span><input class="field" name="nome_envolvido" id="validationNomeEnvolvido" value="${esc(x.nome_envolvido||'')}" placeholder="Nome completo..."></label>
<label class="c6"><span class="label">Empresa</span><input class="field" name="empresa_envolvido" id="validationEmpresaEnvolvido" value="${esc(x.empresa_envolvido||(isValCsn?'Grupo CSN':''))}" placeholder="Razão social ou prestadora..."></label>
${isValCsn?`<label class="c6"><span class="label">Matrícula</span><input class="field" name="matricula_id" id="validationMatriculaId" value="${esc(x.matricula_id||'')}" placeholder="Informe a matrícula CSN"></label>`:`<label class="c6"><span class="label">Documento (RG/CPF)</span><input class="field" name="documento" id="validationDocumento" value="${esc(x.documento||'')}" placeholder="Documento de identificação"></label>`}
<label class="c6"><span class="label">Telefone de Contato</span><input class="field" name="telefone" id="validationTelefone" value="${esc(x.telefone||'')}" placeholder="(00) 00000-0000"></label>
<label class="c6"><span class="label">Placa do Veículo</span><input class="field" name="placa_veiculo" id="validationPlacaVeiculo" value="${esc(x.placa_veiculo||'')}" placeholder="ABC-1234"></label>
${isValCsn?`<label class="c4"><span class="label">Gerência</span><input class="field" name="gerencia_envolvido" id="validationGerenciaEnvolvido" value="${esc(x.gerencia_envolvido||x.gerencia||'')}" placeholder="Informe a gerência"></label><label class="c4"><span class="label">Gerência Geral</span><input class="field" name="gerencia_geral" id="validationGerenciaGeral" value="${esc(x.gerencia_geral||'')}" placeholder="Informe a gerência geral"></label><label class="c4"><span class="label">Diretoria</span><input class="field" name="diretoria" id="validationDiretoria" value="${esc(x.diretoria||'')}" placeholder="Informe a diretoria"></label>`:''}
</div>
</div>
<div class="validation-section">
<div class="validation-section-title"><span>3</span> Descrição do Fato e Parecer da Supervisão</div>
<div class="formgrid">
<label class="c12"><span class="label">Relato Detalhado do Fato</span><textarea class="field" rows="6" maxlength="5000" name="relato_detalhado" required placeholder="Descreva os fatos ocorridos...">${esc(x.relato_detalhado||'')}</textarea></label>
<label class="c12"><span class="label">Providências Adotadas</span><textarea class="field" rows="3" name="providencias_adotadas" placeholder="Medidas imediatas tomadas pela equipe de segurança...">${esc(x.providencias_adotadas||'')}</textarea></label>
<label class="c12"><span class="label">Parecer e Observações da Validação</span><textarea class="field" rows="3" name="observacoes" placeholder="Parecer da supervisão, notas de conferência ou justificativas de aprovação...">${esc(x.observacoes||x.observacao_validacao||'')}</textarea></label>
</div>
</div>
<div class="validation-section">
<div class="validation-section-title"><span>4</span> Anexos e Evidências Fotográficas</div>
<div class="photo-zone">${photos(true, 'valPhotos')}</div>
</div>
</form>
</div>
<div style="padding:16px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
<button type="button" id="cancelValidationModal" class="btn" style="padding:9px 16px;font-weight:600">Cancelar</button>
<div style="display:flex;gap:10px;align-items:center">
<button type="button" id="savePendingDraftBtn" class="btn" style="background:#ffffff;border:1px solid #cbd5e1;color:#1e293b;padding:9px 18px;font-weight:600;display:inline-flex;align-items:center;gap:6px">
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
Salvar Alterações
</button>
<button type="button" id="confirmValidationModal" class="btn primary" style="background:#15803d;border-color:#15803d;padding:9px 20px;font-weight:700;display:inline-flex;align-items:center;gap:7px;box-shadow:0 2px 6px rgba(21,128,61,.3)">
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
Validar Ocorrência
</button>
</div>
</div>
</div>
</div>`}
function deletePendingAlertDialog(){
if(!S.deletePendingTarget)return '';
const target=S.deletePendingTarget;
return `<div class="modalbg popup-backdrop alert-dialog-backdrop" style="z-index:1100">
<div class="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="alertDialogTitle" aria-describedby="alertDialogDesc">
<div class="alert-dialog-header">
<div class="alert-dialog-icon">
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
</div>
<div>
<h3 id="alertDialogTitle" style="margin:0 0 4px;font-size:17px;font-weight:700;color:#0f172a">Excluir Ocorrência Pendente</h3>
<p id="alertDialogDesc" style="margin:0;font-size:13px;color:#64748b;line-height:1.4">Tem certeza de que deseja excluir permanentemente esta ocorrência da fila de validação? Esta ação não pode ser desfeita.</p>
</div>
</div>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:18px;font-size:13px;color:#334155;display:grid;grid-template-columns:1fr 1fr;gap:8px">
<div><span style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase">Protocolo</span><br><b>${esc(target.protocol||target.id)}</b></div>
<div><span style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase">Unidade</span><br><b>${esc(target.unit||'Não informada')}</b></div>
</div>
<div class="row" style="justify-content:flex-end;gap:10px">
<button type="button" id="cancelDeletePending" class="btn">Cancelar</button>
<button type="button" id="confirmDeletePending" class="btn danger" style="background:#dc2626;color:#fff;border-color:#dc2626;font-weight:700;display:inline-flex;align-items:center;gap:6px">
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
Excluir Ocorrência
</button>
</div>
</div>
</div>`}
function deleteRecordAlertDialog(){
if(!S.deleteRecordTarget)return '';
const target=S.deleteRecordTarget;
return `<div class="modalbg popup-backdrop alert-dialog-backdrop" style="z-index:1100">
<div class="alert-dialog" role="alertdialog" aria-modal="true" aria-labelledby="deleteRecordTitle" aria-describedby="deleteRecordDesc">
<div class="alert-dialog-header">
<div class="alert-dialog-icon" style="background:#fee2e2;color:#dc2626">
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
</div>
<div>
<h3 id="deleteRecordTitle" style="margin:0 0 4px;font-size:17px;font-weight:700;color:#0f172a">Confirmar Exclusão de Registro</h3>
<p id="deleteRecordDesc" style="margin:0;font-size:13px;color:#64748b;line-height:1.4">Ação exclusiva de Administrador. O registro será removido da base ativa e salvo em <b>registros_apagados.csv</b> para auditoria permanente.</p>
</div>
</div>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:16px 0;font-size:13px;color:#334155;display:grid;grid-template-columns:1fr 1fr;gap:8px">
<div><span style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase">Módulo</span><br><b>${esc(target.modulo)}</b></div>
<div><span style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase">Identificador</span><br><b>${esc(target.code||target.id)}</b></div>
${target.detail?`<div style="grid-column:1/-1"><span style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase">Detalhes</span><br><span>${esc(target.detail)}</span></div>`:''}
</div>
<div class="row" style="justify-content:flex-end;gap:10px">
<button type="button" id="cancelDeleteRecord" class="btn">Cancelar</button>
<button type="button" id="confirmDeleteRecord" class="btn danger" style="background:#dc2626;color:#fff;border-color:#dc2626;font-weight:700;display:inline-flex;align-items:center;gap:6px">
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
Confirmar Exclusão
</button>
</div>
</div>
</div>`}
function toastContainer(){return ''}
function toggleSidebarMenu(menuId){S.activeMenu=S.activeMenu===menuId?null:menuId;updateSidebarAccordion()}
function updateSidebarAccordion(){
  const occToggle=document.getElementById('occurrencesMenuToggle'),occSubmenu=document.getElementById('submenu-occurrences'),occArrow=occToggle?.querySelector('.menu-arrow'),isOccOpen=S.activeMenu==='ocorrencias';
  if(occToggle)occToggle.setAttribute('aria-expanded',String(isOccOpen));
  if(occArrow)occArrow.classList.toggle('open',isOccOpen);
  if(occSubmenu)occSubmenu.classList.toggle('open',isOccOpen);

  const envToggle=document.getElementById('environmentMenuToggle'),envSubmenu=document.getElementById('submenu-environment'),envArrow=envToggle?.querySelector('.menu-arrow'),isEnvOpen=S.activeMenu==='meio-ambiente';
  if(envToggle)envToggle.setAttribute('aria-expanded',String(isEnvOpen));
  if(envArrow)envArrow.classList.toggle('open',isEnvOpen);
  if(envSubmenu)envSubmenu.classList.toggle('open',isEnvOpen);

  const keysToggle=document.getElementById('keysMenuToggle'),keysSubmenu=document.getElementById('submenu-keys'),keysArrow=keysToggle?.querySelector('.menu-arrow'),isKeysOpen=S.activeMenu==='chaves';
  if(keysToggle)keysToggle.setAttribute('aria-expanded',String(isKeysOpen));
  if(keysArrow)keysArrow.classList.toggle('open',isKeysOpen);
  if(keysSubmenu)keysSubmenu.classList.toggle('open',isKeysOpen);
}
function renderSidebarMenu(){
  const operator=hasProfile(S.user,'Operador'),
        p=getRightsForUser(S.user),
        canManageK=canManageKeys(S.user),
        occActive=['occ-register','occ-history','occ-validation','occ-apuracao','ocorrencias'].includes(S.page),
        isOccOpen=S.activeMenu==='ocorrencias',
        envActive=['inspecao-veicular','hist-inspecoes'].includes(S.page),
        isEnvOpen=S.activeMenu==='meio-ambiente',
        keysActive=['chaves','chaves-cautela','chaves-cadastro'].includes(S.page),
        isKeysOpen=S.activeMenu==='chaves';

  const keysSubmenuHtml=`<button type="button" id="keysMenuToggle" class="menu-btn menu-parent ${keysActive?'active':''}" aria-expanded="${isKeysOpen}" aria-controls="submenu-keys" aria-haspopup="true"><span>Chaves</span><span class="menu-arrow ${isKeysOpen?'open':''}" aria-hidden="true">▾</span></button><div id="submenu-keys" class="submenu ${isKeysOpen?'open':''}" role="region" aria-labelledby="keysMenuToggle">${canManageK?`<button type="button" class="submenu-btn ${S.page==='chaves-cadastro'?'active':''}" data-page="chaves-cadastro" data-parent-menu="chaves" ${S.page==='chaves-cadastro'?'aria-current="page"':''}><span aria-hidden="true">📋</span> Cadastro de Chaves</button>`:''}<button type="button" class="submenu-btn ${['chaves','chaves-cautela'].includes(S.page)?'active':''}" data-page="chaves-cautela" data-parent-menu="chaves" ${['chaves','chaves-cautela'].includes(S.page)?'aria-current="page"':''}><span aria-hidden="true">🔑</span> Cautela de Chaves</button></div>`;

  if(operator){
    return `<button type="button" id="occurrencesMenuToggle" class="menu-btn menu-parent ${occActive?'active':''}" aria-expanded="${isOccOpen}" aria-controls="submenu-occurrences" aria-haspopup="true"><span>Ocorrências</span><span class="menu-arrow ${isOccOpen?'open':''}" aria-hidden="true">▾</span></button><div id="submenu-occurrences" class="submenu ${isOccOpen?'open':''}" role="region" aria-labelledby="occurrencesMenuToggle"><button type="button" class="submenu-btn ${S.page==='occ-register'?'active':''}" data-page="occ-register" data-parent-menu="ocorrencias" ${S.page==='occ-register'?'aria-current="page"':''}><span aria-hidden="true">＋</span> Registrar Ocorrência</button></div><button type="button" id="environmentMenuToggle" class="menu-btn menu-parent ${envActive?'active':''}" aria-expanded="${isEnvOpen}" aria-controls="submenu-environment" aria-haspopup="true"><span>Meio Ambiente</span><span class="menu-arrow ${isEnvOpen?'open':''}" aria-hidden="true">▾</span></button><div id="submenu-environment" class="submenu ${isEnvOpen?'open':''}" role="region" aria-labelledby="environmentMenuToggle"><button type="button" class="submenu-btn ${S.page==='inspecao-veicular'?'active':''}" data-page="inspecao-veicular" data-parent-menu="meio-ambiente" ${S.page==='inspecao-veicular'?'aria-current="page"':''}><span aria-hidden="true">◔</span> Inspeção Veicular</button><button type="button" class="submenu-btn ${S.page==='hist-inspecoes'?'active':''}" data-page="hist-inspecoes" data-parent-menu="meio-ambiente" ${S.page==='hist-inspecoes'?'aria-current="page"':''}><span aria-hidden="true">◷</span> Histórico de Inspeções</button></div>${keysSubmenuHtml}<button type="button" id="logout" class="menu-btn">Sair</button>`;
  }

  const items=[
    `<button type="button" class="menu-btn ${S.page==='dashboard'?'active':''}" data-page="dashboard" ${S.page==='dashboard'?'aria-current="page"':''}>Dashboard</button>`,
    `<button type="button" id="occurrencesMenuToggle" class="menu-btn menu-parent ${occActive?'active':''}" aria-expanded="${isOccOpen}" aria-controls="submenu-occurrences" aria-haspopup="true"><span>Ocorrências</span><span class="menu-arrow ${isOccOpen?'open':''}" aria-hidden="true">▾</span></button>`,
    `<div id="submenu-occurrences" class="submenu ${isOccOpen?'open':''}" role="region" aria-labelledby="occurrencesMenuToggle"><button type="button" class="submenu-btn ${S.page==='occ-register'?'active':''}" data-page="occ-register" data-parent-menu="ocorrencias" ${S.page==='occ-register'?'aria-current="page"':''}><span aria-hidden="true">＋</span> Registrar Ocorrência</button><button type="button" class="submenu-btn ${['occ-history','ocorrencias'].includes(S.page)?'active':''}" data-page="occ-history" data-parent-menu="ocorrencias" ${['occ-history','ocorrencias'].includes(S.page)?'aria-current="page"':''}><span aria-hidden="true">◷</span> Histórico de Ocorrências</button><button type="button" class="submenu-btn ${S.page==='occ-validation'?'active':''}" data-page="occ-validation" data-parent-menu="ocorrencias" ${S.page==='occ-validation'?'aria-current="page"':''}><span aria-hidden="true">✓</span> Validação de Ocorrências</button><button type="button" class="submenu-btn ${S.page==='occ-apuracao'?'active':''}" data-page="occ-apuracao" data-parent-menu="ocorrencias" ${S.page==='occ-apuracao'?'aria-current="page"':''}><span aria-hidden="true">🔍</span> Apuração de Ocorrências</button></div>`,
    `<button type="button" id="environmentMenuToggle" class="menu-btn menu-parent ${envActive?'active':''}" aria-expanded="${isEnvOpen}" aria-controls="submenu-environment" aria-haspopup="true"><span>Meio Ambiente</span><span class="menu-arrow ${isEnvOpen?'open':''}" aria-hidden="true">▾</span></button>`,
    `<div id="submenu-environment" class="submenu ${isEnvOpen?'open':''}" role="region" aria-labelledby="environmentMenuToggle"><button type="button" class="submenu-btn ${S.page==='inspecao-veicular'?'active':''}" data-page="inspecao-veicular" data-parent-menu="meio-ambiente" ${S.page==='inspecao-veicular'?'aria-current="page"':''}><span aria-hidden="true">◔</span> Inspeção Veicular</button><button type="button" class="submenu-btn ${S.page==='hist-inspecoes'?'active':''}" data-page="hist-inspecoes" data-parent-menu="meio-ambiente" ${S.page==='hist-inspecoes'?'aria-current="page"':''}><span aria-hidden="true">◷</span> Histórico de Inspeções</button></div>`,
    keysSubmenuHtml,
    p.reports?`<button type="button" class="menu-btn ${S.page==='relatorios'?'active':''}" data-page="relatorios" ${S.page==='relatorios'?'aria-current="page"':''}>Relatórios</button>`:'',
    p.users?`<button type="button" class="menu-btn ${S.page==='usuarios'?'active':''}" data-page="usuarios" ${S.page==='usuarios'?'aria-current="page"':''}>Usuários</button>`:'',
    p.audit?`<button type="button" class="menu-btn ${S.page==='auditoria'?'active':''}" data-page="auditoria" ${S.page==='auditoria'?'aria-current="page"':''}>Auditoria</button>`:'',
    `<button type="button" class="menu-btn ${S.page==='configuracoes'?'active':''}" data-page="configuracoes" ${S.page==='configuracoes'?'aria-current="page"':''}>Configurações</button>`,
    `<button type="button" id="logout" class="menu-btn">Sair</button>`
  ];
  return items.filter(Boolean).join('');
}
function shell(){
  if(!canAccessPage(S.page)){
    S.page='occ-register';
    S.editing=S.editing||{};
    S.modal=null;
    S.successPopup=null;
    S.errorPopup=null;
    S.accessDenied=true;
  }
  if(S.page==='occ-register'&&(!S.editing||(!S.editing.id_ocorrencia&&!S.editing.numero_protocolo&&!S.reservingProtocol&&!_openOccRegPromise))){
    const stored=loadStoredActiveReservation(S.user?.login||'');
    if(stored?.numeroProtocolo){
      S.editing={...(S.occurrenceDraft||{}),...(S.editing||{}),numero_protocolo:stored.numeroProtocolo,_reservedProtocol:stored.numeroProtocolo,_reservationId:stored.reservationId||'',_reservationConfirmed:true,_clientId:getTabSessionClientId()};
    }else{
      S.reservingProtocol=true;
    }
    setTimeout(()=>{
      if(S.page==='occ-register'&&!S.editing?.id_ocorrencia){
        void ensureActiveProtocolReservation({forceNew:false,preserveForm:true});
      }
    },0);
  }
  const operator=hasProfile(S.user,'Operador');
  let body=S.page==='dashboard'?dashboard():
    S.page==='occ-register'?occForm():
    S.page==='occ-validation'?pendingValidationPage():
    S.page==='occ-apuracao'?apuracaoOccurrencesPage():
    ['occ-history','ocorrencias'].includes(S.page)?occurrenceHistoryPage():
    S.page==='inspecao-veicular'?ambientalFormPage():
    S.page==='hist-inspecoes'?ambientalHistoryPage():
    ['chaves','chaves-cautela','chaves-cadastro'].includes(S.page)?keysPage():
    S.page==='usuarios'?usersPage():
    S.page==='auditoria'?auditPage():
    S.page==='relatorios'?reportsPage():
    settingsPage();

  return `<div class="shell"><aside class="sidebar" aria-label="Navegação lateral do sistema"><div class="brand">🛡️ SIGESP</div><nav class="menu" aria-label="Menu principal">${renderSidebarMenu()}</nav></aside><main class="main"><header class="topbar"><div style="display:flex;align-items:center;gap:10px"><button type="button" id="topbarFolderBadge" class="btn" style="padding:5px 10px;font-size:12px;display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;color:#047857;border-color:#a7f3d0" title="Pasta de dados ativa. Clique para gerenciar ou selecionar outra."><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#16a34a"></span><b>Pasta: ${esc(S.dir?.name||'dados')}</b></button><b>${esc(S.user.nome)} · ${esc(S.user.perfil)}</b></div><div style="display:flex;align-items:center;gap:10px"><div class="sync-status-badge" id="syncStatusBadge" title="Sincronização em segundo plano ativa"><span class="sync-pulse-dot" aria-hidden="true"></span><span id="syncStatusText">Sincronizado às ${formatSyncTime()}</span></div>${operator?'':'<button id="refresh" class="btn">Atualizar</button>'}</div></header><section class="content">${alert()}${body}</section></main>${modal()}${validationModal()}${apuracaoModal()}${deletePendingAlertDialog()}${deleteRecordAlertDialog()}${keyWithdrawModal()}${keyReturnModal()}${keyHistoryModal()}${toastContainer()}${userPasswordModal()}${userRemovalModal()}${userFormModal()}${successModal()}${errorModal()}${settingsMasterEditor()}${masterConfirmationModal()}${S.viewUrl?`<div class="viewer"><button id="closeViewer">×</button><img src="${S.viewUrl}"></div>`:''}</div>${accessDeniedModal()}${folderSelectionModal()}`
}
let _searchDebounceTimer=null;
function scheduleSearchRender(delay=300){if(_searchDebounceTimer)clearTimeout(_searchDebounceTimer);_searchDebounceTimer=setTimeout(()=>{_searchDebounceTimer=null;render()},delay)}
function render(){if(_searchDebounceTimer){clearTimeout(_searchDebounceTimer);_searchDebounceTimer=null}if(S.apuracaoModal&&typeof syncApuracaoFormState==='function')syncApuracaoFormState();const active=document.activeElement,focusId=active&&app.contains(active)?active.id:'',selStart=typeof active?.selectionStart==='number'?active.selectionStart:null,selEnd=typeof active?.selectionEnd==='number'?active.selectionEnd:null;app.innerHTML=S.restoring?restoringV():S.permissionNeeded?permissionV():!S.dir?connectV():!S.user?loginV():shell();bind();renderToastPortal();if(focusId){const nextEl=document.getElementById(focusId);if(nextEl){nextEl.focus();if(selStart!==null&&typeof nextEl.setSelectionRange==='function'){try{nextEl.setSelectionRange(selStart,selEnd??selStart)}catch{}}}}}
function download(name,rows,h){const u=URL.createObjectURL(new Blob([csv(rows,h)],{type:'text/csv'})),a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)}
function preserveOccurrenceDraftOnLeave(){
  if(S.page==='occ-register'&&S.editing&&!S.editing.id_ocorrencia){
    const formEl=document.getElementById('occForm');
    if(formEl)captureOccurrenceDraft(formEl);
    const copy={...S.editing};
    delete copy.id_ocorrencia;
    S.occurrenceDraft=copy;
  }else{
    cleanup();
  }
}
function bind(){
  const handleVinculoChange=e=>{
    const form=e.target.form||e.target.closest('form');
    if(!form)return;
    captureOccurrenceDraft(form);
    const isValidation=form.id==='validationOccForm',targetState=isValidation?S.validationModal:S.editing;
    if(!targetState)return;
    const newVal=e.target.value;
    targetState.tipo_vinculo=newVal;
    if(newVal==='Grupo CSN'){
      targetState.documento='';
      if(!targetState.empresa_envolvido)targetState.empresa_envolvido='Grupo CSN';
    }else{
      targetState.gerencia_envolvido='';
      targetState.gerencia='';
      targetState.gerencia_geral='';
      targetState.diretoria='';
      targetState.matricula_id='';
    }
    render();
  };

  document.getElementById('select')?.addEventListener('click',selectFolder);
  document.getElementById('selectNative')?.addEventListener('click',pickFolderWithPicker);
  document.getElementById('changeFolderBtn')?.addEventListener('click',changeFolderFallback);
  document.getElementById('selectAuto')?.addEventListener('click',()=>connectDataFolder(false));
  document.getElementById('selectManual')?.addEventListener('click',pickFolderWithPicker);
  document.getElementById('openFolderSelector')?.addEventListener('click',selectFolder);
  document.getElementById('changeFolderLogin')?.addEventListener('click',selectFolder);
  document.getElementById('topbarFolderBadge')?.addEventListener('click',selectFolder);
  document.getElementById('selectFolderSettings')?.addEventListener('click',selectFolder);
  document.getElementById('cancelFolderModal')?.addEventListener('click',()=>{S.folderModal=false;render()});
  document.querySelectorAll('.cancelFolderModal').forEach(b=>b.onclick=()=>{S.folderModal=false;render()});
  document.getElementById('chooseAutoFolder')?.addEventListener('click',()=>{S.folderModal=false;void connectDataFolder(false)});
  document.getElementById('chooseNativeFolder')?.addEventListener('click',pickFolderWithPicker);
  const bindFileInputGuard=el=>{
    if(!el)return;
    el.addEventListener('click',()=>markFilePickerOpening());
    el.addEventListener('cancel',()=>markFilePickerClosed(800));
  };
  const folderPickerEl=document.getElementById('folderPickerInput');
  bindFileInputGuard(folderPickerEl);
  folderPickerEl?.addEventListener('change',e=>{markFilePickerClosed(2000);const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void handleDirectoryInput(files)});
  const folderDirectEl=document.getElementById('folderInputDirect');
  bindFileInputGuard(folderDirectEl);
  folderDirectEl?.addEventListener('change',e=>{markFilePickerClosed(2000);const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void handleDirectoryInput(files)});
  document.getElementById('authorize')?.addEventListener('click',authorizeSaved);
  document.getElementById('forget')?.addEventListener('click',forgetFolder);
  document.getElementById('login')?.addEventListener('submit',login);
  document.getElementById('logout')?.addEventListener('click',logout);
  document.getElementById('refresh')?.addEventListener('click',handleManualRefresh);

  document.querySelectorAll('.menu-btn[data-page]').forEach(b=>b.onclick=async()=>{
    preserveOccurrenceDraftOnLeave();
    S.editing=null;
    S.modal=null;
    S.query='';
    S.currentPage=1;
    S.activeMenu=null;
    S.page=b.dataset.page;
    if(b.dataset.page==='occ-register'){
      await openOccurrenceRegistration({forceNew:false});
    }else if(b.dataset.page==='chaves'){
      S.keysTab='cautela';
      render();
    }else{
      render();
    }
  });

  document.getElementById('occurrencesMenuToggle')?.addEventListener('click',()=>toggleSidebarMenu('ocorrencias'));
  document.getElementById('environmentMenuToggle')?.addEventListener('click',()=>toggleSidebarMenu('meio-ambiente'));
  document.getElementById('keysMenuToggle')?.addEventListener('click',()=>toggleSidebarMenu('chaves'));

  document.querySelectorAll('.submenu-btn[data-page]').forEach(b=>b.onclick=async()=>{
    if(S.page==='occ-register'&&b.dataset.page!=='occ-register')preserveOccurrenceDraftOnLeave();
    else if(S.page!=='occ-register')cleanup();
    S.modal=null;
    S.query='';
    S.currentPage=1;
    const parent=b.dataset.parentMenu||(['occ-register','occ-history','occ-validation','occ-apuracao','ocorrencias'].includes(b.dataset.page)?'ocorrencias':['inspecao-veicular','hist-inspecoes'].includes(b.dataset.page)?'meio-ambiente':'chaves');
    S.activeMenu=parent;
    S.page=b.dataset.page;
    if(b.dataset.page==='chaves-cadastro'){
      if(!canManageKeys(S.user)){S.accessDenied=true;render();return;}
      S.keysTab='cadastro';
    }else if(b.dataset.page==='chaves-cautela'||b.dataset.page==='chaves'){
      S.keysTab='cautela';
    }
    if(b.dataset.page==='occ-register'){
      await openOccurrenceRegistration({forceNew:false});
    }else{
      S.editing=null;
      render();
    }
  });

  // Eventos das Abas e Ações de Chaves
  document.getElementById('tabCautela')?.addEventListener('click',()=>{
    S.keysTab='cautela';
    if(S.page==='chaves-cadastro')S.page='chaves-cautela';
    render();
  });
  document.getElementById('tabCadastro')?.addEventListener('click',()=>{
    if(!canManageKeys(S.user)){S.accessDenied=true;render();return;}
    S.keysTab='cadastro';
    S.page='chaves-cadastro';
    render();
  });
  document.getElementById('btnGoToCadastro')?.addEventListener('click',()=>{
    if(!canManageKeys(S.user)){S.accessDenied=true;render();return;}
    S.keysTab='cadastro';
    S.page='chaves-cadastro';
    S.editing={kind:'key',data:{}};
    render();
  });
  document.getElementById('cancelKeyEdit')?.addEventListener('click',()=>{
    S.editing=null;
    render();
  });

  // Filtros de Chaves
  document.getElementById('keySearch')?.addEventListener('input',e=>{
    S.keySearchQuery=e.target.value;
    scheduleSearchRender(200);
  });
  document.getElementById('keyUnitFilter')?.addEventListener('change',e=>{
    S.keyUnitFilter=e.target.value;
    render();
  });
  document.querySelectorAll('.keys-status-btn').forEach(btn=>btn.onclick=()=>{
    S.keyStatusFilter=btn.dataset.status;
    render();
  });
  document.querySelectorAll('.keys-view-btn').forEach(btn=>btn.onclick=()=>{
    S.keyViewMode=btn.dataset.view;
    render();
  });

  // Modal de Retirada de Chave (Cautela)
  document.querySelectorAll('.promptWithdrawKey').forEach(b=>b.onclick=()=>{
    const id=b.dataset.id;
    const key=(S.keys||[]).find(x=>String(x.id_chave)===String(id));
    if(key){
      S.keyWithdrawTarget={...key};
      S.keyModalErrors={};
      render();
    }
  });
  document.querySelectorAll('.closeKeyWithdrawModal').forEach(b=>b.onclick=()=>{
    S.keyWithdrawTarget=null;
    S.keyModalErrors={};
    render();
  });
  document.getElementById('keyWithdrawForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const raw=Object.fromEntries(new FormData(form));
    const v=validateKeyWithdrawForm(raw);
    if(!v.valid){
      S.keyModalErrors=v.errors;
      if(S.keyWithdrawTarget)S.keyWithdrawTarget._draft=raw;
      render();
      return;
    }
    const submitBtn=form.querySelector('button[type="submit"]');
    if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Processando...';}
    await executeKeyWithdrawal(raw.id_chave,raw);
  });

  // Modal de Devolução de Chave
  document.querySelectorAll('.promptReturnKey').forEach(b=>b.onclick=()=>{
    const id=b.dataset.id;
    const key=(S.keys||[]).find(x=>String(x.id_chave)===String(id));
    if(key){
      S.keyReturnTarget={...key};
      S.keyModalErrors={};
      render();
    }
  });
  document.querySelectorAll('.closeKeyReturnModal').forEach(b=>b.onclick=()=>{
    S.keyReturnTarget=null;
    S.keyModalErrors={};
    render();
  });
  document.getElementById('keyReturnForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const raw=Object.fromEntries(new FormData(form));
    const v=validateKeyReturnForm(raw);
    if(!v.valid){
      S.keyModalErrors=v.errors;
      if(S.keyReturnTarget)S.keyReturnTarget._draft=raw;
      render();
      return;
    }
    const submitBtn=form.querySelector('button[type="submit"]');
    if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Processando...';}
    await executeKeyReturn(raw.id_chave,raw);
  });

  // Histórico de Movimentações da Chave
  document.querySelectorAll('.viewKeyHistory').forEach(b=>b.onclick=()=>{
    const id=b.dataset.id;
    const key=(S.keys||[]).find(x=>String(x.id_chave)===String(id));
    if(key){
      S.keyHistoryTarget=key;
      render();
    }
  });
  document.querySelectorAll('.closeKeyHistoryModal').forEach(b=>b.onclick=()=>{
    S.keyHistoryTarget=null;
    render();
  });

  document.getElementById('newOcc')?.addEventListener('click',()=>openOccurrenceRegistration({forceNew:false}));
  document.getElementById('occForm')?.addEventListener('submit',saveOcc);
  document.getElementById('occForm')?.addEventListener('input',e=>{if(S.editing?._reservedProtocol)renewProtocolHeartbeat(S.editing._reservedProtocol);if(e.target.name&&S.editing){S.editing[e.target.name]=e.target.value}});
  document.getElementById('occForm')?.addEventListener('change',e=>{if(e.target.name==='tipo_vinculo'){handleVinculoChange(e);return}if(e.target.name)captureOccurrenceDraft(e.currentTarget)});
  document.getElementById('occTipoVinculo')?.addEventListener('change',handleVinculoChange);
  document.getElementById('cancelOcc')?.addEventListener('click',async()=>{const wasEditingExisting=Boolean(S.editing?.id_ocorrencia);cleanup();S.occurrenceDraft=null;if(wasEditingExisting){S.editing=null;S.page=hasProfile(S.user,'Operador')?'occ-register':'occ-history';if(S.page==='occ-register'){await openOccurrenceRegistration({forceNew:false,clearDraft:true});}else{render();}}else{await openOccurrenceRegistration({forceNew:false,clearDraft:true});}});
  document.querySelectorAll('label.add-photo').forEach(lbl=>{
    lbl.addEventListener('click',()=>{
      markFilePickerOpening();
    });
    lbl.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        markFilePickerOpening();
        const forId=lbl.getAttribute('for');
        if(forId)document.getElementById(forId)?.click();
      }
    });
  });
  document.querySelectorAll('input.photoFileInput, #photos, #valPhotos').forEach(pInput=>{
    bindFileInputGuard(pInput);
    pInput.addEventListener('change',x=>{
      markFilePickerClosed(2500);
      const files=Array.from(x.target.files||[]);
      x.target.value='';
      if(files.length)void choose(files);
    });
    pInput.addEventListener('cancel',()=>{
      markFilePickerClosed(1000);
    });
  });
  document.querySelectorAll('.removeNew').forEach(b=>b.onclick=()=>{captureOccurrenceDraft();const i=+b.dataset.i;URL.revokeObjectURL(S.newPhotos[i].url);S.newPhotos.splice(i,1);render()});
  document.querySelectorAll('.removeOld').forEach(b=>b.onclick=()=>{captureOccurrenceDraft();const i=+b.dataset.i,p=S.existing[i];S.removed.push(p.path);if(p.url)URL.revokeObjectURL(p.url);S.existing.splice(i,1);render()});
  document.querySelectorAll('.zoom').forEach(b=>b.onclick=()=>{S.viewUrl=b.dataset.url;render()});
  document.getElementById('closeViewer')?.addEventListener('click',()=>{S.viewUrl=null;render()});
  document.querySelector('.viewer')?.addEventListener('click',e=>{if(e.target.classList.contains('viewer')){S.viewUrl=null;render()}});
  document.getElementById('search')?.addEventListener('input',x=>{S.query=x.target.value;S.currentPage=1;scheduleSearchRender(300)});
  document.getElementById('prevPage')?.addEventListener('click',()=>{if(S.currentPage>1){S.currentPage--;render()}});
  document.getElementById('nextPage')?.addEventListener('click',()=>{if(S.currentPage<occurrenceTotalPages()){S.currentPage++;render()}});
  document.getElementById('historyRegisterOccurrence')?.addEventListener('click',()=>openOccurrenceRegistration({forceNew:false}));
  const updateHistoryFilter=(key,value,debounced=false)=>{S.historyFilters={...S.historyFilters,[key]:value};S.currentPage=1;if(debounced)scheduleSearchRender(300);else render()};
  document.getElementById('historyDateFrom')?.addEventListener('change',e=>updateHistoryFilter('dateFrom',e.target.value));
  document.getElementById('historyDateTo')?.addEventListener('change',e=>updateHistoryFilter('dateTo',e.target.value));
  document.getElementById('historyNature')?.addEventListener('change',e=>updateHistoryFilter('nature',e.target.value));
  document.getElementById('historyProtocol')?.addEventListener('input',e=>updateHistoryFilter('protocol',e.target.value,true));
  document.getElementById('historyGeneral')?.addEventListener('input',e=>updateHistoryFilter('general',e.target.value,true));
  document.getElementById('clearHistoryFilters')?.addEventListener('click',()=>{S.historyFilters={dateFrom:'',dateTo:'',nature:'',protocol:'',general:''};S.currentPage=1;render()});
  document.getElementById('historyFirst')?.addEventListener('click',()=>{S.currentPage=1;render()});
  document.getElementById('historyPrev')?.addEventListener('click',()=>{if(S.currentPage>1){S.currentPage--;render()}});
  document.getElementById('historyNext')?.addEventListener('click',()=>{if(S.currentPage<occurrenceHistoryTotalPages()){S.currentPage++;render()}});
  document.getElementById('historyLast')?.addEventListener('click',()=>{S.currentPage=occurrenceHistoryTotalPages();render()});
  document.querySelectorAll('.pdfOcc').forEach(b=>b.onclick=()=>generateOccurrencePdf(b.dataset.id));
  document.querySelectorAll('.pdfApuracao').forEach(b=>b.onclick=()=>generateApuracaoPdf(b.dataset.id));
  document.querySelectorAll('.exportApuracaoPdfModal').forEach(b=>b.onclick=()=>generateApuracaoPdf(b.dataset.id));
  document.querySelectorAll('.viewOcc').forEach(b=>b.onclick=()=>viewOcc(b.dataset.id));
  document.querySelectorAll('.editOcc').forEach(b=>b.onclick=()=>editOcc(b.dataset.id));
  document.querySelectorAll('.viewPendingOcc').forEach(b=>b.onclick=()=>viewPendingOcc(b.dataset.id));
  document.querySelectorAll('.validatePendingOcc').forEach(b=>b.onclick=()=>validatePendingOcc(b.dataset.id));
  document.querySelectorAll('.openValidationModal').forEach(b=>b.onclick=()=>openValidationModal(b.dataset.id));
  document.querySelectorAll('.promptDeletePending').forEach(b=>b.onclick=()=>{S.deletePendingTarget={id:b.dataset.id,protocol:b.dataset.protocol,unit:b.dataset.unit};render()});
  document.getElementById('cancelDeletePending')?.addEventListener('click',()=>{S.deletePendingTarget=null;render()});
  document.getElementById('confirmDeletePending')?.addEventListener('click',()=>{if(S.deletePendingTarget?.id)deletePendingOcc(S.deletePendingTarget.id)});
  document.querySelectorAll('.deleteRecordPrompt').forEach(b=>b.onclick=()=>{if(!isAdministratorUser(S.user))return;S.deleteRecordTarget={modulo:b.dataset.modulo,id:b.dataset.id,code:b.dataset.code,detail:b.dataset.detail||''};render()});
  document.getElementById('cancelDeleteRecord')?.addEventListener('click',()=>{S.deleteRecordTarget=null;render()});
  document.getElementById('confirmDeleteRecord')?.addEventListener('click',executeRecordDeletion);
  document.getElementById('closeValidationModal')?.addEventListener('click',()=>{cleanup();S.validationModal=null;render()});
  document.getElementById('cancelValidationModal')?.addEventListener('click',()=>{cleanup();S.validationModal=null;render()});
  document.getElementById('validationUnidade')?.addEventListener('change',e=>{const sup=supervisionForUnit(e.target.value);const sEl=document.getElementById('validationSupervisao');if(sEl)sEl.value=sup?.nome||''});
  document.getElementById('validationOccForm')?.addEventListener('input',e=>{if(e.target.name&&S.validationModal){S.validationModal[e.target.name]=e.target.value}});
  document.getElementById('validationOccForm')?.addEventListener('change',e=>{if(e.target.name==='tipo_vinculo'){handleVinculoChange(e);return}if(e.target.name)captureOccurrenceDraft(e.currentTarget)});
  document.getElementById('validationTipoVinculo')?.addEventListener('change',handleVinculoChange);
  document.getElementById('savePendingDraftBtn')?.addEventListener('click',()=>{const form=document.getElementById('validationOccForm');if(form)savePendingDraft(form)});
  document.getElementById('confirmValidationModal')?.addEventListener('click',()=>{const form=document.getElementById('validationOccForm');if(form){if(!form.reportValidity())return;const id=form.elements['id_ocorrencia']?.value;validatePendingOcc(id,form)}});
  document.getElementById('validationOccForm')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;const id=form.elements['id_ocorrencia']?.value;validatePendingOcc(id,form)});

  // Módulo de Apuração de Ocorrências
  document.querySelectorAll('.openApuracaoModal').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.id;
    const occ=(S.occ||[]).find(x=>String(x.id_ocorrencia)===String(id)||String(x.id_interno)===String(id)||String(x.numero_protocolo)===String(id));
    if(occ){
      const existingPdfs=String(occ.anexos_referencias||'').split('|').map(p=>p.trim()).filter(p=>p&&/\.pdf$/i.test(p)).map(p=>({path:p,name:p.split('/').pop()}));
      S.apuracaoExistingPdfs=existingPdfs;
      S.apuracaoNewPdfs=[];
      S.apuracaoModal={...occ};
      await loadApuracaoPhotos(occ);
      render();
    }
  });
  document.querySelectorAll('.closeApuracaoModal').forEach(b=>b.onclick=()=>{
    if(S.apuracaoPhotos&&S.apuracaoPhotos.length){
      S.apuracaoPhotos.forEach(p=>p.url&&URL.revokeObjectURL(p.url));
      S.apuracaoPhotos=[];
    }
    S.apuracaoModal=null;
    S.apuracaoNewPdfs=[];
    S.apuracaoExistingPdfs=[];
    render();
  });
  const apuracaoPdfEl=document.getElementById('apuracaoPdfInput');
  bindFileInputGuard(apuracaoPdfEl);
  document.getElementById('btnChooseApuracaoPdf')?.addEventListener('click',e=>{
    e.preventDefault();
    if(isFilePickerBlockingSync()||Date.now()-(_filePickerOpenedAt||0)<600)return;
    syncApuracaoFormState();
    markFilePickerOpening();
    apuracaoPdfEl?.click();
  });
  apuracaoPdfEl?.addEventListener('cancel',()=>{
    markFilePickerClosed(1000);
  });
  apuracaoPdfEl?.addEventListener('change',e=>{
    markFilePickerClosed(1200);
    syncApuracaoFormState();
    const files=Array.from(e.target.files||[]);
    if(!files.length)return;
    const curTotal=(S.apuracaoExistingPdfs?.length||0)+(S.apuracaoNewPdfs?.length||0);
    const space=3-curTotal;
    if(space<=0){
      showToast('Limite máximo de 3 PDFs por ocorrência já atingido.','error','Limite de Anexos');
      e.target.value='';
      return;
    }
    const pdfFiles=files.filter(f=>f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'));
    if(pdfFiles.length<files.length){
      showToast('Apenas arquivos no formato PDF são permitidos neste módulo.','error','Formato Inválido');
    }
    if(!pdfFiles.length){
      e.target.value='';
      return;
    }
    const toAdd=pdfFiles.slice(0,space);
    if(pdfFiles.length>space){
      showToast(`Apenas ${space} arquivo(s) foram adicionados para respeitar o limite de 3 PDFs.`,'warning','Limite de Anexos');
    }
    for(const f of toAdd){
      S.apuracaoNewPdfs.push({
        file:f,
        name:f.name,
        size:f.size
      });
    }
    e.target.value='';
    render();
  });
  document.querySelectorAll('.removeNewApuracaoPdf').forEach(b=>b.onclick=()=>{
    syncApuracaoFormState();
    const idx=+b.dataset.idx;
    if(!isNaN(idx)){
      S.apuracaoNewPdfs.splice(idx,1);
      render();
    }
  });
  document.querySelectorAll('.removeExistingApuracaoPdf').forEach(b=>b.onclick=()=>{
    syncApuracaoFormState();
    const idx=+b.dataset.idx;
    if(!isNaN(idx)){
      S.apuracaoExistingPdfs.splice(idx,1);
      render();
    }
  });
  document.querySelectorAll('.downloadApuracaoPdf').forEach(b=>b.onclick=()=>{
    const path=b.dataset.path;
    if(path)downloadApuracaoPdf(path);
  });
  document.getElementById('apuracaoForm')?.addEventListener('input',()=>syncApuracaoFormState());
  document.getElementById('apuracaoForm')?.addEventListener('change',()=>syncApuracaoFormState());
  document.getElementById('apuracaoForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    syncApuracaoFormState();
    const form=e.currentTarget;
    const id=form.elements['id_ocorrencia']?.value;
    if(id){
      await saveApuracao(id,form);
    }
  });
  const updateApuracaoFilter=(key,value,debounced=false)=>{
    S.apuracaoFilters={...S.apuracaoFilters,[key]:value};
    S.apuracaoCurrentPage=1;
    if(debounced)scheduleSearchRender(300);else render();
  };
  document.getElementById('apuracaoDateFrom')?.addEventListener('change',e=>updateApuracaoFilter('dateFrom',e.target.value));
  document.getElementById('apuracaoDateTo')?.addEventListener('change',e=>updateApuracaoFilter('dateTo',e.target.value));
  document.getElementById('apuracaoPriority')?.addEventListener('change',e=>updateApuracaoFilter('priority',e.target.value));
  document.getElementById('apuracaoStatus')?.addEventListener('change',e=>updateApuracaoFilter('status',e.target.value));
  document.getElementById('apuracaoNature')?.addEventListener('change',e=>updateApuracaoFilter('nature',e.target.value));
  document.getElementById('apuracaoGeneral')?.addEventListener('input',e=>updateApuracaoFilter('general',e.target.value,true));
  document.getElementById('clearApuracaoFilters')?.addEventListener('click',()=>{
    S.apuracaoFilters={dateFrom:'',dateTo:'',priority:'',status:'',nature:'',general:''};
    S.apuracaoCurrentPage=1;
    render();
  });
  document.getElementById('apuracaoPrev')?.addEventListener('click',()=>{
    if(S.apuracaoCurrentPage>1){
      S.apuracaoCurrentPage--;
      render();
    }
  });
  document.getElementById('apuracaoNext')?.addEventListener('click',()=>{
    if(S.apuracaoCurrentPage<apuracaoTotalPages()){
      S.apuracaoCurrentPage++;
      render();
    }
  });

  document.getElementById('closeToast')?.addEventListener('click',()=>{S.toast=null;render()});
  document.getElementById('closeModal')?.addEventListener('click',()=>{cleanup();S.modal=null;render()});
  const handleAmbientalConditional=(form,val)=>{const isSim=String(val||'Sim').trim()==='Sim';if(S.editing?.kind==='ambiental'&&S.editing.data){S.editing.data.realizar_monitoramento=isSim?'Sim':'Não'}const secVeiculo=form.querySelector('#secVeiculo');const secNaoExecucao=form.querySelector('#secNaoExecucao');const motivoEl=form.querySelector('[name="motivo_nao_execucao"]');if(secVeiculo){secVeiculo.style.display=isSim?'block':'none';secVeiculo.querySelectorAll('input, select, textarea').forEach(el=>{el.disabled=!isSim;el.required=isSim;if(!isSim)el.value=''})}if(secNaoExecucao){secNaoExecucao.style.display=isSim?'none':'block'}if(motivoEl){motivoEl.disabled=isSim;motivoEl.required=!isSim;if(isSim){motivoEl.value=''}else{setTimeout(()=>{try{motivoEl.focus()}catch{}},30)}}};
  const ambFormEl=document.getElementById('ambientalForm');if(ambFormEl){ambFormEl.addEventListener('change',e=>{if(e.target.name==='realizar_monitoramento')handleAmbientalConditional(ambFormEl,e.target.value)});ambFormEl.addEventListener('input',e=>{if(e.target.name==='realizar_monitoramento')handleAmbientalConditional(ambFormEl,e.target.value)});ambFormEl.addEventListener('submit',saveAmbientalInspection)}
  document.querySelectorAll('.ambiental-new').forEach(b=>b.onclick=()=>{const loggedNome=S.user?.nome||'';const loggedMatricula=String(S.user?.matricula||S.user?.id_usuario||S.user?.login||'').trim();const responsavel=loggedMatricula?`${loggedNome} (${loggedMatricula})`:loggedNome;S.editing={kind:'ambiental',data:{realizar_monitoramento:'Sim',responsavel,matricula_responsavel:loggedMatricula,responsavel_nome:loggedNome}};S.page='inspecao-veicular';S.activeMenu='meio-ambiente';render()});
  document.querySelectorAll('.viewAmbiental').forEach(b=>b.onclick=()=>{const record=(S.inspecoes||[]).find(x=>String(x.id)===String(b.dataset.id));if(record){S.modal={kind:'ambiental',data:record};render()}});
  document.querySelectorAll('.editAmbiental').forEach(b=>b.onclick=()=>{const record=(S.inspecoes||[]).find(x=>String(x.id)===String(b.dataset.id));if(record){S.editing={kind:'ambiental',data:record};S.page='inspecao-veicular';S.activeMenu='meio-ambiente';render()}});
  document.getElementById('ambientalPrev')?.addEventListener('click',()=>{if(S.currentPage>1){S.currentPage--;render()}});
  document.getElementById('ambientalNext')?.addEventListener('click',()=>{if(S.currentPage<ambientalHistoryTotalPages()){S.currentPage++;render()}});
  document.getElementById('clearAmbientalFilters')?.addEventListener('click',()=>{S.ambientalFilters={dateFrom:'',dateTo:'',placa:'',transportadora:'',realizado:'',laudo:'',responsavel:'',unidade:'',supervisao:'',general:''};S.currentPage=1;render()});
  document.getElementById('ambientalDateFrom')?.addEventListener('change',e=>{S.ambientalFilters={...S.ambientalFilters,dateFrom:e.target.value};S.currentPage=1;render()});
  document.getElementById('ambientalDateTo')?.addEventListener('change',e=>{S.ambientalFilters={...S.ambientalFilters,dateTo:e.target.value};S.currentPage=1;render()});
  document.getElementById('ambientalPlaca')?.addEventListener('input',e=>{S.ambientalFilters={...S.ambientalFilters,placa:e.target.value};S.currentPage=1;scheduleSearchRender(300)});
  document.getElementById('ambientalTransportadora')?.addEventListener('input',e=>{S.ambientalFilters={...S.ambientalFilters,transportadora:e.target.value};S.currentPage=1;scheduleSearchRender(300)});
  document.getElementById('ambientalRealizado')?.addEventListener('change',e=>{S.ambientalFilters={...S.ambientalFilters,realizado:e.target.value};S.currentPage=1;render()});
  document.getElementById('ambientalLaudo')?.addEventListener('change',e=>{S.ambientalFilters={...S.ambientalFilters,laudo:e.target.value};S.currentPage=1;render()});
  document.getElementById('ambientalResponsavel')?.addEventListener('input',e=>{S.ambientalFilters={...S.ambientalFilters,responsavel:e.target.value};S.currentPage=1;scheduleSearchRender(300)});
  document.getElementById('ambientalUnidade')?.addEventListener('change',e=>{S.ambientalFilters={...S.ambientalFilters,unidade:e.target.value};S.currentPage=1;render()});
  document.getElementById('ambientalSupervisao')?.addEventListener('change',e=>{S.ambientalFilters={...S.ambientalFilters,supervisao:e.target.value};S.currentPage=1;render()});
  document.getElementById('ambientalGeneral')?.addEventListener('input',e=>{S.ambientalFilters={...S.ambientalFilters,general:e.target.value};S.currentPage=1;scheduleSearchRender(300)});
  document.getElementById('userForm')?.addEventListener('submit',saveUser);
  document.getElementById('newUser')?.addEventListener('click',()=>{S.editing={kind:'user',data:{}};S.userModalTab='geral';render()});
  document.getElementById('cancelUser')?.addEventListener('click',()=>{S.editing=null;render()});
  document.querySelectorAll('.closeUserModal').forEach(b=>b.onclick=()=>{S.editing=null;render()});
  document.querySelectorAll('.user-tab-btn[data-usertab]').forEach(b=>b.onclick=()=>{
    S.userModalTab=b.dataset.usertab;
    render();
  });

  document.getElementById('userSearchInput')?.addEventListener('input',e=>{
    S.userSearchQuery=e.target.value;
    scheduleSearchRender(250);
  });
  document.getElementById('userProfileFilter')?.addEventListener('change',e=>{
    S.userProfileFilter=e.target.value;
    render();
  });
  document.querySelectorAll('.users-status-btn[data-userstatus]').forEach(b=>b.onclick=()=>{
    S.userStatusFilter=b.dataset.userstatus;
    render();
  });
  document.querySelectorAll('.users-view-btn[data-userview]').forEach(b=>b.onclick=()=>{
    S.userViewMode=b.dataset.userview;
    render();
  });

  document.querySelectorAll('.editUser').forEach(b=>b.onclick=()=>{
    S.editing={kind:'user',data:S.users.find(x=>x.id_usuario===b.dataset.id)};
    S.userModalTab='geral';
    render();
  });
  document.querySelectorAll('.toggleUser').forEach(b=>b.onclick=()=>toggleUser(b.dataset.id));
  document.getElementById('closeSuccess')?.addEventListener('click',async()=>{const kind=S.successPopup?.kind;S.successPopup=null;S.editing=null;const isOp=hasProfile(S.user,'Operador');S.page=isOp?'occ-register':(kind==='pending'?'occ-validation':'occ-history');S.activeMenu=isOp?'ocorrencias':null;if(isOp){await openOccurrenceRegistration({forceNew:true,clearDraft:true});}else{render();}});
  document.getElementById('newSuccessOccurrence')?.addEventListener('click',()=>openOccurrenceRegistration({forceNew:true,clearDraft:true}));
  document.getElementById('viewSuccessOccurrence')?.addEventListener('click',async()=>{const id=S.successPopup?.idOcorrencia;const isPending=S.successPopup?.kind==='pending';S.successPopup=null;if(hasProfile(S.user,'Operador')){if(id){try{const r=await findAuthorizedOccurrence(id,isPending);S.editing=null;await loadImages(r);S.modal={...r};render();return}catch(err){console.warn('Falha ao abrir ocorrência do operador:',err);fail('Registro não encontrado ou sem autorização para acessá-lo.');return}}await openOccurrenceRegistration({forceNew:true,clearDraft:true});return}const kind=isPending?'pending':'official';S.editing=null;S.page=kind==='pending'?'occ-validation':'occ-history';S.activeMenu='ocorrencias';if(id){if(kind==='pending')await viewPendingOcc(id);else await viewOcc(id)}else render()});
  document.getElementById('copyProtocol')?.addEventListener('click',async()=>{const protocol=S.successPopup?.protocolo;if(!protocol)return;try{await navigator.clipboard.writeText(protocol);S.message='Protocolo copiado.'}catch{S.message='Não foi possível copiar automaticamente.'}render()});
  document.getElementById('closeError')?.addEventListener('click',()=>{S.errorPopup=null;render()});
  document.getElementById('keyForm')?.addEventListener('submit',saveKey);
  document.querySelectorAll('.editKey').forEach(b=>b.onclick=()=>{S.editing={kind:'key',data:S.keys.find(x=>x.id_chave===b.dataset.id)};render()});
  document.getElementById('exportOcc')?.addEventListener('click',()=>download('ocorrencias.csv',scope(S.occ),H.occ));
  document.getElementById('exportKeys')?.addEventListener('click',()=>download('chaves.csv',scope(S.keys),H.keys));
  document.getElementById('changeFolder')?.addEventListener('click',selectFolder);
  document.getElementById('forgetFolder')?.addEventListener('click',forgetFolder);
  document.getElementById('syncServerFolder')?.addEventListener('click',()=>connectServerFolder(false));
  document.getElementById('downloadAllCsvs')?.addEventListener('click',downloadAllServerCsvs);
  const uploadCsvEl=document.getElementById('uploadCsvInput');
  bindFileInputGuard(uploadCsvEl);
  uploadCsvEl?.addEventListener('change',e=>{markFilePickerClosed(2000);const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void uploadHybridCsvFiles(files)});
  const historyImportEl=document.getElementById('historyImportCsvInput');
  bindFileInputGuard(historyImportEl);
  historyImportEl?.addEventListener('change',e=>{markFilePickerClosed(2000);const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void uploadHybridCsvFiles(files)});
  document.querySelectorAll('.downloadSingleCsv').forEach(b=>b.onclick=()=>downloadRawCsvFile(b.dataset.file));
}
if(typeof window!=='undefined'){
  setInterval(()=>{
    if(S.page==='occ-register'&&S.editing?._reservedProtocol&&!S.submitting){
      const active=S.activeReservation||loadStoredActiveReservation(S.user?.login||'');
      const clientId=S.editing?._clientId||active?.sessionId||getTabSessionClientId();
      const reservationId=S.editing?._reservationId||active?.reservationId||'';
      window.StorageService?.renewProtocol(S.editing._reservedProtocol,S.user?.login||'Operador',{clientId,reservationId}).then(res=>{
        if(res&&(res.conflict||res.expired)){
          clearStoredActiveReservation();
          void ensureActiveProtocolReservation({forceNew:true,preserveForm:true});
        }
      }).catch(()=>{});
    }
  },60000);
}
restoreFolder();
