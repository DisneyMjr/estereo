'use strict'

const settingsPanel = document.querySelector('#settings-panel')
const preferenceKey = 'estereo-preferences-'+localStorage.getItem(profileKey)
const preferences = {similar:false,doubleClick:'play',devicePause:false,theme:'system'}
try { Object.assign(preferences,JSON.parse(localStorage.getItem(preferenceKey))) } catch {}
document.documentElement.dataset.theme = preferences.theme

const settingsGroups = [
  ['Player',[['playback','Reprodução'],['shortcuts','Atalhos'],['eq','Equalizador']]],
  ['Interface',[['appearance','Aparência']]],
  ['Aplicativo',[['storage','Cache e armazenamento'],['about','Sobre']]],
  ['Ajuda',[['help','Documentação e suporte']]]
]
const shortcuts = [
  ['Reproduzir ou pausar','Espaço'],['Próxima faixa','Ctrl + →'],['Faixa anterior','Ctrl + ←'],
  ['Avançar 5 segundos','→'],['Voltar 5 segundos','←'],['Aumentar volume','↑'],
  ['Diminuir volume','↓'],['Silenciar ou ativar som','M'],['Pesquisar música','/'],['Fila','Q'],['Exibir letras','F']
]
const externalLinks = {
  tiktok:'https://www.tiktok.com/@disneymkt',
  instagram:'https://www.instagram.com/disneymkt/',
  docs:'https://github.com/DisneyMjr/estereo#readme',
  support:'https://github.com/DisneyMjr/estereo/issues'
}
let settingsPage = 'playback'
function settingRow(title,description,control) {
  return '<div class="setting-row"><div><strong>'+title+'</strong><p>'+description+'</p></div>'+control+'</div>'
}
function toggleSetting(name,label) {
  return '<input class="setting-toggle" type="checkbox" data-preference="'+name+'" aria-label="'+label+'" '+(preferences[name]?'checked':'')+'>'
}
function settingsContent() {
  const box = content=>'<div class="setting-box">'+content+'</div>'
  if (settingsPage==='playback') return box(
    settingRow('Reproduzir faixas similares automaticamente','Busca mais faixas quando a fila termina.',toggleSetting('similar','Reproduzir faixas similares automaticamente'))+
    settingRow('Duplo clique em uma faixa','Escolha a ação para cartões e resultados de busca.',
      '<div class="actions">'+[['play','Reproduzir'],['queue','Adicionar à fila']].map(([id,label])=>
        button('setting-choice',label,label,'data-key="doubleClick" data-id="'+id+'" '+pressed(preferences.doubleClick===id))).join('')+'</div>')+
    settingRow('Pausar ao trocar de dispositivo','Quando o sistema informar uma mudança de saída de áudio.',toggleSetting('devicePause','Pausar ao trocar de dispositivo')))
  if (settingsPage==='shortcuts') return '<div class="shortcut-grid">'+shortcuts.map(([label,key])=>
    '<div class="setting-box shortcut"><strong>'+escape(label)+'</strong><kbd>'+escape(key)+'</kbd></div>').join('')+'</div>'
  if (settingsPage==='eq') return box(settingRow('Ajustar frequências','Use uma predefinição ou ajuste cada uma das dez bandas.',button('settings-eq','Abrir equalizador','Abrir equalizador')))
  if (settingsPage==='appearance') return box(settingRow('Idioma','Idioma da interface.','<span>Português (Brasil)</span>')+
    '<h3>Tema</h3><div class="theme-options">'+[['system','Sistema'],['light','Claro'],['dark','Escuro']].map(([id,label])=>
      button('setting-choice',label,'<span class="theme-preview '+id+'"></span>'+label,'data-key="theme" data-id="'+id+'" '+pressed(preferences.theme===id))).join('')+'</div>')
  if (settingsPage==='storage') {
    const bytes=tracks.reduce((total,item)=>total+(item.size||0),0)
    return box(settingRow('Música local',tracks.filter(item=>item.filename).length+' arquivo(s) neste perfil.', '<strong>'+new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(bytes/1048576)+' MB</strong>')+
      settingRow('Arquivos de áudio e letras','Adicione arquivos à sua biblioteca.',button('import','Importar arquivos','Importar arquivos')))
  }
  if (settingsPage==='about') return box('<p class="creator-credit">Criado por <strong>Disney Marketing</strong></p><div class="actions">'+
    button('external-link','TikTok','TikTok','data-id="tiktok"')+button('external-link','Instagram','Instagram','data-id="instagram"')+'</div>')
  return box('<div class="actions">'+button('external-link','Documentação','Documentação','data-id="docs"')+
    button('external-link','Suporte','Suporte','data-id="support"')+'</div>'+
    (window.mobileApp?button('server-settings','Configurar servidor','Configurar servidor'):''))
}
function renderSettings() {
  const title=settingsGroups.flatMap(([,items])=>items).find(([id])=>id===settingsPage)[1]
  settingsPanel.querySelector('.settings-content').innerHTML='<header><h2>'+title+'</h2>'+button('close-settings','Fechar configurações','×','class="icon"')+'</header>'+settingsContent()
  for (const tab of settingsPanel.querySelectorAll('[data-action="settings-tab"]')) tab.setAttribute('aria-pressed',String(tab.dataset.id===settingsPage))
}
function showSettings() {
  const id=localStorage.getItem(profileKey)
  const name=profiles().find(item=>item.id===id)?.name || 'Convidado'
  settingsPanel.innerHTML='<div class="settings-layout"><aside><input type="text" data-settings-search aria-label="Pesquisar configurações" placeholder="Pesquisar configurações…">'+
    settingsGroups.map(([label,items])=>'<section><small>'+label+'</small>'+items.map(([id,title])=>
      button('settings-tab',title,title,'data-id="'+id+'"')).join('')+'</section>').join('')+
    '<div class="settings-profile"><strong>'+escape(name)+'</strong>'+button('switch-profile','Trocar perfil','Trocar perfil')+'</div></aside><div class="settings-content"></div></div>'
  renderSettings()
  if (!settingsPanel.open) settingsPanel.showModal()
}
function savePreference(name,value) {
  preferences[name]=value
  localStorage.setItem(preferenceKey,JSON.stringify(preferences))
  document.documentElement.dataset.theme=preferences.theme
}
settingsPanel.addEventListener('input',event=>{
  const input=event.target
  if (input.hasAttribute('data-settings-search')) {
    for (const group of settingsPanel.querySelectorAll('aside section')) {
      const tabs=[...group.querySelectorAll('button')]
      for (const tab of tabs) tab.hidden=!normalized(tab.textContent).includes(normalized(input.value))
      group.hidden=tabs.every(tab=>tab.hidden)
    }
  } else if (input.dataset.preference) savePreference(input.dataset.preference,input.checked)
})
