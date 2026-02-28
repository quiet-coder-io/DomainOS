import { useState, useCallback } from 'react'
import type { Skill, SkillOutputFormat } from '../../preload/api'

interface Props {
  skill?: Skill | null
  readOnly?: boolean
  onSave(input: {
    name: string; description: string; content: string; outputFormat: SkillOutputFormat
    outputSchema: string | null; toolHints: string[]
  }): void
  onCancel(): void
}

export function SkillEditor({ skill, readOnly, onSave, onCancel }: Props) {
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [content, setContent] = useState(skill?.content ?? '')
  const [outputFormat, setOutputFormat] = useState<SkillOutputFormat>(skill?.outputFormat ?? 'freeform')
  const [outputSchema, setOutputSchema] = useState(skill?.outputSchema ?? '')
  const [toolHintsStr, setToolHintsStr] = useState(skill?.toolHints.join(', ') ?? '')
  const [schemaError, setSchemaError] = useState<string | null>(null)

  const validateSchema = useCallback((val: string) => {
    if (!val.trim()) {
      setSchemaError(null)
      return
    }
    try {
      JSON.parse(val)
      setSchemaError(null)
    } catch {
      setSchemaError('Invalid JSON')
    }
  }, [])

  function handleSave() {
    if (!name.trim() || !content.trim()) return
    if (outputFormat === 'structured' && (!outputSchema.trim() || schemaError)) return

    const toolHints = toolHintsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    onSave({
      name: name.trim(),
      description: description.trim(),
      content,
      outputFormat,
      outputSchema: outputFormat === 'structured' ? outputSchema : null,
      toolHints,
    })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          className="w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none disabled:opacity-60"
          placeholder="e.g., CMBS Loan Review"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={readOnly}
          className="w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none disabled:opacity-60"
          placeholder="Short purpose description"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Procedure / Instructions
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={readOnly}
          className="w-full min-h-[200px] resize-y rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none font-mono disabled:opacity-60"
          placeholder="Step-by-step procedure or instructions (markdown supported)..."
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Output Format</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
            <input
              type="radio"
              checked={outputFormat === 'freeform'}
              onChange={() => setOutputFormat('freeform')}
              disabled={readOnly}
              className="accent-accent"
            />
            Freeform
          </label>
          <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
            <input
              type="radio"
              checked={outputFormat === 'structured'}
              onChange={() => setOutputFormat('structured')}
              disabled={readOnly}
              className="accent-accent"
            />
            Structured (JSON)
          </label>
        </div>
      </div>

      {outputFormat === 'structured' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Output Schema (JSON)
          </label>
          <textarea
            value={outputSchema}
            onChange={(e) => setOutputSchema(e.target.value)}
            onBlur={() => validateSchema(outputSchema)}
            disabled={readOnly}
            className={`w-full min-h-[80px] resize-y rounded border bg-surface-2 px-2.5 py-1.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none font-mono disabled:opacity-60 ${
              schemaError ? 'border-danger focus:border-danger' : 'border-border focus:border-accent'
            }`}
            placeholder='{"summary": "string", "items": ["string"]}'
          />
          {schemaError && (
            <p className="mt-0.5 text-xs text-danger">{schemaError}</p>
          )}
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Tool Hints (comma-separated)
        </label>
        <input
          type="text"
          value={toolHintsStr}
          onChange={(e) => setToolHintsStr(e.target.value)}
          disabled={readOnly}
          className="w-full rounded border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none disabled:opacity-60"
          placeholder="gmail_search, advisory_search_deadlines"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {readOnly ? (
          <button
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2"
          >
            Close
          </button>
        ) : (
          <>
            <button
              onClick={onCancel}
              className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !content.trim() || (outputFormat === 'structured' && (!outputSchema.trim() || !!schemaError))}
              className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {skill ? 'Update' : 'Create'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
