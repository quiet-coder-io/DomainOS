interface Props {
  stopBlocks: Array<{ reason: string; actionNeeded: string }>
}

const OctagonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M5.25 1.5H10.75L14.5 5.25V10.75L10.75 14.5H5.25L1.5 10.75V5.25L5.25 1.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M8 5V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="11" r="0.75" fill="currentColor" />
  </svg>
)

export function StopAlert({ stopBlocks }: Props): React.JSX.Element {
  return (
    <div className="mb-3 ml-0 mr-12 animate-fade-in rounded border-2 border-danger/60 bg-danger/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-danger">
        <OctagonIcon />
        <span className="text-sm font-semibold">STOP — Human Approval Required</span>
      </div>
      {stopBlocks.map((block, i) => (
        <div key={i} className="mt-2 text-sm text-text-primary">
          <p className="font-medium">{block.reason}</p>
          <p className="mt-1 text-text-secondary">{block.actionNeeded}</p>
        </div>
      ))}
    </div>
  )
}
