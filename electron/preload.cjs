const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('passionaris', {
  isElectron: true,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: s => ipcRenderer.invoke('settings:set', s),
  launch: s => ipcRenderer.send('game:launch', s),
  exitToLauncher: () => ipcRenderer.send('game:exit-to-launcher'),
  quit: () => ipcRenderer.send('app:quit'),
  minimize: () => ipcRenderer.send('win:minimize'),
  saves: {
    list: () => ipcRenderer.invoke('saves:list'),
    save: (id, bytes) => ipcRenderer.invoke('saves:save', id, bytes),
    load: id => ipcRenderer.invoke('saves:load', id),
    remove: id => ipcRenderer.invoke('saves:remove', id),
  },
});
