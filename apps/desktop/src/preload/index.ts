import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('domainOS', {
  platform: process.platform,
})
