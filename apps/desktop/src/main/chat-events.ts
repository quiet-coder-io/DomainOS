/**
 * Enforces requestId on every chat event emission.
 * All chat IPC events MUST go through these helpers — never call sender.send() directly.
 */

import type { WebContents } from 'electron'
import type { ToolUseEvent } from '../shared/chat-types'

export function sendChatChunk(sender: WebContents, requestId: string, chunk: string): void {
  if (!sender.isDestroyed()) sender.send('chat:stream-chunk', { requestId, chunk })
}

export function sendChatDone(sender: WebContents, requestId: string, cancelled: boolean): void {
  if (!sender.isDestroyed()) sender.send('chat:stream-done', { requestId, cancelled })
}

export function sendChatToolUse(
  sender: WebContents,
  requestId: string,
  event: Omit<ToolUseEvent, 'requestId'>,
): void {
  if (!sender.isDestroyed()) sender.send('chat:tool-use', { ...event, requestId })
}
