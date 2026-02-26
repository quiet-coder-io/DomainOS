/**
 * @domain-os/integrations — External service integrations for DomainOS.
 *
 * Provides pollers for Gmail and Google Tasks that feed into the
 * DomainOS intake pipeline via the localhost HTTP listener.
 */

export { GmailPoller } from './gmail/index.js'
export { GmailClient } from './gmail/index.js'
export { extractTextBody, extractAttachmentMeta } from './gmail/index.js'
export type { GmailAttachmentMeta } from './gmail/index.js'
export type { GmailPollerConfig, GmailMessageMeta } from './gmail/index.js'
export type { GmailClientConfig, GmailSearchResult, GmailMessage } from './gmail/index.js'

export { GTasksReader } from './gtasks/index.js'
export type { GTasksReaderConfig, GTaskMeta } from './gtasks/index.js'

export { GTasksClient } from './gtasks/index.js'
export type { GTasksClientConfig, GTaskSearchResult, GTask, GTaskList } from './gtasks/index.js'

export { IntakeClient } from './common/index.js'
export type { IntakePayload, IntakeResponse, OAuthTokens, PollerConfig } from './common/index.js'
