import { ipcMain, dialog, safeStorage, app } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import { writeFile, readFile, unlink, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
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
  buildKBContext,
  buildSiblingContext,
  buildSystemPrompt,
  buildStartupReport,
  AnthropicProvider,
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
} from '@domain-os/core'
import { getIntakeToken } from './intake-token'
import { startKBWatcher, stopKBWatcher } from './kb-watcher'

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

  // --- Chat (streaming) ---

  ipcMain.handle(
    'chat:send',
    async (
      event: IpcMainInvokeEvent,
      payload: {
        domainId: string
        messages: ChatMessage[]
        apiKey: string
      },
    ) => {
      try {
        const domain = domainRepo.getById(payload.domainId)
        if (!domain.ok) return { ok: false, error: domain.error.message }

        // Session: get or create active session
        let activeSession = sessionRepo.getActive(payload.domainId)
        let sessionId: string | undefined
        if (activeSession.ok && activeSession.value) {
          sessionId = activeSession.value.id
        } else {
          const newSession = sessionRepo.create({
            domainId: payload.domainId,
            scope: 'working',
            modelProvider: 'anthropic',
            modelName: 'claude-sonnet-4-5-20250929',
          })
          if (newSession.ok) {
            sessionId = newSession.value.id
            // Log session start to audit
            auditRepo.logChange({
              domainId: payload.domainId,
              sessionId,
              changeDescription: `Session started (scope: working)`,
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

        const provider = new AnthropicProvider({ apiKey: payload.apiKey })
        let fullResponse = ''

        for await (const chunk of provider.chat(payload.messages, systemPrompt)) {
          fullResponse += chunk
          event.sender.send('chat:stream-chunk', chunk)
        }

        event.sender.send('chat:stream-done')

        const proposals = parseKBUpdates(fullResponse)

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

        const provider = new AnthropicProvider({ apiKey })
        const classification = await classifyContent(
          provider,
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

  // --- Settings (API Key with safeStorage) ---

  const apiKeyPath = resolve(app.getPath('userData'), 'api-key.enc')

  ipcMain.handle('settings:get-api-key', async () => {
    try {
      const encrypted = await readFile(apiKeyPath)
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(encrypted)
        return { ok: true, value: decrypted }
      }
      // Fallback: file stored as plain UTF-8
      return { ok: true, value: encrypted.toString('utf-8') }
    } catch {
      // File doesn't exist yet
      return { ok: true, value: '' }
    }
  })

  ipcMain.handle('settings:set-api-key', async (_event, key: string) => {
    try {
      if (!key) {
        // Clear the key
        try {
          await unlink(apiKeyPath)
        } catch {
          // File didn't exist, that's fine
        }
        return { ok: true, value: undefined }
      }

      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key)
        await writeFile(apiKeyPath, encrypted)
      } else {
        console.warn('[settings] safeStorage not available — storing API key as plaintext')
        await writeFile(apiKeyPath, key, 'utf-8')
      }
      return { ok: true, value: undefined }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
