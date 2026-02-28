import { createHash } from 'node:crypto'
import { ipcMain, dialog, safeStorage, app, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import { writeFile, readFile, unlink, realpath, stat, copyFile } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
import { existsSync } from 'node:fs'
import {
  DomainRepository,
  DomainRelationshipRepository,
  KBRepository,
  ProtocolRepository,
  SharedProtocolRepository,
  IntakeRepository,
  AuditRepository,
  DecisionRepository,
  SessionRepository,
  scanKBDirectory,
  scaffoldKBFiles,
  buildKBContext,
  buildKBContextDigestOnly,
  buildKBContextDigestPlusStructural,
  buildSiblingContext,
  buildSystemPrompt,
  buildStartupReport,
  getPromptProfile,
  estimateTokens,
  estimateChatTokens,
  clamp,
  AnthropicProvider,
  createProvider,
  shouldUseTools,
  isToolCapableProvider,
  setToolCapability,
  toolCapKey,
  ToolsNotSupportedError,
  DEFAULT_MODELS,
  OllamaProvider,
  parseKBUpdates,
  parseDecisions,
  parseGapFlags,
  parseStopBlocks,
  GapFlagRepository,
  seedDefaultProtocols,
  computeContentHash,
  classifyContent,
  TOKEN_BUDGETS,
  computePortfolioHealth,
  buildBriefingPrompt,
  parseBriefingAnalysis,
  DeadlineRepository,
  AdvisoryRepository,
  parseAdvisoryBlocks,
  extractTasksFromArtifact,
  detectStatusIntent,
  computeDomainStatusSnapshot,
  STATUS_CAPS,
  AutomationRepository,
  BrainstormSessionRepository,
  DomainTagRepository,
  SkillRepository,
  skillToMarkdown,
  markdownToSkillInput,
  ChatMessageRepository,
  ConversationSummaryRepository,
  MissionRepository,
  MissionRunRepository,
  MissionRunner,
  initMissionParsers,
  DomainOSError,
  buildLoanReviewPrompt,
  KBChunkRepository,
  buildVectorKBContext,
  PluginRepository,
  CommandRepository,
  installPlugin,
  cleanupStaging,
  listMarketplace,
  checkDependencies,
  checkCommandDependencies,
} from '@domain-os/core'
import type {
  CreateDomainInput,
  UpdateDomainInput,
  ChatMessage,
  KBUpdateProposal,
  AuditEventType,
  ProviderName,
  ToolCapableProvider,
  AddRelationshipOptions,
  CreateDeadlineInput,
  DeadlineStatus,
  AdvisoryType,
  AdvisoryStatus,
  SaveDraftBlockInput,
  DomainStatusSnapshot,
  CreateAutomationInput,
  UpdateAutomationInput,
  MissionProgressEvent,
  MissionRunnerDeps,
  MissionParseResult,
  CreateSkillInput,
  UpdateSkillInput,
  Result,
} from '@domain-os/core'
import { getIntakeToken } from './intake-token'
import { startKBWatcher, stopKBWatcher } from './kb-watcher'
import { loadGmailCredentials, checkGmailConnected } from './gmail-credentials'
import { startGmailOAuth, disconnectGmail } from './gmail-oauth'
import { GMAIL_TOOLS } from './gmail-tools'
import { ADVISORY_TOOLS } from './advisory-tools'
import { BRAINSTORM_TOOLS } from './brainstorm-tools'
import { loadGTasksCredentials, checkGTasksConnected } from './gtasks-credentials'
import { startGTasksOAuth, disconnectGTasks } from './gtasks-oauth'
import { saveGCPOAuthConfig, loadGCPOAuthConfig, clearGCPOAuthConfig } from './gcp-oauth-config'
import { GTASKS_TOOLS } from './gtasks-tools'
import { runToolLoop } from './tool-loop'
import { sendChatChunk, sendChatDone } from './chat-events'
import { GmailClient, GTasksClient } from '@domain-os/integrations'
import type { GmailAttachmentMeta, GmailMessage } from '@domain-os/integrations'
import type { GmailContextMessage, GmailContextAttachment } from '../preload/api'
import { extractTextFromBuffer, isFormatSupported, resolveFormat } from './text-extractor'
import { emitAutomationEvent } from './automation-events'
import { triggerManualRun } from './automation-engine'
import { EventEmitter } from 'node:events'
import { resolveEmbeddingClient } from './embedding-resolver'
import type { EmbeddingResolverConfig } from './embedding-resolver'
import { EmbeddingManager } from './embedding-manager'
import { EmbeddingCache } from './embedding-cache'

// ── Mission event bus (module scope for lifecycle stability) ──

type MissionStartPayload = { requestId: string; domainId: string }
type MissionTerminalPayload = { requestId: string; domainId: string; status: 'success' | 'failed' | 'cancelled' | 'unknown' }

export const missionEvents = new EventEmitter()

// Mission run tracking — module scope so abort controllers survive across IPC calls
const activeMissionRuns = new Map<string, AbortController>()
const requestIdByRunId = new Map<string, string>()

// ── Stale tool-claim detection ──────────────────────────────────────────────
// When tools become available mid-conversation, old assistant messages saying
// "I can't access Gmail" poison the context. This detector flags those stale
// claims so an ephemeral reset message can be injected before the LLM call.

const STALE_TOOL_CLAIM_PATTERNS = [
  /(?:don't|do not|cannot|can't|unable to)\s+(?:have|access|use|connect to|search|read)(?:\s+\w+){0,3}?\s+(?:your\s+)?(?:email|gmail|google\s*tasks?|tools?|integrations?)/i,
  /(?:lack|without|no)\s+(?:email|gmail|tool|integration)\s+(?:access|capability|connection)/i,
  /(?:email|gmail|tasks?).*(?:unavailable|not available|not connected)/i,
  /(?:don't|do not)\s+have\s+(?:a\s+)?(?:live|direct|real)\s+(?:connection|access)/i,
  /copy[- ]?paste\s+(?:the\s+)?(?:email|content|text)/i,
  /(?:share|paste|provide)\s+(?:the\s+)?(?:email|correspondence|thread)\s+(?:content|text|here)/i,
]

export function detectStaleToolClaims(
  messages: Array<{ role: string; content: string }>,
): boolean {
  return messages.some(
    (m) => m.role === 'assistant' && STALE_TOOL_CLAIM_PATTERNS.some((p) => p.test(m.content)),
  )
}

// ── KB content loader for loan-document-review missions ──

interface KBFileEntry {
  relativePath: string
  chars: number
  contentHash: string
  mtime: string
}

async function loadKBContent(
  kbPath: string,
  docPathsRaw: string,
): Promise<{
  content: string
  files: KBFileEntry[]
  missingPaths: string[]
}> {
  const { createHash: hashCreate } = await import('node:crypto')
  const { readFile: fsReadFile, stat: fsStat } = await import('node:fs/promises')

  // Parse docPaths: split on comma and newline, trim, drop empties
  const paths = docPathsRaw
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (paths.length === 0) {
    // Full KB digest mode
    try {
      const digestPath = join(kbPath, 'kb_digest.md')
      const raw = await fsReadFile(digestPath, 'utf-8')
      const content = raw.slice(0, 12000) // Allow more for loan review
      return {
        content,
        files: [{
          relativePath: 'kb_digest.md',
          chars: content.length,
          contentHash: hashCreate('sha256').update(content).digest('hex'),
          mtime: (await fsStat(digestPath).catch(() => null))?.mtime?.toISOString() ?? 'unknown',
        }],
        missingPaths: [],
      }
    } catch {
      return { content: '(kb_digest.md missing)', files: [], missingPaths: [] }
    }
  }

  // Specific docPaths mode
  const files: KBFileEntry[] = []
  const missingPaths: string[] = []
  const contentParts: string[] = []

  for (const p of paths) {
    // Path traversal guard
    if (p.includes('..') || p.startsWith('/') || p.startsWith('\\')) {
      missingPaths.push(p)
      continue
    }

    const fullPath = join(kbPath, p)
    // Ensure the resolved path is under kbPath
    const resolvedFull = resolve(fullPath)
    const resolvedRoot = resolve(kbPath)
    if (!resolvedFull.startsWith(resolvedRoot + sep) && resolvedFull !== resolvedRoot) {
      missingPaths.push(p)
      continue
    }

    try {
      const raw = await fsReadFile(fullPath, 'utf-8')
      const content = raw.slice(0, 8000)
      const fileStat = await fsStat(fullPath).catch(() => null)
      files.push({
        relativePath: p,
        chars: content.length,
        contentHash: hashCreate('sha256').update(content).digest('hex'),
        mtime: fileStat?.mtime?.toISOString() ?? 'unknown',
      })
      contentParts.push(`--- ${p} ---\n${content}`)
    } catch {
      missingPaths.push(p)
    }
  }

  return {
    content: contentParts.join('\n\n'),
    files,
    missingPaths,
  }
}

// ── Gmail URL parser (for drag-and-drop context) ──

function parseGmailUrl(url: string): { threadId?: string } | null {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('mail.google.com')) return null
    const hash = u.hash.replace(/^#/, '')
    const segments = hash.split('/')
    const lastSeg = segments[segments.length - 1]
    if (!lastSeg || lastSeg.length < 10) return {}
    // Accept any sufficiently long alphanumeric segment as a potential thread ID.
    // Gmail uses multiple formats: pure hex (18f3a2b4c5d6e7f8), FMfcgz..., jrjt...
    // We try it with the API — if invalid, getThread returns [] and we fall back to search.
    if (/^[a-zA-Z0-9_-]{10,}$/.test(lastSeg)) return { threadId: lastSeg }
    return {}
  } catch {
    return null
  }
}

// ── Provider config types (D20) ──

interface ProviderConfigFile {
  version: number
  defaultProvider: ProviderName
  defaultModel: string
  ollamaBaseUrl: string
  windowPinned?: boolean
  responseStyle?: 'concise' | 'detailed'
  historyWindow?: number
  embeddingProvider?: 'auto' | 'ollama' | 'openai' | 'off'
  embeddingModel?: string
}

const DEFAULT_PROVIDER_CONFIG: ProviderConfigFile = {
  version: 1,
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  ollamaBaseUrl: 'http://localhost:11434',
  windowPinned: false,
  responseStyle: 'concise',
  historyWindow: 50,
}

// ── Sender-scoped chat abort controllers ──
const activeChatControllers = new Map<number, AbortController>()

// ── Conditional advisory protocol state (Change 5) ──
const advisoryPinMap = new Map<string, number>() // domainId → pinCount (0=off, 1-3=active)

const ADVISORY_TRIGGER = /\b(brainstorm|risk|scenario|review strategy|compare|pros\s*\.?\s*cons|tradeoff|weigh options)\b/i
const ADVISORY_DEV_FILTER = /\b(stack trace|TypeScript|SQL|npm|pnpm|compile|lint|unit test|migration|exception|traceback)\b/i
const ADVISORY_DEV_OVERRIDE = /\b(tradeoff|strategy|pros\s*\.?\s*cons|weigh)\b/i
const ADVISORY_OFF = /\b(stop advising|just answer|normal mode)\b/i

// ── Conditional KB update instructions state (Change 6) ──
const forceKBMap = new Map<string, { count: number; reason: string }>() // domainId → {count, reason}

const KB_INTENT = /\b(update|edit|change|add to|modify|revise|create|delete|remove|write to|save)\b.*\b(kb|knowledge|file|document|digest|intel)\b/i
const KB_SELF_HEAL_COMPLAINT = /\b(why didn'?t you update|write to file|save this)\b/i

function isAbortError(err: unknown, controller: AbortController): boolean {
  if (controller.signal.aborted) return true
  let current: unknown = err
  while (current instanceof Error) {
    if (current.name === 'AbortError') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Dispatch KB context building based on strategy name. */
async function dispatchKBStrategy(
  strategy: string,
  kbPath: string,
  kbFiles: Array<{ id: string; domainId: string; relativePath: string; contentHash: string; sizeBytes: number; lastSyncedAt: string; tier: string; tierSource: string }>,
  kbBudget: number,
) {
  if (strategy === 'digest_only') {
    return buildKBContextDigestOnly(kbPath, kbFiles as any, kbBudget)
  } else if (strategy === 'digest_plus_structural') {
    return buildKBContextDigestPlusStructural(kbPath, kbFiles as any, kbBudget)
  } else {
    return buildKBContext(kbPath, kbFiles as any, kbBudget)
  }
}

// ── History slicing + conversation summary helpers ──

const RECALL_PHRASES = /\b(earlier|previous|as we discussed|as we said|you mentioned|remember when)\b/i
const CONTINUE_PHRASE = /\bcontinue\b/i

/**
 * Token-aware history slicing: keeps newest messages up to targetCount,
 * trimming oldest if total exceeds tokenCeiling.
 */
function sliceMessagesForLLM<T extends { role: string; content: string }>(
  messages: T[],
  targetCount: number,
  tokenCeiling: number,
): T[] {
  if (messages.length <= targetCount) {
    const est = estimateChatTokens(messages)
    if (est <= tokenCeiling) return messages
  }

  // Start from newest, add until budget exceeded or targetCount reached
  const result: T[] = []
  let runningTokens = 0
  const startIdx = Math.max(0, messages.length - targetCount)

  for (let i = messages.length - 1; i >= startIdx; i--) {
    const msgTokens = estimateTokens(messages[i].content.length) + 4
    if (runningTokens + msgTokens > tokenCeiling && result.length > 0) break
    runningTokens += msgTokens
    result.unshift(messages[i])
  }

  return result
}

/**
 * Detect whether the user is referencing earlier conversation context.
 */
function detectRecallIntent(
  userMessage: string,
  lastActivityMs: number | null,
  hasSummaryOrLargeHistory: boolean,
): { triggered: boolean; reason: string | null } {
  if (RECALL_PHRASES.test(userMessage)) {
    return { triggered: true, reason: 'earlier_phrase' }
  }
  if (CONTINUE_PHRASE.test(userMessage) && lastActivityMs !== null) {
    const gapMinutes = (Date.now() - lastActivityMs) / 60_000
    if (gapMinutes > 30 && hasSummaryOrLargeHistory) {
      return { triggered: true, reason: 'continue_after_gap' }
    }
  }
  return { triggered: false, reason: null }
}

/** Strip code blocks, long quoted text, file contents, base64 from message content. */
function stripNonFactual(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '')               // code blocks
    .replace(/> .+(\n> .+)*/g, '')                  // block quotes
    .replace(/data:[a-z/]+;base64,[A-Za-z0-9+/=]+/g, '') // base64
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Build a heuristic summary from trimmed messages (no LLM). */
function buildHeuristicSummary(
  existingSummary: string,
  trimmedMessages: Array<{ role: string; content: string }>,
): string {
  const MAX_SUMMARY_CHARS = 1600
  const MAX_LINES_PER_FIELD = 3

  // Extract first sentence of each message, cap at 160 chars
  const facts: string[] = []
  for (const msg of trimmedMessages) {
    const clean = stripNonFactual(msg.content)
    if (!clean) continue
    const firstSentence = clean.split(/[.!?\n]/)[0]?.trim()
    if (firstSentence && firstSentence.length > 10) {
      const prefix = msg.role === 'user' ? 'User: ' : 'AI: '
      facts.push(prefix + firstSentence.slice(0, 160))
    }
  }

  if (facts.length === 0) return existingSummary

  // Parse existing summary into fields
  const fields: Record<string, string[]> = {
    'Goals': [],
    'Decisions': [],
    'Open questions': [],
    'Constraints': [],
    'Current status': [],
  }

  if (existingSummary) {
    let currentField = 'Current status'
    for (const line of existingSummary.split('\n')) {
      const fieldMatch = line.match(/^- (Goals|Decisions|Open questions|Constraints|Current status):(.*)/)
      if (fieldMatch) {
        currentField = fieldMatch[1]
        const rest = fieldMatch[2].trim()
        if (rest) fields[currentField].push(rest)
      } else if (line.startsWith('  ') && currentField) {
        fields[currentField].push(line.trim())
      }
    }
  }

  // Append new facts to Current status
  for (const fact of facts) {
    fields['Current status'].push(fact)
  }

  // Trim each field to max lines (keep newest)
  for (const key of Object.keys(fields)) {
    if (fields[key].length > MAX_LINES_PER_FIELD) {
      fields[key] = fields[key].slice(-MAX_LINES_PER_FIELD)
    }
  }

  // Render
  const lines = ['Conversation context:']
  for (const [key, values] of Object.entries(fields)) {
    if (values.length > 0) {
      lines.push(`- ${key}: ${values[0]}`)
      for (let i = 1; i < values.length; i++) {
        lines.push(`  ${values[i]}`)
      }
    } else {
      lines.push(`- ${key}: (none noted)`)
    }
  }

  let result = lines.join('\n')
  if (result.length > MAX_SUMMARY_CHARS) {
    result = result.slice(0, MAX_SUMMARY_CHARS - 15) + '\n...[trimmed]'
  }
  return result
}

// ── In-memory key cache (avoids repeated safeStorage calls) ──
const keyCache: Map<string, string> = new Map()

export function registerIPCHandlers(db: Database.Database, mainWindow: BrowserWindow | null): void {
  const domainRepo = new DomainRepository(db)
  const kbRepo = new KBRepository(db)
  const protocolRepo = new ProtocolRepository(db)
  const sharedProtocolRepo = new SharedProtocolRepository(db)
  const intakeRepo = new IntakeRepository(db)
  const relationshipRepo = new DomainRelationshipRepository(db)
  const auditRepo = new AuditRepository(db)
  const decisionRepo = new DecisionRepository(db)
  const sessionRepo = new SessionRepository(db)
  const gapFlagRepo = new GapFlagRepository(db)
  const deadlineRepo = new DeadlineRepository(db)
  const advisoryRepo = new AdvisoryRepository(db)
  const tagRepo = new DomainTagRepository(db)
  const skillRepo = new SkillRepository(db)
  const chatMessageRepo = new ChatMessageRepository(db)
  const summaryRepo = new ConversationSummaryRepository(db)
  const chunkRepo = new KBChunkRepository(db)
  const embeddingCache = new EmbeddingCache()
  const embeddingManager = new EmbeddingManager({
    chunkRepo,
    cache: embeddingCache,
    onProgress: (domainId, progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('kb:embedding-progress', progress)
      }
    },
  })

  // Resolve embedding client on startup (async, non-blocking)
  ;(async () => {
    try {
      const config = await loadProviderConfig()
      const client = await resolveEmbeddingClient({
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        ollamaBaseUrl: config.ollamaBaseUrl,
        openaiApiKey: await loadProviderKey('openai') ?? undefined,
      } as EmbeddingResolverConfig)
      embeddingManager.updateClient(client)
      if (client) {
        console.log(`[embedding] resolved: ${client.modelName} (${client.dimensions}d)`)
      }
    } catch (err) {
      console.warn(`[embedding] startup resolve failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()

  // Clean up embedding manager on app quit
  app.on('before-quit', () => {
    embeddingManager.cancelAll()
    embeddingCache.clear()
  })

  // Seed default shared protocols (STOP + Gap Detection) — idempotent
  seedDefaultProtocols(sharedProtocolRepo)

  /** Emit skills:changed to renderer so UI caches can invalidate immediately. */
  function emitSkillsChanged(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('skills:changed')
    }
  }

  // ── Deadline snooze wake — unsnooze on startup + hourly ──
  {
    const wakeResult = deadlineRepo.unsnoozeDue()
    if (wakeResult.ok && wakeResult.value > 0) {
      console.log(`[deadlines] Startup unsnooze: ${wakeResult.value} deadline(s) woken`)
    }
  }

  const unsnoozeIntervalId = setInterval(() => {
    const wakeResult = deadlineRepo.unsnoozeDue()
    if (wakeResult.ok && wakeResult.value > 0) {
      console.log(`[deadlines] Hourly unsnooze: ${wakeResult.value} deadline(s) woken`)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deadline:unsnooze-wake')
      }
    }
  }, 3_600_000) // 1 hour

  // Clean up interval on app quit
  app.on('before-quit', () => {
    clearInterval(unsnoozeIntervalId)
  })

  // ── Multi-key storage helpers (D7) ──

  const userDataPath = app.getPath('userData')

  function providerKeyPath(provider: string): string {
    return resolve(userDataPath, `api-key-${provider}.enc`)
  }

  const providerConfigPath = resolve(userDataPath, 'provider-config.json')

  // Legacy migration: copy api-key.enc → api-key-anthropic.enc on first run
  const legacyKeyPath = resolve(userDataPath, 'api-key.enc')
  const anthropicKeyPath = providerKeyPath('anthropic')
  if (existsSync(legacyKeyPath) && !existsSync(anthropicKeyPath)) {
    copyFile(legacyKeyPath, anthropicKeyPath).catch(() => {
      // Best-effort migration
    })
  }

  /** Load a provider's decrypted API key. Internal only — never exposed to renderer. */
  async function loadProviderKey(provider: string): Promise<string> {
    // Check in-memory cache first
    const cached = keyCache.get(provider)
    if (cached) return cached

    try {
      const encrypted = await readFile(providerKeyPath(provider))
      let key: string
      if (safeStorage.isEncryptionAvailable()) {
        key = safeStorage.decryptString(encrypted)
      } else {
        key = encrypted.toString('utf-8')
      }
      if (key) keyCache.set(provider, key)
      return key
    } catch {
      return '' // File doesn't exist yet
    }
  }

  /** Load provider config (no secrets). */
  async function loadProviderConfig(): Promise<ProviderConfigFile> {
    try {
      const raw = await readFile(providerConfigPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ProviderConfigFile>
      // D20: normalize/migrate if version is missing or outdated
      return {
        ...DEFAULT_PROVIDER_CONFIG,
        ...parsed,
        version: 1,
      }
    } catch {
      return { ...DEFAULT_PROVIDER_CONFIG }
    }
  }

  /** Save provider config. */
  async function saveProviderConfig(config: ProviderConfigFile): Promise<void> {
    await writeFile(providerConfigPath, JSON.stringify({ ...config, version: 1 }, null, 2), 'utf-8')
  }

  // --- Domain CRUD ---

  ipcMain.handle('domain:create', (_event, input: CreateDomainInput) => {
    return domainRepo.create(input)
  })

  ipcMain.handle('domain:list', () => {
    return domainRepo.list()
  })

  ipcMain.handle('domain:get', (_event, id: string) => {
    return domainRepo.getById(id)
  })

  ipcMain.handle('domain:update', (_event, id: string, input: UpdateDomainInput) => {
    return domainRepo.update(id, input)
  })

  ipcMain.handle('domain:delete', (_event, id: string) => {
    return domainRepo.delete(id)
  })

  ipcMain.handle('domain:reorder', (_event, orderedIds: string[]) => {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.some((id) => typeof id !== 'string' || !id)) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'orderedIds must be a non-empty array of strings' } }
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'orderedIds must not contain duplicates' } }
    }
    if (orderedIds.length > 500) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'orderedIds exceeds maximum length' } }
    }
    return domainRepo.reorder(orderedIds)
  })

  // --- KB ---

  ipcMain.handle('kb:scan', async (_event, domainId: string) => {
    const domain = domainRepo.getById(domainId)
    if (!domain.ok) return domain

    const scanned = await scanKBDirectory(domain.value.kbPath)
    if (!scanned.ok) return scanned

    return kbRepo.sync(domainId, scanned.value)
  })

  ipcMain.handle('kb:files', (_event, domainId: string) => {
    return kbRepo.getFiles(domainId)
  })

  ipcMain.handle('kb:scaffold', async (_event, input: { dirPath: string; domainName: string }) => {
    if (typeof input?.dirPath !== 'string' || !input.dirPath.trim() ||
        typeof input?.domainName !== 'string' || !input.domainName.trim()) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'dirPath and domainName are required' } }
    }
    return scaffoldKBFiles({ dirPath: input.dirPath.trim(), domainName: input.domainName.trim() })
  })

  // --- Chat (streaming) ---

  ipcMain.handle(
    'chat:send',
    async (
      event: IpcMainInvokeEvent,
      payload: {
        requestId: string
        domainId: string
        messages: ChatMessage[]
        activeSkillId?: string
      },
    ) => {
      const { requestId } = payload
      const t0 = Date.now()
      let tFirstChunk: number | null = null

      // ── Sender-scoped cancellation ──
      const senderId = event.sender.id
      activeChatControllers.get(senderId)?.abort()
      const controller = new AbortController()
      activeChatControllers.set(senderId, controller)

      // Idempotent stream-done: guaranteed exactly once per send
      let streamDoneSent = false
      let cancelled = false // tracks polarity for finally safety net
      function sendStreamDone(isCancelled: boolean): void {
        if (streamDoneSent) return
        streamDoneSent = true
        sendChatDone(event.sender, requestId, isCancelled)
      }

      let fullResponse = ''

      try {
        const domain = domainRepo.getById(payload.domainId)
        if (!domain.ok) return { ok: false, error: domain.error.message }

        // ── Resolve provider + model (per-domain override or global default) ──
        const globalConfig = await loadProviderConfig()
        const resolvedProvider = (domain.value.modelProvider ?? globalConfig.defaultProvider ?? 'anthropic') as ProviderName
        const resolvedModel = domain.value.modelName ?? globalConfig.defaultModel ?? DEFAULT_MODELS[resolvedProvider]
        const ollamaBaseUrl = globalConfig.ollamaBaseUrl ?? 'http://localhost:11434'

        // ── Pre-flight checks (user-facing errors, not crashes) ──
        if (resolvedProvider !== 'ollama') {
          const apiKey = await loadProviderKey(resolvedProvider)
          if (!apiKey) {
            const source = domain.value.modelProvider ? 'Domain override' : 'Global default'
            sendStreamDone(false)
            return { ok: false, error: `${source} uses ${resolvedProvider}, but no API key is configured. Open Settings to add one.` }
          }
        } else {
          const reachable = await OllamaProvider.testConnection(ollamaBaseUrl)
          if (!reachable) {
            sendStreamDone(false)
            return { ok: false, error: `Ollama not reachable at ${ollamaBaseUrl}. Is it running?` }
          }
        }

        const apiKey = resolvedProvider !== 'ollama' ? await loadProviderKey(resolvedProvider) : undefined
        const provider = createProvider({
          provider: resolvedProvider,
          model: resolvedModel,
          apiKey,
          ollamaBaseUrl,
        })

        // Session: get or create active session
        let activeSession = sessionRepo.getActive(payload.domainId)
        let sessionId: string | undefined
        if (activeSession.ok && activeSession.value) {
          sessionId = activeSession.value.id
        } else {
          const newSession = sessionRepo.create({
            domainId: payload.domainId,
            scope: 'working',
            modelProvider: resolvedProvider,
            modelName: resolvedModel,
          })
          if (newSession.ok) {
            sessionId = newSession.value.id
            // Log session start to audit
            auditRepo.logChange({
              domainId: payload.domainId,
              sessionId,
              changeDescription: `Session started (scope: working, provider: ${resolvedProvider}, model: ${resolvedModel})`,
              eventType: 'session_start',
              source: 'system',
            })
          }
        }

        // Early intent detection for KB budget adjustment
        const lastUserMsgEarly = payload.messages.filter((m) => m.role === 'user').at(-1)
        const isStatusBriefingEarly = lastUserMsgEarly && detectStatusIntent(lastUserMsgEarly.content)

        // ── Prompt profile selection ──
        const promptProfile = getPromptProfile(
          resolvedProvider === 'ollama' ? 'ollama_fast' : 'cloud_full',
        )

        // ── History window: slice messages + fetch conversation summary ──
        const historyWindow = globalConfig.historyWindow ?? 50
        const totalMessageCount = payload.messages.length

        // Fetch conversation summary
        let conversationSummary: string | undefined
        const existingSummary = summaryRepo.getSummary(payload.domainId)
        if (existingSummary.ok && existingSummary.value) {
          conversationSummary = existingSummary.value.summaryText || undefined
        }

        // Detect recall intent (expand window if user references earlier context)
        let recallTriggered = false
        let recallReason: string | null = null
        if (lastUserMsgEarly) {
          const lastActivityMs = payload.messages.length > 1
            ? new Date(payload.messages[payload.messages.length - 2]?.content ? Date.now() : Date.now()).getTime()
            : null
          const hasSummaryOrLarge = !!conversationSummary || totalMessageCount > historyWindow
          const recall = detectRecallIntent(lastUserMsgEarly.content, lastActivityMs, hasSummaryOrLarge)
          recallTriggered = recall.triggered
          recallReason = recall.reason
        }

        const targetCount = recallTriggered
          ? Math.min(120, Math.floor(historyWindow * 2.4))
          : historyWindow

        // Token ceiling for history: 70% of (contextLimit - estimated system - outputReserve)
        const tokenCeiling = Math.floor(
          0.7 * (promptProfile.modelContextLimit - promptProfile.maxSystemBudget * 0.3 - promptProfile.outputReserve),
        )
        const slicedMessages = sliceMessagesForLLM(payload.messages, targetCount, tokenCeiling)

        // ── End-to-end budget computation (uses sliced messages) ──
        const historyTokens = estimateChatTokens(slicedMessages)
        const rawBudget = Math.floor(
          (promptProfile.modelContextLimit - historyTokens - promptProfile.outputReserve)
          / promptProfile.safetyFactor,
        )
        const systemBudget = clamp(rawBudget, promptProfile.minSystemBudget, promptProfile.maxSystemBudget)

        const kbFiles = kbRepo.getFiles(payload.domainId)
        if (!kbFiles.ok) return { ok: false, error: kbFiles.error.message }

        // KB budget depends on profile strategy
        const kbBudget = promptProfile.kbStrategy === 'full'
          ? (isStatusBriefingEarly ? TOKEN_BUDGETS.primaryKB - TOKEN_BUDGETS.statusBriefing : TOKEN_BUDGETS.primaryKB)
          : Math.floor(systemBudget * 0.65)

        // KB context building: try vector search first, fall back to strategy dispatch
        let kbContext: Result<{ files: Array<{ path: string; content: string; tier?: string; stalenessLabel?: string }>; totalChars: number; truncated: boolean }, DomainOSError>
        const embClient = embeddingManager.getClient()
        const lastUserMsgForVector = payload.messages.filter(m => m.role === 'user').at(-1)
        if (embClient && lastUserMsgForVector) {
          const hasEmb = chunkRepo.hasEmbeddings(payload.domainId, embClient.modelName)
          if (hasEmb.ok && hasEmb.value) {
            const cached = embeddingCache.get(payload.domainId, embClient.modelName, chunkRepo)
            kbContext = await buildVectorKBContext({
              domainId: payload.domainId,
              kbPath: domain.value.kbPath,
              queryText: lastUserMsgForVector.content,
              embeddingClient: embClient,
              chunkRepo,
              kbFiles: kbFiles.value,
              tokenBudget: kbBudget,
              cachedEmbeddings: cached,
            })
          } else {
            // No embeddings yet — use existing strategy
            kbContext = await dispatchKBStrategy(promptProfile.kbStrategy, domain.value.kbPath, kbFiles.value, kbBudget)
          }
        } else {
          kbContext = await dispatchKBStrategy(promptProfile.kbStrategy, domain.value.kbPath, kbFiles.value, kbBudget)
        }
        if (!kbContext.ok) return { ok: false, error: kbContext.error.message }

        const protocols = protocolRepo.getByDomainId(payload.domainId)
        if (!protocols.ok) return { ok: false, error: protocols.error.message }

        // Fetch enabled shared protocols
        const sharedProtocols = sharedProtocolRepo.listEnabled('chat')
        const sharedProtoList = sharedProtocols.ok
          ? sharedProtocols.value.map((p) => ({ name: p.name, content: p.content }))
          : []

        // Fetch sibling context for cross-domain awareness
        let siblingContext: { siblings: Array<{ domainName: string; digestContent: string }> } | undefined
        const siblingRels = relationshipRepo.getByType(payload.domainId, 'sibling')
        if (siblingRels.ok && siblingRels.value.length > 0) {
          const siblingDomains: Array<{ domainName: string; kbPath: string }> = []
          for (const rel of siblingRels.value) {
            const sibDomain = domainRepo.getById(rel.siblingDomainId)
            if (sibDomain.ok) {
              siblingDomains.push({ domainName: sibDomain.value.name, kbPath: sibDomain.value.kbPath })
            }
          }
          if (siblingDomains.length > 0) {
            const siblingEntries = await buildSiblingContext(
              siblingDomains,
              TOKEN_BUDGETS.siblingPerDomain,
              TOKEN_BUDGETS.siblingGlobal,
            )
            if (siblingEntries.length > 0) {
              siblingContext = { siblings: siblingEntries }
            }
            // Log cross-domain reads to audit
            for (const sib of siblingEntries) {
              auditRepo.logChange({
                domainId: payload.domainId,
                sessionId,
                filePath: `sibling:${sib.domainName}/kb_digest.md`,
                changeDescription: `Cross-domain read: ${sib.domainName} KB_DIGEST`,
                eventType: 'cross_domain_read',
                source: 'system',
              })
            }
          }
        }

        // Build session context from staleness info + open gap flags
        let sessionContext: { scope: string; startupReport: string } | undefined
        if (sessionId) {
          const scope = activeSession.ok && activeSession.value
            ? activeSession.value.scope
            : 'working'
          const staleFiles = kbContext.value.files
            .filter((f) => f.stalenessLabel && !f.stalenessLabel.includes('FRESH'))
            .map((f) => ({
              path: f.path,
              staleness: {
                level: f.stalenessLabel?.includes('CRITICALLY') ? 'critical' as const : 'stale' as const,
                daysSinceUpdate: parseInt(f.stalenessLabel?.match(/(\d+)/)?.[1] ?? '0', 10),
                basis: 'mtime' as const,
              },
            }))

          // Fetch open gap flags for startup report
          const gapFlags: Array<{ category: string; description: string }> = []
          try {
            const rows = db
              .prepare("SELECT category, description FROM gap_flags WHERE domain_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 20")
              .all(payload.domainId) as Array<{ category: string; description: string }>
            gapFlags.push(...rows)
          } catch {
            // gap_flags table might not have data yet
          }

          const report = buildStartupReport(scope as 'quick' | 'working' | 'prep', staleFiles, gapFlags)
          sessionContext = { scope, startupReport: report }
        }

        // Detect wrap-up intent from last user message
        const lastUserMsg = lastUserMsgEarly
        const isWrapUp = lastUserMsg && /\b(wrap\s*up|wrap\s*-\s*up|end\s*session|session\s*summary|final\s*summary)\b/i.test(lastUserMsg.content)

        // Status briefing intent (already detected early for KB budget)
        const isStatusBriefing = isStatusBriefingEarly

        if (isStatusBriefing) {
          console.log('[chat:send] StatusIntentDebug: detected=true message=', lastUserMsg!.content.slice(0, 60))
        }

        let statusBriefing: DomainStatusSnapshot | undefined
        if (isStatusBriefing) {
          const snap = computeDomainStatusSnapshot(db, payload.domainId)
          if (snap.ok) {
            statusBriefing = snap.value
            console.log('[chat:send] StatusBriefingDebug:',
              `caps=${JSON.stringify(STATUS_CAPS)}`,
              `actions=${statusBriefing.topActions.length}`,
              `overdue=${statusBriefing.overdueDeadlines.length}`,
              `gaps=${statusBriefing.openGapFlags.length}`,
              `sinceWindow=${statusBriefing.sinceWindow.kind}`)
          } else {
            console.warn('[chat:send] Status snapshot failed:', snap.error.code)
          }
        }

        // Format current date with day-of-week, time, and timezone for LLM temporal grounding
        const currentDate = new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        }).format(new Date())

        // Detect active brainstorm session for prompt context
        let brainstormContext: { topic: string; ideaCount: number; phase: 'divergent' | 'convergent'; currentTechnique: string; step: string; isPaused: boolean } | undefined
        try {
          const brainstormRepo = new BrainstormSessionRepository(db)
          const activeBrainstorm = brainstormRepo.getActive(payload.domainId)
          if (activeBrainstorm.ok && activeBrainstorm.value) {
            const bs = activeBrainstorm.value
            const currentTech = bs.selectedTechniques.length > 0 ? bs.selectedTechniques[bs.selectedTechniques.length - 1] : 'none'
            brainstormContext = {
              topic: bs.topic,
              ideaCount: bs.ideaCount,
              phase: bs.phase,
              currentTechnique: currentTech,
              step: bs.step,
              isPaused: bs.isPaused,
            }
          }
        } catch {
          // brainstorm_sessions table might not exist yet (pre-migration)
        }

        // Fetch domain tags for prompt injection
        const domainTags = tagRepo.getByDomain(payload.domainId)

        // Fetch active skill (if selected for this message) — checks plugin enabled state
        let activeSkill: {
          name: string; description: string; content: string
          outputFormat: 'freeform' | 'structured'; outputSchema?: string | null; toolHints: string[]
        } | undefined
        if (payload.activeSkillId) {
          const skillResult = skillRepo.getEffectiveEnabled(payload.activeSkillId, payload.domainId)
          if (skillResult.ok && skillResult.value.effectiveEnabled) {
            const s = skillResult.value.skill
            activeSkill = {
              name: s.name,
              description: s.description,
              content: s.content,
              outputFormat: s.outputFormat as 'freeform' | 'structured',
              outputSchema: s.outputSchema,
              toolHints: s.toolHints,
            }
          }
        }

        // ── Conditional advisory protocol (Change 5) ──
        const userMsg = lastUserMsgEarly?.content ?? ''
        let advisoryPinCount = advisoryPinMap.get(payload.domainId) ?? 0

        if (ADVISORY_OFF.test(userMsg)) {
          advisoryPinCount = 0
        } else if (
          ADVISORY_TRIGGER.test(userMsg) ||
          !!brainstormContext ||
          /^\/(advisory|brainstorm)\b/.test(userMsg)
        ) {
          // Check dev filter: don't trigger for dev tasks unless overridden
          const isDevTask = ADVISORY_DEV_FILTER.test(userMsg) && !ADVISORY_DEV_OVERRIDE.test(userMsg)
          if (!isDevTask) {
            advisoryPinCount = Math.max(advisoryPinCount, 3)
          }
        }

        // Initialize on restart: scan last 5 assistant messages for advisory marker
        if (advisoryPinCount === 0 && !advisoryPinMap.has(payload.domainId)) {
          const recentAssistant = slicedMessages
            .filter(m => m.role === 'assistant')
            .slice(-5)
          for (const m of recentAssistant) {
            if (/<!-- advisory_mode:/.test(m.content)) {
              advisoryPinCount = 2
              break
            }
          }
          if (/^\/(advisory)\b/.test(userMsg)) advisoryPinCount = 3
        }

        const advisoryIncluded = advisoryPinCount > 0
        advisoryPinMap.set(payload.domainId, advisoryIncluded
          ? advisoryPinCount  // will decay after response
          : 0)

        // ── Conditional KB update instructions (Change 6) ──
        const kbState = forceKBMap.get(payload.domainId) ?? { count: 0, reason: '' }
        let forceKbCount = kbState.count
        let forceKbReason = kbState.reason

        const kbIntentDetected = KB_INTENT.test(userMsg) ||
          /^\/kb\b/.test(userMsg) ||
          /\bKB:/.test(userMsg) ||
          !!payload.activeSkillId

        if (kbIntentDetected) {
          forceKbCount = Math.max(forceKbCount, 3)
          forceKbReason = 'intent'
        } else if (KB_SELF_HEAL_COMPLAINT.test(userMsg)) {
          forceKbCount = Math.max(forceKbCount, 1)
          forceKbReason = 'user_complaint'
        }

        const kbInstructionsIncluded = forceKbCount > 0

        // Build effective profile (override advisory + kbInstructions based on gates)
        const effectiveProfile = {
          ...promptProfile,
          sections: {
            ...promptProfile.sections,
            advisory: advisoryIncluded ? promptProfile.sections.advisory : false as const,
            kbInstructions: kbInstructionsIncluded ? promptProfile.sections.kbInstructions : false,
          },
        }

        const promptResult = buildSystemPrompt({
          domain: {
            name: domain.value.name,
            description: domain.value.description,
            identity: domain.value.identity ?? '',
            escalationTriggers: domain.value.escalationTriggers ?? '',
            tags: domainTags.map((t) => ({ key: t.key, value: t.value })),
          },
          kbContext: kbContext.value,
          protocols: protocols.value.map((p) => ({ name: p.name, content: p.content })),
          sharedProtocols: sharedProtoList,
          siblingContext,
          sessionContext,
          statusBriefing,
          brainstormContext,
          activeSkill,
          currentDate,
          responseStyle: globalConfig.responseStyle ?? 'concise',
          conversationSummary,
        }, effectiveProfile, systemBudget)
        const systemPrompt = promptResult.prompt

        // Performance logging for prompt profile budgeting
        console.log(`[prompt] profile=${promptProfile.name} rawBudget=${rawBudget} cappedBudget=${systemBudget} maxBudget=${promptProfile.maxSystemBudget} history=${historyTokens} outputReserve=${promptProfile.outputReserve} promptTokens=${promptResult.manifest.totalTokenEstimate} excluded=${promptResult.manifest.excludedSections.length}`)

        // --- Tool-use branch (Advisory + Gmail + GTasks, uses unified shouldUseTools routing) ---
        const gmailCreds = await loadGmailCredentials()
        const gmailEnabled = gmailCreds && domain.value.allowGmail
        const gtasksCreds = await loadGTasksCredentials()
        const gtasksEnabled = !!gtasksCreds // global, no per-domain flag

        // Advisory tools are always available for cloud providers; Gmail/GTasks depend on credentials.
        // For Ollama, always skip tool loop — the non-streaming tool-use path (stream: false) is
        // too slow for local models (full response must complete before any UI update). Users who
        // need tools with Ollama can set forceToolAttempt on the domain.
        const toolsAvailable = resolvedProvider !== 'ollama'

        if (toolsAvailable && shouldUseTools(provider, resolvedProvider, resolvedModel, domain.value, ollamaBaseUrl)) {
          const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = []
          let gmailClient: GmailClient | undefined
          let gtasksClient: GTasksClient | undefined
          let toolsHint = ''
          const integrationNames: string[] = []

          if (gmailEnabled) {
            gmailClient = new GmailClient({
              clientId: gmailCreds.clientId,
              clientSecret: gmailCreds.clientSecret,
              refreshToken: gmailCreds.refreshToken,
            })

            // Preflight: validate credentials before entering tool loop
            const profile = await gmailClient.getProfile()
            if (!profile.ok) {
              sendChatChunk(event.sender, requestId, 'Gmail credentials appear to be invalid or expired. Please reconnect Gmail in the settings bar above.')
              sendStreamDone(false)
              return { ok: true, value: { requestId, content: 'Gmail credentials appear to be invalid or expired. Please reconnect Gmail in the settings bar above.', proposals: [], rejectedProposals: [], stopBlocks: [], gapFlags: [], decisions: [] } }
            }

            tools.push(...GMAIL_TOOLS)
            integrationNames.push('Gmail')
            toolsHint += '\nGmail: use gmail_search/gmail_read for any email request. If unsure whether an email exists, search first. Don\'t claim no access.'
          }

          if (gtasksEnabled) {
            gtasksClient = new GTasksClient({
              clientId: gtasksCreds.clientId,
              clientSecret: gtasksCreds.clientSecret,
              refreshToken: gtasksCreds.refreshToken,
            })

            // Preflight: validate GTasks credentials
            const profile = await gtasksClient.getProfile()
            if (!profile.ok) {
              // Non-fatal: skip GTasks tools but continue with other tools
              console.warn('[chat:send] GTasks credentials invalid, skipping GTasks tools')
              gtasksClient = undefined
            } else {
              tools.push(...GTASKS_TOOLS)
              integrationNames.push('Google Tasks')
              toolsHint += '\nGoogle Tasks: use gtasks_* to search, read, complete, update, delete tasks. Don\'t claim no access.'
            }
          }

          // Advisory tools are always available (read-only, no external credentials)
          tools.push(...ADVISORY_TOOLS)
          toolsHint += '\nAdvisory: use advisory_search_decisions/deadlines/cross_domain_context/risk_snapshot for strategic advice. Attribute cross-domain sources. Don\'t invent citations; if no tool data, say so.'

          // Brainstorm tools are always available (DB-only, sync)
          tools.push(...BRAINSTORM_TOOLS)
          toolsHint += '\nBrainstorm: use brainstorm_* tools for deep facilitated sessions with technique-guided idea capture.'

          if (isStatusBriefing) {
            toolsHint += '\nStatus Briefing: use available tools to enrich the briefing. Use search hints from DOMAIN STATUS BRIEFING section.'
          }

          // Prepend a prominent capability preamble when external integrations are connected
          if (integrationNames.length > 0) {
            const sortedNames = [...integrationNames].sort()
            const preamble = '\n\n=== TOOL CAPABILITIES ===\nLive authenticated access: ' + sortedNames.join(', ') + '.\nIf a tool is relevant, use it before answering from memory.\nIf a tool fails or is unavailable, say so and fall back.'
            toolsHint = preamble + toolsHint
          }

          if (tools.length === ADVISORY_TOOLS.length) {
            // Only advisory tools available (Gmail + GTasks preflights failed) — still useful
            gmailClient = undefined
            gtasksClient = undefined
          }

          // --- Capability-reset injection: counter stale tool claims in history ---
          let messagesForLlm: ChatMessage[] = slicedMessages
          if (integrationNames.length > 0) {
            try {
              if (detectStaleToolClaims(slicedMessages)) {
                const resetMsg: ChatMessage = {
                  role: 'user',
                  content: `[System note: Your tool capabilities have changed since earlier messages in this conversation. You now have LIVE, AUTHENTICATED access to: ${integrationNames.join('; ')}. Any earlier assistant messages claiming you lack email, task, or tool access are OUTDATED and INCORRECT. Use your tools when relevant.]`,
                }
                const lastUserIdx = slicedMessages.map((m) => m.role).lastIndexOf('user')
                if (lastUserIdx >= 0) {
                  messagesForLlm = [
                    ...slicedMessages.slice(0, lastUserIdx),
                    resetMsg,
                    ...slicedMessages.slice(lastUserIdx),
                  ]
                }
              }
            } catch {
              // Safety fallback: if detection throws (e.g. malformed content), use original messages
              messagesForLlm = slicedMessages
            }
          }

          if (tools.length > 0) {
            const result = await runToolLoop({
              provider: provider as ToolCapableProvider,
              providerName: resolvedProvider,
              model: resolvedModel,
              domainId: payload.domainId,
              requestId,
              userMessages: messagesForLlm,
              systemPrompt: systemPrompt + toolsHint,
              tools,
              db,
              gmailClient,
              gtasksClient,
              eventSender: event.sender,
              ollamaBaseUrl: undefined, // Ollama never enters tool loop (toolsAvailable = false)
              signal: controller.signal,
            })

            if (result.cancelled) {
              cancelled = true
              sendStreamDone(true)
              return { ok: true, value: { requestId, content: result.fullResponse, proposals: [], rejectedProposals: [], cancelled: true } }
            }

            fullResponse = result.fullResponse
          }
        }

        if (!fullResponse) {
          // --- Streaming path (all providers) ---
          const streamStart = Date.now()
          console.log(`[streaming] start provider=${resolvedProvider} model=${resolvedModel} systemPromptLen=${systemPrompt.length} messagesCount=${slicedMessages.length}`)
          let chunkCount = 0
          try {
            for await (const chunk of provider.chat(slicedMessages, systemPrompt, { signal: controller.signal })) {
              if (controller.signal.aborted) break
              chunkCount++
              if (chunkCount === 1) {
                tFirstChunk = Date.now()
                console.log(`[streaming] first_chunk latency=${tFirstChunk - streamStart}ms chunk=${JSON.stringify(chunk.slice(0, 50))}`)
              }
              fullResponse += chunk
              sendChatChunk(event.sender, requestId, chunk)
            }
          } catch (streamErr) {
            console.error(`[streaming] error after ${chunkCount} chunks, ${Date.now() - streamStart}ms:`, streamErr)
            throw streamErr
          }
          console.log(`[streaming] done chunks=${chunkCount} totalMs=${Date.now() - streamStart} responseLen=${fullResponse.length}`)

          if (controller.signal.aborted) {
            cancelled = true
            sendStreamDone(true)
            return { ok: true, value: { requestId, content: fullResponse, proposals: [], rejectedProposals: [], cancelled: true } }
          }

          sendStreamDone(false)
        }

        const { proposals, rejectedProposals } = parseKBUpdates(fullResponse)

        // Parse and persist decisions from LLM response (with session_id)
        const parsedDecisions = parseDecisions(fullResponse)
        for (const pd of parsedDecisions) {
          decisionRepo.create({
            domainId: payload.domainId,
            sessionId,
            decisionId: pd.decisionId,
            decision: pd.decision,
            rationale: pd.rationale,
            downside: pd.downside,
            revisitTrigger: pd.revisitTrigger,
            linkedFiles: pd.linkedFiles,
          })
        }

        // Parse and persist gap flags from LLM response
        const parsedGapFlags = parseGapFlags(fullResponse)
        for (const gf of parsedGapFlags) {
          const gfResult = gapFlagRepo.create({
            domainId: payload.domainId,
            sessionId,
            category: gf.category,
            description: gf.description,
          })
          if (gfResult.ok) {
            emitAutomationEvent({
              type: 'gap_flag_raised',
              domainId: payload.domainId,
              data: { entityId: gfResult.value.id, entityType: 'gap_flag', summary: gf.description },
            })
          }
        }

        // Parse advisory fence blocks from LLM response (runs on final assistant text only)
        const advisoryResult = parseAdvisoryBlocks(
          fullResponse,
          payload.domainId,
          sessionId,
          undefined, // messageId — set after message is persisted if needed
          { db },
        )

        // Render system notes as inline feedback
        for (const note of advisoryResult.systemNotes) {
          console.log(`[advisory] ${note}`)
        }

        // Log rejects for telemetry
        for (const reject of advisoryResult.rejects) {
          console.warn(`[advisory-parser] reject: ${reject.reason} | detail=${reject.detail ?? ''} | type=${reject.fenceType} | domain=${reject.domainId} | size=${reject.sizeBytes}`)
        }

        // End session on wrap-up
        if (isWrapUp && sessionId) {
          sessionRepo.end(sessionId)
          auditRepo.logChange({
            domainId: payload.domainId,
            sessionId,
            changeDescription: 'Session wrapped up',
            eventType: 'session_wrap',
            source: 'system',
          })
        }

        // Parse stop blocks from LLM response
        const stopBlocks = parseStopBlocks(fullResponse)

        // ── Advisory pinCount decay (Change 5) ──
        if (advisoryPinCount > 0 && !ADVISORY_TRIGGER.test(userMsg) && !brainstormContext) {
          advisoryPinMap.set(payload.domainId, Math.max(0, advisoryPinCount - 1))
        }

        // ── KB forceKb decay (Change 6) ──
        if (kbIntentDetected) {
          // KB intent present: keep or reset to 3
          forceKBMap.set(payload.domainId, { count: Math.max(forceKbCount, 3), reason: forceKbReason })
        } else {
          // Decay
          const newCount = Math.max(0, forceKbCount - 1)
          forceKBMap.set(payload.domainId, { count: newCount, reason: newCount > 0 ? forceKbReason : '' })
        }

        // KB self-heal: check if assistant emitted kb-update or decision blocks
        if (fullResponse) {
          if (/```kb-update|```decision|```advisory-/.test(fullResponse)) {
            forceKBMap.set(payload.domainId, { count: Math.max(forceKBMap.get(payload.domainId)?.count ?? 0, 3), reason: 'assistant_emitted' })
          }
          if (proposals.length > 0) {
            forceKBMap.set(payload.domainId, { count: Math.max(forceKBMap.get(payload.domainId)?.count ?? 0, 3), reason: 'proposals' })
          }
        }

        // Update conversation summary if messages were trimmed
        try {
          if (slicedMessages.length < totalMessageCount) {
            const sentWindowStart = slicedMessages[0]
            // Get the created_at of oldest sliced message to determine trim boundary
            // Use payload.messages index since slicedMessages is a subset
            const sliceStartIdx = totalMessageCount - slicedMessages.length
            const trimmedForSummary = payload.messages.slice(
              0,
              sliceStartIdx,
            )

            const lastSummarized = existingSummary.ok && existingSummary.value
              ? existingSummary.value.lastSummarizedCreatedAt
              : null

            // Only update if we have >= 10 trimmed messages since last summary
            const unsummarizedTrimmed = lastSummarized
              ? trimmedForSummary.filter(() => true) // all trimmed are new since we don't track created_at in ChatMessage
              : trimmedForSummary

            if (unsummarizedTrimmed.length >= 10) {
              const prevText = conversationSummary ?? ''
              const newSummary = buildHeuristicSummary(prevText, unsummarizedTrimmed)
              const now = new Date().toISOString()
              summaryRepo.setSummary(payload.domainId, newSummary, now)
            }
          }
        } catch (summaryErr) {
          console.warn('[chat:send] Summary update failed:', summaryErr)
        }

        // Structured perf log (Change 7: full gate diagnostics)
        const tDone = Date.now()
        console.log('[chat:perf]', JSON.stringify({
          historyCountTotal: totalMessageCount,
          historyCountSent: slicedMessages.length,
          summaryChars: conversationSummary?.length ?? 0,
          summaryTokensEstimate: conversationSummary ? estimateTokens(conversationSummary.length) : 0,
          promptTokensBudget: systemBudget,
          promptTokensActual: promptResult.manifest.totalTokenEstimate,
          systemPromptChars: systemPrompt.length,
          responseChars: fullResponse.length,
          responseStyle: globalConfig.responseStyle ?? 'concise',
          streaming: !fullResponse || tFirstChunk !== null,
          kbInstructionsIncluded,
          forceKb: forceKbCount,
          forceKbReason,
          advisoryIncluded,
          advisoryPinCount,
          recallTriggered,
          recallReason,
          provider: resolvedProvider,
          model: resolvedModel,
          firstChunkMs: tFirstChunk ? tFirstChunk - t0 : null,
          totalMs: tDone - t0,
        }))

        return {
          ok: true,
          value: {
            requestId,
            content: fullResponse,
            proposals,
            rejectedProposals,
            stopBlocks,
            gapFlags: parsedGapFlags,
            decisions: parsedDecisions,
            advisory: {
              classifiedMode: advisoryResult.classifiedMode,
              persisted: advisoryResult.persisted,
              draftBlocks: advisoryResult.draftBlocks,
              systemNotes: advisoryResult.systemNotes,
            },
          },
        }
      } catch (err) {
        if (isAbortError(err, controller)) {
          cancelled = true
          sendStreamDone(true)
          return { ok: true, value: { requestId, content: fullResponse, proposals: [], rejectedProposals: [], cancelled: true } }
        }
        const message = err instanceof Error ? err.message : String(err)
        sendStreamDone(false)
        return { ok: false, error: message }
      } finally {
        // Safety net: correct polarity guaranteed by tracking `cancelled`
        if (!streamDoneSent) sendStreamDone(cancelled)
        if (activeChatControllers.get(senderId) === controller) {
          activeChatControllers.delete(senderId)
        }
      }
    },
  )

  // --- Chat Cancel ---

  ipcMain.handle('chat:send-cancel', (event) => {
    const ctrl = activeChatControllers.get(event.sender.id)
    if (ctrl) {
      ctrl.abort()
      activeChatControllers.delete(event.sender.id)
      return { ok: true, value: { cancelled: true } }
    }
    return { ok: true, value: { cancelled: false } }
  })

  // --- KB Update Apply ---

  ipcMain.handle(
    'kb:apply-update',
    async (_event, domainId: string, proposal: KBUpdateProposal) => {
      try {
        const domain = domainRepo.getById(domainId)
        if (!domain.ok) return { ok: false, error: domain.error.message }

        // --- Path traversal guard ---
        if (proposal.file.includes('\0')) {
          return { ok: false, error: 'Invalid file path: null bytes not allowed' }
        }

        const ALLOWED_EXTENSIONS = new Set(['.md', '.mdx', '.json', '.txt', '.yaml', '.yml'])
        const ext = extname(proposal.file).toLowerCase()
        if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
          return { ok: false, error: `File extension not allowed: ${ext}` }
        }

        const filePath = resolve(domain.value.kbPath, proposal.file)
        const kbRoot = resolve(domain.value.kbPath)

        // Syntactic boundary check
        if (!filePath.startsWith(kbRoot + sep) && filePath !== kbRoot) {
          return { ok: false, error: 'Path traversal rejected: file path escapes KB directory' }
        }

        // Symlink escape check: realpath the nearest existing ancestor
        let checkDir = resolve(filePath, '..')
        while (checkDir !== kbRoot && checkDir.startsWith(kbRoot + sep)) {
          try {
            await stat(checkDir)
            // Directory exists — resolve its real path
            const realDir = await realpath(checkDir)
            const realKbRoot = await realpath(kbRoot)
            if (!realDir.startsWith(realKbRoot + sep) && realDir !== realKbRoot) {
              return { ok: false, error: 'Path traversal rejected: symlink escapes KB directory' }
            }
            break
          } catch {
            // Directory doesn't exist yet — walk up
            checkDir = resolve(checkDir, '..')
          }
        }

        if (proposal.action === 'delete') {
          await unlink(filePath)
        } else {
          await writeFile(filePath, proposal.content, 'utf-8')
        }

        // Auto-log to audit trail with content-hash dedup
        const hash = computeContentHash(proposal.file, proposal.content)
        auditRepo.logChange({
          domainId,
          filePath: proposal.file,
          changeDescription: `${proposal.action}: ${proposal.file} (mode: ${proposal.mode || 'full'}, basis: ${proposal.basis || 'primary'})`,
          contentHash: hash,
          eventType: 'kb_write',
          source: 'agent',
        })

        return { ok: true, value: undefined }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // --- Dialog ---

  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, value: null }
    }
    return { ok: true, value: result.filePaths[0] }
  })

  // --- Intake ---

  ipcMain.handle('intake:list-pending', () => {
    return intakeRepo.listPending()
  })

  ipcMain.handle('intake:get', (_event, id: string) => {
    return intakeRepo.getById(id)
  })

  ipcMain.handle(
    'intake:classify',
    async (_event, id: string, apiKey: string) => {
      try {
        const item = intakeRepo.getById(id)
        if (!item.ok) return item

        const domains = domainRepo.list()
        if (!domains.ok) return domains

        if (domains.value.length === 0) {
          return { ok: false, error: 'No domains available for classification' }
        }

        const classifyConfig = await loadProviderConfig()
        const classifyProviderName = (classifyConfig.defaultProvider ?? 'anthropic') as ProviderName
        const classifyModel = classifyConfig.defaultModel ?? DEFAULT_MODELS[classifyProviderName]
        const classifyKey = classifyProviderName !== 'ollama' ? await loadProviderKey(classifyProviderName) : undefined
        if (classifyProviderName !== 'ollama' && !classifyKey) {
          return { ok: false, error: `No API key configured for ${classifyProviderName}` }
        }
        const classifyProvider = createProvider({
          provider: classifyProviderName,
          model: classifyModel,
          apiKey: classifyKey,
          ollamaBaseUrl: classifyConfig.ollamaBaseUrl,
        })
        const classification = await classifyContent(
          classifyProvider,
          domains.value.map((d) => ({ id: d.id, name: d.name, description: d.description })),
          item.value.title,
          item.value.content,
        )

        if (!classification.ok) return { ok: false, error: classification.error.message }

        const updated = intakeRepo.updateClassification(
          id,
          classification.value.domainId,
          classification.value.confidence,
        )

        if (!updated.ok) return { ok: false, error: updated.error.message }

        return {
          ok: true,
          value: {
            item: updated.value,
            classification: classification.value,
          },
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'intake:confirm',
    async (_event, id: string, domainId: string) => {
      try {
        const item = intakeRepo.getById(id)
        if (!item.ok) return { ok: false, error: item.error.message }

        const domain = domainRepo.getById(domainId)
        if (!domain.ok) return { ok: false, error: domain.error.message }

        // Write .md file to KB folder
        const slug = item.value.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60)
        const dateStr = new Date().toISOString().slice(0, 10)
        const filename = `intake-${dateStr}-${slug}.md`
        const filePath = join(domain.value.kbPath, filename)

        const mdContent = [
          `# ${item.value.title}`,
          '',
          item.value.sourceUrl ? `**Source:** ${item.value.sourceUrl}` : '',
          `**Ingested:** ${dateStr}`,
          '',
          '---',
          '',
          item.value.content,
        ]
          .filter((line) => line !== '')
          .join('\n')

        await writeFile(filePath, mdContent, 'utf-8')

        // Re-scan KB
        const scanned = await scanKBDirectory(domain.value.kbPath)
        if (scanned.ok) {
          kbRepo.sync(domainId, scanned.value)
        }

        // Mark as ingested
        const updated = intakeRepo.updateStatus(id, 'ingested')
        if (!updated.ok) return { ok: false, error: updated.error.message }

        return { ok: true, value: updated.value }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle('intake:dismiss', (_event, id: string) => {
    return intakeRepo.updateStatus(id, 'dismissed')
  })

  ipcMain.handle('intake:find-by-external-id', (_event, sourceType: string, externalId: string) => {
    return intakeRepo.findByExternalId(
      sourceType as 'web' | 'gmail' | 'gtasks' | 'manual',
      externalId,
    )
  })

  ipcMain.handle('intake:list-by-source-type', (_event, sourceType: string, limit?: number) => {
    return intakeRepo.listBySourceType(
      sourceType as 'web' | 'gmail' | 'gtasks' | 'manual',
      limit,
    )
  })

  ipcMain.handle('intake:get-token', () => {
    return { ok: true, value: getIntakeToken() }
  })

  ipcMain.handle('intake:get-port', () => {
    return { ok: true, value: 19532 }
  })

  // --- KB Watcher ---

  ipcMain.handle('kb:watch-start', (_event, domainId: string) => {
    const domain = domainRepo.getById(domainId)
    if (!domain.ok) return domain

    startKBWatcher(domainId, domain.value.kbPath, mainWindow, async (id) => {
      const scanned = await scanKBDirectory(domain.value.kbPath)
      if (scanned.ok) {
        kbRepo.sync(id, scanned.value)
        // Trigger embedding indexing after KB sync
        const kbFiles = kbRepo.getFiles(id)
        if (kbFiles.ok) {
          embeddingManager.indexDomain(id, domain.value.kbPath, kbFiles.value)
        }
      }
    })

    // Trigger initial embedding indexing
    const kbFiles = kbRepo.getFiles(domainId)
    if (kbFiles.ok) {
      embeddingManager.indexDomain(domainId, domain.value.kbPath, kbFiles.value)
    }

    return { ok: true, value: undefined }
  })

  ipcMain.handle('kb:watch-stop', (_event, domainId: string) => {
    stopKBWatcher(domainId)
    return { ok: true, value: undefined }
  })

  // --- Embedding / Vector Search ---

  ipcMain.handle('kb:reindex-embeddings', async (_event, domainId?: string) => {
    const client = embeddingManager.getClient()
    if (!client) return { ok: false, error: 'No embedding provider available' }

    try {
      if (domainId) {
        // Re-index single domain
        chunkRepo.deleteEmbeddingsByModel(domainId, client.modelName)
        embeddingCache.invalidate(domainId, client.modelName)
        const domain = domainRepo.getById(domainId)
        if (!domain.ok) return domain
        const kbFiles = kbRepo.getFiles(domainId)
        if (!kbFiles.ok) return kbFiles
        await embeddingManager.indexDomain(domainId, domain.value.kbPath, kbFiles.value)
      } else {
        // Re-index all domains
        const domains = domainRepo.list()
        if (!domains.ok) return domains
        for (const d of domains.value) {
          chunkRepo.deleteEmbeddingsByModel(d.id, client.modelName)
          embeddingCache.invalidate(d.id, client.modelName)
          const kbFiles = kbRepo.getFiles(d.id)
          if (kbFiles.ok) {
            embeddingManager.indexDomain(d.id, d.kbPath, kbFiles.value)
          }
        }
      }
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('kb:embedding-status', (_event, domainId: string) => {
    const client = embeddingManager.getClient()
    const jobStatus = client ? chunkRepo.getJobStatus(domainId, client.modelName) : null
    const hasEmb = client ? chunkRepo.hasEmbeddings(domainId, client.modelName) : { ok: true, value: false }

    return {
      ok: true,
      value: {
        enabled: client !== null,
        resolvedProvider: client ? client.providerFingerprint.split(':')[0] : null,
        activeModelName: client?.modelName ?? null,
        isIndexing: embeddingManager.isIndexing(domainId),
        jobStatus: jobStatus?.ok ? jobStatus.value : null,
        hasEmbeddings: hasEmb.ok ? (hasEmb as { ok: true; value: boolean }).value : false,
      },
    }
  })

  // --- Protocols ---

  ipcMain.handle('protocol:list', (_event, domainId: string) => {
    return protocolRepo.getByDomainId(domainId)
  })

  ipcMain.handle(
    'protocol:create',
    (_event, input: { domainId: string; name: string; content: string; sortOrder?: number }) => {
      return protocolRepo.create(input)
    },
  )

  ipcMain.handle(
    'protocol:update',
    (_event, id: string, input: { name?: string; content?: string; sortOrder?: number }) => {
      return protocolRepo.update(id, input)
    },
  )

  ipcMain.handle('protocol:delete', (_event, id: string) => {
    return protocolRepo.delete(id)
  })

  // --- Shared Protocols ---

  ipcMain.handle('shared-protocol:list', () => {
    return sharedProtocolRepo.list()
  })

  ipcMain.handle(
    'shared-protocol:create',
    (_event, input: { name: string; content: string; sortOrder?: number; priority?: number; isEnabled?: boolean; scope?: 'all' | 'chat' | 'startup' }) => {
      return sharedProtocolRepo.create(input)
    },
  )

  ipcMain.handle(
    'shared-protocol:update',
    (_event, id: string, input: { name?: string; content?: string; sortOrder?: number; priority?: number; isEnabled?: boolean; scope?: 'all' | 'chat' | 'startup' }) => {
      return sharedProtocolRepo.update(id, input)
    },
  )

  ipcMain.handle('shared-protocol:delete', (_event, id: string) => {
    return sharedProtocolRepo.delete(id)
  })

  ipcMain.handle('shared-protocol:toggle', (_event, id: string) => {
    return sharedProtocolRepo.toggleEnabled(id)
  })

  // --- Sessions ---

  ipcMain.handle('session:get-active', (_event, domainId: string) => {
    return sessionRepo.getActive(domainId)
  })

  ipcMain.handle('session:list', (_event, domainId: string, limit?: number) => {
    return sessionRepo.getByDomain(domainId, limit)
  })

  ipcMain.handle('session:end', (_event, id: string) => {
    return sessionRepo.end(id)
  })

  // --- Relationships ---

  ipcMain.handle('relationship:get-siblings', (_event, domainId: string) => {
    return relationshipRepo.getSiblings(domainId)
  })

  ipcMain.handle('relationship:get-relationships', (_event, domainId: string) => {
    const getDomainName = (id: string) => {
      const d = domainRepo.getById(id)
      return d.ok ? d.value.name : 'Unknown'
    }
    return relationshipRepo.getRelationships(domainId, getDomainName)
  })

  ipcMain.handle('relationship:add-relationship', (_event, fromDomainId: string, toDomainId: string, options?: AddRelationshipOptions) => {
    return relationshipRepo.addRelationship(fromDomainId, toDomainId, options)
  })

  ipcMain.handle('relationship:add-sibling', (_event, domainId: string, siblingDomainId: string) => {
    return relationshipRepo.addSibling(domainId, siblingDomainId)
  })

  ipcMain.handle('relationship:remove-relationship', (_event, fromDomainId: string, toDomainId: string) => {
    return relationshipRepo.removeRelationship(fromDomainId, toDomainId)
  })

  ipcMain.handle('relationship:remove-sibling', (_event, domainId: string, siblingDomainId: string) => {
    return relationshipRepo.removeSibling(domainId, siblingDomainId)
  })

  // --- Deadlines ---

  ipcMain.handle('deadline:create', (_event, input: CreateDeadlineInput) => {
    return deadlineRepo.create(input)
  })

  ipcMain.handle('deadline:list', (_event, domainId: string, status?: DeadlineStatus) => {
    return deadlineRepo.getByDomain(domainId, status ? { status } : undefined)
  })

  ipcMain.handle('deadline:active', (_event, domainId: string) => {
    return deadlineRepo.getActive(domainId)
  })

  ipcMain.handle('deadline:overdue', (_event, domainId?: string) => {
    return deadlineRepo.getOverdue(domainId)
  })

  ipcMain.handle('deadline:upcoming', (_event, domainId: string, days: number) => {
    return deadlineRepo.getUpcoming(domainId, days)
  })

  ipcMain.handle('deadline:snooze', (_event, id: string, until: string) => {
    return deadlineRepo.snooze(id, until)
  })

  ipcMain.handle('deadline:complete', (_event, id: string) => {
    const result = deadlineRepo.complete(id)
    if (result.ok) {
      auditRepo.logChange({
        domainId: result.value.domainId,
        changeDescription: `Deadline completed: "${result.value.text}"`,
        eventType: 'deadline_lifecycle',
        source: 'user',
      })
    }
    return result
  })

  ipcMain.handle('deadline:cancel', (_event, id: string) => {
    const result = deadlineRepo.cancel(id)
    if (result.ok) {
      auditRepo.logChange({
        domainId: result.value.domainId,
        changeDescription: `Deadline cancelled: "${result.value.text}"`,
        eventType: 'deadline_lifecycle',
        source: 'user',
      })
    }
    return result
  })

  ipcMain.handle('deadline:find-by-source-ref', (_event, domainId: string, sourceRef: string) => {
    return deadlineRepo.findBySourceRef(domainId, sourceRef)
  })

  // --- Briefing ---

  ipcMain.handle('briefing:portfolio-health', async () => {
    const healthResult = await computePortfolioHealth(db)
    if (!healthResult.ok) return healthResult

    let globalOverdueGTasks = 0
    let overdueGTasksList: Array<{ id: string; taskListId: string; taskListTitle: string; title: string; due: string; notes: string }> = []
    const gtasksCreds = await loadGTasksCredentials()
    if (gtasksCreds) {
      try {
        const client = new GTasksClient({
          clientId: gtasksCreds.clientId,
          clientSecret: gtasksCreds.clientSecret,
          refreshToken: gtasksCreds.refreshToken,
        })
        const overdueResults = await client.getOverdue()
        globalOverdueGTasks = overdueResults.length
        overdueGTasksList = overdueResults.map((t) => ({
          id: t.id,
          taskListId: t.taskListId,
          taskListTitle: t.taskListTitle,
          title: t.title,
          due: t.due,
          notes: t.notes,
        }))
      } catch (err) {
        // Non-fatal: covers invalid creds, expired refresh token, network failure
        console.warn('[briefing] GTasks overdue fetch failed (non-fatal):', (err as Error).message)
      }
    }

    return { ok: true, value: { ...healthResult.value, globalOverdueGTasks, overdueGTasksList } }
  })

  // Briefing analysis — streaming LLM interpretation of portfolio health
  let currentBriefingRequestId: string | null = null
  const activeBriefingAnalyses = new Map<string, AbortController>()

  ipcMain.handle('briefing:analyze', async (event: IpcMainInvokeEvent, requestId: string) => {
    // Cancel any existing analysis
    if (currentBriefingRequestId) {
      activeBriefingAnalyses.get(currentBriefingRequestId)?.abort()
    }
    currentBriefingRequestId = requestId

    const controller = new AbortController()
    activeBriefingAnalyses.set(requestId, controller)

    try {
      // 1. Compute health
      const healthResult = await computePortfolioHealth(db)
      if (!healthResult.ok) return { ok: false, error: healthResult.error.message }

      // 2. Load domains for digest paths
      const domainsResult = domainRepo.list()
      if (!domainsResult.ok) return { ok: false, error: domainsResult.error.message }

      // 3. Load digests with per-domain error handling
      const digests: Array<{ domainId: string; domainName: string; content: string }> = []
      for (const domain of domainsResult.value) {
        try {
          const digestPath = join(domain.kbPath, 'kb_digest.md')
          const raw = await readFile(digestPath, 'utf-8')
          digests.push({ domainId: domain.id, domainName: domain.name, content: raw.slice(0, 6000) })
        } catch {
          digests.push({ domainId: domain.id, domainName: domain.name, content: '(kb_digest.md missing)' })
        }
      }

      // 4. Build prompt
      const currentDate = new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date())

      // Fetch GTasks overdue for prompt context
      let analyzeGTasks = 0
      const analyzeGTasksCreds = await loadGTasksCredentials()
      if (analyzeGTasksCreds) {
        try {
          const gtClient = new GTasksClient({
            clientId: analyzeGTasksCreds.clientId,
            clientSecret: analyzeGTasksCreds.clientSecret,
            refreshToken: analyzeGTasksCreds.refreshToken,
          })
          analyzeGTasks = (await gtClient.getOverdue()).length
        } catch {
          // Non-fatal
        }
      }

      const prompt = buildBriefingPrompt({
        health: healthResult.value,
        digests,
        currentDate,
        globalOverdueGTasks: analyzeGTasks,
      })

      // 5. Resolve provider (same pattern as chat:send)
      const globalConfig = await loadProviderConfig()
      const resolvedProvider = (globalConfig.defaultProvider ?? 'anthropic') as ProviderName
      const resolvedModel = globalConfig.defaultModel ?? DEFAULT_MODELS[resolvedProvider]
      const ollamaBaseUrl = globalConfig.ollamaBaseUrl ?? 'http://localhost:11434'

      if (resolvedProvider !== 'ollama') {
        const apiKey = await loadProviderKey(resolvedProvider)
        if (!apiKey) {
          return { ok: false, error: `No API key configured for ${resolvedProvider}. Open Settings to add one.` }
        }
      } else {
        const reachable = await OllamaProvider.testConnection(ollamaBaseUrl)
        if (!reachable) {
          return { ok: false, error: `Ollama not reachable at ${ollamaBaseUrl}. Is it running?` }
        }
      }

      const apiKey = resolvedProvider !== 'ollama' ? await loadProviderKey(resolvedProvider) : undefined
      const provider = createProvider({
        provider: resolvedProvider,
        model: resolvedModel,
        apiKey,
        ollamaBaseUrl,
      })

      // 6. Stream LLM response
      const userMessage = 'Analyze this portfolio and produce briefing blocks.'
      let fullResponse = ''

      for await (const chunk of provider.chat(
        [{ role: 'user' as const, content: userMessage }],
        prompt,
      )) {
        if (controller.signal.aborted) break
        fullResponse += chunk
        if (!event.sender.isDestroyed()) {
          event.sender.send('briefing:analysis-chunk', { requestId, chunk })
        }
      }

      if (controller.signal.aborted) {
        return { ok: false, error: 'CANCELLED' }
      }

      // 7. Parse response
      const parsed = parseBriefingAnalysis(fullResponse)

      return {
        ok: true,
        value: {
          requestId,
          ...parsed,
          rawText: fullResponse,
          snapshotHash: healthResult.value.snapshotHash,
        },
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return { ok: false, error: 'CANCELLED' }
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      activeBriefingAnalyses.delete(requestId)
      if (currentBriefingRequestId === requestId) currentBriefingRequestId = null
    }
  })

  ipcMain.handle('briefing:analyze-cancel', () => {
    if (currentBriefingRequestId) {
      activeBriefingAnalyses.get(currentBriefingRequestId)?.abort()
      currentBriefingRequestId = null
    }
    return { ok: true, value: undefined }
  })

  // --- Gap Flags ---

  ipcMain.handle('gap-flag:list', (_event, domainId: string, limit?: number) => {
    return gapFlagRepo.getByDomain(domainId, limit)
  })

  ipcMain.handle('gap-flag:open', (_event, domainId: string) => {
    return gapFlagRepo.getOpen(domainId)
  })

  ipcMain.handle('gap-flag:acknowledge', (_event, id: string) => {
    return gapFlagRepo.acknowledge(id)
  })

  ipcMain.handle('gap-flag:resolve', (_event, id: string) => {
    return gapFlagRepo.resolve(id)
  })

  // --- Audit ---

  ipcMain.handle('audit:list', (_event, domainId: string, limit?: number) => {
    return auditRepo.getByDomain(domainId, limit)
  })

  ipcMain.handle('audit:list-by-type', (_event, domainId: string, eventType: string, limit?: number) => {
    return auditRepo.getByDomainAndType(domainId, eventType as AuditEventType, limit)
  })

  // --- Decisions ---

  ipcMain.handle('decision:list', (_event, domainId: string, limit?: number) => {
    return decisionRepo.getByDomain(domainId, limit)
  })

  ipcMain.handle('decision:active', (_event, domainId: string) => {
    return decisionRepo.getActive(domainId)
  })

  ipcMain.handle('decision:reject', (_event, id: string) => {
    return decisionRepo.reject(id)
  })

  // --- Advisory Artifacts ---

  ipcMain.handle('advisory:list', (_event, domainId: string, options?: { status?: AdvisoryStatus; type?: AdvisoryType; limit?: number }) => {
    return advisoryRepo.getByDomain(domainId, options)
  })

  ipcMain.handle('advisory:get', (_event, id: string) => {
    return advisoryRepo.getById(id)
  })

  ipcMain.handle('advisory:archive', (_event, id: string) => {
    return advisoryRepo.archive(id)
  })

  ipcMain.handle('advisory:unarchive', (_event, id: string) => {
    return advisoryRepo.unarchive(id)
  })

  ipcMain.handle('advisory:rename', (_event, id: string, title: string) => {
    return advisoryRepo.renameTitle(id, title)
  })

  ipcMain.handle(
    'advisory:save-draft-block',
    (_event, input: SaveDraftBlockInput) => {
      // 1-click save: re-validate stored draft block and persist as active artifact
      // In production, this reads from message.metadata.advisoryDraftBlocks[blockIndex]
      // For now, the IPC contract is defined — renderer will supply the draft data
      try {
        // The renderer will pass the full draft block data via the input
        // This handler delegates to the repository after re-validation
        return { ok: false, error: 'Save draft block requires message metadata integration (Phase C UI)' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'advisory:extract-tasks',
    (_event, artifactId: string, domainId: string) => {
      try {
        const artifact = advisoryRepo.getById(artifactId)
        if (!artifact.ok) return artifact

        // Verify domain match
        if (artifact.value.domainId !== domainId) {
          return { ok: false, error: 'Artifact does not belong to the specified domain' }
        }

        const result = extractTasksFromArtifact(artifact.value)
        return { ok: true, value: result }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // --- Brainstorm ---

  ipcMain.handle('brainstorm:get-session', (_event, domainId: string) => {
    try {
      const brainstormRepo = new BrainstormSessionRepository(db)
      return brainstormRepo.getActive(domainId)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('brainstorm:get-ideas', (_event, domainId: string) => {
    try {
      const brainstormRepo = new BrainstormSessionRepository(db)
      const active = brainstormRepo.getActive(domainId)
      if (!active.ok || !active.value) {
        return { ok: true, value: [] }
      }
      return { ok: true, value: active.value.rawIdeas }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Gmail ---

  ipcMain.handle('gmail:start-oauth', async () => {
    try {
      await startGmailOAuth()
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('gmail:check-connected', async () => {
    try {
      const status = await checkGmailConnected()
      return { ok: true, value: status }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('gmail:disconnect', async () => {
    try {
      await disconnectGmail()
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Attachment enrichment for gmail:fetch-for-context ──

  const MAX_ATTACHMENT_BYTES = 5_000_000
  const MAX_TEXT_PER_ATTACHMENT = 10_000
  const MAX_ATTACHMENTS_PER_MESSAGE = 5
  const MAX_TOTAL_TEXT_PER_MESSAGE = 20_000
  const MAX_TOTAL_BYTES_PER_MESSAGE = 10_000_000
  const MAX_ELIGIBLE_ATTACHMENTS_PER_FETCH = 25
  const ATTACH_CONCURRENCY_LIMIT = 2

  interface SkippedAttachment {
    filename: string
    reason: string
  }

  interface TaggedAttachment {
    att: GmailAttachmentMeta
    msgIndex: number
    eligible: boolean
    skipReason?: string
  }

  async function enrichWithAttachments(
    client: GmailClient,
    messages: GmailMessage[],
  ): Promise<GmailContextMessage[]> {
    // Simple concurrency limiter
    let active = 0
    const queue: Array<() => void> = []
    function acquire(): Promise<void> {
      if (active < ATTACH_CONCURRENCY_LIMIT) { active++; return Promise.resolve() }
      return new Promise(resolve => queue.push(() => { active++; resolve() }))
    }
    function release(): void {
      active--
      if (queue.length > 0) queue.shift()!()
    }

    // ── Step 1: Deterministic pre-walk ──
    const taggedByMsg: TaggedAttachment[][] = messages.map(() => [])
    let threadAttemptCount = 0
    const perMsgCounters: number[] = messages.map(() => 0)

    for (let mi = 0; mi < messages.length; mi++) {
      for (const att of messages[mi].attachments) {
        if (threadAttemptCount >= MAX_ELIGIBLE_ATTACHMENTS_PER_FETCH) {
          taggedByMsg[mi].push({ att, msgIndex: mi, eligible: false, skipReason: 'thread limit reached' })
          continue
        }
        if (perMsgCounters[mi] >= MAX_ATTACHMENTS_PER_MESSAGE) {
          taggedByMsg[mi].push({ att, msgIndex: mi, eligible: false, skipReason: 'limit reached' })
          continue
        }
        if (!isFormatSupported(att.filename, att.mimeType)) {
          taggedByMsg[mi].push({ att, msgIndex: mi, eligible: false, skipReason: 'unsupported' })
          continue
        }
        // Quick inline size estimate
        if (att.inlineData) {
          const estimatedBytes = Math.floor(att.inlineData.length * 3 / 4)
          if (estimatedBytes > MAX_ATTACHMENT_BYTES * 1.05) {
            const sizeMB = (estimatedBytes / 1_000_000).toFixed(1)
            taggedByMsg[mi].push({ att, msgIndex: mi, eligible: false, skipReason: `too large (~${sizeMB}MB)` })
            continue
          }
        }
        taggedByMsg[mi].push({ att, msgIndex: mi, eligible: true })
        perMsgCounters[mi]++
        threadAttemptCount++
      }
    }

    // ── Step 2: Async extraction (concurrency-limited) ──
    return Promise.all(messages.map(async (msg, mi) => {
      const myTags = taggedByMsg[mi]
      const extracted: GmailContextAttachment[] = []
      const skipped: SkippedAttachment[] = []
      let totalTextChars = 0
      let totalDecodedBytes = 0

      for (const tag of myTags) {
        if (!tag.eligible) {
          skipped.push({ filename: tag.att.filename, reason: tag.skipReason! })
          continue
        }

        if (totalTextChars >= MAX_TOTAL_TEXT_PER_MESSAGE) {
          skipped.push({ filename: tag.att.filename, reason: 'message text limit reached' })
          continue
        }
        if (totalDecodedBytes >= MAX_TOTAL_BYTES_PER_MESSAGE) {
          skipped.push({ filename: tag.att.filename, reason: 'message byte limit reached' })
          continue
        }

        await acquire()
        try {
          const att = tag.att
          const buf = att.inlineData
            ? Buffer.from(att.inlineData, 'base64url')
            : att.attachmentId
              ? await client.getAttachmentData(msg.messageId, att.attachmentId)
              : null

          if (!buf) {
            skipped.push({ filename: att.filename, reason: 'no data' })
          } else if (buf.length > MAX_ATTACHMENT_BYTES) {
            const sizeMB = (buf.length / 1_000_000).toFixed(1)
            skipped.push({ filename: att.filename, reason: `too large (${sizeMB}MB)` })
          } else if (totalDecodedBytes + buf.length > MAX_TOTAL_BYTES_PER_MESSAGE) {
            skipped.push({ filename: att.filename, reason: 'message byte limit reached' })
          } else {
            totalDecodedBytes += buf.length
            let text = await extractTextFromBuffer(att.filename, buf, att.mimeType)
            // Low-signal guard: PDF-only (scanned without OCR → whitespace/artifacts)
            const format = resolveFormat(att.filename, att.mimeType)
            const nonWs = text.replace(/\s/g, '').length
            if (format === 'pdf' && nonWs < 40) {
              skipped.push({ filename: att.filename, reason: 'low text content (likely scanned)' })
            } else {
              const charBudget = Math.min(
                MAX_TEXT_PER_ATTACHMENT,
                MAX_TOTAL_TEXT_PER_MESSAGE - totalTextChars,
              )
              if (text.length > charBudget) {
                text = text.slice(0, charBudget) + '\n[truncated]'
              }
              extracted.push({ filename: att.filename, mimeType: att.mimeType, text })
              totalTextChars += text.length
            }
          }
        } catch (err) {
          console.warn('[gmail-attach]', {
            filename: tag.att.filename, reason: 'extraction failed',
            messageId: msg.messageId, threadId: msg.threadId,
            error: err instanceof Error ? err.message : String(err),
          })
          skipped.push({ filename: tag.att.filename, reason: 'extraction failed' })
        } finally {
          release()
        }
      }

      return {
        messageId: msg.messageId,
        threadId: msg.threadId,
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        date: msg.date,
        body: msg.body,
        attachments: extracted.length > 0 ? extracted : undefined,
        skippedAttachments: skipped.length > 0 ? skipped : undefined,
      }
    }))
  }

  ipcMain.handle('gmail:fetch-for-context', async (_event, payload: { url: string; subjectHint?: string }) => {
    try {
      const creds = await loadGmailCredentials()
      if (!creds) return { ok: false, error: 'Gmail not connected' }

      const client = new GmailClient({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: creds.refreshToken,
      })

      // Parse Gmail URL in main process
      const parsed = parseGmailUrl(payload.url)
      if (!parsed) return { ok: false, error: 'Not a valid Gmail URL' }

      // Strategy A: threadId → direct thread API
      if (parsed.threadId) {
        const messages = await client.getThread(parsed.threadId)
        if (messages.length > 0) return { ok: true, value: await enrichWithAttachments(client, messages) }

        // Strategy A2: opaque ID might be a message ID — try reading directly
        const singleMsg = await client.read(parsed.threadId)
        if (singleMsg) {
          // If we got a message, try fetching its full thread
          if (singleMsg.threadId && singleMsg.threadId !== parsed.threadId) {
            const threadMsgs = await client.getThread(singleMsg.threadId)
            if (threadMsgs.length > 0) return { ok: true, value: await enrichWithAttachments(client, threadMsgs) }
          }
          return { ok: true, value: await enrichWithAttachments(client, [singleMsg]) }
        }
      }

      // Strategy B: constrained search fallback (requires a real subject hint)
      if (payload.subjectHint) {
        // Strip RE:/FW: prefixes — Gmail subject: search matches the base subject
        const cleanSubject = payload.subjectHint.replace(/^(re|fw|fwd):\s*/i, '').replace(/"/g, '')
        const query = `subject:"${cleanSubject}"`
        const results = await client.search(query, 3)

        if (results.length >= 1) {
          // Take the first (most recent) match — the preview UI lets the user verify
          const best = results[0]
          // Try to get the full thread for richer context
          if (best.threadId) {
            const threadMsgs = await client.getThread(best.threadId)
            if (threadMsgs.length > 0) return { ok: true, value: await enrichWithAttachments(client, threadMsgs) }
          }
          const msg = await client.read(best.messageId)
          return msg ? { ok: true, value: await enrichWithAttachments(client, [msg]) } : { ok: false, error: 'Could not read email' }
        }
      }

      // If we had a threadId but couldn't resolve it, and no subject hint was available,
      // signal the renderer to prompt the user for a subject search
      if (parsed.threadId && !payload.subjectHint) {
        return { ok: false, error: 'NEEDS_SUBJECT' }
      }

      return { ok: false, error: 'Could not find the email. Make sure it exists in your Gmail.' }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- Google Tasks ---

  ipcMain.handle('gtasks:start-oauth', async () => {
    try {
      await startGTasksOAuth()
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('gtasks:check-connected', async () => {
    try {
      const status = await checkGTasksConnected()
      return { ok: true, value: status }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('gtasks:disconnect', async () => {
    try {
      await disconnectGTasks()
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('gtasks:complete-task', async (_event, taskListId: string, taskId: string) => {
    try {
      if (typeof taskListId !== 'string' || !taskListId.trim() || typeof taskId !== 'string' || !taskId.trim()) {
        return { ok: false, error: 'taskListId and taskId are required' }
      }
      const creds = await loadGTasksCredentials()
      if (!creds) return { ok: false, error: 'Not connected to Google Tasks' }
      const client = new GTasksClient({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: creds.refreshToken,
      })
      await client.completeTask(taskListId.trim(), taskId.trim())
      return { ok: true, value: undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[GTasks] complete-task failed:', msg)
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('gtasks:delete-task', async (_event, taskListId: string, taskId: string) => {
    try {
      if (typeof taskListId !== 'string' || !taskListId.trim() || typeof taskId !== 'string' || !taskId.trim()) {
        return { ok: false, error: 'taskListId and taskId are required' }
      }
      const creds = await loadGTasksCredentials()
      if (!creds) return { ok: false, error: 'Not connected to Google Tasks' }
      const client = new GTasksClient({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: creds.refreshToken,
      })
      await client.deleteTask(taskListId.trim(), taskId.trim())
      return { ok: true, value: undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[GTasks] delete-task failed:', msg)
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('gtasks:update-task', async (_event, taskListId: string, taskId: string, updates: Record<string, unknown>) => {
    try {
      if (typeof taskListId !== 'string' || !taskListId.trim() || typeof taskId !== 'string' || !taskId.trim()) {
        return { ok: false, error: 'taskListId and taskId are required' }
      }
      const creds = await loadGTasksCredentials()
      if (!creds) return { ok: false, error: 'Not connected to Google Tasks' }

      // Whitelist allowed update fields
      const safeUpdates: { title?: string; notes?: string; due?: string } = {}
      if (typeof updates?.title === 'string') safeUpdates.title = updates.title
      if (typeof updates?.notes === 'string') safeUpdates.notes = updates.notes
      if (typeof updates?.due === 'string') safeUpdates.due = updates.due

      if (Object.keys(safeUpdates).length === 0) {
        return { ok: false, error: 'At least one of title, notes, or due must be provided' }
      }

      const client = new GTasksClient({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        refreshToken: creds.refreshToken,
      })
      await client.updateTask(taskListId.trim(), taskId.trim(), safeUpdates)
      return { ok: true, value: undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[GTasks] update-task failed:', msg)
      return { ok: false, error: msg }
    }
  })

  // --- Settings: Multi-Provider Keys (D7) ---

  // Legacy get/set for backward compatibility (maps to anthropic)
  ipcMain.handle('settings:get-api-key', async () => {
    const key = await loadProviderKey('anthropic')
    return { ok: true, value: key }
  })

  ipcMain.handle('settings:set-api-key', async (_event, key: string) => {
    try {
      if (!key) {
        keyCache.delete('anthropic')
        try { await unlink(providerKeyPath('anthropic')) } catch { /* noop */ }
        return { ok: true, value: undefined }
      }
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key)
        await writeFile(providerKeyPath('anthropic'), encrypted)
      } else {
        await writeFile(providerKeyPath('anthropic'), key, 'utf-8')
      }
      keyCache.set('anthropic', key)
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // New multi-provider key endpoints
  ipcMain.handle('settings:set-provider-key', async (_event, provider: string, key: string) => {
    try {
      if (!key) {
        keyCache.delete(provider)
        try { await unlink(providerKeyPath(provider)) } catch { /* noop */ }
        return { ok: true, value: undefined }
      }
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key)
        await writeFile(providerKeyPath(provider), encrypted)
      } else {
        console.warn(`[settings] safeStorage not available — storing ${provider} API key as plaintext`)
        await writeFile(providerKeyPath(provider), key, 'utf-8')
      }
      keyCache.set(provider, key)
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:clear-provider-key', async (_event, provider: string) => {
    try {
      keyCache.delete(provider)
      try { await unlink(providerKeyPath(provider)) } catch { /* noop */ }
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  /** Batch endpoint: returns hasKey + last4 for each provider (D7). */
  ipcMain.handle('settings:get-provider-keys-status', async () => {
    try {
      const anthropicKey = await loadProviderKey('anthropic')
      const openaiKey = await loadProviderKey('openai')
      return {
        ok: true,
        value: {
          anthropic: { hasKey: !!anthropicKey, last4: anthropicKey ? anthropicKey.slice(-4) : undefined },
          openai: { hasKey: !!openaiKey, last4: openaiKey ? openaiKey.slice(-4) : undefined },
          ollama: { hasKey: false, note: 'No key required' },
        },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // --- Settings: Provider Config ---

  ipcMain.handle('settings:get-provider-config', async () => {
    try {
      const config = await loadProviderConfig()
      return { ok: true, value: config }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:set-provider-config', async (_event, config: ProviderConfigFile) => {
    try {
      await saveProviderConfig(config)
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // --- Settings: GCP OAuth ---

  ipcMain.handle('settings:get-gcp-oauth-status', async () => {
    try {
      const config = await loadGCPOAuthConfig()
      const hasOverride = !!config
      const hasBuiltIn = !!(import.meta.env.MAIN_VITE_GMAIL_CLIENT_ID && import.meta.env.MAIN_VITE_GMAIL_CLIENT_SECRET)
      return { ok: true, value: { configured: hasOverride || hasBuiltIn, hasBuiltIn, hasOverride } }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:set-gcp-oauth', async (_event, clientId: string, clientSecret: string) => {
    try {
      await saveGCPOAuthConfig({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:clear-gcp-oauth', async () => {
    try {
      await clearGCPOAuthConfig()
      // Also disconnect Gmail and GTasks since they depend on these credentials
      try { await disconnectGmail() } catch { /* noop */ }
      try { await disconnectGTasks() } catch { /* noop */ }
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // --- Settings: Ollama ---

  ipcMain.handle('settings:list-ollama-models', async (_event, baseUrl?: string) => {
    try {
      const models = await OllamaProvider.listModels(baseUrl)
      return { ok: true, value: models }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('settings:test-ollama', async (_event, baseUrl?: string) => {
    try {
      const connected = await OllamaProvider.testConnection(baseUrl)
      return { ok: true, value: connected }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // --- Settings: Test Tools Probe ---

  ipcMain.handle('settings:test-tools', async (_event, providerName: string, model: string) => {
    try {
      const globalCfg = await loadProviderConfig()
      const ollamaBase = globalCfg.ollamaBaseUrl ?? 'http://localhost:11434'

      const key = providerName !== 'ollama' ? await loadProviderKey(providerName) : undefined
      if (providerName !== 'ollama' && !key) {
        return { ok: false, error: `No API key configured for ${providerName}` }
      }

      const testProvider = createProvider({
        provider: providerName as ProviderName,
        model,
        apiKey: key,
        ollamaBaseUrl: ollamaBase,
      })

      if (!isToolCapableProvider(testProvider)) {
        return { ok: true, value: { status: 'not_supported', message: 'Provider does not implement tool interface' } }
      }

      const testTool = {
        name: 'ping_tool',
        description: 'A test tool. When called, return the input value.',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      }

      // Round 1: expect tool call
      const r1 = await testProvider.createToolUseMessage({
        messages: [{ role: 'user', content: "Call ping_tool with input='ping' and return only 'ok' after tool result." }],
        systemPrompt: 'You are a test assistant. Use the provided tools when asked.',
        tools: [testTool],
      })

      if (r1.toolCalls.length === 0) {
        const capKey2 = toolCapKey(providerName, model, providerName === 'ollama' ? ollamaBase : undefined)
        setToolCapability(providerName, model, 'not_observed', providerName === 'ollama' ? ollamaBase : undefined)
        return { ok: true, value: { status: 'not_observed', message: 'Model did not make a tool call' } }
      }

      // Round 2: provide tool result, expect final text
      const r2 = await testProvider.createToolUseMessage({
        messages: [
          { role: 'user', content: "Call ping_tool with input='ping' and return only 'ok' after tool result." },
          { role: 'assistant', rawMessage: r1.rawAssistantMessage, derivedText: r1.textContent },
          { role: 'tool', toolCallId: r1.toolCalls[0].id, toolName: 'ping_tool', content: 'pong' },
        ],
        systemPrompt: 'You are a test assistant. Use the provided tools when asked.',
        tools: [testTool],
      })

      setToolCapability(providerName, model, 'supported', providerName === 'ollama' ? ollamaBase : undefined)
      return { ok: true, value: { status: 'supported', message: `Tool call succeeded. Model response: ${r2.textContent.slice(0, 100)}` } }
    } catch (err) {
      if (err instanceof ToolsNotSupportedError) {
        setToolCapability(providerName, model, 'not_supported', providerName === 'ollama' ? (await loadProviderConfig()).ollamaBaseUrl : undefined)
        return { ok: true, value: { status: 'not_supported', message: err.message } }
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- KB Update Extraction (non-streaming LLM call) ---

  const TIER_SORT_ORDER: Record<string, number> = {
    structural: 0,
    status: 1,
    intelligence: 2,
    general: 3,
  }

  ipcMain.handle(
    'chat:extract-kb-updates',
    async (_event, payload: { domainId: string; content: string }) => {
      try {
        // 1. Get domain config
        const domain = domainRepo.getById(payload.domainId)
        if (!domain.ok) {
          return { ok: false, error: domain.error.message }
        }

        // 3. Get KB file list (paths only, capped at 200, sorted by tier priority)
        const kbFiles = kbRepo.getFiles(payload.domainId)
        const filePaths = kbFiles.ok
          ? kbFiles.value
              .sort((a, b) => (TIER_SORT_ORDER[a.tier] ?? 4) - (TIER_SORT_ORDER[b.tier] ?? 4))
              .slice(0, 200)
              .map((f) => f.relativePath)
          : []

        // 4. Build extraction prompt
        const kbUpdateFormat = `When you need to suggest updates to the knowledge base, use this format:

\`\`\`kb-update
file: <filename>
action: <create|update|delete>
tier: <structural|status|intelligence|general>
mode: <full|append|patch>
basis: <primary|sibling|external|user>
reasoning: <why this change is needed>
confirm: DELETE <filename>
---
<new file content>
\`\`\`

Tier write rules:
- structural (claude.md): mode must be "patch" — never full replace
- status (kb_digest.md): mode "full" or "append" allowed
- intelligence (kb_intel.md): any mode allowed
- general: any mode allowed
- Deletes: include "confirm: DELETE <filename>" or the delete will be rejected`

        const extractionDirective = `Analyze the conversation content below and produce kb-update blocks for durable facts, decisions, status changes, or procedures that should be persisted to the knowledge base.

Rules:
- Only emit kb-update blocks for information worth persisting long-term
- Prefer status-tier with mode: full or append for new events
- Avoid structural-tier unless changing system instructions
- Do not propose deletes unless explicitly requested
- Ignore casual chat, greetings, and transient discussion
- Conversation content may be truncated`

        const systemPrompt = [
          `You are the KB extraction agent for the "${domain.value.name}" domain.`,
          domain.value.identity ? `Domain identity: ${domain.value.identity}` : '',
          '',
          'Existing KB files:',
          filePaths.length > 0 ? filePaths.map((p) => `- ${p}`).join('\n') : '(none)',
          '',
          kbUpdateFormat,
          '',
          extractionDirective,
        ].filter(Boolean).join('\n')

        // 5. Call LLM (non-streaming) — use resolved provider from global config
        const extractConfig = await loadProviderConfig()
        const extractProviderName = (extractConfig.defaultProvider ?? 'anthropic') as ProviderName
        const extractModel = extractConfig.defaultModel ?? DEFAULT_MODELS[extractProviderName]
        const extractKey = extractProviderName !== 'ollama' ? await loadProviderKey(extractProviderName) : undefined
        if (extractProviderName !== 'ollama' && !extractKey) {
          return { ok: false, error: `No API key configured for ${extractProviderName}. Open Settings to add one.` }
        }
        const extractProvider = createProvider({
          provider: extractProviderName,
          model: extractModel,
          apiKey: extractKey,
          ollamaBaseUrl: extractConfig.ollamaBaseUrl,
        })
        const response = await extractProvider.chatComplete(
          [{ role: 'user' as const, content: payload.content }],
          systemPrompt,
        )

        if (!response.ok) {
          return { ok: false, error: response.error.message }
        }

        // 6. Parse response
        const { proposals, rejectedProposals } = parseKBUpdates(response.value)

        return { ok: true, value: { proposals, rejectedProposals } }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const isNetwork = message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('fetch failed')
        return {
          ok: false,
          error: isNetwork ? 'Network error' : message,
        }
      }
    },
  )

  // ── Automation IPC handlers ──

  const automationRepo = new AutomationRepository(db)

  ipcMain.handle('automation:list', async (_e: IpcMainInvokeEvent, domainId: string) => {
    try {
      const result = automationRepo.getByDomain(domainId)
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:get', async (_e: IpcMainInvokeEvent, id: string) => {
    try {
      const result = automationRepo.getById(id)
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:create', async (_e: IpcMainInvokeEvent, input: CreateAutomationInput) => {
    try {
      const result = automationRepo.create(input)
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:update', async (_e: IpcMainInvokeEvent, id: string, input: UpdateAutomationInput) => {
    try {
      const result = automationRepo.update(id, input)
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:delete', async (_e: IpcMainInvokeEvent, id: string) => {
    try {
      const result = automationRepo.delete(id)
      return result.ok ? { ok: true, value: undefined } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:toggle', async (_e: IpcMainInvokeEvent, id: string) => {
    try {
      const result = automationRepo.toggle(id)
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:run', async (_e: IpcMainInvokeEvent, id: string, requestId: string) => {
    try {
      triggerManualRun(id, requestId)
      return { ok: true, value: undefined }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:runs', async (_e: IpcMainInvokeEvent, automationId: string, limit?: number) => {
    try {
      const result = automationRepo.getRunsByAutomation(automationId, limit)
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('automation:reset-failures', async (_e: IpcMainInvokeEvent, id: string) => {
    try {
      automationRepo.resetFailureStreak(id)
      // Re-enable the automation
      const result = automationRepo.update(id, { enabled: true })
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  // --- Tags ---

  ipcMain.handle('tags:get', async (_e: IpcMainInvokeEvent, domainId: string) => {
    try {
      return { ok: true, value: tagRepo.getByDomain(domainId) }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('tags:set', async (_e: IpcMainInvokeEvent, domainId: string, tags: Array<{ key: string; value: string }>) => {
    try {
      tagRepo.setTags(domainId, tags)
      return { ok: true }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('tags:distinct-values', async (_e: IpcMainInvokeEvent, key: string, limit?: number) => {
    try {
      return { ok: true, value: tagRepo.getDistinctValues(key, limit ? { limit } : undefined) }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('tags:filter', async (_e: IpcMainInvokeEvent, filters: Record<string, string[]>) => {
    try {
      return { ok: true, value: tagRepo.findDomainIdsByFilters(filters) }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  ipcMain.handle('tags:all', async () => {
    try {
      return { ok: true, value: tagRepo.getAllGroupedByDomain() }
    } catch (e) { return { ok: false, error: (e as Error).message } }
  })

  // --- Skills CRUD ---

  ipcMain.handle('skill:list', async () => {
    const result = skillRepo.list()
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:list-with-meta', async (_e: IpcMainInvokeEvent, domainId?: string) => {
    const result = skillRepo.listWithMeta(domainId)
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:list-enabled', async () => {
    const result = skillRepo.listEnabled()
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:list-enabled-for-domain', async (_e: IpcMainInvokeEvent, domainId: string) => {
    const result = skillRepo.listEnabledForDomain(domainId)
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:get', async (_e: IpcMainInvokeEvent, id: string) => {
    const result = skillRepo.getById(id)
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:create', async (_e: IpcMainInvokeEvent, input: CreateSkillInput) => {
    const result = skillRepo.create(input)
    if (result.ok) emitSkillsChanged()
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:update', async (_e: IpcMainInvokeEvent, id: string, input: UpdateSkillInput) => {
    const result = skillRepo.update(id, input)
    if (result.ok) emitSkillsChanged()
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:delete', async (_e: IpcMainInvokeEvent, id: string) => {
    const result = skillRepo.delete(id)
    if (result.ok) emitSkillsChanged()
    return result.ok ? { ok: true } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:toggle', async (_e: IpcMainInvokeEvent, id: string) => {
    const result = skillRepo.toggleEnabled(id)
    if (result.ok) emitSkillsChanged()
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:export', async (_e: IpcMainInvokeEvent, id: string) => {
    const result = skillRepo.getById(id)
    if (!result.ok) return { ok: false, error: result.error.message }

    const markdown = skillToMarkdown(result.value)
    const safeName = result.value.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')
    const dialogResult = await dialog.showSaveDialog({
      defaultPath: `${safeName}.skill.md`,
      filters: [{ name: 'Skill files', extensions: ['skill.md', 'md'] }],
    })
    if (dialogResult.canceled || !dialogResult.filePath) return { ok: false, error: 'Cancelled' }
    await writeFile(dialogResult.filePath, markdown, 'utf-8')
    return { ok: true, value: { path: dialogResult.filePath } }
  })

  ipcMain.handle('skill:import', async () => {
    const dialogResult = await dialog.showOpenDialog({
      filters: [{ name: 'Skill files', extensions: ['skill.md', 'md'] }],
      properties: ['openFile'],
    })
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return { ok: false, error: 'Cancelled' }
    try {
      const content = await readFile(dialogResult.filePaths[0], 'utf-8')
      const input = markdownToSkillInput(content)
      const result = skillRepo.create(input)
      if (result.ok) emitSkillsChanged()
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // --- Chat History Persistence ---

  ipcMain.handle('chat:load-history', (_event, domainId: string, limit?: number) => {
    return chatMessageRepo.getByDomain(domainId, limit)
  })

  ipcMain.handle('chat:persist-messages', (_event, domainId: string, messages: Array<{
    id: string; role: string; content: string; status?: string | null
    metadata?: Record<string, unknown>; createdAt: string
  }>) => {
    return chatMessageRepo.appendMessages(domainId, messages)
  })

  ipcMain.handle('chat:clear-history', (_event, domainId: string) => {
    return chatMessageRepo.clearByDomain(domainId)
  })

  // --- Window Pin ---

  ipcMain.handle('appWindow:get-pinned', async () => {
    try {
      const config = await loadProviderConfig()
      return { ok: true, value: config.windowPinned ?? false }
    } catch {
      return { ok: true, value: false }
    }
  })

  ipcMain.handle('appWindow:set-pinned', async (event, pinned: boolean) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { ok: false, error: 'No window found' }

      if (process.platform === 'darwin') {
        win.setAlwaysOnTop(pinned, 'floating')
      } else {
        win.setAlwaysOnTop(pinned)
      }

      // Save to config
      const config = await loadProviderConfig()
      await saveProviderConfig({ ...config, windowPinned: pinned })

      // Broadcast to all renderers
      const allWindows = BrowserWindow.getAllWindows()
      for (const w of allWindows) {
        if (!w.isDestroyed()) {
          w.webContents.send('appWindow:pinned-changed', { pinned, windowId: win.id })
        }
      }

      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --- File text extraction (for binary attachments: PDF, Excel, Word) ---

  ipcMain.handle('file:extract-text', async (_e: IpcMainInvokeEvent, filename: string, buffer: ArrayBuffer) => {
    try {
      const ext = filename.toLowerCase().split('.').pop() ?? ''
      if (ext === 'doc') {
        return { ok: false, error: 'Legacy .doc format not supported — please convert to .docx' }
      }
      const buf = Buffer.from(buffer)
      const text = await extractTextFromBuffer(filename, buf)
      return { ok: true, value: text }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // --- Missions ---

  initMissionParsers()
  const missionRepo = new MissionRepository(db)
  const missionRunRepo = new MissionRunRepository(db)

  ipcMain.handle('mission:list', () => {
    const result = missionRepo.listSummaries()
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('mission:list-for-domain', (_event, domainId: string) => {
    const result = missionRepo.listSummariesForDomain(domainId)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('mission:get', (_event, id: string) => {
    const result = missionRepo.getById(id)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('mission:enable-for-domain', (_event, missionId: string, domainId: string) => {
    const result = missionRepo.enableForDomain(missionId, domainId)
    return result.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('mission:disable-for-domain', (_event, missionId: string, domainId: string) => {
    const result = missionRepo.disableForDomain(missionId, domainId)
    return result.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('mission:run', async (event: IpcMainInvokeEvent, missionId: string, domainId: string, inputs: Record<string, unknown>, requestId: string) => {
    const controller = new AbortController()

    try {
      // Resolve provider (same pattern as briefing:analyze)
      const globalConfig = await loadProviderConfig()
      const resolvedProvider = (globalConfig.defaultProvider ?? 'anthropic') as ProviderName
      const resolvedModel = globalConfig.defaultModel ?? DEFAULT_MODELS[resolvedProvider]
      const ollamaBaseUrl = globalConfig.ollamaBaseUrl ?? 'http://localhost:11434'

      if (resolvedProvider !== 'ollama') {
        const apiKey = await loadProviderKey(resolvedProvider)
        if (!apiKey) {
          return { ok: false, error: `No API key configured for ${resolvedProvider}. Open Settings to add one.` }
        }
      } else {
        const reachable = await OllamaProvider.testConnection(ollamaBaseUrl)
        if (!reachable) {
          return { ok: false, error: `Ollama not reachable at ${ollamaBaseUrl}. Is it running?` }
        }
      }

      // ── Shared helper: real Gmail draft ──
      async function createRealGmailDraft(to: string, subject: string, body: string): Promise<string> {
        const creds = await loadGmailCredentials()
        if (!creds) {
          throw new Error('Gmail not connected. Connect Gmail in Settings.')
        }
        const client = new GmailClient({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          refreshToken: creds.refreshToken,
        })
        return client.createDraft(to, subject, body)
      }

      // ── Build base deps (shared across all mission types) ──
      const deps: MissionRunnerDeps = {
        db,
        async streamLLM(systemPrompt, userMessage, onChunk, signal) {
          const apiKey = resolvedProvider !== 'ollama' ? await loadProviderKey(resolvedProvider) : undefined
          const provider = createProvider({
            provider: resolvedProvider,
            model: resolvedModel,
            apiKey,
            ollamaBaseUrl,
          })

          let fullResponse = ''
          for await (const chunk of provider.chat(
            [{ role: 'user' as const, content: userMessage }],
            systemPrompt,
          )) {
            if (signal.aborted) break
            fullResponse += chunk
            onChunk(chunk)
          }
          return fullResponse
        },
        async createDeadline(domainId, text, dueDate, priority) {
          return deadlineRepo.create({
            domainId,
            text,
            dueDate,
            priority,
            source: 'mission',
            sourceRef: `mission:${missionId}`,
          })
        },
        async createGmailDraft(to, subject, body) {
          return createRealGmailDraft(to, subject, body)
        },
        async loadDigests(domains: Array<{ id: string; name: string; kbPath: string }>) {
          // Load all domains if none specified
          let targetDomains: Array<{ id: string; name: string; kbPath: string }>
          if (domains.length > 0) {
            targetDomains = domains
          } else {
            const domainsResult = domainRepo.list()
            if (!domainsResult.ok) return []
            targetDomains = domainsResult.value.map((d) => ({ id: d.id, name: d.name, kbPath: d.kbPath }))
          }
          const digests: Array<{ domainId: string; domainName: string; content: string }> = []

          for (const domain of targetDomains) {
            try {
              const digestPath = join(domain.kbPath, 'kb_digest.md')
              const raw = await readFile(digestPath, 'utf-8')
              digests.push({ domainId: domain.id, domainName: domain.name, content: raw.slice(0, 6000) })
            } catch {
              digests.push({ domainId: domain.id, domainName: domain.name, content: '(kb_digest.md missing)' })
            }
          }

          return digests
        },
        async loadGlobalOverdueGTasks() {
          const creds = await loadGTasksCredentials()
          if (!creds) return 0
          try {
            const gtClient = new GTasksClient({
              clientId: creds.clientId,
              clientSecret: creds.clientSecret,
              refreshToken: creds.refreshToken,
            })
            return (await gtClient.getOverdue()).length
          } catch {
            return 0
          }
        },
        buildPrompt(context) {
          return buildBriefingPrompt({
            health: context.health as import('@domain-os/core').PortfolioHealth,
            digests: context.digests,
            currentDate: context.currentDate,
            globalOverdueGTasks: context.globalOverdueGTasks,
          })
        },
        async computeHealth(database: Database.Database) {
          const result = await computePortfolioHealth(database)
          return result as Result<unknown, DomainOSError>
        },
        emitProgress(runId: string, progressEvent: MissionProgressEvent) {
          if (!event.sender.isDestroyed()) {
            event.sender.send('mission:run-progress', progressEvent)
          }
        },
        auditLog(input: { domainId: string; changeDescription: string; eventType: string; source: string }) {
          auditRepo.logChange({
            domainId: input.domainId,
            changeDescription: input.changeDescription,
            eventType: input.eventType as AuditEventType,
            source: input.source,
          })
        },
      }

      // ── Mission-type dispatch: add hooks for loan-document-review ──
      const missionResult = new MissionRepository(db).getById(missionId)
      if (missionResult.ok && missionResult.value.definition.type === 'loan-document-review') {
        deps.buildContext = async (domId: string, mInputs: Record<string, unknown>) => {
          const domain = domainRepo.getById(domId)
          if (!domain.ok) throw new Error(`Domain not found: ${domId}`)
          const d = domain.value

          // Parse docPaths
          const docPathsRaw = (mInputs.docPaths as string || '').trim()
          const { content, files, missingPaths } = await loadKBContent(d.kbPath, docPathsRaw)

          return {
            context: {
              digest: content,
              domainName: d.name,
              docsReviewed: files.map((f: { relativePath: string }) => f.relativePath),
              docsMissing: missingPaths,
            },
            snapshot: {
              domainsRead: [domId],
              kbDigests: files.map((f: { relativePath: string; chars: number; contentHash: string; mtime: string }) => ({
                domainId: domId,
                path: f.relativePath,
                modified: f.mtime,
                chars: f.chars,
                contentHash: f.contentHash,
              })),
              missionType: 'loan-document-review',
            },
          }
        }

        deps.buildPrompts = (context, mInputs) => {
          return buildLoanReviewPrompt(
            context as unknown as import('@domain-os/core').LoanReviewContext,
            mInputs,
          )
        }

        deps.shouldGate = (mInputs: Record<string, unknown>, _parseResult: MissionParseResult) => {
          const email = (mInputs.draftEmailTo as string || '').trim()
          const warnings: Array<{ code: string; message: string }> = []
          if (!email) return { needsGate: false, actionIds: [], message: '', warnings }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            warnings.push({ code: 'invalid_email', message: `Invalid email: ${email}` })
            return { needsGate: false, actionIds: [], message: '', warnings }
          }
          return { needsGate: true, actionIds: ['draft-email'], message: `Draft attorney memo to ${email}`, warnings }
        }

        deps.buildEmailBody = (outputs) => {
          const memo = outputs.find((o) => o.outputType === 'loan_review_memo')
          if (memo && memo.contentJson.fullText) {
            return `Loan Document Review — Attorney Memo\n\n${memo.contentJson.fullText as string}\n\nGenerated by DomainOS Mission System`
          }
          return 'Loan Document Review memo attached.\n\nGenerated by DomainOS Mission System'
        }

        deps.buildEmailSubject = (mInputs, _outputs) => {
          const depth = (mInputs.reviewDepth as string) || 'attorney-prep'
          return `Loan Document Review (${depth}) — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        }
      }

      const runner = new MissionRunner(deps)

      // Store abort controller keyed by requestId only
      activeMissionRuns.set(requestId, controller)
      missionEvents.emit('mission-start', { requestId, domainId } satisfies MissionStartPayload)

      let terminalEmitted = false

      try {
        const result = await runner.start(
          missionId,
          domainId,
          { ...inputs, _requestId: requestId },
          resolvedModel,
          resolvedProvider,
          controller.signal,
        )

        if (result.ok) {
          if (result.value.status === 'gated') {
            // Store reverse lookup — only needed for gate-decide
            requestIdByRunId.set(result.value.id, requestId)
          } else {
            // Terminal: success, failed, cancelled (gated excluded by if-branch above)
            missionEvents.emit('mission-terminal', { requestId, domainId, status: result.value.status } as MissionTerminalPayload)
            terminalEmitted = true
          }
        } else {
          // Validation/creation error — no run in DB; clear mission-start
          missionEvents.emit('mission-terminal', { requestId, domainId, status: 'failed' } satisfies MissionTerminalPayload)
          terminalEmitted = true
        }

        return result.ok
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error.message }
      } catch (err) {
        if (!terminalEmitted) {
          const status = controller.signal.aborted ? 'cancelled' : 'failed'
          missionEvents.emit('mission-terminal', { requestId, domainId, status } satisfies MissionTerminalPayload)
        }
        if (controller.signal.aborted) {
          return { ok: false, error: 'CANCELLED' }
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        activeMissionRuns.delete(requestId)
        // No event emission in finally — handled above
      }
    } catch (err) {
      // Outer catch: provider resolution or deps setup failed before runner.start()
      missionEvents.emit('mission-terminal', { requestId, domainId, status: 'failed' } satisfies MissionTerminalPayload)
      activeMissionRuns.delete(requestId)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Renderer passes DB runId. Resolve requestId from DB (MissionRun.requestId is
  // Cancel by requestId — used during streaming before runId is known to the renderer.
  ipcMain.handle('mission:run-cancel-by-request-id', (_event, requestId: string) => {
    const controller = activeMissionRuns.get(requestId)
    if (controller) {
      controller.abort()
      return { ok: true, value: undefined }
    }
    return { ok: false, error: 'No active run found for requestId' }
  })

  // Cancel by runId — used after streaming when runId is known (or for gated runs
  // persisted at run creation, before streaming) to abort in-flight controller.
  ipcMain.handle('mission:run-cancel', (_event, runId: string) => {
    // Resolve requestId: try DB first, fall back to gated reverse map
    let resolvedRequestId = ''
    const runResult = missionRunRepo.getById(runId)
    if (runResult.ok && runResult.value.requestId) {
      resolvedRequestId = runResult.value.requestId
    }
    if (!resolvedRequestId) {
      resolvedRequestId = requestIdByRunId.get(runId) ?? ''
    }

    // Abort in-flight controller if found
    if (resolvedRequestId) {
      activeMissionRuns.get(resolvedRequestId)?.abort()
      // Don't delete from activeMissionRuns — mission:run finally handles cleanup
    }

    // Clean up gated reverse map
    requestIdByRunId.delete(runId)

    // Update DB status
    const cancelResult = missionRunRepo.updateStatus(runId, 'cancelled')
    if (cancelResult.ok) {
      missionEvents.emit('mission-terminal', {
        requestId: resolvedRequestId,
        domainId: '',
        status: 'cancelled',
      } satisfies MissionTerminalPayload)
    }
    return cancelResult.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: cancelResult.error.message }
  })

  ipcMain.handle('mission:run-status', (_event, runId: string) => {
    const result = missionRunRepo.getRunDetail(runId)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('mission:gate-decide', async (event: IpcMainInvokeEvent, runId: string, gateId: string, approved: boolean) => {
    try {
      // Resolve provider for potential action execution
      const globalConfig = await loadProviderConfig()
      const resolvedProvider = (globalConfig.defaultProvider ?? 'anthropic') as ProviderName
      const resolvedModel = globalConfig.defaultModel ?? DEFAULT_MODELS[resolvedProvider]
      const ollamaBaseUrl = globalConfig.ollamaBaseUrl ?? 'http://localhost:11434'

      // Shared Gmail draft helper for gate-decide
      async function gateCreateGmailDraft(to: string, subject: string, body: string): Promise<string> {
        const creds = await loadGmailCredentials()
        if (!creds) {
          throw new Error('Gmail not connected. Connect Gmail in Settings.')
        }
        const client = new GmailClient({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          refreshToken: creds.refreshToken,
        })
        return client.createDraft(to, subject, body)
      }

      const deps: MissionRunnerDeps = {
        db,
        async streamLLM() { return '' },
        async createDeadline(domainId, text, dueDate, priority) {
          return deadlineRepo.create({
            domainId,
            text,
            dueDate,
            priority,
            source: 'mission',
            sourceRef: `mission:gate-resume`,
          })
        },
        async createGmailDraft(to, subject, body) {
          return gateCreateGmailDraft(to, subject, body)
        },
        async loadDigests() { return [] },
        async loadGlobalOverdueGTasks() { return 0 },
        buildPrompt() { return '' },
        async computeHealth(database: Database.Database) { const r = await computePortfolioHealth(database); return r as Result<unknown, DomainOSError> },
        emitProgress(runId: string, progressEvent: MissionProgressEvent) {
          if (!event.sender.isDestroyed()) {
            event.sender.send('mission:run-progress', progressEvent)
          }
        },
        auditLog(input: { domainId: string; changeDescription: string; eventType: string; source: string }) {
          auditRepo.logChange({
            domainId: input.domainId,
            changeDescription: input.changeDescription,
            eventType: input.eventType as AuditEventType,
            source: input.source,
          })
        },
      }

      // Look up mission type from run record for email hooks
      const gateRunResult = missionRunRepo.getById(runId)
      if (gateRunResult.ok) {
        const gateMissionResult = new MissionRepository(db).getById(gateRunResult.value.missionId)
        if (gateMissionResult.ok && gateMissionResult.value.definition.type === 'loan-document-review') {
          deps.buildEmailBody = (outputs) => {
            const memo = outputs.find((o) => o.outputType === 'loan_review_memo')
            if (memo && memo.contentJson.fullText) {
              return `Loan Document Review — Attorney Memo\n\n${memo.contentJson.fullText as string}\n\nGenerated by DomainOS Mission System`
            }
            return 'Loan Document Review memo attached.\n\nGenerated by DomainOS Mission System'
          }
          deps.buildEmailSubject = (mInputs, _outputs) => {
            const depth = (mInputs.reviewDepth as string) || 'attorney-prep'
            return `Loan Document Review (${depth}) — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          }
        }
      }

      const runner = new MissionRunner(deps)
      const result = await runner.resumeAfterGate(runId, gateId, approved)

      if (result.ok) {
        const recoveredRequestId = requestIdByRunId.get(runId) ?? ''
        missionEvents.emit('mission-terminal', {
          requestId: recoveredRequestId,
          domainId: result.value.domainId,
          status: result.value.status,
        } as MissionTerminalPayload)
        requestIdByRunId.delete(runId)
      }

      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error.message }
    } catch (err) {
      // Best-effort: tell main to re-check DB state
      const recoveredRequestId = requestIdByRunId.get(runId) ?? ''
      requestIdByRunId.delete(runId)
      missionEvents.emit('mission-terminal', {
        requestId: recoveredRequestId,
        domainId: '',
        status: 'unknown',
      } satisfies MissionTerminalPayload)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('mission:run-history', (_event, domainId: string, limit?: number) => {
    const result = missionRunRepo.listByDomain(domainId, limit)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('mission:active-run', () => {
    const result = missionRunRepo.getActiveRun()
    if (!result.ok) return { ok: false, error: result.error.message }
    if (!result.value) return { ok: true, value: null }
    const detail = missionRunRepo.getRunDetail(result.value.id)
    return detail.ok
      ? { ok: true, value: detail.value }
      : { ok: false, error: detail.error.message }
  })

  ipcMain.handle('mission:latest-run', (_event, domainId: string) => {
    const result = missionRunRepo.getLatestRunForDomain(domainId)
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, value: result.value }
  })

  // ── Plugin handlers ──
  try {
  const pluginRepo = new PluginRepository(db)
  const commandRepo = new CommandRepository(db)
  const pluginsDir = join(app.getPath('userData'), 'plugins')

  // Startup: clean up interrupted installs
  cleanupStaging(pluginsDir).catch(() => {})

  ipcMain.handle('plugin:list', () => {
    const result = pluginRepo.list()
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('plugin:get', (_event, id: string) => {
    const result = pluginRepo.getById(id)
    if (!result.ok) return { ok: false, error: result.error.message }

    // Fetch associated skills and commands
    const skillRows = db
      .prepare(
        `SELECT id, name, description, is_enabled, plugin_skill_key, source_hash,
                removed_upstream_at, has_assets
         FROM skills WHERE plugin_id = ? ORDER BY sort_order ASC, name ASC`,
      )
      .all(id) as Array<{
      id: string; name: string; description: string; is_enabled: number
      plugin_skill_key: string | null; source_hash: string | null
      removed_upstream_at: string | null; has_assets: number
    }>

    const cmdsResult = commandRepo.listByPlugin(id)
    const commands = cmdsResult.ok ? cmdsResult.value : []

    return {
      ok: true,
      value: {
        ...result.value,
        skills: skillRows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isEnabled: r.is_enabled === 1,
          pluginSkillKey: r.plugin_skill_key,
          removedUpstreamAt: r.removed_upstream_at,
          hasAssets: r.has_assets === 1,
        })),
        commands: commands.map((c) => ({
          id: c.id,
          name: c.name,
          canonicalSlug: c.canonicalSlug,
          description: c.description,
          argumentHint: c.argumentHint,
          isEnabled: c.isEnabled,
          removedUpstreamAt: c.removedUpstreamAt,
        })),
      },
    }
  })

  ipcMain.handle('plugin:install-from-directory', async (_event, path: string) => {
    console.log('[plugin:install] Starting install from:', path)
    const result = await installPlugin(path, db, pluginsDir, {
      sourceType: 'local_directory',
    })
    if (result.ok) {
      console.log('[plugin:install] Success:', result.value.plugin.name, '— skills:', result.value.skillsImported, 'commands:', result.value.commandsImported)
      emitSkillsChanged()
      return { ok: true, value: result.value }
    } else {
      console.error('[plugin:install] Failed:', result.error.message)
      return { ok: false, error: result.error.message }
    }
  })

  ipcMain.handle('plugin:uninstall', async (_event, id: string) => {
    const { rm } = await import('node:fs/promises')
    const plugin = pluginRepo.getById(id)
    if (!plugin.ok) return { ok: false, error: plugin.error.message }

    const result = pluginRepo.delete(id)
    if (!result.ok) return { ok: false, error: result.error.message }

    // Remove from disk
    try { await rm(plugin.value.installPath, { recursive: true, force: true }) } catch { /* ok */ }
    emitSkillsChanged()
    return { ok: true }
  })

  ipcMain.handle('plugin:toggle', (_event, id: string) => {
    const result = pluginRepo.toggle(id)
    if (result.ok) emitSkillsChanged()
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('plugin:enable-for-domain', (_event, pluginId: string, domainId: string) => {
    // Check hard deps before enabling
    const plugin = pluginRepo.getById(pluginId)
    if (!plugin.ok) return { ok: false, error: plugin.error.message }

    if (plugin.value.sourceRepo) {
      const deps = checkDependencies(plugin.value.name, plugin.value.sourceRepo, db, domainId)
      if (deps.hard.length > 0) {
        const missing = deps.hard[0]!
        const msg = missing.installedGlobally
          ? `Requires "${missing.name}" enabled for this domain`
          : `Requires "${missing.name}" to be installed`
        return { ok: false, error: msg }
      }
    }

    const result = pluginRepo.enableForDomain(pluginId, domainId)
    if (result.ok) emitSkillsChanged()
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('plugin:disable-for-domain', (_event, pluginId: string, domainId: string) => {
    const result = pluginRepo.disableForDomain(pluginId, domainId)
    if (result.ok) emitSkillsChanged()
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('plugin:list-for-domain', (_event, domainId: string) => {
    const result = pluginRepo.listForDomain(domainId)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('plugin:check-updates', async (_event, id: string) => {
    const plugin = pluginRepo.getById(id)
    if (!plugin.ok) return { ok: false, error: plugin.error.message }
    // For MVP: no actual remote version check — just return no update
    return { ok: true, value: { hasUpdate: false } }
  })

  ipcMain.handle('plugin:marketplace-list', async () => {
    const result = await listMarketplace(db)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  // ── Command handlers ──

  ipcMain.handle('command:list-for-domain', (_event, domainId: string) => {
    const cmdsResult = commandRepo.listForDomain(domainId)
    if (!cmdsResult.ok) return { ok: false, error: cmdsResult.error.message }

    const slugsResult = commandRepo.computeDisplaySlugs(domainId)
    const slugMap = slugsResult.ok ? slugsResult.value : new Map()

    const enriched = cmdsResult.value.map((cmd) => ({
      ...cmd,
      displaySlug: slugMap.get(cmd.canonicalSlug) ?? cmd.canonicalSlug,
      isModified: cmd.sourceHash !== createHash('sha256').update(cmd.content).digest('hex'),
    }))

    return { ok: true, value: enriched }
  })

  ipcMain.handle('command:get', (_event, id: string) => {
    const result = commandRepo.getById(id)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  ipcMain.handle('command:display-slugs', (_event, domainId: string) => {
    const result = commandRepo.computeDisplaySlugs(domainId)
    if (!result.ok) return { ok: false, error: result.error.message }
    // Convert Map to plain object for IPC
    const obj: Record<string, string> = {}
    for (const [k, v] of result.value) obj[k] = v
    return { ok: true, value: obj }
  })

  ipcMain.handle('command:invoke-log', (_event, input: {
    commandId: string; domainId: string; canonicalSlug: string
    pluginVersion?: string | null; argsHash?: string | null; resultHash?: string | null
    durationMs?: number | null; status: 'success' | 'blocked' | 'error'; errorCode?: string | null
  }) => {
    const result = commandRepo.logInvocation(input)
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error.message }
  })

  } catch (err) {
    console.error('[plugin-handlers] FATAL: Failed to register plugin/command IPC handlers:', err)
  }
}
