/**
 * Type definition for the DomainOS preload API.
 * Shared between preload (implementation) and renderer (consumption).
 */

export interface DomainOSAPI {
  platform: string

  domain: {
    create(input: { name: string; description?: string; kbPath: string; identity?: string; escalationTriggers?: string }): Promise<IPCResult<Domain>>
    list(): Promise<IPCResult<Domain[]>>
    get(id: string): Promise<IPCResult<Domain>>
    update(id: string, input: { name?: string; description?: string; kbPath?: string; identity?: string; escalationTriggers?: string }): Promise<IPCResult<Domain>>
    delete(id: string): Promise<IPCResult<void>>
  }

  kb: {
    scan(domainId: string): Promise<IPCResult<KBSyncResult>>
    files(domainId: string): Promise<IPCResult<KBFile[]>>
    watchStart(domainId: string): Promise<IPCResult<void>>
    watchStop(domainId: string): Promise<IPCResult<void>>
    onFilesChanged(callback: (domainId: string) => void): void
    offFilesChanged(): void
  }

  chat: {
    send(payload: {
      domainId: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      apiKey: string
    }): Promise<IPCResult<{
      content: string
      proposals: KBUpdateProposal[]
      rejectedProposals: RejectedProposal[]
      stopBlocks?: Array<{ reason: string; actionNeeded: string }>
      gapFlags?: Array<{ category: string; description: string }>
      decisions?: Array<{ decisionId: string; decision: string }>
    }>>
    extractKbUpdates(payload: {
      domainId: string
      content: string
    }): Promise<IPCResult<{
      proposals: KBUpdateProposal[]
      rejectedProposals: RejectedProposal[]
    }>>
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
    findByExternalId(sourceType: string, externalId: string): Promise<IPCResult<IntakeItem | null>>
    listBySourceType(sourceType: string, limit?: number): Promise<IPCResult<IntakeItem[]>>
    getToken(): Promise<IPCResult<string>>
    getPort(): Promise<IPCResult<number>>
    onNewItem(callback: (itemId: string) => void): void
    offNewItem(): void
  }

  protocol: {
    list(domainId: string): Promise<IPCResult<Protocol[]>>
    create(input: { domainId: string; name: string; content: string; sortOrder?: number }): Promise<IPCResult<Protocol>>
    update(id: string, input: { name?: string; content?: string; sortOrder?: number }): Promise<IPCResult<Protocol>>
    delete(id: string): Promise<IPCResult<void>>
  }

  sharedProtocol: {
    list(): Promise<IPCResult<SharedProtocol[]>>
    create(input: { name: string; content: string; sortOrder?: number; priority?: number; isEnabled?: boolean; scope?: string }): Promise<IPCResult<SharedProtocol>>
    update(id: string, input: { name?: string; content?: string; sortOrder?: number; priority?: number; isEnabled?: boolean; scope?: string }): Promise<IPCResult<SharedProtocol>>
    delete(id: string): Promise<IPCResult<void>>
    toggle(id: string): Promise<IPCResult<SharedProtocol>>
  }

  session: {
    getActive(domainId: string): Promise<IPCResult<Session | null>>
    list(domainId: string, limit?: number): Promise<IPCResult<Session[]>>
    end(id: string): Promise<IPCResult<Session>>
  }

  relationship: {
    getSiblings(domainId: string): Promise<IPCResult<DomainRelationship[]>>
    addSibling(domainId: string, siblingDomainId: string): Promise<IPCResult<DomainRelationship>>
    removeSibling(domainId: string, siblingDomainId: string): Promise<IPCResult<void>>
  }

  audit: {
    list(domainId: string, limit?: number): Promise<IPCResult<AuditEntry[]>>
    listByType(domainId: string, eventType: string, limit?: number): Promise<IPCResult<AuditEntry[]>>
  }

  gapFlag: {
    list(domainId: string, limit?: number): Promise<IPCResult<GapFlag[]>>
    open(domainId: string): Promise<IPCResult<GapFlag[]>>
    acknowledge(id: string): Promise<IPCResult<GapFlag>>
    resolve(id: string): Promise<IPCResult<GapFlag>>
  }

  decision: {
    list(domainId: string, limit?: number): Promise<IPCResult<Decision[]>>
    active(domainId: string): Promise<IPCResult<Decision[]>>
    reject(id: string): Promise<IPCResult<Decision>>
  }

  settings: {
    getApiKey(): Promise<IPCResult<string>>
    setApiKey(key: string): Promise<IPCResult<void>>
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
  identity: string
  escalationTriggers: string
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
  tier: string
  tierSource: string
}

export interface KBSyncResult {
  added: number
  updated: number
  deleted: number
}

export interface KBUpdateProposal {
  file: string
  action: 'create' | 'update' | 'delete'
  tier: string
  mode: string
  basis: string
  reasoning: string
  content: string
  confirm?: string
}

export interface RejectedProposal {
  id: string
  file: string
  action: string
  reasoning: string
  rejectionReason: string
  suggestedFix?: string
  tier?: string
  mode?: string
  rawExcerpt?: string
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
  sourceType: 'web' | 'gmail' | 'gtasks' | 'manual'
  externalId: string
  metadata: Record<string, unknown>
  createdAt: string
  resolvedAt: string | null
}

export interface ClassifyResult {
  domainId: string
  domainName: string
  confidence: number
  reasoning: string
}

export interface Protocol {
  id: string
  domainId: string
  name: string
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface SharedProtocol {
  id: string
  name: string
  content: string
  sortOrder: number
  priority: number
  isEnabled: boolean
  scope: string
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  domainId: string
  scope: string
  status: string
  modelProvider: string
  modelName: string
  startedAt: string
  endedAt: string | null
}

export interface DomainRelationship {
  id: string
  domainId: string
  siblingDomainId: string
  relationshipType: string
  createdAt: string
}

export interface GapFlag {
  id: string
  domainId: string
  sessionId: string | null
  category: string
  description: string
  sourceMessage: string
  status: string
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AuditEntry {
  id: string
  domainId: string
  sessionId: string | null
  agentName: string
  filePath: string
  changeDescription: string
  contentHash: string
  eventType: string
  source: string
  createdAt: string
  updatedAt: string
}

export interface Decision {
  id: string
  domainId: string
  sessionId: string | null
  decisionId: string
  decision: string
  rationale: string
  downside: string
  revisitTrigger: string
  status: string
  supersedesDecisionId: string | null
  linkedFiles: string[]
  createdAt: string
  updatedAt: string
}
