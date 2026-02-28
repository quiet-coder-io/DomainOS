import { autoUpdater } from 'electron-updater'
import { app, dialog, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'

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
    }).then(async (r) => {
      if (r.response === 0) {
        // Clear quarantine on update cache — unsigned app updates get quarantined by macOS
        // Package name @domain-os/desktop → cache dir @domain-osdesktop-updater
        const cachePath = `${app.getPath('home')}/Library/Caches/@domain-osdesktop-updater`
        try {
          await new Promise<void>((resolve) => {
            execFile('xattr', ['-cr', cachePath], () => resolve())
          })
        } catch { /* non-fatal */ }

        // Strip close-event handlers so nothing blocks app.quit()
        // Do NOT destroy windows — destroying keeps the process alive on macOS
        // and the detached installer waits for the PID to exit forever
        for (const win of BrowserWindow.getAllWindows()) {
          win.removeAllListeners('close')
        }

        // quitAndInstall spawns a detached installer then calls app.quit()
        autoUpdater.quitAndInstall(false, true)

        // Hard fallback: if quit is blocked by anything, force-exit after 3s
        // so the detached installer can replace the app bundle
        setTimeout(() => {
          console.error('[updater] Force-exiting — quit was blocked')
          app.exit(0)
        }, 3_000)
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
