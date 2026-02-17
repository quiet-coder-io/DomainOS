import { useEffect, useRef } from 'react'

interface Props {
  x: number
  y: number
  onEdit(): void
  onDelete(): void
  onClose(): void
}

export function DomainContextMenu({ x, y, onEdit, onDelete, onClose }: Props): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const itemClass =
    'w-full px-3 py-1.5 text-left text-sm hover:bg-surface-3 transition-colors'

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[120px] rounded border border-border bg-surface-2 py-1 shadow-lg"
      style={{ top: y, left: x }}
    >
      <button
        onClick={() => { onEdit(); onClose() }}
        className={`${itemClass} text-text-secondary`}
      >
        Edit
      </button>
      <button
        onClick={() => { onDelete(); onClose() }}
        className={`${itemClass} text-danger`}
      >
        Delete
      </button>
    </div>
  )
}
