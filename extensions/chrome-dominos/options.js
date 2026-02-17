/* global chrome */

const tokenInput = document.getElementById('token')
const portInput = document.getElementById('port')
const saveBtn = document.getElementById('save-btn')
const testBtn = document.getElementById('test-btn')
const statusEl = document.getElementById('status')

function showStatus(message, type) {
  statusEl.textContent = message
  statusEl.className = `status ${type}`
}

// Load saved settings
chrome.storage.local.get(['intakeToken', 'intakePort'], (result) => {
  if (result.intakeToken) tokenInput.value = result.intakeToken
  if (result.intakePort) portInput.value = result.intakePort
})

// Save settings
saveBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim()
  const port = parseInt(portInput.value, 10) || 19532

  if (!token) {
    showStatus('Token is required.', 'error')
    return
  }

  chrome.storage.local.set({ intakeToken: token, intakePort: port }, () => {
    showStatus('Settings saved.', 'success')
  })
})

// Test connection
testBtn.addEventListener('click', async () => {
  const port = parseInt(portInput.value, 10) || 19532

  showStatus('Testing...', 'info')

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ping`)
    const data = await response.json()

    if (data.ok) {
      showStatus('Connected to DomainOS!', 'success')
    } else {
      showStatus('Unexpected response from server.', 'error')
    }
  } catch {
    showStatus('Cannot connect. Is DomainOS running?', 'error')
  }
})
