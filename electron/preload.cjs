const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('passionaris', {
  isElectron: true,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: s => ipcRenderer.invoke('settings:set', s),
  launch: s => ipcRenderer.send('game:launch', s),
  exitToLauncher: () => ipcRenderer.send('game:exit-to-launcher'),
  quit: () => ipcRenderer.send('app:quit'),
  openAlbum: () => ipcRenderer.send('album:open'),
  albumFeedback: text => ipcRenderer.invoke('album:feedback', text),
  minimize: () => ipcRenderer.send('win:minimize'),
  // game window: apply {windowMode, resolution} now (in-game settings); windowState() for checks
  applyWindow: s => ipcRenderer.invoke('win:apply', s),
  windowState: () => ipcRenderer.invoke('win:state'),
  displays: () => ipcRenderer.invoke('app:displays'),
  openSavesFolder: () => ipcRenderer.invoke('app:open-saves-folder'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  saves: {
    list: () => ipcRenderer.invoke('saves:list'),
    save: (id, bytes) => ipcRenderer.invoke('saves:save', id, bytes),
    load: id => ipcRenderer.invoke('saves:load', id),
    remove: id => ipcRenderer.invoke('saves:remove', id),
  },
});
