import { contextBridge, ipcRenderer } from 'electron'
import { CH, type LivestreamSyncApi, type UpdateStatus } from '../shared/ipc.js'
import type { ProgressEvent } from '../engine/src/types'

const api: LivestreamSyncApi = {
  platform: process.platform,
  analyze: (input) => ipcRenderer.invoke(CH.analyze, input),
  download: (req) => ipcRenderer.invoke(CH.download, req),
  cancel: () => ipcRenderer.invoke(CH.cancel),
  exportTimeline: (req) => ipcRenderer.invoke(CH.exportTimeline, req),
  pickFolder: () => ipcRenderer.invoke(CH.pickFolder),
  openFolder: (path) => ipcRenderer.invoke(CH.openFolder, path),
  revealFile: (path) => ipcRenderer.invoke(CH.revealFile, path),
  getRoster: () => ipcRenderer.invoke(CH.getRoster),
  saveRoster: (roster) => ipcRenderer.invoke(CH.saveRoster, roster),
  getDefaults: () => ipcRenderer.invoke(CH.getDefaults),
  checkTools: () => ipcRenderer.invoke(CH.checkTools),
  onProgress: (cb) => {
    const listener = (_e: unknown, ev: ProgressEvent) => cb(ev)
    ipcRenderer.on(CH.progress, listener)
    return () => ipcRenderer.removeListener(CH.progress, listener)
  },
  getVersion: () => ipcRenderer.invoke(CH.getVersion),
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, s: UpdateStatus) => cb(s)
    ipcRenderer.on(CH.updateStatus, listener)
    return () => ipcRenderer.removeListener(CH.updateStatus, listener)
  },
  checkForUpdate: () => ipcRenderer.send(CH.updateCheck),
  downloadUpdate: () => ipcRenderer.send(CH.updateDownload),
  installUpdate: () => ipcRenderer.send(CH.updateInstall),
  minimize: () => ipcRenderer.send(CH.winMinimize),
  toggleMaximize: () => ipcRenderer.send(CH.winMaximize),
  close: () => ipcRenderer.send(CH.winClose),
}

contextBridge.exposeInMainWorld('livestreamsync', api)
