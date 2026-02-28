import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { app, dialog, BrowserWindow, Notification } from 'electron'
import { spawn } from 'node:child_process'
import {
  writeFileSync,
  chmodSync,
  readFileSync,
  existsSync,
  statSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  renameSync,
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

// ── Constants ──

const EXPECTED_BUNDLE_ID = 'com.domain-os.desktop'
const REPO_URL = 'https://github.com/quiet-coder-io/DomainOS/releases/tag'
const MIN_ZIP_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_ZIP_AGE_MS = 30 * 60 * 1000 // 30 minutes
const LOG_DIR = join(app.getPath('home'), 'Library/Logs/DomainOS')
const MARKER_PATH = join(app.getPath('userData'), 'last-update-result.json')
const CACHE_PATH = join(
  app.getPath('home'),
  'Library/Caches/@domain-osdesktop-updater',
)

// ── Logging ──

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    /* best effort */
  }
}

function logPath(): string {
  return join(LOG_DIR, 'updater.log')
}

// ── Marker (persisted update result for next-launch check) ──

interface UpdateMarker {
  status: 'success' | 'failed'
  fromVersion: string
  toVersion: string
  error: string | null
  logPath: string
  timestamp: string
}

function writeMarkerJSON(marker: UpdateMarker): string {
  return JSON.stringify(marker, null, 2)
}

// ── Preflight checks ──

function getBundlePath(): string {
  const exe = app.getPath('exe') // .../DomainOS.app/Contents/MacOS/DomainOS
  return resolve(exe, '../../..') // .../DomainOS.app
}

function isOnDMGOrTranslocated(bundlePath: string): boolean {
  return (
    bundlePath.startsWith('/Volumes/') ||
    bundlePath.includes('AppTranslocation')
  )
}

function isBundleSane(bundlePath: string): boolean {
  const plistPath = join(bundlePath, 'Contents/Info.plist')
  if (!existsSync(plistPath)) return false
  try {
    const plist = readFileSync(plistPath, 'utf-8')
    return plist.includes(EXPECTED_BUNDLE_ID)
  } catch {
    return false
  }
}

function isReallyWritable(dir: string): boolean {
  const testFile = join(dir, `.dominos-write-test-${process.pid}`)
  try {
    writeFileSync(testFile, 'test')
    renameSync(testFile, testFile + '.renamed')
    unlinkSync(testFile + '.renamed')
    return true
  } catch {
    return false
  }
}

function findUpdateZip(): string | null {
  // Primary: update.zip in cache root
  const primary = join(CACHE_PATH, 'update.zip')
  if (isValidZip(primary)) return primary

  // Fallback: newest .zip in pending/
  const pendingDir = join(CACHE_PATH, 'pending')
  if (existsSync(pendingDir)) {
    try {
      const zips = readdirSync(pendingDir)
        .filter((f) => f.endsWith('.zip'))
        .map((f) => {
          const full = join(pendingDir, f)
          return { path: full, mtime: statSync(full).mtimeMs }
        })
        .sort((a, b) => b.mtime - a.mtime)
      if (zips.length > 0 && isValidZip(zips[0].path)) return zips[0].path
    } catch {
      /* ignore */
    }
  }
  return null
}

function isValidZip(zipPath: string): boolean {
  try {
    const stat = statSync(zipPath)
    if (stat.size < MIN_ZIP_BYTES) return false
    if (Date.now() - stat.mtimeMs > MAX_ZIP_AGE_MS) return false
    return true
  } catch {
    return false
  }
}

interface PreflightResult {
  ok: boolean
  error?: string
  bundlePath: string
  zipPath: string | null
  needsAdmin: boolean
}

function runPreflight(): PreflightResult {
  const bundlePath = getBundlePath()
  const fail = (error: string): PreflightResult => ({
    ok: false,
    error,
    bundlePath,
    zipPath: null,
    needsAdmin: false,
  })

  if (isOnDMGOrTranslocated(bundlePath)) {
    return fail(
      'DomainOS is running from a disk image or translocated path. Move it to /Applications first.',
    )
  }

  if (!isBundleSane(bundlePath)) {
    return fail(
      'Cannot verify current app bundle (Info.plist missing or wrong bundle ID).',
    )
  }

  const zipPath = findUpdateZip()
  if (!zipPath) {
    return fail('Update zip not found, too small, or too old.')
  }

  const parentDir = dirname(bundlePath)
  const needsAdmin = !isReallyWritable(parentDir)

  return { ok: true, bundlePath, zipPath, needsAdmin }
}

// ── Install script generation ──

function generateInstallScript(opts: {
  bundlePath: string
  zipPath: string
  pid: number
  expectedVersion: string
  expectedArch: string
  fromVersion: string
  logFile: string
  markerPath: string
  needsAdmin: boolean
}): string {
  const suffix = randomBytes(4).toString('hex')
  const staging = `${opts.bundlePath}.update-staging.${suffix}`
  const backup = `${opts.bundlePath}.bak`
  const destNew = `${opts.bundlePath}.new`

  // The core extraction + validation + swap logic
  const coreScript = `#!/bin/bash
# DomainOS hardened self-updater — bypasses Squirrel.Mac for unsigned apps
set -euo pipefail

exec >> "${opts.logFile}" 2>&1
echo ""
echo "========================================"
echo "[updater] $(date -u '+%Y-%m-%dT%H:%M:%SZ') — Install script started"
echo "[updater] PID to wait for: ${opts.pid}"
echo "[updater] Bundle: ${opts.bundlePath}"
echo "[updater] ZIP: ${opts.zipPath}"
echo "[updater] Expected version: ${opts.expectedVersion}"
echo "[updater] Expected arch: ${opts.expectedArch}"
echo "[updater] Needs admin: ${opts.needsAdmin}"
echo "========================================"

APP_PATH="${opts.bundlePath}"
UPDATE_ZIP="${opts.zipPath}"
APP_PID=${opts.pid}
STAGING="${staging}"
BACKUP="${backup}"
DEST_NEW="${destNew}"
EXPECTED_VERSION="${opts.expectedVersion}"
EXPECTED_ARCH="${opts.expectedArch}"
MARKER_PATH="${opts.markerPath}"
FROM_VERSION="${opts.fromVersion}"
LOG_PATH="${opts.logFile}"

write_marker() {
  local status="$1"
  local error="$2"
  cat > "$MARKER_PATH" <<MARKER_EOF
{
  "status": "$status",
  "fromVersion": "$FROM_VERSION",
  "toVersion": "$EXPECTED_VERSION",
  "error": $error,
  "logPath": "$LOG_PATH",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
MARKER_EOF
}

abort() {
  echo "[updater] ABORT: $1"
  write_marker "failed" "\\"$1\\""
  # Relaunch current app on failure
  open -n -a "$APP_PATH" 2>/dev/null || true
  rm -rf "$STAGING" "$DEST_NEW" 2>/dev/null || true
  exit 1
}

# 1. Wait for PID to exit (max 60s)
echo "[updater] Waiting for PID $APP_PID to exit..."
for i in $(seq 1 120); do
  kill -0 $APP_PID 2>/dev/null || break
  sleep 0.5
done
if kill -0 $APP_PID 2>/dev/null; then
  echo "[updater] WARN: App still running after 60s"
  ps -p $APP_PID -o pid,comm,state= 2>/dev/null || true
  abort "App process did not exit within 60s"
fi
echo "[updater] App process exited"

# 2. Stale state guard
if [ -d "$BACKUP" ] && [ -d "$APP_PATH" ]; then
  echo "[updater] Cleaning stale backup from previous attempt"
  rm -rf "$BACKUP"
elif [ -d "$BACKUP" ] && [ ! -d "$APP_PATH" ]; then
  echo "[updater] Restoring from previous failed update backup"
  mv "$BACKUP" "$APP_PATH"
  abort "Restored from previous failed update backup"
fi

[ ! -d "$APP_PATH" ] && abort "Destination app missing at $APP_PATH"

# 3. Extract update to staging
echo "[updater] Extracting update to staging: $STAGING"
rm -rf "$STAGING" "$DEST_NEW"
mkdir -p "$STAGING"
ditto -x -k "$UPDATE_ZIP" "$STAGING"

# 4. Find .app by bundle ID (not just first .app)
EXTRACTED_APP=""
for candidate in "$STAGING"/*.app "$STAGING"/*/*.app; do
  [ ! -d "$candidate" ] && continue
  PLIST="$candidate/Contents/Info.plist"
  [ ! -f "$PLIST" ] && continue
  if grep -q "${EXPECTED_BUNDLE_ID}" "$PLIST" 2>/dev/null; then
    EXTRACTED_APP="$candidate"
    break
  fi
done
if [ -z "$EXTRACTED_APP" ]; then
  abort "No .app with bundle ID ${EXPECTED_BUNDLE_ID} found in update zip"
fi
echo "[updater] Found app: $EXTRACTED_APP"

# 5. Version validation
EXTRACTED_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$EXTRACTED_APP/Contents/Info.plist" 2>/dev/null || echo "")
if [ "$EXTRACTED_VERSION" != "$EXPECTED_VERSION" ]; then
  abort "Version mismatch: expected $EXPECTED_VERSION, got $EXTRACTED_VERSION"
fi
echo "[updater] Version verified: $EXTRACTED_VERSION"

# 6. Architecture validation
EXE_NAME=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$EXTRACTED_APP/Contents/Info.plist" 2>/dev/null || echo "DomainOS")
EXE_PATH="$EXTRACTED_APP/Contents/MacOS/$EXE_NAME"
if [ -f "$EXE_PATH" ]; then
  FILE_INFO=$(file "$EXE_PATH" 2>/dev/null || echo "")
  if [ "$EXPECTED_ARCH" = "arm64" ]; then
    if ! echo "$FILE_INFO" | grep -q "arm64"; then
      abort "Architecture mismatch: expected arm64 but binary does not contain arm64"
    fi
  elif [ "$EXPECTED_ARCH" = "x86_64" ]; then
    if ! echo "$FILE_INFO" | grep -q "x86_64"; then
      abort "Architecture mismatch: expected x86_64 but binary does not contain x86_64"
    fi
  fi
  echo "[updater] Architecture verified: $EXPECTED_ARCH"
else
  echo "[updater] WARN: Could not verify architecture (executable not found at $EXE_PATH)"
fi

# 7. Clear quarantine on extracted app (pre-swap)
xattr -cr "$EXTRACTED_APP" 2>/dev/null || true

# 8. ditto copy to DEST.new (not move — avoids staging cleanup deleting installed app)
echo "[updater] Copying extracted app to $DEST_NEW"
ditto "$EXTRACTED_APP" "$DEST_NEW"

# Quick re-validate DEST.new
[ ! -f "$DEST_NEW/Contents/Info.plist" ] && abort "Copied app missing Info.plist"
`

  // The swap logic — may run elevated or not
  const swapScript = `#!/bin/bash
set -euo pipefail

APP_PATH="${opts.bundlePath}"
BACKUP="${backup}"
DEST_NEW="${destNew}"
STAGING="${staging}"
MARKER_PATH="${opts.markerPath}"
FROM_VERSION="${opts.fromVersion}"
EXPECTED_VERSION="${opts.expectedVersion}"
LOG_PATH="${opts.logFile}"

write_marker() {
  local status="$1"
  local error="$2"
  cat > "$MARKER_PATH" <<MARKER_EOF
{
  "status": "$status",
  "fromVersion": "$FROM_VERSION",
  "toVersion": "$EXPECTED_VERSION",
  "error": $error,
  "logPath": "$LOG_PATH",
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
MARKER_EOF
}

# Swap: mv current → .bak, mv .new → current
mv "$APP_PATH" "$BACKUP"
mv "$DEST_NEW" "$APP_PATH"

# Post-swap quarantine clear
xattr -cr "$APP_PATH" 2>/dev/null || true

# Clean up
rm -rf "$BACKUP" "$STAGING" 2>/dev/null || true

echo "[updater] Swap complete"
`

  if (opts.needsAdmin) {
    // Write swap script to a separate file; elevate via osascript
    const swapScriptPath = '/tmp/dominos-swap.sh'
    return `${coreScript}

# 9. Write swap script for admin elevation
cat > "${swapScriptPath}" <<'SWAP_SCRIPT_EOF'
${swapScript}
SWAP_SCRIPT_EOF
chmod 755 "${swapScriptPath}"

# 10. Elevate and run swap
echo "[updater] Requesting admin elevation for swap..."
if ! osascript -e 'do shell script "/bin/bash ${swapScriptPath}" with administrator privileges' >> "${opts.logFile}" 2>&1; then
  echo "[updater] Admin elevation failed or was cancelled"
  rm -rf "$STAGING" "$DEST_NEW" 2>/dev/null || true
  abort "Admin elevation failed or was cancelled by user"
fi

# 11. Verify swap succeeded
if [ ! -d "$APP_PATH/Contents" ]; then
  abort "Swap appeared to succeed but app bundle is missing"
fi

write_marker "success" "null"
echo "[updater] Update applied successfully"

# 12. Relaunch
echo "[updater] Relaunching..."
open -n -a "$APP_PATH"
`
  }

  // Non-admin path: swap inline
  return `${coreScript}

# 9. Swap: mv current → .bak, mv .new → current
echo "[updater] Performing swap..."
mv "$APP_PATH" "$BACKUP" || abort "Failed to move current app to backup"
mv "$DEST_NEW" "$APP_PATH" || {
  echo "[updater] CRITICAL: Failed to move new app to destination, rolling back..."
  mv "$BACKUP" "$APP_PATH" 2>/dev/null || true
  abort "Swap failed, rolled back to previous version"
}

# 10. Post-swap quarantine clear
xattr -cr "$APP_PATH" 2>/dev/null || true

# 11. Clean up backup + staging
rm -rf "$BACKUP" "$STAGING" 2>/dev/null || true

# 12. Verify swap
if [ ! -d "$APP_PATH/Contents" ]; then
  abort "Swap appeared to succeed but app bundle is missing"
fi

write_marker "success" "null"
echo "[updater] Update applied successfully"

# 13. Relaunch
echo "[updater] Relaunching..."
open -n -a "$APP_PATH"
`
}

// ── Manual install entrypoint ──

function manualInstallAndRelaunch(info: UpdateInfo): void {
  const preflight = runPreflight()

  if (!preflight.ok) {
    console.error('[updater] Preflight failed:', preflight.error)
    showManualInstallDialog(info.version, preflight.error!)
    return
  }

  ensureLogDir()

  const expectedArch =
    process.arch === 'arm64' ? 'arm64' : 'x86_64'

  const script = generateInstallScript({
    bundlePath: preflight.bundlePath,
    zipPath: preflight.zipPath!,
    pid: process.pid,
    expectedVersion: info.version,
    expectedArch,
    fromVersion: app.getVersion(),
    logFile: logPath(),
    markerPath: MARKER_PATH,
    needsAdmin: preflight.needsAdmin,
  })

  const scriptPath = join('/tmp', `dominos-updater-${randomBytes(4).toString('hex')}.sh`)
  writeFileSync(scriptPath, script, 'utf-8')
  chmodSync(scriptPath, 0o755)

  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  console.log(
    `[updater] Spawned hardened installer (script=${scriptPath}, admin=${preflight.needsAdmin}), exiting app...`,
  )
}

// ── Dialogs ──

function showManualInstallDialog(version: string, reason: string): void {
  dialog
    .showMessageBox({
      type: 'warning',
      title: 'Auto-Update Failed',
      message: `Could not auto-install DomainOS ${version}.`,
      detail: `${reason}\n\nYou can download and install this update manually.`,
      buttons: ['Install Manually', 'Dismiss'],
    })
    .then((r) => {
      if (r.response === 0) {
        const { shell } = require('electron') as typeof import('electron')
        shell.openExternal(`${REPO_URL}/v${version}`)
      }
    })
}

function showDMGDialog(bundlePath: string): void {
  dialog
    .showMessageBox({
      type: 'warning',
      title: 'Cannot Update',
      message: 'DomainOS is running from a disk image.',
      detail:
        'Please drag DomainOS to your Applications folder first, then relaunch from there.',
      buttons: ['Show in Finder', 'Dismiss'],
    })
    .then((r) => {
      if (r.response === 0) {
        spawn('open', ['-R', bundlePath])
      }
    })
}

// ── Next-launch update status check ──

export function checkLastUpdateResult(): void {
  if (!existsSync(MARKER_PATH)) return

  try {
    const raw = readFileSync(MARKER_PATH, 'utf-8')
    const marker: UpdateMarker = JSON.parse(raw)

    // Always delete marker after reading
    try {
      unlinkSync(MARKER_PATH)
    } catch {
      /* best effort */
    }

    if (marker.status === 'success') {
      console.log(
        `[updater] Previous update succeeded: ${marker.fromVersion} → ${marker.toVersion}`,
      )
      if (Notification.isSupported()) {
        new Notification({
          title: 'DomainOS Updated',
          body: `Updated to v${marker.toVersion}`,
        }).show()
      }
    } else {
      console.error(
        `[updater] Previous update failed: ${marker.error}`,
      )
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Failed',
        message: `DomainOS failed to update to v${marker.toVersion}.`,
        detail: marker.error ?? 'Unknown error. Check the log for details.',
        buttons: ['Open Log', 'Install Manually', 'Dismiss'],
      }).then((r) => {
        const { shell } = require('electron') as typeof import('electron')
        if (r.response === 0) {
          shell.openExternal(`file://${marker.logPath}`)
        } else if (r.response === 1) {
          shell.openExternal(`${REPO_URL}/v${marker.toVersion}`)
        }
      })
    }
  } catch (e) {
    console.error('[updater] Failed to read update marker:', e)
    try {
      unlinkSync(MARKER_PATH)
    } catch {
      /* best effort */
    }
  }
}

// ── Auto-updater initialization ──

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) return

  const bundlePath = getBundlePath()
  console.log(
    `[updater] macOS unsigned mode: manual apply enabled`,
  )
  console.log(
    `[updater] bundlePath=${bundlePath} cache=${CACHE_PATH}`,
  )

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false // Disable Squirrel.Mac entirely

  autoUpdater.on('update-available', (info) => {
    // Check for DMG/translocation early so user gets a helpful message
    if (isOnDMGOrTranslocated(bundlePath)) {
      showDMGDialog(bundlePath)
      return
    }

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `DomainOS ${info.version} is available. Download now?`,
        buttons: ['Download', 'Later'],
      })
      .then((r) => {
        if (r.response === 0) autoUpdater.downloadUpdate()
      })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const preflight = runPreflight()
    const restartLabel = preflight.needsAdmin
      ? 'Restart (Admin Required)'
      : 'Restart'

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `DomainOS ${info.version} has been downloaded. Restart now to install?`,
        buttons: [restartLabel, 'Later'],
      })
      .then((r) => {
        if (r.response === 0) {
          // Strip close-event handlers so nothing blocks app.exit()
          for (const win of BrowserWindow.getAllWindows()) {
            win.removeAllListeners('close')
          }

          // Spawn hardened installer script (bypasses Squirrel.Mac)
          manualInstallAndRelaunch(info)

          // Exit the app so the installer script can replace the bundle
          app.exit(0)
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Auto-update error:', err.stack ?? err.message)
  })

  // Check 10s after launch, then every 4 hours
  setTimeout(
    () =>
      autoUpdater
        .checkForUpdates()
        .catch((e: Error) =>
          console.error('[updater] Check failed:', e.stack ?? e.message),
        ),
    10_000,
  )
  setInterval(
    () =>
      autoUpdater
        .checkForUpdates()
        .catch((e: Error) =>
          console.error('[updater] Check failed:', e.stack ?? e.message),
        ),
    4 * 3600_000,
  )
}
