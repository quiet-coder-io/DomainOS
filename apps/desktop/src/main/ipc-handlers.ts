import { ipcMain, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DomainRepository,
  KBRepository,
  ProtocolRepository,
  scanKBDirectory,
  buildKBContext,
  buildSystemPrompt,
  AnthropicProvider,
  parseKBUpdates,
} from '@domain-os/core'
import type {
  CreateDomainInput,
  UpdateDomainInput,
  ChatMessage,
  KBUpdateProposal,
} from '@domain-os/core'

const TOKEN_BUDGET = 32_000

export function registerIPCHandlers(db: Database.Database): void {
  const domainRepo = new DomainRepository(db)
  const kbRepo = new KBRepository(db)
  const protocolRepo = new ProtocolRepository(db)

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
}
