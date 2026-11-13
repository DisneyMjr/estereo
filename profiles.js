'use strict'
const profileKey = 'estereo-active-profile'
const profileStore = 'estereo-profiles'
function profiles() { return JSON.parse(localStorage.getItem(profileStore) || '[]') }
function profileScreen() {
  const panel = document.querySelector('#profiles')
  panel.hidden = false
  document.body.classList.add('choosing-profile')
  panel.querySelector('[data-profile-list]').replaceChildren(...profiles().map(profile=>{
    const button=document.createElement('button')
    button.type='button'
    button.textContent=profile.name
    button.onclick=()=>selectProfile(profile.id)
    return button
  }))
}
function selectProfile(id) {
  localStorage.setItem(profileKey,id)
  location.reload()
}
document.querySelector('#profile-form').onsubmit = event => {
  event.preventDefault()
  const name = event.currentTarget.elements.profile.value.trim()
  if (!name) return
  const saved = profiles()
  const existing = saved.find(profile=>profile.name.toLowerCase()===name.toLowerCase())
  if (existing) { selectProfile(existing.id); return }
  const id = crypto.randomUUID()
  localStorage.setItem(profileStore,JSON.stringify([...saved,{id,name}]))
  selectProfile(id)
}
document.querySelector('#guest').onclick = ()=>selectProfile('guest')
