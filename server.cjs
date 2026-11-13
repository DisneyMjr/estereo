const http = require('node:http')
const {catalog,spotify,youtube,stream} = require('./remote.cjs')
const { Readable } = require('node:stream')
const { randomUUID } = require('node:crypto')
const handlers = new Map(Object.entries({catalog,playlist:spotify,match:youtube,stream}))
const clientOrigin = 'https://appassets.androidplatform.net'
const publicOrigin = process.env.ESTEREO_PUBLIC_ORIGIN?.replace(/\/$/,'')
if (!publicOrigin || new URL(publicOrigin).protocol!=='https:') throw new Error('Defina ESTEREO_PUBLIC_ORIGIN com o endereço HTTPS público.')
const media = new Map()
let active = 0

http.createServer(async (req,res)=>{
  const route = req.url.slice(1)
  if (req.method==='GET' && route.startsWith('audio/')) {
    const entry = media.get(route.slice(6))
    if (!entry || entry.expires<=Date.now()) { res.writeHead(404).end(); return }
    try {
      const options = {signal:AbortSignal.timeout(120000)}
      if (/^bytes=\d+-\d*$/.test(req.headers.range || '')) options.headers={Range:req.headers.range}
      const audio = await fetch(entry.url,options)
      if (!audio.ok || !audio.body) { res.writeHead(502).end(); return }
      const headers = {}
      for (const name of ['content-type','content-length','accept-ranges','content-range']) {
        const value = audio.headers.get(name)
        if (value) headers[name] = value
      }
      res.writeHead(audio.status,headers)
      const body=Readable.fromWeb(audio.body)
      body.on('error',()=>res.destroy())
      res.on('close',()=>body.destroy())
      body.pipe(res)
    } catch { if (!res.headersSent) res.writeHead(502); res.end() }
    return
  }
  if (req.headers.origin!==clientOrigin) { res.writeHead(403).end(); return }
  res.setHeader('Access-Control-Allow-Origin',clientOrigin)
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Content-Type')
  if (req.method==='OPTIONS') { res.writeHead(204).end(); return }
  if (req.method!=='POST' || !handlers.has(route)) { res.writeHead(404).end(); return }
  res.setHeader('Content-Type','application/json')
  if (active>=8) { res.writeHead(429).end(JSON.stringify({error:'Servidor ocupado. Tente novamente.'})); return }
  active++
  try {
    let body=''
    for await (const chunk of req) {
      body += chunk
      if (body.length>4096) { res.writeHead(413).end(); return }
    }
    let value=await handlers.get(route)(JSON.parse(body).input)
    if (route==='stream') {
      const now=Date.now()
      for (const [key,item] of media) if (item.expires<now) media.delete(key)
      if (media.size>=128) media.delete(media.keys().next().value)
      const key=randomUUID()
      media.set(key,{url:value,expires:now+15*60*1000})
      value=publicOrigin+'/audio/'+key
    }
    res.end(JSON.stringify({value}))
  } catch(error) { res.end(JSON.stringify({error:error.message || 'Servidor indisponível.'})) }
  finally { active-- }
}).listen(Number(process.env.PORT || 8787))

