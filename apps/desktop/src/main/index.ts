import { app, BrowserWindow, shell, safeStorage, Tray, Menu, nativeImage, Notification } from 'electron'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase, getDatabase } from './database'
import { registerIPCHandlers, missionEvents } from './ipc-handlers'
import { generateIntakeToken } from './intake-token'
import { startIntakeServer, stopIntakeServer } from './intake-server'
import { stopAllKBWatchers } from './kb-watcher'
import { startAutomationEngine, stopAutomationEngine } from './automation-engine'
import { DomainRepository, MissionRunRepository, createProvider, DEFAULT_MODELS } from '@domain-os/core'
import { initAutoUpdater, checkLastUpdateResult } from './updater'
import { setupApplicationMenu } from './app-menu'
import type { ProviderName } from '@domain-os/core'
import { GTasksClient } from '@domain-os/integrations'
import { loadGTasksCredentials } from './gtasks-credentials'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let hasActiveMission = false

// ── Mission state helpers ──

function refreshHasActiveMission(): void {
  try {
    const repo = new MissionRunRepository(getDatabase())
    const res = repo.getActiveRun()
    hasActiveMission = res.ok && res.value !== null
  } catch {
    hasActiveMission = false
  }
}

// ── Tray icon — programmatic 16x16 macOS template image ──

function createTrayIcon(): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  const cx = 8, cy = 8, r = 5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      const idx = (y * size + x) * 4
      if (dist <= r) {
        buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 255
      }
    }
  }
  const img = nativeImage.createFromBuffer(buf, { width: size, height: size })
  img.setTemplateImage(true)
  return img
}

// ── Tray + window helpers ──

function createTray(): void {
  if (tray) return
  tray = new Tray(createTrayIcon())
  tray.setToolTip('DomainOS — Mission running')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show DomainOS', click: showWindow },
    { type: 'separator' },
    { label: 'Force Quit', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', showWindow)
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

function showWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
  destroyTray()
}

// ── Window creation ──

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 500,
    show: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } } : {}),
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
  // Non-blocking: show update result from previous launch before anything else
  checkLastUpdateResult()

  setupApplicationMenu()
  const db = initDatabase()

  // ── Startup reconciliation: mark stale non-terminal runs as failed ──
  // updated_at is ISO 8601; lexical comparison is valid for chronological ordering
  try {
    const now = new Date().toISOString()
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    db.prepare(`
      UPDATE mission_runs SET status = 'failed', error = 'App terminated unexpectedly',
        ended_at = ?, updated_at = ?
      WHERE status IN ('pending', 'running') AND updated_at < ?
    `).run(now, now, cutoff)
  } catch { /* non-fatal */ }

  // Seed cached state from DB (gated runs survive restart)
  refreshHasActiveMission()

  generateIntakeToken()

  mainWindow = createWindow()
  initAutoUpdater(mainWindow)

  // ── Window close interception: hide to tray during active mission ──
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    if (hasActiveMission) {
      e.preventDefault()
      mainWindow?.hide()
      if (!tray) createTray()
    }
  })

  registerIPCHandlers(db, mainWindow)

  // ── Mission lifecycle listeners ──
  missionEvents.on('mission-start', () => {
    hasActiveMission = true
    tray?.setToolTip('DomainOS — Mission running')
  })

  missionEvents.on('mission-terminal', (payload?: { status?: 'success' | 'failed' | 'cancelled' | 'unknown' }) => {
    refreshHasActiveMission()

    // Only notify when window is hidden behind tray
    if (!tray) return
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isVisible()) return

    if (!hasActiveMission) {
      const status = payload?.status ?? 'unknown'
      const body = status === 'success' ? 'Mission complete'
        : status === 'cancelled' ? 'Mission cancelled'
        : status === 'failed' ? 'Mission failed'
        : 'Mission ended'

      if (Notification.isSupported()) {
        new Notification({ title: 'DomainOS', body }).show()
      }
      tray?.setToolTip(`DomainOS — ${body}`)
    }
  })

  // Restore window pin state
  loadProviderConfig().then((config) => {
    if (config.windowPinned && mainWindow && !mainWindow.isDestroyed()) {
      if (process.platform === 'darwin') {
        mainWindow.setAlwaysOnTop(true, 'floating')
      } else {
        mainWindow.setAlwaysOnTop(true)
      }
    }
  }).catch(() => {
    // Non-fatal: pin restore failed
  })

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

  async function loadProviderConfig(): Promise<{ defaultProvider: ProviderName; defaultModel: string; ollamaBaseUrl: string; windowPinned?: boolean }> {
    try {
      const raw = await readFile(resolve(userDataPath, 'provider-config.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      return {
        defaultProvider: parsed.defaultProvider ?? 'anthropic',
        defaultModel: parsed.defaultModel ?? 'claude-sonnet-4-20250514',
        ollamaBaseUrl: parsed.ollamaBaseUrl ?? 'http://localhost:11434',
        windowPinned: parsed.windowPinned ?? false,
      }
    } catch {
      return { defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-20250514', ollamaBaseUrl: 'http://localhost:11434', windowPinned: false }
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      destroyTray()
    } else {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  stopAutomationEngine()
  stopAllKBWatchers()
  stopIntakeServer()
  closeDatabase()
})
