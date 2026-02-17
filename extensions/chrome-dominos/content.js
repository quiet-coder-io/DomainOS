/* global chrome */

/**
 * Gmail content script — extracts email subject and body.
 *
 * Gmail DOM selectors are fragile and may break when Google updates the UI.
 * This is expected — keep extraction isolated here for easy maintenance.
 */

function extractGmailEmail() {
  // Subject: .hP is the subject heading in the expanded email view
  const subjectEl = document.querySelector('.hP')
  const subject = subjectEl?.textContent?.trim() || ''

  // Body: .a3s.aiL is the email body container
  const bodyEl = document.querySelector('.a3s.aiL')
  const body = bodyEl?.innerText?.trim() || ''

  // Sender: .gD is the sender name element
  const senderEl = document.querySelector('.gD')
  const sender = senderEl?.getAttribute('email') || senderEl?.textContent?.trim() || ''

  return {
    title: subject || document.title,
    content: body
      ? `From: ${sender}\nSubject: ${subject}\n\n${body}`
      : '',
  }
}

// Listen for extraction requests from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'extractEmail') {
    const result = extractGmailEmail()
    sendResponse(result)
  }
  return true
})
