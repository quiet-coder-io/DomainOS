import { Ok, Err } from '../common/index.js'
import type { Result } from '../common/index.js'
import { DomainOSError } from '../common/index.js'
import type { LLMProvider } from '../agents/provider.js'
import { ClassifyResultSchema } from './schemas.js'
import type { ClassifyResult } from './schemas.js'

interface ClassifyDomain {
  id: string
  name: string
  description: string
}

const CLASSIFY_CONTENT_LIMIT = 2000

function buildClassifyPrompt(domains: ClassifyDomain[]): string {
  const domainList = domains
    .map((d) => `- id: "${d.id}" | name: "${d.name}" | description: "${d.description}"`)
    .join('\n')

  return `You are a domain classifier for a knowledge management system.
Given a piece of content with a title, determine which domain it belongs to.

Available domains:
${domainList}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "domainId": "<the domain id>",
  "domainName": "<the domain name>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one sentence explaining why>"
}

If no domain is a good fit, pick the closest one but set confidence below 0.3.`
}

export async function classifyContent(
  provider: LLMProvider,
  domains: ClassifyDomain[],
  title: string,
  content: string,
): Promise<Result<ClassifyResult, DomainOSError>> {
  if (domains.length === 0) {
    return Err(DomainOSError.validation('No domains available for classification'))
  }

  const truncatedContent = content.slice(0, CLASSIFY_CONTENT_LIMIT)
  const systemPrompt = buildClassifyPrompt(domains)
  const userMessage = `Title: ${title}\n\nContent:\n${truncatedContent}`

  const response = await provider.chatComplete(
    [{ role: 'user', content: userMessage }],
    systemPrompt,
  )

  if (!response.ok) return response

  try {
    const cleaned = response.value.replace(/```json\s*|\s*```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const validated = ClassifyResultSchema.safeParse(parsed)

    if (!validated.success) {
      return Err(DomainOSError.parse(`Invalid classify response: ${validated.error.message}`))
    }

    return Ok(validated.data)
  } catch {
    return Err(DomainOSError.parse(`Failed to parse classify response: ${response.value}`))
  }
}
