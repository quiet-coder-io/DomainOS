import { contextBridge, ipcRenderer } from 'electron'
import type { DomainOSAPI, KBUpdateProposal, ToolUseEvent, ProviderConfig, DependencyType, DeadlineStatus, DeadlineSource } from './api'

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
    scaffold: (input: { dirPath: string; domainName: string }) =>
      ipcRenderer.invoke('kb:scaffold', input),
    watchStart: (domainId) => ipcRenderer.invoke('kb:watch-start', domainId),
    watchStop: (domainId) => ipcRenderer.invoke('kb:watch-stop', domainId),
    onFilesChanged(callback: (domainId: string) => void) {
      ipcRenderer.on('kb:files-changed', (_event, domainId: string) => callback(domainId))
    },
    offFilesChanged() {
      ipcRenderer.removeAllListeners('kb:files-changed')
    },
  },

  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    extractKbUpdates: (payload) => ipcRenderer.invoke('chat:extract-kb-updates', payload),
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
    onToolUse(callback: (data: ToolUseEvent) => void) {
      const handler = (_e: unknown, data: ToolUseEvent): void => callback(data)
      ipcRenderer.on('chat:tool-use', handler as (...args: unknown[]) => void)
      return () => { ipcRenderer.removeListener('chat:tool-use', handler as (...args: unknown[]) => void) }
    },
  },

  gmail: {
    startOAuth: () => ipcRenderer.invoke('gmail:start-oauth'),
    checkConnected: () => ipcRenderer.invoke('gmail:check-connected'),
    disconnect: () => ipcRenderer.invoke('gmail:disconnect'),
  },

  kbUpdate: {
    apply: (domainId: string, proposal: KBUpdateProposal) =>
      ipcRenderer.invoke('kb:apply-update', domainId, proposal),
  },

  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
  },

  intake: {
    listPending: () => ipcRenderer.invoke('intake:list-pending'),
    get: (id: string) => ipcRenderer.invoke('intake:get', id),
    classify: (id: string, apiKey: string) => ipcRenderer.invoke('intake:classify', id, apiKey),
    confirm: (id: string, domainId: string) => ipcRenderer.invoke('intake:confirm', id, domainId),
    dismiss: (id: string) => ipcRenderer.invoke('intake:dismiss', id),
    findByExternalId: (sourceType: string, externalId: string) =>
      ipcRenderer.invoke('intake:find-by-external-id', sourceType, externalId),
    listBySourceType: (sourceType: string, limit?: number) =>
      ipcRenderer.invoke('intake:list-by-source-type', sourceType, limit),
    getToken: () => ipcRenderer.invoke('intake:get-token'),
    getPort: () => ipcRenderer.invoke('intake:get-port'),
    onNewItem(callback: (itemId: string) => void) {
      ipcRenderer.on('intake:new-item', (_event, itemId: string) => callback(itemId))
    },
    offNewItem() {
      ipcRenderer.removeAllListeners('intake:new-item')
    },
  },

  protocol: {
    list: (domainId: string) => ipcRenderer.invoke('protocol:list', domainId),
    create: (input: { domainId: string; name: string; content: string; sortOrder?: number }) =>
      ipcRenderer.invoke('protocol:create', input),
    update: (id: string, input: { name?: string; content?: string; sortOrder?: number }) =>
      ipcRenderer.invoke('protocol:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('protocol:delete', id),
  },

  sharedProtocol: {
    list: () => ipcRenderer.invoke('shared-protocol:list'),
    create: (input) => ipcRenderer.invoke('shared-protocol:create', input),
    update: (id: string, input) => ipcRenderer.invoke('shared-protocol:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('shared-protocol:delete', id),
    toggle: (id: string) => ipcRenderer.invoke('shared-protocol:toggle', id),
  },

  session: {
    getActive: (domainId: string) => ipcRenderer.invoke('session:get-active', domainId),
    list: (domainId: string, limit?: number) => ipcRenderer.invoke('session:list', domainId, limit),
    end: (id: string) => ipcRenderer.invoke('session:end', id),
  },

  relationship: {
    getSiblings: (domainId: string) => ipcRenderer.invoke('relationship:get-siblings', domainId),
    getRelationships: (domainId: string) => ipcRenderer.invoke('relationship:get-relationships', domainId),
    addRelationship: (
      fromDomainId: string,
      toDomainId: string,
      options?: {
        relationshipType?: string
        dependencyType?: DependencyType
        description?: string
        reciprocate?: boolean
        reciprocalType?: DependencyType
      },
    ) => ipcRenderer.invoke('relationship:add-relationship', fromDomainId, toDomainId, options),
    addSibling: (domainId: string, siblingDomainId: string) =>
      ipcRenderer.invoke('relationship:add-sibling', domainId, siblingDomainId),
    removeRelationship: (fromDomainId: string, toDomainId: string) =>
      ipcRenderer.invoke('relationship:remove-relationship', fromDomainId, toDomainId),
    removeSibling: (domainId: string, siblingDomainId: string) =>
      ipcRenderer.invoke('relationship:remove-sibling', domainId, siblingDomainId),
  },

  deadline: {
    create: (input: {
      domainId: string; text: string; dueDate: string; priority?: number
      source?: DeadlineSource; sourceRef?: string
    }) => ipcRenderer.invoke('deadline:create', input),
    list: (domainId: string, status?: DeadlineStatus) =>
      ipcRenderer.invoke('deadline:list', domainId, status),
    active: (domainId: string) => ipcRenderer.invoke('deadline:active', domainId),
    overdue: (domainId?: string) => ipcRenderer.invoke('deadline:overdue', domainId),
    upcoming: (domainId: string, days: number) =>
      ipcRenderer.invoke('deadline:upcoming', domainId, days),
    snooze: (id: string, until: string) => ipcRenderer.invoke('deadline:snooze', id, until),
    complete: (id: string) => ipcRenderer.invoke('deadline:complete', id),
    cancel: (id: string) => ipcRenderer.invoke('deadline:cancel', id),
    findBySourceRef: (domainId: string, sourceRef: string) =>
      ipcRenderer.invoke('deadline:find-by-source-ref', domainId, sourceRef),
    onUnsnoozeWake(callback: () => void) {
      ipcRenderer.on('deadline:unsnooze-wake', () => callback())
    },
    offUnsnoozeWake() {
      ipcRenderer.removeAllListeners('deadline:unsnooze-wake')
    },
  },

  briefing: {
    portfolioHealth: () => ipcRenderer.invoke('briefing:portfolio-health'),
    analyze: (requestId: string) => ipcRenderer.invoke('briefing:analyze', requestId),
    analyzeCancel: () => ipcRenderer.invoke('briefing:analyze-cancel'),
    onAnalysisChunk(callback: (payload: { requestId: string; chunk: string }) => void) {
      ipcRenderer.on('briefing:analysis-chunk', (_event, payload: { requestId: string; chunk: string }) => callback(payload))
    },
    offAnalysisChunk() {
      ipcRenderer.removeAllListeners('briefing:analysis-chunk')
    },
  },

  audit: {
    list: (domainId: string, limit?: number) => ipcRenderer.invoke('audit:list', domainId, limit),
    listByType: (domainId: string, eventType: string, limit?: number) =>
      ipcRenderer.invoke('audit:list-by-type', domainId, eventType, limit),
  },

  gapFlag: {
    list: (domainId: string, limit?: number) => ipcRenderer.invoke('gap-flag:list', domainId, limit),
    open: (domainId: string) => ipcRenderer.invoke('gap-flag:open', domainId),
    acknowledge: (id: string) => ipcRenderer.invoke('gap-flag:acknowledge', id),
    resolve: (id: string) => ipcRenderer.invoke('gap-flag:resolve', id),
  },

  decision: {
    list: (domainId: string, limit?: number) => ipcRenderer.invoke('decision:list', domainId, limit),
    active: (domainId: string) => ipcRenderer.invoke('decision:active', domainId),
    reject: (id: string) => ipcRenderer.invoke('decision:reject', id),
  },

  settings: {
    getApiKey: () => ipcRenderer.invoke('settings:get-api-key'),
    setApiKey: (key: string) => ipcRenderer.invoke('settings:set-api-key', key),
    setProviderKey: (provider: string, key: string) => ipcRenderer.invoke('settings:set-provider-key', provider, key),
    clearProviderKey: (provider: string) => ipcRenderer.invoke('settings:clear-provider-key', provider),
    getProviderKeysStatus: () => ipcRenderer.invoke('settings:get-provider-keys-status'),
    getProviderConfig: () => ipcRenderer.invoke('settings:get-provider-config'),
    setProviderConfig: (config) => ipcRenderer.invoke('settings:set-provider-config', config),
    listOllamaModels: (baseUrl?: string) => ipcRenderer.invoke('settings:list-ollama-models', baseUrl),
    testOllama: (baseUrl?: string) => ipcRenderer.invoke('settings:test-ollama', baseUrl),
    testTools: (provider: string, model: string) => ipcRenderer.invoke('settings:test-tools', provider, model),
  },
}

contextBridge.exposeInMainWorld('domainOS', api)
