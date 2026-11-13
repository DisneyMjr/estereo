const MAX_TRACKS = 500

function playlistId(input) {
  const value = String(input).trim()
  const match = value.match(/^(?:spotify:playlist:|https:\/\/open\.spotify\.com\/(?:intl-[\w-]+\/)?playlist\/)([a-zA-Z0-9]{22})(?:[?#].*)?$/)
  if (!match) throw new Error('O link não é compatível. Cole o endereço de uma playlist pública.')
  return match[1]
}

async function page(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(15000), redirect:'error'})
  if (!response.ok) throw new Error('A fonte retornou um erro ('+response.status+').')
  return response.text()
}

async function spotify(input) {
  const id = playlistId(input)
  const html = await page('https://open.spotify.com/embed/playlist/'+id)
  const data = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s)
  const entity = data && JSON.parse(data[1])?.props?.pageProps?.state?.data?.entity
  const tracks = entity?.trackList?.filter(item => item.uri?.startsWith('spotify:track:') && item.title && item.subtitle)
  if (!tracks?.length) throw new Error('Não foi possível ler as faixas. Verifique se a playlist é pública e contém músicas.')
  return {name:entity.name || entity.title || 'Playlist importada', source:'https://open.spotify.com/playlist/'+id,
    tracks:tracks.slice(0,MAX_TRACKS).map(item => ({spotifyId:item.uri.split(':').at(-1),
      title:item.title,artist:item.subtitle,duration:(Number(item.duration)||0)/1000}))}
}

const normalize = value => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim()
const text = field => field?.simpleText || field?.runs?.map(part=>part.text).join('') || ''
async function searchVideos(query) {
  const html = await page('https://www.youtube.com/results?search_query='+encodeURIComponent(query)+'&sp=EgIQAQ%253D%253D')
  const match = html.match(/(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*(\{.*?\});\s*<\/script>/s)
  if (!match) throw new Error('O catálogo está temporariamente indisponível.')
  const results = new Map()
  function visit(node) {
    if (!node || typeof node!=='object') return
    const video = node.videoRenderer
    if (video && /^[\w-]{11}$/.test(video.videoId)) {
      const title = text(video.title)
      const channel = text(video.ownerText)
      const time = text(video.lengthText)
      if (title && channel && /^\d+(?::[0-5]\d){1,2}$/.test(time)) {
        const duration = time.split(':').reduce((total,part)=>total*60+Number(part),0)
        results.set(video.videoId,{videoId:video.videoId,title,channel,duration})
      }
    }
    for (const value of Object.values(node)) visit(value)
  }
  visit(JSON.parse(match[1]))
  return [...results.values()]
}

async function catalog(input) {
  if (typeof input!=='string') throw new Error('Busca inválida.')
  const query = input.trim().slice(0,160)
  const results = await searchVideos(query ? query+' música' : 'músicas em alta Brasil lançamentos clipe oficial')
  return results.slice(0,28).map(({channel,title,...item})=>({
    ...item, title, artist:channel.replace(/ - Topic$/i,'')
  }))
}

async function youtube(item) {
  const title = String(item.title).slice(0,200)
  const artist = String(item.artist).slice(0,200)
  const name = normalize(title)
  const author = normalize(artist.split(',')[0])
  const variants = /\b(cover|karaoke|reaction|sped up|slowed|live|remix)\b/
  return (await searchVideos(artist+' '+title+' official audio')).flatMap(video=>{
    const label = normalize(video.title)
    const channel = normalize(video.channel)
    const delta = item.duration ? Math.abs(video.duration-Number(item.duration)) : 0
    if (!name || !label.includes(name) || !author || !(label.includes(author) || channel.includes(author)) || delta>=45) return []
    const variation = variants.test(label) && !variants.test(name)
    return [{id:video.videoId,score:100-delta+(channel.endsWith(' topic')?15:0)+
      (label.includes('official audio')?10:0)-(variation?70:0)}]
  }).sort((a,b)=>b.score-a.score).filter(item=>item.score>=55).slice(0,5).map(item=>item.id)
}

module.exports = {spotify,youtube,catalog}


const {execFile} = require('node:child_process')
const {promisify} = require('node:util')
const exec = promisify(execFile)

async function stream(id) {
  if (typeof id!=='string' || !/^[\w-]{11}$/.test(id)) throw new Error('Identificador de faixa inválido.')
  const executable = process.env.ESTEREO_YTDLP || (process.platform==='win32'?'yt-dlp.exe':'yt-dlp')
  let output
  try {
    const result = await exec(executable,[
      '--ignore-config','--no-playlist','--socket-timeout','9','--retries','0','--extractor-retries','0',
      '--no-warnings','-f','bestaudio[protocol=https]','--get-url','https://www.youtube.com/watch?v='+id
    ],{timeout:22000,maxBuffer:256*1024,windowsHide:true})
    output = result.stdout.trim()
  } catch(error) {
    if (error.code==='ENOENT') throw new Error('Instale o yt-dlp para tocar faixas online.')
    throw new Error('Não foi possível obter o áudio desta gravação.')
  }
  let url
  try { url = new URL(output) } catch { throw new Error('A fonte retornou um endereço de áudio inválido.') }
  if (url.protocol!=='https:' || !url.hostname.endsWith('.googlevideo.com') || url.username || url.password || url.port)
    throw new Error('A fonte retornou um endereço de áudio inválido.')
  return url.href
}

module.exports.stream = stream


