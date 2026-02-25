import { useState, useRef, useEffect } from 'react'
import { inputClass } from './ui'

interface TagInputProps {
  label: string
  values: string[]
  suggestions: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}

export function TagInput({ label, values, suggestions, onChange, placeholder }: TagInputProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const filtered = input.trim()
    ? suggestions.filter(
        (s) =>
          s.toLowerCase().includes(input.trim().toLowerCase()) &&
          !values.some((v) => v.toLowerCase() === s.toLowerCase()),
      )
    : suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()))

  function addValue(val: string): void {
    const trimmed = val.trim()
    if (!trimmed) return
    if (values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return
    onChange([...values, trimmed])
    setInput('')
    setShowDropdown(false)
  }

  function removeValue(val: string): void {
    onChange(values.filter((v) => v !== val))
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (input.trim()) addValue(input)
    }
  }

  // Close dropdown on click outside
  useEffect(() => {
    function handler(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="mb-3" ref={wrapperRef}>
      <span className="mb-1 block text-sm text-text-secondary">{label}</span>

      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map((val) => (
            <span
              key={val}
              className="inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-0.5 text-xs text-accent-text"
            >
              {val}
              <button
                type="button"
                onClick={() => removeValue(val)}
                className="text-text-tertiary hover:text-text-primary ml-0.5"
                aria-label={`Remove ${val}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setShowDropdown(true)
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          className={inputClass}
          placeholder={placeholder ?? `Add ${label.toLowerCase()}...`}
        />

        {showDropdown && filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded border border-border bg-surface-1 py-1 shadow-lg">
            {filtered.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => addValue(suggestion)}
                className="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-2"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
