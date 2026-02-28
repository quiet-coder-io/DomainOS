import { useRef, useEffect, useCallback } from 'react'

interface Props {
  isOpen: boolean
  onClose: () => void
  itemName: string
  itemType: 'skill' | 'command'
  localContent: string
  upstreamContent: string
  onKeepLocal: () => void
  onOverwrite: () => void
}

export function PluginDiffDialog({
  isOpen,
  onClose,
  itemName,
  itemType,
  localContent,
  upstreamContent,
  onKeepLocal,
  onOverwrite,
}: Props) {
  const localRef = useRef<HTMLPreElement>(null)
  const upstreamRef = useRef<HTMLPreElement>(null)

  // Scroll sync: when one pane scrolls, mirror to the other
  const syncScroll = useCallback(
    (source: HTMLPreElement | null, target: HTMLPreElement | null) => {
      if (!source || !target) return
      target.scrollTop = source.scrollTop
    },
    [],
  )

  useEffect(() => {
    const localEl = localRef.current
    const upstreamEl = upstreamRef.current
    if (!localEl || !upstreamEl) return

    const handleLocalScroll = () => syncScroll(localEl, upstreamEl)
    const handleUpstreamScroll = () => syncScroll(upstreamEl, localEl)

    localEl.addEventListener('scroll', handleLocalScroll)
    upstreamEl.addEventListener('scroll', handleUpstreamScroll)

    return () => {
      localEl.removeEventListener('scroll', handleLocalScroll)
      upstreamEl.removeEventListener('scroll', handleUpstreamScroll)
    }
  }, [isOpen, syncScroll])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-surface-0 shadow-2xl">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Merge Conflict: {itemName}
            </h2>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              This {itemType} has been modified locally and differs from the upstream version
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-secondary text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Two-column diff */}
        <div className="flex-1 flex min-h-0">
          {/* Local */}
          <div className="flex-1 flex flex-col border-r border-border-subtle min-w-0">
            <div className="shrink-0 px-4 py-2 border-b border-border-subtle bg-surface-1">
              <span className="text-xs font-medium text-text-secondary">Local (modified)</span>
            </div>
            <pre
              ref={localRef}
              className="flex-1 overflow-auto p-4 text-[11px] text-text-primary whitespace-pre-wrap font-mono leading-relaxed bg-surface-0"
            >
              {localContent}
            </pre>
          </div>

          {/* Upstream */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="shrink-0 px-4 py-2 border-b border-border-subtle bg-surface-1">
              <span className="text-xs font-medium text-text-secondary">Upstream</span>
            </div>
            <pre
              ref={upstreamRef}
              className="flex-1 overflow-auto p-4 text-[11px] text-text-primary whitespace-pre-wrap font-mono leading-relaxed bg-surface-0"
            >
              {upstreamContent}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center justify-end gap-3 border-t border-border-subtle px-5 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onKeepLocal(); onClose() }}
            className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2 transition-colors"
          >
            Keep local
          </button>
          <button
            onClick={() => { onOverwrite(); onClose() }}
            className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover transition-colors"
          >
            Overwrite with upstream
          </button>
        </div>
      </div>
    </div>
  )
}
