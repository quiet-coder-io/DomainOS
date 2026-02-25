/**
 * Type definition for the DomainOS preload API.
 * Shared between preload (implementation) and renderer (consumption).
 */

export interface DomainOSAPI {
  platform: string

  domain: {
    create(input: {
      name: string; description?: string; kbPath: string; identity?: string; escalationTriggers?: string; allowGmail?: boolean
      modelProvider?: string | null; modelName?: string | null; forceToolAttempt?: boolean
    }): Promise<IPCResult<Domain>>
    list(): Promise<IPCResult<Domain[]>>
    get(id: string): Promise<IPCResult<Domain>>
    update(id: string, input: {
      name?: string; description?: string; kbPath?: string; identity?: string; escalationTriggers?: string; allowGmail?: boolean
      modelProvider?: string | null; modelName?: string | null; forceToolAttempt?: boolean
    }): Promise<IPCResult<Domain>>
    delete(id: string): Promise<IPCResult<void>>
  }

  kb: {
    scan(domainId: string): Promise<IPCResult<KBSyncResult>>
    files(domainId: string): Promise<IPCResult<KBFile[]>>
    scaffold(input: { dirPath: string; domainName: string }): Promise<IPCResult<{
      files: Array<{ filename: string; status: 'created' | 'skipped' }>
      createdCount: number
      skippedCount: number
    }>>
    watchStart(domainId: string): Promise<IPCResult<void>>
    watchStop(domainId: string): Promise<IPCResult<void>>
    onFilesChanged(callback: (domainId: string) => void): void
    offFilesChanged(): void
  }

  chat: {
    send(payload: {
      requestId: string
      domainId: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      activeSkillId?: string
    }): Promise<IPCResult<{
      requestId: string
      content: string
      proposals: KBUpdateProposal[]
      rejectedProposals: RejectedProposal[]
      cancelled?: boolean
      stopBlocks?: Array<{ reason: string; actionNeeded: string }>
      gapFlags?: Array<{ category: string; description: string }>
      decisions?: Array<{ decisionId: string; decision: string }>
      advisory?: {
        classifiedMode: string
        persisted: Array<{ artifactId: string; type: AdvisoryType; status: AdvisoryStatus }>
        draftBlocks: Array<{
          fenceType: string
          rawJson: string
          normalizedControl: { schemaVersion: number; type: string; persist: string; title: string }
          payload: Record<string, unknown>
          savedArtifactId?: string
        }>
        systemNotes: string[]
      }
    }>>
    sendCancel(): Promise<IPCResult<{ cancelled: boolean }>>
    extractKbUpdates(payload: {
      domainId: string
      content: string
    }): Promise<IPCResult<{
      proposals: KBUpdateProposal[]
      rejectedProposals: RejectedProposal[]
    }>>
    onStreamChunk(callback: (data: { requestId: string; chunk: string }) => void): () => void
    onStreamDone(callback: (data: { requestId: string; cancelled: boolean }) => void): () => void
    onToolUse(callback: (data: import('../shared/chat-types').ToolUseEvent) => void): () => void
  }

  gmail: {
    startOAuth(): Promise<IPCResult<void>>
    checkConnected(): Promise<IPCResult<{ connected: boolean; blocked?: boolean; email?: string }>>
    disconnect(): Promise<IPCResult<void>>
  }

  gtasks: {
    startOAuth(): Promise<IPCResult<void>>
    checkConnected(): Promise<IPCResult<{ connected: boolean; blocked?: boolean; email?: string }>>
    disconnect(): Promise<IPCResult<void>>
    completeTask(taskListId: string, taskId: string): Promise<IPCResult<void>>
    deleteTask(taskListId: string, taskId: string): Promise<IPCResult<void>>
    updateTask(taskListId: string, taskId: string, updates: { title?: string; notes?: string; due?: string }): Promise<IPCResult<void>>
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
    getRelationships(domainId: string): Promise<IPCResult<RelationshipView[]>>
    addRelationship(
      fromDomainId: string,
      toDomainId: string,
      options?: {
        relationshipType?: string
        dependencyType?: DependencyType
        description?: string
        reciprocate?: boolean
        reciprocalType?: DependencyType
      },
    ): Promise<IPCResult<DomainRelationship>>
    addSibling(domainId: string, siblingDomainId: string): Promise<IPCResult<DomainRelationship>>
    removeRelationship(fromDomainId: string, toDomainId: string): Promise<IPCResult<void>>
    removeSibling(domainId: string, siblingDomainId: string): Promise<IPCResult<void>>
  }

  deadline: {
    create(input: {
      domainId: string; text: string; dueDate: string; priority?: number
      source?: DeadlineSource; sourceRef?: string
    }): Promise<IPCResult<Deadline>>
    list(domainId: string, status?: DeadlineStatus): Promise<IPCResult<Deadline[]>>
    active(domainId: string): Promise<IPCResult<Deadline[]>>
    overdue(domainId?: string): Promise<IPCResult<Deadline[]>>
    upcoming(domainId: string, days: number): Promise<IPCResult<Deadline[]>>
    snooze(id: string, until: string): Promise<IPCResult<Deadline>>
    complete(id: string): Promise<IPCResult<Deadline>>
    cancel(id: string): Promise<IPCResult<Deadline>>
    findBySourceRef(domainId: string, sourceRef: string): Promise<IPCResult<Deadline | null>>
    onUnsnoozeWake(callback: () => void): void
    offUnsnoozeWake(): void
  }

  briefing: {
    portfolioHealth(): Promise<IPCResult<PortfolioHealth>>
    analyze(requestId: string): Promise<IPCResult<BriefingAnalysis>>
    analyzeCancel(): Promise<IPCResult<void>>
    onAnalysisChunk(callback: (payload: { requestId: string; chunk: string }) => void): void
    offAnalysisChunk(): void
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

  advisory: {
    list(domainId: string, options?: { status?: AdvisoryStatus; type?: AdvisoryType; limit?: number }): Promise<IPCResult<AdvisoryArtifact[]>>
    get(id: string): Promise<IPCResult<AdvisoryArtifact>>
    archive(id: string): Promise<IPCResult<AdvisoryArtifact>>
    unarchive(id: string): Promise<IPCResult<AdvisoryArtifact>>
    rename(id: string, title: string): Promise<IPCResult<AdvisoryArtifact>>
    saveDraftBlock(input: SaveDraftBlockInput): Promise<IPCResult<SaveDraftBlockResult>>
    extractTasks(artifactId: string, domainId: string): Promise<IPCResult<TurnIntoTasksOutput>>
  }

  automation: {
    list(domainId: string): Promise<IPCResult<Automation[]>>
    get(id: string): Promise<IPCResult<Automation>>
    create(input: {
      domainId: string; name: string; description?: string
      triggerType: AutomationTriggerType; triggerCron?: string | null; triggerEvent?: AutomationTriggerEvent | null
      promptTemplate: string; actionType: AutomationActionType; actionConfig?: string
      enabled?: boolean; catchUpEnabled?: boolean; storePayloads?: boolean; deadlineWindowDays?: number | null
    }): Promise<IPCResult<Automation>>
    update(id: string, input: {
      name?: string; description?: string
      triggerType?: AutomationTriggerType; triggerCron?: string | null; triggerEvent?: AutomationTriggerEvent | null
      promptTemplate?: string; actionType?: AutomationActionType; actionConfig?: string
      enabled?: boolean; catchUpEnabled?: boolean; storePayloads?: boolean; deadlineWindowDays?: number | null
    }): Promise<IPCResult<Automation>>
    delete(id: string): Promise<IPCResult<void>>
    toggle(id: string): Promise<IPCResult<Automation>>
    run(id: string, requestId: string): Promise<IPCResult<void>>
    runs(automationId: string, limit?: number): Promise<IPCResult<AutomationRun[]>>
    resetFailures(id: string): Promise<IPCResult<Automation>>
    onNotification(callback: (data: AutomationNotification) => void): void
    offNotification(): void
  }

  tags: {
    get(domainId: string): Promise<IPCResult<DomainTag[]>>
    set(domainId: string, tags: Array<{ key: string; value: string }>): Promise<IPCResult<void>>
    distinctValues(key: string, limit?: number): Promise<IPCResult<Array<{ value: string; count: number }>>>
    filter(filters: Record<string, string[]>): Promise<IPCResult<string[] | null>>
    all(): Promise<IPCResult<Record<string, DomainTag[]>>>
  }

  skill: {
    list(): Promise<IPCResult<Skill[]>>
    listEnabled(): Promise<IPCResult<Skill[]>>
    get(id: string): Promise<IPCResult<Skill>>
    create(input: {
      name: string; description?: string; content: string; outputFormat?: string
      outputSchema?: string | null; toolHints?: string[]; isEnabled?: boolean; sortOrder?: number
    }): Promise<IPCResult<Skill>>
    update(id: string, input: {
      name?: string; description?: string; content?: string; outputFormat?: string
      outputSchema?: string | null; toolHints?: string[]; isEnabled?: boolean; sortOrder?: number
    }): Promise<IPCResult<Skill>>
    delete(id: string): Promise<IPCResult<void>>
    toggle(id: string): Promise<IPCResult<Skill>>
    export(id: string): Promise<IPCResult<{ path: string }>>
    import(): Promise<IPCResult<Skill>>
  }

  file: {
    extractText(filename: string, buffer: ArrayBuffer): Promise<IPCResult<string>>
  }

  settings: {
    getApiKey(): Promise<IPCResult<string>>
    setApiKey(key: string): Promise<IPCResult<void>>
    // Multi-provider key management
    setProviderKey(provider: string, key: string): Promise<IPCResult<void>>
    clearProviderKey(provider: string): Promise<IPCResult<void>>
    getProviderKeysStatus(): Promise<IPCResult<ProviderKeysStatus>>
    // Provider config (no secrets)
    getProviderConfig(): Promise<IPCResult<ProviderConfig>>
    setProviderConfig(config: ProviderConfig): Promise<IPCResult<void>>
    // Ollama
    listOllamaModels(baseUrl?: string): Promise<IPCResult<string[]>>
    testOllama(baseUrl?: string): Promise<IPCResult<boolean>>
    // Tool capability probe
    testTools(provider: string, model: string): Promise<IPCResult<ToolTestResult>>
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
  allowGmail: boolean
  modelProvider: string | null
  modelName: string | null
  forceToolAttempt: boolean
  createdAt: string
  updatedAt: string
}

export interface DomainTag {
  id: string
  domainId: string
  key: string
  value: string
  createdAt: string
}

// Re-export ToolUseEvent from shared types (single source of truth)
export type { ToolUseEvent } from '../shared/chat-types'

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

export type DependencyType = 'blocks' | 'depends_on' | 'informs' | 'parallel' | 'monitor_only'

export interface DomainRelationship {
  id: string
  domainId: string
  siblingDomainId: string
  relationshipType: string
  dependencyType: DependencyType
  description: string
  createdAt: string
}

export type RelationshipPerspective = 'outgoing' | 'incoming'

export interface RelationshipView extends DomainRelationship {
  perspective: RelationshipPerspective
  peerDomainId: string
  peerDomainName: string
  displayKey: string
}

export type DomainStatus = 'active' | 'quiet' | 'stale-risk' | 'blocked'

export interface DomainHealth {
  domainId: string
  domainName: string
  status: DomainStatus
  fileCountTotal: number
  fileCountStatChecked: number
  staleSummary: {
    freshByTier: Record<string, number>
    staleByTier: Record<string, number>
    criticalByTier: Record<string, number>
    fresh: number
    stale: number
    critical: number
    worstFile?: { path: string; tier: string; daysSinceUpdate: number }
  }
  openGapFlags: number
  overdueDeadlines: number
  severityScore: number
  lastTouchedAt: string | null
  outgoingDeps: Array<{
    targetDomainId: string
    targetDomainName: string
    dependencyType: DependencyType
    description: string
  }>
  incomingDeps: Array<{
    sourceDomainId: string
    sourceDomainName: string
    dependencyType: DependencyType
    description: string
  }>
}

export interface CrossDomainAlert {
  severity: 'critical' | 'warning' | 'monitor'
  sourceDomainId: string
  sourceDomainName: string
  dependentDomainId: string
  dependentDomainName: string
  dependentStatus: DomainStatus
  dependentOpenGaps: number
  text: string
  trace: {
    triggerFile?: string
    triggerTier?: string
    triggerStaleness?: number
    dependencyType: DependencyType
    description: string
    baseSeverityScore: number
    escalated: boolean
  }
}

export interface OverdueGTask {
  id: string
  taskListId: string
  taskListTitle: string
  title: string
  due: string
  notes: string
}

export interface PortfolioHealth {
  domains: DomainHealth[]
  alerts: CrossDomainAlert[]
  computedAt: string
  snapshotHash: string
  globalOverdueGTasks?: number
  overdueGTasksList?: OverdueGTask[]
}

export interface BriefingAnalysis {
  alerts: Array<{ domain: string; severity: string; text: string; evidence: string }>
  actions: Array<{ domain: string; priority: number; deadline: string; text: string }>
  monitors: Array<{ domain: string; text: string }>
  diagnostics: { skippedBlocks: number; errors: string[] }
  rawText: string
  snapshotHash: string
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
  confidence: string | null
  horizon: string | null
  reversibilityClass: string | null
  reversibilityNotes: string | null
  category: string | null
  createdAt: string
  updatedAt: string
}

// ── Deadline types ──

export type DeadlineStatus = 'active' | 'snoozed' | 'completed' | 'cancelled'
export type DeadlineSource = 'manual' | 'briefing'

export interface Deadline {
  id: string
  domainId: string
  text: string
  dueDate: string
  priority: number
  status: DeadlineStatus
  source: DeadlineSource
  sourceRef: string
  snoozedUntil: string | null
  completedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

// ── Multi-provider types ──

export interface ProviderKeyStatus {
  hasKey: boolean
  last4?: string
  note?: string
}

export interface ProviderKeysStatus {
  anthropic: ProviderKeyStatus
  openai: ProviderKeyStatus
  ollama: ProviderKeyStatus
}

export interface ProviderConfig {
  version: number
  defaultProvider: string
  defaultModel: string
  ollamaBaseUrl: string
}

export interface ToolTestResult {
  status: 'supported' | 'not_observed' | 'not_supported'
  message: string
}

// ── Advisory types ──

export type AdvisoryType = 'brainstorm' | 'risk_assessment' | 'scenario' | 'strategic_review'
export type AdvisoryStatus = 'active' | 'archived'

export interface AdvisoryArtifact {
  id: string
  domainId: string
  sessionId: string | null
  type: AdvisoryType
  title: string
  llmTitle: string
  schemaVersion: number
  content: string
  fingerprint: string
  source: 'llm' | 'user' | 'import'
  sourceMessageId: string | null
  status: AdvisoryStatus
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SaveDraftBlockInput {
  messageId: string
  blockIndex: number
  domainId: string
  sessionId?: string
}

export type SaveDraftBlockResult =
  | { ok: true; artifactId: string; message: string; idempotent?: boolean }
  | { ok: false; message: string }

export interface ExtractedTask {
  title: string
  priority: 'high' | 'medium' | 'low'
  dueOffset?: number
  sourceField: string
}

export interface NeedsEditingTask {
  title: string
  reason: 'too_short' | 'too_long' | 'no_action_indicator'
  suggestion?: string
  sourceField: string
}

export interface TurnIntoTasksOutput {
  tasks: ExtractedTask[]
  needsEditing?: NeedsEditingTask[]
  artifactId: string
  artifactTitle: string
}

// ── Automation types ──

export type AutomationTriggerType = 'schedule' | 'event' | 'manual'
export type AutomationTriggerEvent = 'intake_created' | 'kb_changed' | 'gap_flag_raised' | 'deadline_approaching'
export type AutomationActionType = 'notification' | 'create_gtask' | 'draft_gmail'
export type AutomationRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface Automation {
  id: string
  domainId: string
  name: string
  description: string
  triggerType: AutomationTriggerType
  triggerCron: string | null
  triggerEvent: AutomationTriggerEvent | null
  promptTemplate: string
  actionType: AutomationActionType
  actionConfig: string
  enabled: boolean
  catchUpEnabled: boolean
  storePayloads: boolean
  deadlineWindowDays: number | null
  nextRunAt: string | null
  failureStreak: number
  cooldownUntil: string | null
  lastRunAt: string | null
  lastError: string | null
  runCount: number
  duplicateSkipCount: number
  lastDuplicateAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationRun {
  id: string
  automationId: string
  domainId: string
  triggerType: AutomationTriggerType
  triggerEvent: AutomationTriggerEvent | null
  triggerData: string | null
  dedupeKey: string | null
  promptHash: string | null
  promptRendered: string | null
  responseHash: string | null
  llmResponse: string | null
  actionType: AutomationActionType
  actionResult: string
  actionExternalId: string | null
  status: AutomationRunStatus
  error: string | null
  errorCode: string | null
  durationMs: number | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export interface AutomationNotification {
  automationId: string
  automationName: string
  domainId: string
  message: string
}

// ── Skill types ──

export type SkillOutputFormat = 'freeform' | 'structured'

export interface Skill {
  id: string
  name: string
  description: string
  content: string
  outputFormat: SkillOutputFormat
  outputSchema: string | null
  toolHints: string[]
  isEnabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}
