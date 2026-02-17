/* global chrome */

const titleEl = document.getElementById('title')
const sizeEl = document.getElementById('size')
const sourceEl = document.getElementById('source')
const sendBtn = document.getElementById('send-btn')
const statusEl = document.getElementById('status')
const notConfigured = document.getElementById('not-configured')
const openOptions = document.getElementById('open-options')

let extractedData = null

function showStatus(message, type) {
  statusEl.textContent = message
  statusEl.className = `status ${type}`
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

async function getConfig() {
  const result = await chrome.storage.local.get(['intakeToken', 'intakePort'])
  return {
    token: result.intakeToken || '',
    port: result.intakePort || 19532,
  }
}

async function extractContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return null

  // Extract page title + selected text (or full body text)
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection()?.toString()?.trim()
        return {
          title: document.title,
          content: selection || document.body.innerText.slice(0, 50000),
          url: window.location.href,
        }
      },
    })

    if (result?.result) {
      return {
        title: result.result.title,
        content: result.result.content,
        sourceUrl: result.result.url,
        extractionMode: result.result.content === (window.getSelection()?.toString()?.trim()) ? 'excerpt' : 'full',
      }
    }
  } catch {
    // Scripting failed
  }

  return null
}

async function sendToApp() {
  if (!extractedData) return

  const config = await getConfig()
  if (!config.token) {
    notConfigured.style.display = 'block'
    return
  }

  sendBtn.disabled = true
  showStatus('Sending...', 'info')

  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/intake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(extractedData),
    })

    const data = await response.json()

    if (response.ok && data.ok) {
      showStatus('Sent successfully!', 'success')
      sendBtn.textContent = 'Sent!'
    } else {
      showStatus(data.error || `Error: ${response.status}`, 'error')
      sendBtn.disabled = false
    }
  } catch (err) {
    showStatus(
      err.message.includes('Failed to fetch')
        ? 'Cannot connect to DomainOS. Is the app running?'
        : err.message,
      'error',
    )
    sendBtn.disabled = false
  }
}

async function init() {
  const config = await getConfig()

  if (!config.token) {
    notConfigured.style.display = 'block'
  }

  extractedData = await extractContent()

  if (extractedData) {
    titleEl.textContent = extractedData.title || '(untitled)'
    sizeEl.textContent = formatBytes(new Blob([extractedData.content]).size)
    sourceEl.textContent = extractedData.sourceUrl || '-'
    sendBtn.disabled = !config.token
  } else {
    titleEl.textContent = 'Could not extract content'
    showStatus('Unable to read page content.', 'error')
  }
}

sendBtn.addEventListener('click', sendToApp)
openOptions.addEventListener('click', (e) => {
  e.preventDefault()
  chrome.runtime.openOptionsPage()
})

init()
