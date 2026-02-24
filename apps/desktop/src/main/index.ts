import { app, BrowserWindow, shell, safeStorage } from 'electron'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from './database'
import { registerIPCHandlers } from './ipc-handlers'
import { generateIntakeToken } from './intake-token'
import { startIntakeServer, stopIntakeServer } from './intake-server'
import { stopAllKBWatchers } from './kb-watcher'
import { startAutomationEngine, stopAutomationEngine } from './automation-engine'
import { DomainRepository, createProvider, DEFAULT_MODELS } from '@domain-os/core'
import type { ProviderName } from '@domain-os/core'
import { GTasksClient } from '@domain-os/integrations'
import { loadGTasksCredentials } from './gtasks-credentials'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 500,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const db = initDatabase()

  generateIntakeToken()

  mainWindow = createWindow()

  registerIPCHandlers(db, mainWindow)

  startIntakeServer(db, (item) => {
    mainWindow?.webContents.send('intake:new-item', item.id)
  })

  // ── Provider resolution for automation engine ──

  const userDataPath = app.getPath('userData')

  async function loadProviderKey(provider: string): Promise<string> {
    try {
      const encrypted = await readFile(resolve(userDataPath, `api-key-${provider}.enc`))
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(encrypted)
      }
      return encrypted.toString('utf-8')
    } catch {
      return ''
    }
  }

  async function loadProviderConfig(): Promise<{ defaultProvider: ProviderName; defaultModel: string; ollamaBaseUrl: string }> {
    try {
      const raw = await readFile(resolve(userDataPath, 'provider-config.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      return {
        defaultProvider: parsed.defaultProvider ?? 'anthropic',
        defaultModel: parsed.defaultModel ?? 'claude-sonnet-4-20250514',
        ollamaBaseUrl: parsed.ollamaBaseUrl ?? 'http://localhost:11434',
      }
    } catch {
      return { defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514', ollamaBaseUrl: 'http://localhost:11434' }
    }
  }

  const domainRepo = new DomainRepository(db)

  startAutomationEngine({
    db,
    mainWindow,
    getProvider: async (domainId: string) => {
      const domain = domainRepo.getById(domainId)
      if (!domain.ok) return null

      const globalConfig = await loadProviderConfig()
      const resolvedProvider = (domain.value.modelProvider ?? globalConfig.defaultProvider) as ProviderName
      const resolvedModel = domain.value.modelName ?? globalConfig.defaultModel ?? DEFAULT_MODELS[resolvedProvider]
      const apiKey = resolvedProvider !== 'ollama' ? await loadProviderKey(resolvedProvider) : undefined
      if (resolvedProvider !== 'ollama' && !apiKey) return null

      return createProvider({ provider: resolvedProvider, model: resolvedModel, apiKey, ollamaBaseUrl: globalConfig.ollamaBaseUrl })
    },
    actionDeps: {
      mainWindow,
      getGTasksClient: async () => {
        const creds = await loadGTasksCredentials()
        if (!creds) return null
        return new GTasksClient({ clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken })
      },
      checkGmailComposeScope: async () => false, // gmail.compose not yet authorized by default
      createGmailDraft: async () => { throw new Error('Gmail compose scope not authorized') },
    },
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopAutomationEngine()
  stopAllKBWatchers()
  stopIntakeServer()
  closeDatabase()
})
