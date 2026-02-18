import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import type { BrowserWindow } from 'electron'

const watchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

const DEBOUNCE_MS = 500

export function startKBWatcher(
  domainId: string,
  kbPath: string,
  mainWindow: BrowserWindow | null,
  onChange: (domainId: string) => Promise<void>,
): void {
  // Stop existing watcher for this domain if any
  stopKBWatcher(domainId)

  try {
    const watcher = watch(kbPath, { recursive: true }, (_eventType, _filename) => {
      // Debounce rapid file saves
      const existing = debounceTimers.get(domainId)
      if (existing) clearTimeout(existing)

      debounceTimers.set(
        domainId,
        setTimeout(async () => {
          debounceTimers.delete(domainId)
          await onChange(domainId)
          mainWindow?.webContents.send('kb:files-changed', domainId)
        }, DEBOUNCE_MS),
      )
    })

    watcher.on('error', (err) => {
      console.error(`[kb-watcher] Error watching ${kbPath}: ${err.message}`)
      stopKBWatcher(domainId)
    })

    watchers.set(domainId, watcher)
  } catch (err) {
    console.error(`[kb-watcher] Failed to start watcher for ${kbPath}: ${(err as Error).message}`)
  }
}

export function stopKBWatcher(domainId: string): void {
  const watcher = watchers.get(domainId)
  if (watcher) {
    watcher.close()
    watchers.delete(domainId)
  }

  const timer = debounceTimers.get(domainId)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(domainId)
  }
}

export function stopAllKBWatchers(): void {
  for (const domainId of watchers.keys()) {
    stopKBWatcher(domainId)
  }
}
