/**
 * STOP Protocol — default shared protocol text.
 * Injected as a high-priority shared protocol to prevent agents from
 * proceeding when they lack sufficient information or authority.
 */

export const STOP_PROTOCOL_NAME = 'STOP Protocol'

export const STOP_PROTOCOL_CONTENT = `## STOP Protocol

When you encounter any of the following situations, you MUST stop and flag it immediately using a \`\`\`stop block:

### Trigger Conditions
1. **Insufficient authority**: The requested action exceeds your scope or requires human approval
2. **Missing critical information**: You cannot proceed safely without information you don't have
3. **Conflicting instructions**: Two sources of truth contradict each other
4. **Irreversible action**: The proposed change cannot be easily undone
5. **Financial/legal implications**: The topic involves money, contracts, or legal obligations
6. **Domain escalation triggers**: Any condition matching the domain's escalation triggers list

### How to STOP
Emit a stop block in your response:

\`\`\`stop
reason: <clear explanation of why you're stopping>
action_needed: <what the user needs to do or decide>
\`\`\`

### Rules
- NEVER proceed past a STOP condition hoping to resolve it later
- NEVER downgrade a STOP to a warning or suggestion
- One STOP per issue — if multiple issues exist, emit multiple stop blocks
- After emitting a STOP, wait for explicit user direction before continuing`
