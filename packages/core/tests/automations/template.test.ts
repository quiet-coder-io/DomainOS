import { describe, it, expect } from 'vitest'
import { renderPromptTemplate, extractTemplateVars } from '../../src/automations/template.js'

describe('renderPromptTemplate', () => {
  it('replaces {{domain_name}} with value', () => {
    const result = renderPromptTemplate('Hello {{domain_name}}!', { domain_name: 'RealEstate' })
    expect(result).toBe('Hello RealEstate!')
  })

  it('replaces multiple variables in one template', () => {
    const template = '{{greeting}} {{name}}, welcome to {{domain_name}}'
    const result = renderPromptTemplate(template, {
      greeting: 'Hi',
      name: 'Yahav',
      domain_name: 'Accounting',
    })
    expect(result).toBe('Hi Yahav, welcome to Accounting')
  })

  it('leaves unknown {{vars}} untouched', () => {
    const result = renderPromptTemplate('Hello {{name}} and {{unknown}}!', { name: 'Yahav' })
    expect(result).toBe('Hello Yahav and {{unknown}}!')
  })

  it('replaces all occurrences of the same variable', () => {
    const result = renderPromptTemplate('{{x}} + {{x}} = 2{{x}}', { x: '1' })
    expect(result).toBe('1 + 1 = 21')
  })

  it('handles empty context — leaves all variables untouched', () => {
    const result = renderPromptTemplate('{{a}} {{b}} {{c}}', {})
    expect(result).toBe('{{a}} {{b}} {{c}}')
  })

  it('returns empty string for empty template', () => {
    const result = renderPromptTemplate('', { key: 'value' })
    expect(result).toBe('')
  })

  it('handles template with no variables', () => {
    const result = renderPromptTemplate('No variables here', { key: 'value' })
    expect(result).toBe('No variables here')
  })

  it('handles multiline templates', () => {
    const template = `Line 1: {{var1}}
Line 2: {{var2}}
Line 3: {{var1}} again`
    const result = renderPromptTemplate(template, { var1: 'A', var2: 'B' })
    expect(result).toBe(`Line 1: A
Line 2: B
Line 3: A again`)
  })

  it('replaces with empty string value', () => {
    const result = renderPromptTemplate('Hello {{name}}!', { name: '' })
    expect(result).toBe('Hello !')
  })

  it('only matches word characters in variable names', () => {
    // {{with-dash}} should NOT match because - is not a word character
    const result = renderPromptTemplate('{{valid}} and {{with-dash}}', { valid: 'yes' })
    expect(result).toBe('yes and {{with-dash}}')
  })
})

describe('extractTemplateVars', () => {
  it('returns unique variable names', () => {
    const vars = extractTemplateVars('{{a}} {{b}} {{a}}')
    expect(vars).toHaveLength(2)
    expect(vars).toContain('a')
    expect(vars).toContain('b')
  })

  it('returns empty array for template with no variables', () => {
    expect(extractTemplateVars('No variables here')).toEqual([])
  })

  it('returns empty array for empty template', () => {
    expect(extractTemplateVars('')).toEqual([])
  })

  it('extracts from complex template', () => {
    const template = 'Analyze {{domain_name}} KB for {{category}} issues, focusing on {{priority}} items'
    const vars = extractTemplateVars(template)
    expect(vars).toHaveLength(3)
    expect(vars).toContain('domain_name')
    expect(vars).toContain('category')
    expect(vars).toContain('priority')
  })

  it('handles multiline template', () => {
    const template = `{{header}}
Some text
{{body}}
More text
{{footer}}`
    const vars = extractTemplateVars(template)
    expect(vars).toHaveLength(3)
    expect(vars).toContain('header')
    expect(vars).toContain('body')
    expect(vars).toContain('footer')
  })

  it('deduplicates variables', () => {
    const vars = extractTemplateVars('{{x}} {{x}} {{x}} {{y}}')
    expect(vars).toHaveLength(2)
  })
})
