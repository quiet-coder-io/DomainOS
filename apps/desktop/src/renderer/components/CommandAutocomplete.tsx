import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useCommandStore } from '../stores/command-store'

interface Props {
  query: string
  domainId: string
  onSelect: (canonicalSlug: string, content: string, argumentHint: string | null) => void
  onClose: () => void
}

export function CommandAutocomplete({ query, domainId, onSelect, onClose }: Props) {
  const commands = useCommandStore((s) => s.commands)
  const displaySlugs = useCommandStore((s) => s.displaySlugs)
  const loadedDomainId = useCommandStore((s) => s.loadedDomainId)
  const { fetchForDomain } = useCommandStore.getState()

  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Ensure commands are loaded for this domain
  useEffect(() => {
    if (loadedDomainId !== domainId) {
      fetchForDomain(domainId)
    }
  }, [domainId, loadedDomainId])

  // Filter commands by query prefix
  const matches = useMemo(() => {
    if (!query) return commands.filter((c) => c.isEnabled)

    const q = query.toLowerCase()
    return commands.filter((c) => {
      if (!c.isEnabled) return false
      const display = displaySlugs[c.canonicalSlug] ?? c.canonicalSlug
      return (
        display.toLowerCase().includes(q) ||
        c.canonicalSlug.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
      )
    })
  }, [commands, displaySlugs, query])

  // Reset active index when matches change
  useEffect(() => {
    setActiveIndex(0)
  }, [matches.length, query])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector(`[data-index="${activeIndex}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (matches.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) => (prev + 1) % matches.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => (prev - 1 + matches.length) % matches.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const cmd = matches[activeIndex]
        if (cmd) {
          onSelect(cmd.canonicalSlug, cmd.content, cmd.argumentHint)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [matches, activeIndex, onSelect, onClose],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  if (matches.length === 0) {
    return (
      <div className="absolute bottom-full left-0 mb-1 w-72 rounded-lg border border-border-subtle bg-surface-1 p-2 shadow-lg z-50">
        <p className="text-xs text-text-tertiary px-2 py-1">
          {commands.length === 0 ? 'No commands available' : 'No matching commands'}
        </p>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 w-80 max-h-64 overflow-y-auto rounded-lg border border-border-subtle bg-surface-1 py-1 shadow-lg z-50"
    >
      {matches.map((cmd, index) => {
        const display = displaySlugs[cmd.canonicalSlug] ?? cmd.canonicalSlug
        const isActive = index === activeIndex

        return (
          <button
            key={cmd.id}
            data-index={index}
            className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors ${
              isActive ? 'bg-accent/10' : 'hover:bg-surface-2'
            }`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onSelect(cmd.canonicalSlug, cmd.content, cmd.argumentHint)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                  /{display}
                </span>
                {cmd.argumentHint && (
                  <span className="text-[10px] text-text-tertiary italic">
                    {cmd.argumentHint}
                  </span>
                )}
              </div>
              {cmd.description && (
                <p className="mt-0.5 text-[10px] text-text-tertiary truncate">
                  {cmd.description}
                </p>
              )}
            </div>
            {cmd.pluginName && (
              <span className="shrink-0 mt-0.5 rounded bg-surface-2 px-1.5 py-0.5 text-[9px] text-text-tertiary">
                {cmd.pluginName}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
