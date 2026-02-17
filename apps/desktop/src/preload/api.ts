/**
 * Type definition for the DomainOS preload API.
 * Shared between preload (implementation) and renderer (consumption).
 */

export interface DomainOSAPI {
  platform: string

  domain: {
    create(input: { name: string; description?: string; kbPath: string }): Promise<IPCResult<Domain>>
    list(): Promise<IPCResult<Domain[]>>
    get(id: string): Promise<IPCResult<Domain>>
    update(id: string, input: { name?: string; description?: string; kbPath?: string }): Promise<IPCResult<Domain>>
    delete(id: string): Promise<IPCResult<void>>
  }

  kb: {
    scan(domainId: string): Promise<IPCResult<KBSyncResult>>
    files(domainId: string): Promise<IPCResult<KBFile[]>>
  }

  chat: {
    send(payload: {
      domainId: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      apiKey: string
    }): Promise<IPCResult<{ content: string; proposals: KBUpdateProposal[] }>>
    onStreamChunk(callback: (chunk: string) => void): void
    offStreamChunk(): void
    onStreamDone(callback: () => void): void
    offStreamDone(): void
  }

  kbUpdate: {
    apply(
      domainId: string,
      proposal: KBUpdateProposal,
    ): Promise<IPCResult<void>>
  }

  dialog: {
    openFolder(): Promise<IPCResult<string | null>>
  }

  intake: {
    listPending(): Promise<IPCResult<IntakeItem[]>>
    get(id: string): Promise<IPCResult<IntakeItem>>
    classify(id: string, apiKey: string): Promise<IPCResult<{ item: IntakeItem; classification: ClassifyResult }>>
    confirm(id: string, domainId: string): Promise<IPCResult<IntakeItem>>
    dismiss(id: string): Promise<IPCResult<IntakeItem>>
    getToken(): Promise<IPCResult<string>>
    getPort(): Promise<IPCResult<number>>
    onNewItem(callback: (itemId: string) => void): void
    offNewItem(): void
  }
}

// Simplified types for IPC boundary (no class instances, just plain data)
export interface IPCResult<T> {
  ok: boolean
  value?: T
  error?: string
}

export interface Domain {
  id: string
  name: string
  description: string
  kbPath: string
  createdAt: string
  updatedAt: string
}

export interface KBFile {
  id: string
  domainId: string
  relativePath: string
  contentHash: string
  sizeBytes: number
  lastSyncedAt: string
}

export interface KBSyncResult {
  added: number
  updated: number
  deleted: number
}

export interface KBUpdateProposal {
  file: string
  action: 'create' | 'update' | 'delete'
  reasoning: string
  content: string
}

export interface IntakeItem {
  id: string
  sourceUrl: string
  title: string
  content: string
  extractionMode: string
  contentSizeBytes: number
  suggestedDomainId: string | null
  confidence: number | null
  status: 'pending' | 'classified' | 'ingested' | 'dismissed'
  createdAt: string
  resolvedAt: string | null
}

export interface ClassifyResult {
  domainId: string
  domainName: string
  confidence: number
  reasoning: string
}
