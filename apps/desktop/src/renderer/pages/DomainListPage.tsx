const LayersIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M24 6L4 18l20 12 20-12L24 6z" fill="currentColor" opacity="0.3" />
    <path d="M4 24l20 12 20-12" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.5" />
    <path d="M4 32l20 12 20-12" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.7" />
  </svg>
)

export function DomainListPage(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative text-center">
        {/* Subtle radial glow */}
        <div className="pointer-events-none absolute inset-0 -m-24 rounded-full bg-accent/5 blur-3xl" />

        <div className="relative">
          <div className="mb-4 flex justify-center text-text-tertiary">
            <LayersIcon />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">DomainOS</h1>
          <p className="mt-3 text-sm text-text-tertiary">
            Select a domain from the sidebar or create a new one to get started.
          </p>
        </div>
      </div>
    </div>
  )
}
