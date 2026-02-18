interface Props {
  gapFlags: Array<{ category: string; description: string }>
}

const TriangleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8 2L14.5 13.5H1.5L8 2Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M8 6.5V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
  </svg>
)

export function GapFlagAlert({ gapFlags }: Props): React.JSX.Element {
  return (
    <div className="mb-3 ml-0 mr-12 animate-fade-in rounded border border-warning/40 bg-warning/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-warning">
        <TriangleIcon />
        <span className="text-sm font-semibold">Knowledge Gap Detected</span>
      </div>
      {gapFlags.map((flag, i) => (
        <div key={i} className="mt-2 flex items-start gap-2 text-sm">
          <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[0.65rem] font-medium text-warning">
            {flag.category}
          </span>
          <span className="text-text-secondary">{flag.description}</span>
        </div>
      ))}
    </div>
  )
}
