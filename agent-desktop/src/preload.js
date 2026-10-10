'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agent', {
  listSources: () => ipcRenderer.invoke('list-sources'),
  getConfig: () => ipcRenderer.invoke('config-get'),
  setConfig: (patch) => ipcRenderer.invoke('config-set', patch),
  sessionStart: (info) => ipcRenderer.send('session-start', info),
  sessionEnd: () => ipcRenderer.send('session-end'),
  sendInput: (ev) => ipcRenderer.send('input', ev),
  forceStop: () => ipcRenderer.send('force-stop'),
  onToggleUnattended: (cb) => ipcRenderer.on('toggle-unattended', (e, v) => cb(v)),
  onForceStop: (cb) => ipcRenderer.on('force-stop', () => cb()),
  onSessionInfo: (cb) => ipcRenderer.on('session-info', (e, info) => cb(info)),
  // operatore / finestra viewer
  openViewer: (target) => ipcRenderer.invoke('open-viewer', target),
  onViewerTarget: (cb) => ipcRenderer.on('viewer-target', (e, t) => cb(t))
});
