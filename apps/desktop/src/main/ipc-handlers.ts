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
  buildSiblingContext,
  buildSystemPrompt,
  buildStartupReport,
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
  MissionRepository,
  MissionRunRepository,
  MissionRunner,
  initMissionParsers,
  DomainOSError,
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
import { GTASKS_TOOLS } from './gtasks-tools'
import { runToolLoop } from './tool-loop'
import { sendChatChunk, sendChatDone } from './chat-events'
import { GmailClient, GTasksClient } from '@domain-os/integrations'
import type { GmailAttachmentMeta, GmailMessage } from '@domain-os/integrations'
import type { GmailContextMessage, GmailContextAttachment } from '../preload/api'
import { extractTextFromBuffer, isFormatSupported, resolveFormat } from './text-extractor'
import { emitAutomationEvent } from './automation-events'
import { triggerManualRun } from './automation-engine'

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
}

const DEFAULT_PROVIDER_CONFIG: ProviderConfigFile = {
  version: 1,
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  ollamaBaseUrl: 'http://localhost:11434',
  windowPinned: false,
}

// ── Sender-scoped chat abort controllers ──
const activeChatControllers = new Map<number, AbortController>()

function isAbortError(err: unknown, controller: AbortController): boolean {
  if (controller.signal.aborted) return true
  let current: unknown = err
  while (current instanceof Error) {
    if (current.name === 'AbortError') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
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

  // Seed default shared protocols (STOP + Gap Detection) — idempotent
  seedDefaultProtocols(sharedProtocolRepo)

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

        const kbFiles = kbRepo.getFiles(payload.domainId)
        if (!kbFiles.ok) return { ok: false, error: kbFiles.error.message }

        const kbBudget = isStatusBriefingEarly
          ? TOKEN_BUDGETS.primaryKB - TOKEN_BUDGETS.statusBriefing
          : TOKEN_BUDGETS.primaryKB
        const kbContext = await buildKBContext(domain.value.kbPath, kbFiles.value, kbBudget)
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

        // Fetch active skill (if selected for this message)
        let activeSkill: {
          name: string; description: string; content: string
          outputFormat: 'freeform' | 'structured'; outputSchema?: string | null; toolHints: string[]
        } | undefined
        if (payload.activeSkillId) {
          const skillResult = skillRepo.getById(payload.activeSkillId)
          if (skillResult.ok && skillResult.value.isEnabled) {
            const s = skillResult.value
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
        })
        const systemPrompt = promptResult.prompt

        // --- Tool-use branch (Advisory + Gmail + GTasks, uses unified shouldUseTools routing) ---
        const gmailCreds = await loadGmailCredentials()
        const gmailEnabled = gmailCreds && domain.value.allowGmail
        const gtasksCreds = await loadGTasksCredentials()
        const gtasksEnabled = !!gtasksCreds // global, no per-domain flag

        // Advisory tools are always available; Gmail/GTasks depend on credentials
        const toolsAvailable = true

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
            integrationNames.push('Gmail (gmail_search, gmail_read)')
            toolsHint += '\n\n## Gmail Access\nIMPORTANT: You have a live, authenticated Gmail connection. You CAN and SHOULD use the gmail_search and gmail_read tools to retrieve real emails. When the user asks about emails, correspondence, or contacts — USE YOUR TOOLS. Do not tell the user to copy-paste emails or claim you lack email access. If you are unsure whether an email exists, search for it first.\nIf the request does not involve email, respond normally without using tools.'
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
              integrationNames.push('Google Tasks (gtasks_search, gtasks_read, gtasks_complete, gtasks_update, gtasks_delete)')
              toolsHint += '\n\n## Google Tasks Access\nIMPORTANT: You have a live, authenticated Google Tasks connection. You CAN and SHOULD use the gtasks_* tools to search, read, complete, update, and delete the user\'s tasks. When the user asks about tasks or to-do items — USE YOUR TOOLS. Do not claim you lack task access.\nIf the request does not involve tasks, respond normally without using tools.'
            }
          }

          // Advisory tools are always available (read-only, no external credentials)
          tools.push(...ADVISORY_TOOLS)
          toolsHint += '\n\n## Advisory Tools\nYou have tools to search decisions, deadlines, cross-domain context, and risk snapshots. Use them when providing strategic advice, assessing risk, or referencing prior decisions. When quoting cross-domain data, always attribute the source domain name.'

          // Brainstorm tools are always available (DB-only, sync)
          tools.push(...BRAINSTORM_TOOLS)
          toolsHint += '\n\n## Brainstorm Tools\nYou have tools for deep brainstorming sessions: start sessions, browse techniques, capture ideas, check status, synthesize results, and control session lifecycle. Use these for extensive creative exploration with 10+ ideas and technique-guided facilitation.'

          if (isStatusBriefing) {
            toolsHint += '\n\n## Status Briefing Mode\nThis is a status update request. You SHOULD use available tools to enrich the briefing. Use the search hints provided in the DOMAIN STATUS BRIEFING section for Gmail/GTasks queries.'
          }

          // Prepend a prominent capability preamble when external integrations are connected
          if (integrationNames.length > 0) {
            const preamble = '\n\n=== TOOL CAPABILITIES ===\nYou have LIVE, AUTHENTICATED access to the following external integrations: ' + integrationNames.join('; ') + '.\nThese are real connections — not hypothetical. Use them when the user\'s request is relevant. NEVER claim you lack access to these integrations or tell the user to manually copy-paste data.'
            toolsHint = preamble + toolsHint
          }

          if (tools.length === ADVISORY_TOOLS.length) {
            // Only advisory tools available (Gmail + GTasks preflights failed) — still useful
            gmailClient = undefined
            gtasksClient = undefined
          }

          if (tools.length > 0) {
            const result = await runToolLoop({
              provider: provider as ToolCapableProvider,
              providerName: resolvedProvider,
              model: resolvedModel,
              domainId: payload.domainId,
              requestId,
              userMessages: payload.messages,
              systemPrompt: systemPrompt + toolsHint,
              tools,
              db,
              gmailClient,
              gtasksClient,
              eventSender: event.sender,
              ollamaBaseUrl: resolvedProvider === 'ollama' ? ollamaBaseUrl : undefined,
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
          for await (const chunk of provider.chat(payload.messages, systemPrompt, { signal: controller.signal })) {
            if (controller.signal.aborted) break
            fullResponse += chunk
            sendChatChunk(event.sender, requestId, chunk)
          }

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
      }
    })

    return { ok: true, value: undefined }
  })

  ipcMain.handle('kb:watch-stop', (_event, domainId: string) => {
    stopKBWatcher(domainId)
    return { ok: true, value: undefined }
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

  ipcMain.handle('skill:list-enabled', async () => {
    const result = skillRepo.listEnabled()
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:get', async (_e: IpcMainInvokeEvent, id: string) => {
    const result = skillRepo.getById(id)
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:create', async (_e: IpcMainInvokeEvent, input: {
    name: string; description?: string; content: string; outputFormat?: 'freeform' | 'structured'
    outputSchema?: string | null; toolHints?: string[]; isEnabled?: boolean; sortOrder?: number
  }) => {
    const result = skillRepo.create(input)
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:update', async (_e: IpcMainInvokeEvent, id: string, input: {
    name?: string; description?: string; content?: string; outputFormat?: 'freeform' | 'structured'
    outputSchema?: string | null; toolHints?: string[]; isEnabled?: boolean; sortOrder?: number
  }) => {
    const result = skillRepo.update(id, input)
    return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:delete', async (_e: IpcMainInvokeEvent, id: string) => {
    const result = skillRepo.delete(id)
    return result.ok ? { ok: true } : { ok: false, error: result.error.message }
  })

  ipcMain.handle('skill:toggle', async (_e: IpcMainInvokeEvent, id: string) => {
    const result = skillRepo.toggleEnabled(id)
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
  const activeMissionRuns = new Map<string, AbortController>()

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

      // Build deps
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
          // Placeholder — use gmail tool if available
          console.log(`[missions] Draft email requested: to=${to}, subject=${subject}`)
          return 'draft-placeholder'
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

      const runner = new MissionRunner(deps)

      // Store abort controller mapped by requestId (we'll get runId from result)
      activeMissionRuns.set(requestId, controller)

      const result = await runner.start(
        missionId,
        domainId,
        { ...inputs, _requestId: requestId },
        resolvedModel,
        resolvedProvider,
        controller.signal,
      )

      if (result.ok) {
        // Map runId → controller for cancel-by-runId
        activeMissionRuns.set(result.value.id, controller)
      }

      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error.message }
    } catch (err) {
      if (controller.signal.aborted) {
        return { ok: false, error: 'CANCELLED' }
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      activeMissionRuns.delete(requestId)
    }
  })

  ipcMain.handle('mission:run-cancel', (_event, runId: string) => {
    // Try both runId and requestId mappings
    const controller = activeMissionRuns.get(runId)
    if (controller) {
      controller.abort()
      activeMissionRuns.delete(runId)
    }
    const cancelResult = missionRunRepo.updateStatus(runId, 'cancelled')
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
          console.log(`[missions] Draft email requested: to=${to}, subject=${subject}`)
          return 'draft-placeholder'
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

      const runner = new MissionRunner(deps)
      const result = await runner.resumeAfterGate(runId, gateId, approved)

      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: result.error.message }
    } catch (err) {
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
}
