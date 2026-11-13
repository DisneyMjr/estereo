const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('node:path')
const remote = require('./remote.cjs')
let trustedContents
const requests = new Map()

function register(name, handler) {
  ipcMain.handle('remote:'+name,async (event,value) => {
    if (event.sender!==trustedContents || event.senderFrame!==trustedContents.mainFrame)
      return {error:'Origem de solicitação inválida.'}
    if ((requests.get(name) || 0) >= (['catalog','match'].includes(name)?4:1)) return {error:'Já existe uma solicitação em andamento.'}
    requests.set(name,(requests.get(name)||0)+1)
    try { return {value:await handler(value)} }
    catch (error) { return {error:error.name==='TimeoutError'?'O serviço demorou para responder. Tente novamente.':error.message} }
    finally { requests.set(name,requests.get(name)-1) }
  })
}

async function open() {
  const window = new BrowserWindow({
    width:1240,height:820,minWidth:380,minHeight:560,
    titleBarStyle:'hidden',titleBarOverlay:{color:'#121320',symbolColor:'#ddddea',height:43},
    backgroundColor:'#10111b',icon:path.join(__dirname,'icon.png'),
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'preload.cjs')}
  })
  trustedContents = window.webContents
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  window.webContents.on('will-navigate',event=>event.preventDefault())
  await window.loadFile(path.join(__dirname,'index.html'))
}
app.whenReady().then(async ()=>{
  register('playlist',remote.spotify)
  register('match',remote.youtube)
  register('catalog',remote.catalog)
  register('stream',remote.stream)
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  await open()
  app.on('activate',()=>{if (!BrowserWindow.getAllWindows().length) open()})
})
app.on('window-all-closed',()=>{if (process.platform!=='darwin') app.quit()})



