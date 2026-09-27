const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vget', {
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  parse: (url) => ipcRenderer.invoke('parse', url),
  download: (url, opts) => ipcRenderer.invoke('download:start', url, opts),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  selectFile: () => ipcRenderer.invoke('dialog:selectFile'),
  onTaskProgress: (cb) => ipcRenderer.on('task:progress', (_e, data) => cb(data)),
})
