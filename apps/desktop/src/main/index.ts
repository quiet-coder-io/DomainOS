import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from './database'
import { registerIPCHandlers } from './ipc-handlers'
import { generateIntakeToken } from './intake-token'
import { startIntakeServer, stopIntakeServer } from './intake-server'
import { stopAllKBWatchers } from './kb-watcher'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: true,
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
  stopAllKBWatchers()
  stopIntakeServer()
  closeDatabase()
})
