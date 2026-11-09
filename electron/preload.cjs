const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orbis', {
  isElectron: true,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: s => ipcRenderer.invoke('settings:set', s),
  launch: s => ipcRenderer.send('game:launch', s),
  exitToLauncher: () => ipcRenderer.send('game:exit-to-launcher'),
  quit: () => ipcRenderer.send('app:quit'),
  minimize: () => ipcRenderer.send('win:minimize'),
});
