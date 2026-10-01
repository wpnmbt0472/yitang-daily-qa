'use strict';
/**
 * preload.js —— 渲染层与主进程之间唯一的桥
 * 只暴露白名单方法，不把 ipcRenderer 整体交出去。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  submitAnswer: (qid, picked) => ipcRenderer.invoke('answer:submit', { qid, picked }),
  saveConfig: (feishu) => ipcRenderer.invoke('config:save', feishu),
  testFeishu: () => ipcRenderer.invoke('feishu:test'),
  syncFeishu: () => ipcRenderer.invoke('feishu:sync'),
  resetState: () => ipcRenderer.invoke('state:reset'),
  openDataDir: () => ipcRenderer.invoke('shell:openDataDir'),
  confirm: (title, message) => ipcRenderer.invoke('dialog:confirm', { title, message })
});
