'use strict'
window.mobileApp = true
window.remoteMusic = Object.fromEntries(['catalog','playlist','match','stream'].map(name=>[name,async input=>{
  const base = localStorage.getItem('musicServer')
  if (!base) return {error:'Configure o servidor de música em Preferências.'}
  const response = await fetch(base+'/'+name,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input}),
    signal:AbortSignal.timeout(45000)
  })
  if (!response.ok) return {error:'Servidor de música indisponível.'}
  return response.json()
}]))

