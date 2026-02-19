import { ipcMain, dialog, safeStorage, app } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
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
} from '@domain-os/core'
import type {
  CreateDomainInput,
  UpdateDomainInput,
  ChatMessage,
  KBUpdateProposal,
  AuditEventType,
  ProviderName,
  ToolCapableProvider,
} from '@domain-os/core'
import { getIntakeToken } from './intake-token'
import { startKBWatcher, stopKBWatcher } from './kb-watcher'
import { loadGmailCredentials, checkGmailConnected } from './gmail-credentials'
import { startGmailOAuth, disconnectGmail } from './gmail-oauth'
import { GMAIL_TOOLS } from './gmail-tools'
import { runToolLoop } from './tool-loop'
import { GmailClient } from '@domain-os/integrations'

// ── Provider config types (D20) ──

interface ProviderConfigFile {
  version: number
  defaultProvider: ProviderName
  defaultModel: string
  ollamaBaseUrl: string
}

const DEFAULT_PROVIDER_CONFIG: ProviderConfigFile = {
  version: 1,
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
  ollamaBaseUrl: 'http://localhost:11434',
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

  // Seed default shared protocols (STOP + Gap Detection) — idempotent
  seedDefaultProtocols(sharedProtocolRepo)

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
        domainId: string
        messages: ChatMessage[]
      },
    ) => {
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
            event.sender.send('chat:stream-done')
            return { ok: false, error: `${source} uses ${resolvedProvider}, but no API key is configured. Open Settings to add one.` }
          }
        } else {
          const reachable = await OllamaProvider.testConnection(ollamaBaseUrl)
          if (!reachable) {
            event.sender.send('chat:stream-done')
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

        const kbFiles = kbRepo.getFiles(payload.domainId)
        if (!kbFiles.ok) return { ok: false, error: kbFiles.error.message }

        const kbContext = await buildKBContext(domain.value.kbPath, kbFiles.value, TOKEN_BUDGETS.primaryKB)
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
        const lastUserMsg = payload.messages.filter((m) => m.role === 'user').at(-1)
        const isWrapUp = lastUserMsg && /\b(wrap\s*up|wrap\s*-\s*up|end\s*session|session\s*summary|final\s*summary)\b/i.test(lastUserMsg.content)

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

        const promptResult = buildSystemPrompt({
          domain: {
            name: domain.value.name,
            description: domain.value.description,
            identity: domain.value.identity ?? '',
            escalationTriggers: domain.value.escalationTriggers ?? '',
          },
          kbContext: kbContext.value,
          protocols: protocols.value.map((p) => ({ name: p.name, content: p.content })),
          sharedProtocols: sharedProtoList,
          siblingContext,
          sessionContext,
          currentDate,
        })
        const systemPrompt = promptResult.prompt

        let fullResponse = ''

        // --- Gmail tool-use branch (uses unified shouldUseTools routing) ---
        const gmailCreds = await loadGmailCredentials()
        const gmailEnabled = gmailCreds && domain.value.allowGmail

        if (gmailEnabled && shouldUseTools(provider, resolvedProvider, resolvedModel, domain.value, ollamaBaseUrl)) {
          const gmailClient = new GmailClient({
            clientId: gmailCreds.clientId,
            clientSecret: gmailCreds.clientSecret,
            refreshToken: gmailCreds.refreshToken,
          })

          // Preflight: validate credentials before entering tool loop
          const profile = await gmailClient.getProfile()
          if (!profile.ok) {
            event.sender.send('chat:stream-chunk', 'Gmail credentials appear to be invalid or expired. Please reconnect Gmail in the settings bar above.')
            event.sender.send('chat:stream-done')
            return { ok: true, value: { content: 'Gmail credentials appear to be invalid or expired. Please reconnect Gmail in the settings bar above.', proposals: [], rejectedProposals: [], stopBlocks: [], gapFlags: [], decisions: [] } }
          }

          const toolsHint = '\n\n## Available Tools\nYou have access to Gmail search and read tools. Use gmail_search to find messages and gmail_read for full content. Always use the tools — do not assume email content. Only use Gmail tools when the user\'s request clearly requires email access; otherwise answer normally.'

          const result = await runToolLoop({
            provider: provider as ToolCapableProvider,
            providerName: resolvedProvider,
            model: resolvedModel,
            domainId: payload.domainId,
            userMessages: payload.messages,
            systemPrompt: systemPrompt + toolsHint,
            tools: GMAIL_TOOLS,
            gmailClient,
            eventSender: event.sender,
            ollamaBaseUrl: resolvedProvider === 'ollama' ? ollamaBaseUrl : undefined,
          })

          fullResponse = result.fullResponse
        } else {
          // --- Streaming path (all providers) ---
          for await (const chunk of provider.chat(payload.messages, systemPrompt)) {
            fullResponse += chunk
            event.sender.send('chat:stream-chunk', chunk)
          }

          event.sender.send('chat:stream-done')
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
          gapFlagRepo.create({
            domainId: payload.domainId,
            sessionId,
            category: gf.category,
            description: gf.description,
          })
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
            content: fullResponse,
            proposals,
            rejectedProposals,
            stopBlocks,
            gapFlags: parsedGapFlags,
            decisions: parsedDecisions,
          },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        event.sender.send('chat:stream-done')
        return { ok: false, error: message }
      }
    },
  )

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

  ipcMain.handle('relationship:add-sibling', (_event, domainId: string, siblingDomainId: string) => {
    return relationshipRepo.addSibling(domainId, siblingDomainId)
  })

  ipcMain.handle('relationship:remove-sibling', (_event, domainId: string, siblingDomainId: string) => {
    return relationshipRepo.removeSibling(domainId, siblingDomainId)
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
}
