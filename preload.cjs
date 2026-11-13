const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('remoteMusic', {
  playlist: input => ipcRenderer.invoke('remote:playlist',input),
  catalog: query => ipcRenderer.invoke('remote:catalog',query),
  match: track => ipcRenderer.invoke('remote:match',track),
  stream: id => ipcRenderer.invoke('remote:stream',id)
})

