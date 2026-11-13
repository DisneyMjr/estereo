'use strict'
const bands = [32,64,125,250,500,1000,2000,4000,8000,16000]
const presets = {
  'Plano':[0,0,0,0,0,0,0,0,0,0],
  'Graves':[5,5,4,2,0,0,0,0,0,0],
  'Clareza':[-2,-2,-1,0,0,2,3,3,2,1],
  'Suave':[1,2,2,1,0,0,-1,-2,-2,-3]
}
const eqStore = 'estereo-eq-'+localStorage.getItem(profileKey)
const eqElement = document.querySelector('#equalizer')
let eqSettings = {enabled:false,gains:[...presets.Plano]}
try {
  const saved=JSON.parse(localStorage.getItem(eqStore))
  if (saved?.gains?.length===bands.length && saved.gains.every(value=>Number.isFinite(value)&&Math.abs(value)<=12))
    eqSettings={enabled:!!saved.enabled,gains:saved.gains}
} catch {}
let eqContext
let eqFilters
let eqGain
function updateEq() {
  localStorage.setItem(eqStore,JSON.stringify(eqSettings))
  if (eqFilters) {
    eqFilters.forEach((filter,i)=>{filter.gain.value=eqSettings.enabled?eqSettings.gains[i]:0})
    eqGain.gain.value=eqSettings.enabled?10**(-Math.max(0,...eqSettings.gains)/20):1
  }
}
async function enableEq() {
  if (!eqContext) {
    eqContext = new AudioContext()
    const source = eqContext.createMediaElementSource(document.querySelector('#audio'))
    eqFilters = bands.map(frequency=>{
      const filter=eqContext.createBiquadFilter()
      filter.type='peaking'
      filter.frequency.value=frequency
      filter.Q.value=1.35
      return filter
    })
    eqGain=eqContext.createGain()
    const graph=[source,...eqFilters,eqGain,eqContext.destination]
    graph.slice(1).forEach((node,i)=>graph[i].connect(node))
  }
  updateEq()
  await eqContext.resume()
}
function showEq() {
  if (eqElement.open) {eqElement.close();return}
  eqElement.innerHTML='<div class="eq-head"><h2>Equalizador</h2><label><input type="checkbox" data-eq-enable> Ativar</label></div>'+
    '<div class="actions">'+Object.keys(presets).map(name=>'<button type="button" data-preset="'+name+'">'+name+'</button>').join('')+'</div>'+
    '<div class="eq-bands">'+bands.map((hz,i)=>{
      const label=hz>=1000?hz/1000+'k':hz
      return '<label><output>'+eqSettings.gains[i]+'</output><input data-band="'+i+'" type="range" min="-12" max="12" step="1" value="'+eqSettings.gains[i]+'" aria-label="'+hz+' Hz"><span>'+label+'</span></label>'
    }).join('')+'</div><button type="button" data-eq-close>Fechar</button>'
  eqElement.querySelector('[data-eq-enable]').checked=eqSettings.enabled
  eqElement.showModal()
}
eqElement.addEventListener('input',event=>{
  const input=event.target
  if (input.matches('[data-eq-enable]')) {
    eqSettings.enabled=input.checked
    if (eqSettings.enabled) enableEq().catch(()=>{})
  } else if (input.matches('[data-band]')) {
    eqSettings.gains[Number(input.dataset.band)]=Number(input.value)
    input.previousElementSibling.value=input.value
  }
  updateEq()
})
eqElement.addEventListener('click',event=>{
  const name=event.target.dataset.preset
  if (name) {
    eqSettings.gains=[...presets[name]]
    updateEq()
    eqElement.querySelectorAll('[data-band]').forEach((input,i)=>{
      input.value=eqSettings.gains[i]
      input.previousElementSibling.value=input.value
    })
  }
  if (event.target.matches('[data-eq-close]')) eqElement.close()
})
