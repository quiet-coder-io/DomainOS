import { useState } from 'react'

interface Props {
  title: string
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
  >
    <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function CollapsibleSection({ title, count, defaultOpen = false, children }: Props): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-sm font-semibold text-text-secondary hover:text-text-primary"
      >
        <ChevronIcon open={open} />
        <span>{title}</span>
        {count != null && (
          <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[0.6rem] font-medium text-text-tertiary">
            {count}
          </span>
        )}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}
