import { ipcMain, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DomainRepository,
  KBRepository,
  ProtocolRepository,
  IntakeRepository,
  scanKBDirectory,
  buildKBContext,
  buildSystemPrompt,
  AnthropicProvider,
  parseKBUpdates,
  classifyContent,
} from '@domain-os/core'
import type {
  CreateDomainInput,
  UpdateDomainInput,
  ChatMessage,
  KBUpdateProposal,
} from '@domain-os/core'
import { getIntakeToken } from './intake-token'

const TOKEN_BUDGET = 32_000

export function registerIPCHandlers(db: Database.Database): void {
  const domainRepo = new DomainRepository(db)
  const kbRepo = new KBRepository(db)
  const protocolRepo = new ProtocolRepository(db)
  const intakeRepo = new IntakeRepository(db)

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

        const kbFiles = kbRepo.getFiles(payload.domainId)
        if (!kbFiles.ok) return { ok: false, error: kbFiles.error.message }

        const kbContext = await buildKBContext(domain.value.kbPath, kbFiles.value, TOKEN_BUDGET)
        if (!kbContext.ok) return { ok: false, error: kbContext.error.message }

        const protocols = protocolRepo.getByDomainId(payload.domainId)
        if (!protocols.ok) return { ok: false, error: protocols.error.message }

        const systemPrompt = buildSystemPrompt(
          { name: domain.value.name, description: domain.value.description },
          kbContext.value,
          protocols.value.map((p) => ({ name: p.name, content: p.content })),
        )

        const provider = new AnthropicProvider({ apiKey: payload.apiKey })
        let fullResponse = ''

        for await (const chunk of provider.chat(payload.messages, systemPrompt)) {
          fullResponse += chunk
          event.sender.send('chat:stream-chunk', chunk)
        }

        event.sender.send('chat:stream-done')

        const proposals = parseKBUpdates(fullResponse)

        return {
          ok: true,
          value: {
            content: fullResponse,
            proposals,
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

        const filePath = join(domain.value.kbPath, proposal.file)
        await writeFile(filePath, proposal.content, 'utf-8')

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

  ipcMain.handle('intake:get-token', () => {
    return { ok: true, value: getIntakeToken() }
  })

  ipcMain.handle('intake:get-port', () => {
    return { ok: true, value: 19532 }
  })
}
