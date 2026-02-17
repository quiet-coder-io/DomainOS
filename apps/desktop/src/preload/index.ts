import { contextBridge, ipcRenderer } from 'electron'
import type { DomainOSAPI, KBUpdateProposal } from './api'

const api: DomainOSAPI = {
  platform: process.platform,

  domain: {
    create: (input) => ipcRenderer.invoke('domain:create', input),
    list: () => ipcRenderer.invoke('domain:list'),
    get: (id) => ipcRenderer.invoke('domain:get', id),
    update: (id, input) => ipcRenderer.invoke('domain:update', id, input),
    delete: (id) => ipcRenderer.invoke('domain:delete', id),
  },

  kb: {
    scan: (domainId) => ipcRenderer.invoke('kb:scan', domainId),
    files: (domainId) => ipcRenderer.invoke('kb:files', domainId),
  },

  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    onStreamChunk(callback: (chunk: string) => void) {
      ipcRenderer.on('chat:stream-chunk', (_event, chunk: string) => callback(chunk))
    },
    offStreamChunk() {
      ipcRenderer.removeAllListeners('chat:stream-chunk')
    },
    onStreamDone(callback: () => void) {
      ipcRenderer.on('chat:stream-done', () => callback())
    },
    offStreamDone() {
      ipcRenderer.removeAllListeners('chat:stream-done')
    },
  },

  kbUpdate: {
    apply: (domainId: string, proposal: KBUpdateProposal) =>
      ipcRenderer.invoke('kb:apply-update', domainId, proposal),
  },

  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
  },
}

contextBridge.exposeInMainWorld('domainOS', api)
