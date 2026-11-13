const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('remoteMusic', {
  playlist: input => ipcRenderer.invoke('remote:playlist',input),
  catalog: query => ipcRenderer.invoke('remote:catalog',query),
  match: track => ipcRenderer.invoke('remote:match',track),
  link: key => ipcRenderer.invoke('remote:link',key),
  stream: id => ipcRenderer.invoke('remote:stream',id)
})
