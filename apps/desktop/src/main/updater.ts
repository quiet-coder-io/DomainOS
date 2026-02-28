import { autoUpdater } from 'electron-updater'
import { app, dialog, BrowserWindow } from 'electron'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `DomainOS ${info.version} is available. Download now?`,
      buttons: ['Download', 'Later'],
    }).then((r) => { if (r.response === 0) autoUpdater.downloadUpdate() })
  })

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `DomainOS ${info.version} has been downloaded. Restart now to install?`,
      buttons: ['Restart', 'Later'],
    }).then((r) => {
      if (r.response === 0) {
        // Defer to next tick — quitAndInstall blocks if called while dialog is still dismissing
        setImmediate(() => autoUpdater.quitAndInstall(false, true))
      }
    })
  })

  autoUpdater.on('error', (err) => {
    // Silent UI, verbose file log — helps debug 404/rate-limit/quarantine issues
    console.error('[updater] Auto-update error:', err.stack ?? err.message)
  })

  // Check 10s after launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates().catch((e: Error) => {
    console.error('[updater] Check failed:', e.stack ?? e.message)
  }), 10_000)
  setInterval(() => autoUpdater.checkForUpdates().catch((e: Error) => {
    console.error('[updater] Check failed:', e.stack ?? e.message)
  }), 4 * 3600_000)
}
