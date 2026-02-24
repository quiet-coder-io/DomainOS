/**
 * Minimal mustache-style template rendering for prompt templates.
 * Supports {{variableName}} placeholders. Unknown variables are left untouched.
 */

export function renderPromptTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in context ? context[key] : match
  })
}

/**
 * Extract unique variable names from a template string.
 */
export function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g)
  return [...new Set([...matches].map(m => m[1]))]
}
