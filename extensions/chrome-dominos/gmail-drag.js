const DEBUG = false
const HANDLE_CLASS = 'dominos-drag-handle'

// --- Drag handle injection ---
// Gmail's event system blocks native drag on its rows. Instead of fighting it,
// we inject a small drag handle into each row. The handle is OUR element, so
// it bypasses Gmail's mousedown/drag interception entirely.

function injectDragHandles() {
  const rows = document.querySelectorAll('tr.zA')
  let count = 0
  for (const row of rows) {
    if (row.querySelector('.' + HANDLE_CLASS)) continue
    // Make the row position:relative so we can absolutely position the handle
    if (getComputedStyle(row).position === 'static') {
      row.style.position = 'relative'
    }
    const handle = document.createElement('div')
    handle.className = HANDLE_CLASS
    handle.draggable = true
    handle.title = 'Drag to DomainOS'
    handle.textContent = '\u2630' // ☰ trigram icon (cleaner than ≡)
    // Stop events from reaching Gmail's handlers
    handle.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault() })
    handle.addEventListener('mousedown', (e) => { e.stopPropagation() })
    // Append directly to the row as an overlay
    row.appendChild(handle)
    count++
  }
  if (DEBUG && count) console.debug('[dominos-gmail-drag] injected', count, 'drag handles')
}

// Inject styles
const style = document.createElement('style')
style.textContent = `
.${HANDLE_CLASS} {
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 13px;
  color: #9aa0a6;
  cursor: grab;
  border-radius: 3px;
  user-select: none;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.15s;
  background: transparent;
}
tr.zA:hover .${HANDLE_CLASS} {
  opacity: 1;
}
.${HANDLE_CLASS}:hover {
  background: #e8f0fe;
  color: #1a73e8;
}
.${HANDLE_CLASS}:active {
  cursor: grabbing;
}
`
document.head.appendChild(style)

// Run on load and observe for dynamically loaded rows
injectDragHandles()
const observer = new MutationObserver(() => injectDragHandles())
observer.observe(document.body, { childList: true, subtree: true })

// --- Dragstart handler ---
document.addEventListener('dragstart', (e) => {
  try {
    const dt = e.dataTransfer
    if (!dt) return
    const target = e.target
    if (!target) return

    // Only act on our drag handle
    if (!target.classList?.contains(HANDLE_CLASS)) return

    const row = target.closest('tr.zA')
    if (!row) return

    const subject = extractSubject(row)
    if (!subject) return

    if (DEBUG) console.debug('[dominos-gmail-drag] subject:', subject)

    // Cross-app drag (Chrome → Electron) only reliably preserves text/uri-list values.
    // Custom MIME types and text/plain values are stripped by macOS during transfer.
    // Encode the subject as a query parameter in the URL — the renderer extracts it.
    const baseUrl = extractGmailHref(row) || location.href
    const url = new URL(baseUrl)
    url.searchParams.set('dominos_subject', subject)
    dt.setData('text/uri-list', url.toString())

    // Set a drag image using the row for visual feedback
    try {
      dt.setDragImage(row, 0, 0)
    } catch { /* ok if unsupported */ }
  } catch {
    // Never break Gmail
  }
}, true)

// --- Subject extraction ---

function extractGmailHref(row) {
  const link =
    row.querySelector('a[href*="#inbox/"], a[href*="#sent/"], a[href*="#search/"], a[href*="#label/"], a[href*="#all/"], a[href*="#starred/"], a[href*="#important/"], a[href*="#drafts/"]') ||
    row.querySelector('a[href*="mail.google.com"]')
  return link?.href || ''
}

function extractSubject(row) {
  // Strategy A: span[data-thread-id]
  const threadSpans = row.querySelectorAll('span[data-thread-id]')
  for (const el of threadSpans) {
    const t = cleanText(el.textContent)
    if (looksLikeSubject(t)) return t
  }

  // Strategy B: span[role="link"]
  const roleLinks = row.querySelectorAll('span[role="link"]')
  for (const el of roleLinks) {
    const t = cleanText(el.textContent)
    if (looksLikeSubject(t)) return t
  }

  // Strategy C: largest text container → prefer bold inside it
  const containers = row.querySelectorAll('td, div[role="gridcell"], div, span')
  let best = null
  let bestLen = 0
  for (const el of containers) {
    const t = cleanText(el.textContent)
    if (t.length > bestLen) { bestLen = t.length; best = el }
  }

  if (best) {
    const bolds = best.querySelectorAll('b, strong')
    for (const el of bolds) {
      const t = cleanText(el.textContent)
      if (looksLikeSubject(t)) return t
    }
    const spans = best.querySelectorAll('span')
    for (const el of spans) {
      const t = cleanText(el.textContent)
      if (!looksLikeSubject(t)) continue
      try {
        const fw = getComputedStyle(el).fontWeight
        if (fw === 'bold' || parseInt(fw, 10) >= 600) return t
      } catch { /* skip */ }
    }

    const t = cleanText(best.textContent)
    const firstChunk = t.split(/\s[·–-]\s/)[0] || t.split('  ')[0] || t
    if (looksLikeSubject(firstChunk)) return firstChunk
  }

  return null
}

// --- Utilities ---

function cleanText(t) {
  return (t || '').replace(/\s+/g, ' ').trim()
}

function looksLikeSubject(t) {
  if (!t) return false
  if (t.length < 3 || t.length > 300) return false
  if (/^\d{1,2}:\d{2}\s?(AM|PM)?$/i.test(t)) return false
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(t)) return false
  if (/^(Yesterday|Today)\b/i.test(t)) return false
  if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/i.test(t)) return false
  if (/@/.test(t)) return false
  if ((t.match(/\.\s/g) || []).length >= 2) return false
  if ((t.match(/ · /g) || []).length >= 2) return false
  return true
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/'/g, '&#39;')
}
