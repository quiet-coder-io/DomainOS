/**
 * Seeds default shared protocols (STOP Protocol and Gap Detection).
 * Idempotent — skips if protocols with these names already exist.
 */

import type { SharedProtocolRepository } from '../protocols/shared-repository.js'
import { STOP_PROTOCOL_NAME, STOP_PROTOCOL_CONTENT } from './stop-protocol.js'
import { GAP_DETECTION_PROTOCOL_NAME, GAP_DETECTION_PROTOCOL_CONTENT } from './gap-detection-protocol.js'

export function seedDefaultProtocols(sharedProtocolRepo: SharedProtocolRepository): void {
  const existing = sharedProtocolRepo.list()
  const existingNames = existing.ok ? existing.value.map((p) => p.name) : []

  if (!existingNames.includes(STOP_PROTOCOL_NAME)) {
    sharedProtocolRepo.create({
      name: STOP_PROTOCOL_NAME,
      content: STOP_PROTOCOL_CONTENT,
      priority: 100,
      sortOrder: 0,
      isEnabled: true,
      scope: 'all',
    })
  }

  if (!existingNames.includes(GAP_DETECTION_PROTOCOL_NAME)) {
    sharedProtocolRepo.create({
      name: GAP_DETECTION_PROTOCOL_NAME,
      content: GAP_DETECTION_PROTOCOL_CONTENT,
      priority: 90,
      sortOrder: 1,
      isEnabled: true,
      scope: 'chat',
    })
  }
}
