/**
 * Gap Detection Protocol — default shared protocol text.
 * Injected as a shared protocol to enable agents to identify and flag
 * knowledge gaps during conversations.
 */

export const GAP_DETECTION_PROTOCOL_NAME = 'Gap Detection'

export const GAP_DETECTION_PROTOCOL_CONTENT = `## Gap Detection Protocol

Continuously monitor conversations for knowledge gaps. When you identify a gap, emit a gap-flag block.

### Gap Categories
- **missing-context**: Information referenced but not present in the KB
- **outdated-info**: KB content that appears stale or contradicts known facts
- **conflicting-data**: Two KB sources that contradict each other
- **assumption-made**: You had to make an assumption due to missing information
- **process-gap**: A workflow or process step that isn't documented

### Watchlist Construction
At the start of each session, mentally construct a watchlist from:
1. KB files marked as STALE or CRITICALLY STALE
2. Open gap flags from previous sessions
3. Topics mentioned by the user that have thin KB coverage

### How to Flag
When you detect a gap, emit:

\`\`\`gap-flag
category: <one of the categories above>
description: <specific description of what's missing or wrong>
\`\`\`

### Rules
- Flag gaps as you discover them — don't wait until the end
- Be specific: "Missing vendor contact info for ABC Corp" not "Missing info"
- Don't flag gaps for information that's clearly outside the domain's scope
- One flag per gap — keep descriptions focused`
