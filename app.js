'use strict'

const $ = selector => document.querySelector(selector)
const audio = $('#audio')
const dialog = $('#dialog')
const icons = { home:'⌂', search:'⌕', library:'▤', settings:'⚙', play:'▶', pause:'Ⅱ',
  previous:'⏮', next:'⏭', shuffle:'⇄', repeat:'↻', heart:'♥', queue:'☰', lyrics:'♫', close:'×' }
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char])
const normalized = value => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '')
const clock = value => Number.isFinite(value) ? Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2,'0') : '0:00'
const key = () => crypto.randomUUID()

let db
let tracks = []
let lists = []
let view = 'home'
const onlineTracks = new Map()
const onlineView = () => view==='home' || view==='search'
let catalogItems = []
let catalogStatus = 'loading'
let catalogTimer
let catalogRequest = 0
let filter = 'all'
let query = ''
let layout = localStorage.getItem('layout') || 'grid'
let current = null
let pending = []
let history = []
let shuffle = false
let repeat = false
let objectUrl
let loading = 0
let activeLine = -1
let noticeTimeout
let importing = false

let resolving = false

async function remoteCall(name, input) {
  const result = await window.remoteMusic[name](input)
  if (result.error) throw new Error(result.error)
  return result.value
}
function spotifyDialog() {
  dialog.innerHTML = '<form><h2>Importar playlist por link</h2><label>Link de playlist pública <input type="text" required maxlength="300" placeholder="Cole o link da playlist"></label><p data-import-status role="status">As faixas são localizadas quando você toca a playlist.</p><div class="actions"><button class="primary">Importar</button>'+button('close-dialog','Cancelar','Cancelar')+'</div></form>'
  dialog.showModal()
  const form = dialog.querySelector('form')
  form.onsubmit = async event => {
    event.preventDefault()
    if (importing) return
    const status = form.querySelector('[data-import-status]')
    const submit = form.querySelector('button')
    importing = true
    submit.disabled = true
    status.textContent = 'Lendo a playlist pública…'
    try {
      const result = await remoteCall('playlist',form.querySelector('input').value)
      if (!dialog.open || !form.isConnected) return
      const bySpotify = new Map(tracks.filter(item=>item.spotifyId).map(item=>[item.spotifyId,item]))
      const newTracks = []
      const ids = result.tracks.map(metadata=>{
        let item = bySpotify.get(metadata.spotifyId)
        if (!item) {
          item = {...metadata,id:key(),source:'youtube',favorite:false,lines:[],tone:(tracks.length+newTracks.length)%4}
          newTracks.push(item)
          bySpotify.set(metadata.spotifyId,item)
        }
        return item.id
      })
      const existing = lists.find(item=>item.spotifyUrl===result.source)
      const playlist = {id:existing?.id || key(),name:existing?.name || result.name,ids,spotifyUrl:result.source}
      await new Promise((resolve,reject)=>{
        const tx = db.transaction(['tracks','lists'],'readwrite')
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error)
        for (const item of newTracks) tx.objectStore('tracks').put(item)
        tx.objectStore('lists').put(playlist)
      })
      tracks.push(...newTracks)
      if (existing) Object.assign(existing,playlist)
      else lists.push(playlist)
      closeDialog()
      go('list:'+playlist.id)
      notify(ids.length+' faixa(s) importada(s).')
    } catch(error) { status.textContent = error.message || 'Não foi possível importar a playlist.' }
    finally { importing = false; submit.disabled = false }
  }
}


function notify(message) {
  $('#notice').textContent = message
  clearTimeout(noticeTimeout)
  noticeTimeout = setTimeout(() => { $('#notice').textContent = '' }, 3900)
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('estereo-library', 1)
    request.onupgradeneeded = () => {
      for (const store of ['tracks','lists']) request.result.createObjectStore(store, { keyPath:'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
function transact(store, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store,mode)
    const request = run(transaction.objectStore(store))
    transaction.oncomplete = () => resolve(request?.result)
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}
const track = id => onlineTracks.get(id) || tracks.find(item => item.id === id)
const list = id => lists.find(item => item.id === id)
const saveList = item => transact('lists','readwrite',store => store.put(item))

async function patchTrack(id, fields) {
  await transact('tracks','readwrite',store => {
    const request = store.get(id)
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...fields })
    }
  })
  Object.assign(track(id),fields)
  const saved = tracks.find(item=>item.id===id)
  if (saved) Object.assign(saved,fields)
  render()
}

function parseLrc(source) {
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000
  return source.split(/\r?\n/).flatMap(line => {
    const stamps = [...line.matchAll(/\[(\d+):([0-5]?\d(?:\.\d+)?)\]/g)]
    const words = line.replace(/\[[^\]]*\]/g,'').trim()
    return stamps.map(stamp => ({at:Math.max(0,Number(stamp[1])*60+Number(stamp[2])+offset),words}))
  }).sort((a,b) => a.at-b.at)
}

async function importFiles(files) {
  if (!db || importing) return
  importing = true
  let added = 0
  let playlists = 0
  let linked = 0
  try {
    const audioFiles = files.filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|flac|wav|ogg|opus|aac)$/i.test(file.name))
    const lyricsFiles = files.filter(file => /\.lrc$/i.test(file.name))
    const playlistsFiles = files.filter(file => /\.m3u8?$/i.test(file.name))
    for (const file of audioFiles) {
      if (tracks.some(item => item.filename === file.name && item.size === file.size && item.modified === file.lastModified)) continue
      const name = file.name.replace(/\.[^.]+$/,'')
      const separator = name.indexOf(' - ')
      const item = {id:key(), filename:file.name, size:file.size, modified:file.lastModified,
        title:separator < 0 ? name : name.slice(separator+3), artist:separator < 0 ? '' : name.slice(0,separator),
        favorite:false, lines:[], duration:0, tone:tracks.length%4}
      await transact('tracks','readwrite',store => store.put({...item,file}))
      tracks.push(item)
      added++
    }
    for (const file of lyricsFiles) {
      const item = tracks.find(candidate => normalized((candidate.filename || '').replace(/\.[^.]+$/,'')) === normalized(file.name.slice(0,-4)))
      const lines = parseLrc(await file.text())
      if (!item || !lines.length) continue
      await patchTrack(item.id,{lines})
      linked++
    }
    for (const file of playlistsFiles) {
      const names = (await file.text()).split(/\r?\n/).map(line => line.trim())
        .filter(line => line && !line.startsWith('#')).map(line => line.split(/[\\/]/).at(-1))
      const ids = [...new Set(names.map(name => tracks.find(item => normalized(item.filename || '') === normalized(name))?.id).filter(Boolean))]
      if (!ids.length) continue
      const item = {id:key(),name:file.name.replace(/\.m3u8?$/i,''),ids}
      await saveList(item)
      lists.push(item)
      playlists++
    }
    notify(added || playlists || linked ? [added+' faixa(s)',playlists+' playlist(s)',linked+' letra(s)'].join(' · ') :
      'Nenhum arquivo novo ou correspondente. Selecione também os áudios referenciados pela playlist.')
    go('library')
  } finally { importing = false }
}

const button = (action,label,content,attrs='') => '<button type="button" data-action="'+action+'" aria-label="'+label+'" title="'+label+'" '+attrs+'>'+content+'</button>'
const action = (name,label,extra='',className='icon') => button(name,label,icons[name]||escape(label),'class="'+className+'" '+extra)
const cover = item => /^(?:https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/hqdefault\.jpg)$/.test(item?.cover || '') ? '<img src="'+escape(item.cover)+'" alt="" loading="lazy">' : ''
const art = (item,symbol='♫',extra='') => '<span aria-hidden="true" class="art tone'+(item?.tone || 0)+' '+extra+'">'+symbol+cover(item)+'</span>'
function requestCatalog(delay = 0) {
  clearTimeout(catalogTimer)
  const request = ++catalogRequest
  const term = query.trim()
  catalogItems = []
  catalogStatus = 'loading'
  renderView(true)
  catalogTimer = setTimeout(async () => {
    try {
      const results = await remoteCall('catalog',term)
      if (request!==catalogRequest || !onlineView()) return
      catalogItems = results.map(result=>{
        const id = 'online-'+result.videoId
        const item = {...result,id,source:'youtube',favorite:false,lines:[],tone:0,...track(id),cover:result.cover}
        onlineTracks.set(id,item)
        return item
      })
      catalogStatus = 'ready'
    } catch (error) {
      if (window.mobileApp && !localStorage.getItem('musicServer')) catalogStatus = 'configuration'
      if (request!==catalogRequest || !onlineView()) return
      if (catalogStatus!=='configuration') catalogStatus = 'error'
    }
    renderView(true)
  },delay)
}

function catalogContent() {
  if (catalogStatus==='configuration') return '<div class="empty"><p>Configure um servidor de música para acessar o catálogo.</p>'+button('server-settings','Configurar servidor','Configurar servidor')+'</div>'
  if (catalogStatus==='loading') return '<p role="status">Carregando faixas…</p>'
  if (catalogStatus==='error') return '<div class="empty"><h2>Catálogo indisponível</h2><p>Verifique a conexão e tente novamente.</p>'+button('retry-catalog','Tentar novamente','Tentar novamente')+'</div>'
  if (!catalogItems.length) return '<div class="empty"><h2>Nenhuma faixa encontrada</h2><p>Experimente outro título ou artista.</p></div>'
  if (view==='search' || query.trim()) return trackRows(catalogItems)
  const collectionCards = tile('favorites','Favoritas',tracks.filter(item=>item.favorite).length+' faixa(s)','♥')+
    lists.map(item=>button('navigate',escape(item.name),art(track(item.ids[0]))+'<strong>'+escape(item.name)+'</strong><small>'+item.ids.length+' faixa(s)</small>','class="tile" data-id="list:'+item.id+'"')).join('')
  const musicCards = catalogItems.map(item=>button('track','Tocar '+escape(item.title),
    art(item)+'<strong>'+escape(item.title)+'</strong><small>'+escape(item.artist)+'</small>',
    'class="tile" data-id="'+item.id+'"')).join('')
  if (layout==='list') return '<div class="menu">'+(filter==='tracks'?'':collectionCards)+'</div>'+(filter==='lists'?'':trackRows(catalogItems))
  return '<div class="grid home-grid">'+(filter==='tracks'?'':collectionCards)+(filter==='lists'?'':musicCards)+'</div>'
}

async function saveCatalogTrack(id) {
  if (tracks.some(item=>item.id===id)) return
  const item = onlineTracks.get(id)
  if (!item) return
  await transact('tracks','readwrite',store=>store.put(item))
  if (!tracks.some(item=>item.id===id)) tracks.push(item)
}


function go(next) {
  clearTimeout(catalogTimer)
  catalogRequest++
  view = next
  query = ''
  filter = 'all'
  render()
  $('#view').scrollTop = 0
  if (onlineView()) requestCatalog()
}
function matching(items) {
  const text = normalized(query.trim())
  return items.filter(item => normalized(item.title+' '+item.artist).includes(text))
}
function collection() {
  if (view === 'favorites') return tracks.filter(item => item.favorite)
  if (view.startsWith('list:')) return (list(view.slice(5))?.ids || []).map(track).filter(Boolean)
  return tracks
}
function trackRows(items) {
  if (!items.length) return '<div class="empty"><strong>Nenhuma faixa aqui</strong><p>Importe músicas ou adicione faixas à coleção pelo menu de cada faixa.</p></div>'
  return '<div class="rows">'+items.map((item,index) =>
    '<div class="row '+(item.id===current?'current':'')+'"><small>'+(index+1)+'</small>'+
    button('track','Tocar '+escape(item.title),'<strong>'+escape(item.title)+'</strong> <small>'+escape(item.artist)+'</small>','class="name" data-id="'+item.id+'"')+
    '<small>'+ (item.duration ? clock(item.duration) : '–') +'</small>'+
    button('track-menu','Opções da faixa','⋮','class="icon" data-id="'+item.id+'"')+'</div>').join('')+'</div>'
}
function tile(target,title,subtitle,symbol,tone=0) {
  return button('navigate',escape(title),art({tone},symbol)+'<strong>'+escape(title)+'</strong><small>'+escape(subtitle)+'</small>',
    'class="tile" data-id="'+target+'"')
}
function searchBox(placeholder) {
  return '<input data-query type="text" inputmode="search" placeholder="'+placeholder+'" aria-label="'+placeholder+'" value="'+escape(query)+'">'
}
function renderView(updateResults = false) {
  const parent = $('#view')
  const focused = document.activeElement?.matches('[data-query]')
  const selection = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null
  const scrollTop = parent.scrollTop
  let body
  if (view === 'settings') {
    body = '<h1>Preferências</h1>'+(window.mobileApp?button('server-settings','Configurar servidor','Configurar servidor'):'')+'<div class="empty"><h2>Biblioteca local</h2><p>Importe arquivos de áudio, playlists M3U e letras LRC. Seus arquivos ficam no perfil deste app.</p>'+
      button('import','Importar arquivos','Importar arquivos','class="primary"')+
      '</div><div class="empty"><h2>Teclado</h2><p><kbd>Espaço</kbd> Reproduzir ou pausar · <kbd>Esc</kbd> Fechar letras ou fila</p></div>'
  } else if (onlineView()) {
    const home = view==='home'
    const filters = home ? '<div class="actions">'+[['all','Tudo'],['lists','Playlists'],['tracks','Faixas']].map(([id,label])=>button('filter',label,label,'data-id="'+id+'" aria-pressed="'+(filter===id)+'"')).join('')+'</div>' : ''
    const tools = home ? button('home-layout','Visualização em grade','▦','data-id="grid" aria-pressed="'+(layout==='grid')+'"')+
      button('home-layout','Visualização em lista','☰','data-id="list" aria-pressed="'+(layout==='list')+'"')+
      button('new-list','Criar playlist','＋ Criar playlist','class="primary"') : ''
    body = '<h1>'+(home?'Início':'Buscar')+'</h1><div class="toolbar home-toolbar">'+filters+'<div class="actions">'+searchBox('Buscar título ou artista')+tools+'</div></div>'+catalogContent()
  } else if (view === 'favorites' || view.startsWith('list:')) {
    const playlist = list(view.slice(5))
    const favorites = view === 'favorites'
    const items = collection()
    body = button('navigate','Voltar à biblioteca','‹ Biblioteca','data-id="library"')+
      '<div class="collection-head">'+art(null,favorites?'♥':'♫')+'<div><h1>'+escape(favorites?'Favoritas':playlist?.name)+'</h1><p>'+items.length+' faixa(s)</p><div class="actions">'+
      button('play-all','Reproduzir coleção','▶ Reproduzir','class="primary" '+(!items.length?'disabled':''))+
      button('queue-all','Adicionar coleção à fila','＋ Fila',(!items.length?'disabled':''))+
      (playlist?button('edit-list','Editar playlist','Editar'):'')+'</div></div></div><div class="toolbar">'+searchBox('Buscar nesta coleção')+'</div>'+trackRows(matching(items))
  } else {
    const home = view === 'home'
    const showLists = filter !== 'tracks'
    const filteredLists = lists.filter(item => normalized(item.name).includes(normalized(query.trim())))
    const cards = (normalized('Favoritas').includes(normalized(query.trim())) ?
      tile('favorites','Favoritas',tracks.filter(item=>item.favorite).length+' faixa(s)','♥') : '')+
      filteredLists.map((item,index)=>tile('list:'+item.id,item.name,item.ids.length+' faixa(s)','♫',(index+1)%4)).join('')
    body = '<h1>'+(home?'Início':'Biblioteca')+'</h1><div class="toolbar"><div class="actions">'+
      [['all','Tudo'],['lists','Playlists'],['tracks','Faixas']].map(([id,label])=>button('filter',label,label,'data-id="'+id+'" aria-pressed="'+(filter===id)+'"')).join('')+
      '</div><div class="actions">'+searchBox('Buscar na biblioteca')+
      button('layout','Alternar grade ou lista',layout==='grid'?'▦':'☰')+
      button('new-list','Criar playlist','＋ Playlist')+button('spotify','Importar playlist por link','Importar link')+button('import','Importar arquivos','＋ Importar','class="primary"')+'</div></div>'+
      (showLists && cards ? '<div class="'+(layout==='grid'?'grid':'menu')+'">'+cards+'</div>' : '')+
      (!tracks.length ? '<div class="empty"><h2>Adicione suas músicas</h2><p>Selecione arquivos de áudio ou arraste-os para esta janela.</p>'+button('import','Escolher arquivos','Escolher arquivos','class="primary"')+'</div>' :
       filter!=='lists' ? '<h2>Todas as faixas</h2>'+trackRows(matching(tracks)) : '')
  }
  if (updateResults && focused) {
    const next = document.createElement('template')
    next.innerHTML = body
    const toolbar = next.content.querySelector('.toolbar')
    const oldToolbar = parent.querySelector('.toolbar')
    if (toolbar && oldToolbar) {
      while (oldToolbar.nextSibling) oldToolbar.nextSibling.remove()
      while (toolbar.nextSibling) parent.append(toolbar.nextSibling)
      return
    }
  }
  parent.innerHTML = body
  parent.scrollTop = scrollTop
  if (selection) {
    const input = parent.querySelector('[data-query]')
    input?.focus()
    input?.setSelectionRange(...selection)
  }
}

function renderNav() {
  $('.rail').innerHTML = [['home','Início'],['search','Buscar'],['library','Biblioteca'],['settings','Preferências']]
    .map(([id,label]) => button('navigate',label,icons[id],'class="icon" data-id="'+id+'" aria-pressed="'+(view===id || (id==='library'&&(view==='favorites'||view.startsWith('list:'))))+'"')).join('')
}

const seek = () => '<div class="seek"><span data-time>0:00</span><input data-seek type="range" min="0" max="1000" value="0" aria-label="Posição da faixa"><span data-duration>0:00</span></div>'
const controls = () => '<div class="controls">'+action('previous','Anterior')+
  button('play','Reproduzir','▶','class="play"')+action('next','Próxima')+'</div>'
const pressed = value => 'aria-pressed="'+value+'"'
function renderPlayer() {
  const item = track(current)
  $('#player').className='now'
  $('#player').innerHTML = '<div class="track-info">'+art(item,'♫','mini')+
    '<span><strong>'+escape(item?.title || 'Nenhuma faixa')+'</strong><br><small>'+escape(item?.artist || (item?'Arquivo local':'Selecione uma música'))+'</small></span></div>'+
    '<div class="transport">'+controls()+seek()+'</div><div class="actions right">'+
    action('shuffle','Embaralhar',pressed(shuffle),'icon mobile-hide')+action('repeat','Repetir faixa',pressed(repeat))+
    action('heart','Favoritar faixa',pressed(!!item?.favorite))+
    action('lyrics','Abrir letras',pressed(!$('#lyrics').hidden))+action('queue','Abrir fila',pressed(!$('#queue').hidden))+
    '<input class="volume" data-volume type="range" min="0" max="1" step=".01" aria-label="Volume"></div>'
}

function renderQueue() {
  if ($('#queue').hidden) return
  $('#queue').innerHTML = '<header><h2>Fila de reprodução</h2>'+action('close-queue','Fechar fila')+'</header>'+
    (pending.length ? '<p>'+button('clear-queue','Limpar fila','Limpar fila')+'</p><div class="rows">'+pending.map((id,index)=>{
      const item = track(id)
      return '<div class="row"><small>'+(index+1)+'</small>'+button('queue-play','Tocar '+escape(item?.title),escape(item?.title),'class="name" data-id="'+index+'"')+
        '<span></span>'+button('queue-remove','Remover da fila','×','class="icon" data-id="'+index+'"')+'</div>'
    }).join('')+'</div>' : '<p>A fila está vazia.</p>')
}

const lyricRequests = new Map()
const lyricResults = new Map()
let lyricRetryAfter = 0

async function loadLyrics(id, retry = false) {
  const item = track(id)
  if (!item || item.lines.length || item.plainLyrics || lyricRequests.has(id) || (!retry && lyricResults.has(id))) return
  const cleanTitle = item.title.replace(/\s*[\[(](?:official (?:music )?(?:video|audio)|lyrics|lyric video|clipe oficial)[\])]\s*$/i,'')
    .replace(/\s*\|\s*NCS Release\s*$/i,'').trim()
  const parts = item.source==='youtube' ? cleanTitle.split(/\s+[-–—]\s+/,2) : []
  const artist = (parts[1] ? parts[0] : item.artist).replace(/ - Topic$/i,'').trim()
  const title = (parts[1] || cleanTitle).replace(/\s*[\[(](?:feat\.?|ft\.?).*?[\])]\s*$/i,'').trim()
  if (!artist || !title) { lyricResults.set(id,'missing'); return }
  lyricRequests.set(id,true)
  renderLyrics()
  updatePlayback()
  try {
    if (Date.now()<lyricRetryAfter) throw Error()
    const url = new URL('https://lrclib.net/api/search')
    url.search = new URLSearchParams({track_name:title,artist_name:artist})
    const response = await fetch(url,{headers:{'Lrclib-Client':'Estereo (https://github.com/DisneyMjr/estereo)'},signal:AbortSignal.timeout(9000)})
    if (response.status===429) {
      const delay = Math.max(1,Number(response.headers.get('Retry-After'))||60)
      lyricRetryAfter = Date.now()+delay*1100
    }
    if (!response.ok) throw Error()
    const entries = await response.json()
    const candidates = entries.filter(entry=>normalized(entry.trackName||'')===normalized(title) &&
      (normalized(entry.artistName||'')===normalized(artist) || normalized(entry.artistName||'').split(/[,;&]/).map(value=>value.trim()).includes(normalized(artist.split(',')[0]))) &&
      (!item.duration || Math.abs(entry.duration-item.duration)<=12))
    const result = candidates.find(entry=>entry.syncedLyrics) || candidates.find(entry=>entry.plainLyrics)
    if (!result) { lyricResults.set(id,'missing'); return }
    if (item.lines.length || item.plainLyrics) return
    await patchTrack(id,{lines:parseLrc(result.syncedLyrics || ''),plainLyrics:result.plainLyrics || '',lyricsSource:'LRCLIB'})
    lyricResults.set(id,'loaded')
  } catch { lyricResults.set(id,'error') }
  finally {
    lyricRequests.delete(id)
    if (current===id) { renderLyrics(); updatePlayback() }
  }
}

function lyricContent(item) {
  if (item?.lines.length) return item.lines.map((line,index)=>button('line','Ir para '+clock(line.at),escape(line.words || '♪'),'class="line" data-id="'+index+'"')).join('')
  if (item?.plainLyrics) return '<small>Letra sem sincronização</small><div class="plain-lyrics">'+escape(item.plainLyrics)+'</div>'
  if (!item) return '<div class="lyrics-empty"><h2>Toque uma faixa para ver a letra</h2></div>'
  if (lyricRequests.has(item.id)) return '<div class="lyrics-empty" role="status"><h2>Buscando letra…</h2></div>'
  const failed = lyricResults.get(item.id)==='error'
  return '<div class="lyrics-empty"><h2>'+(failed?'A busca de letras está indisponível':'Letra ainda indisponível')+'</h2><p>Você pode buscar novamente ou adicionar uma letra sincronizada.</p><div class="actions">'+
    button('retry-lyrics','Buscar novamente','Buscar novamente')+button('attach','Adicionar arquivo LRC','Adicionar .lrc')+'</div></div>'
}


function renderLyrics() {
  if ($('#lyrics').hidden) return
  const item = track(current)
  activeLine = -1
  $('#lyrics').innerHTML = '<header class="lyric-top">'+button('close-lyrics','Voltar ao player','⌄ Voltar')+
    '<div class="actions">'+button('offset-down','Adiantar letras','−')+'<small data-offset>'+((item?.offset||0).toFixed(1))+' s</small>'+
    button('offset-up','Atrasar letras','+')+button('attach','Vincular letra LRC','Vincular .lrc',item?'':'disabled')+'</div></header>'+
    '<div class="lyric-body"><div class="lyric-player">'+art(item)+'<h2>'+escape(item?.title || 'Nenhuma faixa')+'</h2><p>'+escape(item?.artist)+'</p>'+seek()+controls()+'</div>'+
    '<div class="lyric-scroll">'+lyricContent(item)+'</div></div>'
}
function updatePlayback() {
  const duration = audio.duration
  const position = audio.currentTime
  const paused = audio.paused
  for (const element of document.querySelectorAll('[data-time]')) element.textContent = clock(position)
  for (const element of document.querySelectorAll('[data-duration]')) element.textContent = clock(duration)
  for (const element of document.querySelectorAll('[data-seek]')) {
    if (element !== document.activeElement) element.value = duration ? position/duration*1000 : 0
    element.disabled = !duration
  }
  for (const element of document.querySelectorAll('[data-volume]')) element.value = audio.volume
  for (const element of document.querySelectorAll('[data-action=play]')) {
    element.textContent = paused?'▶':'Ⅱ'
    element.setAttribute('aria-label',paused?'Reproduzir':'Pausar')
  }
  if ($('#lyrics').hidden) return
  const item = track(current)
  const lines = item?.lines || []
  const index = lines.findLastIndex(line => line.at <= audio.currentTime-(item?.offset||0))
  if (index === activeLine) return
  $('#lyrics .active')?.classList.remove('active')
  const line = $('#lyrics .line[data-id="'+index+'"]')
  line?.classList.add('active')
  line?.scrollIntoView({block:'center',behavior:'smooth'})
  activeLine = index
}
function render() {
  renderNav()
  renderView()
  renderPlayer()
  renderQueue()
  renderLyrics()
  updatePlayback()
}

async function playTrack(id) {
  const item = track(id)
  if (!item) return
  const request = ++loading
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = null
  if (current && current !== id) history.push(current)
  current = id
  if (!$('#lyrics').hidden) loadLyrics(id)
  resolving = item.source === 'youtube'
  render()
  try {
    if (resolving) {
      notify('Localizando o áudio da faixa…')
      let candidates = item.videoId ? [item.videoId] : []
      for (const cached of [true, false]) {
        if (!cached) {
          candidates = (await remoteCall('match',{title:item.title,artist:item.artist,duration:item.duration}))
            .filter(id => id!==item.videoId)
        }
        for (const videoId of candidates) {
          if (request!==loading) return
          try {
            const url = await remoteCall('stream',videoId)
            if (request!==loading) return
            audio.src = url
            await audio.play()
            if (request!==loading) return
            $('#notice').textContent = ''
            if (item.videoId!==videoId) await patchTrack(item.id,{videoId})
            return
          } catch(error) {
            if (error.message.includes('componente de áudio')) throw error
            if (request!==loading) return
          }
        }
      }
      throw new Error('Nenhuma gravação disponível para esta faixa.')
    }
    const result = await transact('tracks','readonly',store=>store.get(id))
    if (request!==loading || !result?.file) return
    objectUrl = URL.createObjectURL(result.file)
    audio.src = objectUrl
    await audio.play()
  } catch(error) {
    if (request===loading) notify(error.name==='NotSupportedError'?'Não foi possível reproduzir esta faixa.':error.message)
  } finally {
    if (request===loading) {
      resolving = false
      updatePlayback()
    }
  }
}
function ordered(ids) {
  const result = [...ids]
  if (!shuffle) return result
  for (let i=result.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1))
    ;[result[i],result[j]] = [result[j],result[i]]
  }
  return result
}
async function nextTrack() {
  const id = pending.shift()
  if (id) await playTrack(id)
  else if (!current && (catalogItems.length || tracks.length)) await playTrack((onlineView()?catalogItems[0]:tracks[0])?.id || tracks[0]?.id)
  else { renderQueue(); notify('A fila está vazia.') }
}
async function togglePlayback() {
  if (!current) return nextTrack()
  if (resolving) return
  if (!audio.getAttribute('src') || audio.error) return playTrack(current)
  if (audio.paused) await audio.play()
  else audio.pause()
}
function closeDialog() { if (dialog.open) dialog.close() }
function playlistDialog(item) {
  dialog.innerHTML = '<form><h2>'+(item?'Editar playlist':'Nova playlist')+'</h2><label>Nome<input type="text" required maxlength="100" value="'+escape(item?.name)+'"></label><div class="actions">'+
    '<button class="primary">Salvar</button>'+button('close-dialog','Cancelar','Cancelar')+
    (item?button('delete-list','Excluir playlist','Excluir','data-id="'+item.id+'"'):'')+'</div></form>'
  dialog.showModal()
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault()
    const name = dialog.querySelector('input').value.trim()
    if (!name) return
    try {
      const updated = item ? {...item,name} : {id:key(),name,ids:[]}
      await saveList(updated)
      if (item) Object.assign(item,updated)
      else lists.push(updated)
      closeDialog()
      go('list:'+updated.id)
    } catch { notify('Não foi possível salvar a playlist.') }
  }
}
function trackMenu(id) {
  const item = track(id)
  dialog.innerHTML = '<h2>'+escape(item.title)+'</h2><div class="menu">'+
    button('add-queue','Adicionar à fila','Adicionar à fila','data-id="'+id+'"')+
    button('favorite-track','Alternar favorita',item.favorite?'Remover das favoritas':'Adicionar às favoritas','data-id="'+id+'"')+
    lists.map(playlist=>button('add-list',escape(playlist.name),(playlist.ids.includes(id)?'Remover de ':'Adicionar a ')+escape(playlist.name),'data-id="'+id+'" data-list="'+playlist.id+'"')).join('')+
    '</div>'+button('close-dialog','Fechar','Fechar')
  dialog.showModal()
}
const handlers = {
  navigate: id => go(id),
  'server-settings': () => {
    const input = prompt('Endereço HTTPS do servidor de música',localStorage.getItem('musicServer') || '')
    if (input===null) return
    try {
      const url=new URL(input)
      if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw Error()
      localStorage.setItem('musicServer',url.href.replace(/\/$/,''))
      go('home')
    } catch { notify('Informe um endereço HTTPS válido.') }
  },
  'home-layout': id => { layout=id; localStorage.setItem('layout',id); renderView() },
  'retry-catalog': () => requestCatalog(),
  spotify: spotifyDialog,
  import: () => $('#files').click(),
  filter: id => { filter=id; renderView() },
  layout: () => { layout=layout==='grid'?'list':'grid'; localStorage.setItem('layout',layout); renderView() },
  'new-list': () => playlistDialog(),
  'edit-list': () => playlistDialog(list(view.slice(5))),
  'delete-list': async id => {
    await transact('lists','readwrite',store => store.delete(id))
    lists = lists.filter(item=>item.id!==id)
    closeDialog()
    go('library')
  },
  'close-dialog': closeDialog,
  track: async id => {
    const items = onlineView() ? catalogItems : matching(collection())
    const index = items.findIndex(item=>item.id===id)
    pending = ordered(items.slice(index+1).map(item=>item.id))
    await playTrack(id)
  },
  'track-menu': trackMenu,
  'add-queue': id => { pending.push(id); closeDialog(); renderQueue(); notify('Faixa adicionada à fila.') },
  'queue-all': () => { pending.push(...collection().map(item=>item.id)); renderQueue(); notify('Coleção adicionada à fila.') },
  'play-all': async () => { pending=ordered(collection().map(item=>item.id)); await nextTrack() },
  'favorite-track': async id => { await saveCatalogTrack(id); await patchTrack(id,{favorite:!track(id).favorite}); closeDialog() },
  'add-list': async (id,element) => {
    await saveCatalogTrack(id)
    const playlist = list(element.dataset.list)
    const ids = playlist.ids.includes(id)?playlist.ids.filter(value=>value!==id):[...playlist.ids,id]
    await saveList({...playlist,ids})
    playlist.ids = ids
    closeDialog()
    renderView()
  },
  play: togglePlayback,
  next: nextTrack,
  previous: async () => {
    if (audio.currentTime>3 || !history.length) { audio.currentTime=0; return }
    const previous = history.pop()
    if (current) pending.unshift(current)
    await playTrack(previous)
    history.pop()
  },
  shuffle: () => { shuffle=!shuffle; if (shuffle) pending=ordered(pending); renderPlayer(); updatePlayback() },
  repeat: () => { repeat=!repeat; audio.loop=repeat; renderPlayer(); updatePlayback() },
  heart: async () => { if (current) { const id=current; await saveCatalogTrack(id); await patchTrack(id,{favorite:!track(id).favorite}) } },
  queue: () => { $('#queue').hidden=!$('#queue').hidden; renderQueue(); renderPlayer(); updatePlayback() },
  'close-queue': () => { $('#queue').hidden=true; renderPlayer(); updatePlayback() },
  'clear-queue': () => { pending=[]; renderQueue() },
  'queue-remove': id => { pending.splice(Number(id),1); renderQueue() },
  'queue-play': async id => { const [target]=pending.splice(Number(id),1); await playTrack(target) },
  lyrics: () => { $('#lyrics').hidden=false; renderLyrics(); updatePlayback(); $('#lyrics button').focus(); loadLyrics(current) },
  'close-lyrics': () => { $('#lyrics').hidden=true; renderPlayer(); updatePlayback(); $('[data-action=lyrics]').focus() },
  'retry-lyrics': () => loadLyrics(current,true),
  attach: () => $('#lyricsFile').click(),
  line: id => { const item=track(current); audio.currentTime=Math.max(0,item.lines[Number(id)].at+(item.offset||0)); updatePlayback() },
  'offset-down': () => current && patchTrack(current,{offset:Math.round(((track(current).offset||0)-.1)*10)/10}),
  'offset-up': () => current && patchTrack(current,{offset:Math.round(((track(current).offset||0)+.1)*10)/10})
}
document.addEventListener('click',async event => {
  const element=event.target.closest('[data-action]')
  if (!element || !db) return
  try { await handlers[element.dataset.action]?.(element.dataset.id,element) }
  catch { notify('Não foi possível concluir a ação.') }
})
document.addEventListener('input',event => {
  const element=event.target
  if ('query' in element.dataset) { query=element.value; if (onlineView()) requestCatalog(350); else renderView(true) }
  if ('seek' in element.dataset) {
    if (audio.duration) audio.currentTime=Number(element.value)*audio.duration/1000
  }
  if ('volume' in element.dataset) { audio.volume=Number(element.value); localStorage.setItem('volume',element.value) }
})
document.addEventListener('keydown',event => {
  if (dialog.open) return
  if (event.key==='Escape') {
    if (!$('#lyrics').hidden) handlers['close-lyrics']()
    else handlers['close-queue']()
  }
  if (event.code==='Space' && !event.target.closest('button,input,textarea') && db) {
    event.preventDefault()
    togglePlayback().catch(()=>notify('Não foi possível reproduzir este arquivo.'))
  }
})
$('#files').addEventListener('change',event => {
  importFiles([...event.target.files]).catch(()=>notify('Falha ao importar arquivos. Verifique o espaço disponível.'))
  event.target.value=''
})
$('#lyricsFile').addEventListener('change',async event => {
  const [file]=event.target.files
  const id=current
  event.target.value=''
  if (!file || !id) return
  try {
    const lines=parseLrc(await file.text())
    if (!lines.length) { notify('O arquivo não contém marcações LRC válidas.'); return }
    await saveCatalogTrack(id)
    await patchTrack(id,{lines,offset:0})
  } catch { notify('Não foi possível vincular a letra.') }
})
document.addEventListener('dragover',event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() })
document.addEventListener('drop',event => {
  event.preventDefault()
  importFiles([...event.dataTransfer.files]).catch(()=>notify('Não foi possível importar os arquivos.'))
})
for (const type of ['play','pause','timeupdate','durationchange']) audio.addEventListener(type,updatePlayback)
audio.addEventListener('loadedmetadata',() => {
  if (current && Number.isFinite(audio.duration) && track(current).duration!==audio.duration)
    patchTrack(current,{duration:audio.duration}).catch(()=>notify('Não foi possível salvar a duração.'))
})
audio.addEventListener('ended',() => {
  if (pending.length) nextTrack().catch(()=>notify('Não foi possível avançar a fila.'))
})
audio.addEventListener('error',() => !resolving && notify('Formato de áudio indisponível neste dispositivo.'))
const savedVolume = Number(localStorage.getItem('volume')??.8)
audio.volume = Number.isFinite(savedVolume) ? Math.min(1,Math.max(0,savedVolume)) : .8

async function start() {
  db = await openDB()
  const stored = await Promise.all(['tracks','lists'].map(name=>transact(name,'readonly',store=>store.getAll())))
  tracks = stored[0].map(({file,...item})=>item)
  lists = stored[1]
  render()
  requestCatalog()
}

start().catch(() => {
  $('#view').innerHTML='<h1>Biblioteca indisponível</h1><p>O armazenamento local não pôde ser aberto. Feche e reabra o aplicativo.</p>'
})



