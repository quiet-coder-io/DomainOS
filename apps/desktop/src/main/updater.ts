import { autoUpdater } from 'electron-updater'
import { app, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `DomainOS ${info.version} is available. Download now?`,
      buttons: ['Download', 'Later'],
    }).then((r) => { if (r.response === 0) autoUpdater.downloadUpdate() })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const cachePath = join(app.getPath('appData'), '..', 'Caches', '@domain-osdesktop-updater', 'pending')
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `DomainOS ${info.version} has been downloaded.`,
      detail: 'The app is unsigned, so automatic install isn\'t available yet. Click "Show Update" to open the folder — unzip and drag DomainOS.app to Applications to replace the current version.',
      buttons: ['Show Update', 'Later'],
    }).then((r) => { if (r.response === 0) shell.openPath(cachePath) })
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
