import { LayersIcon } from '../components/icons/LayersIcon'

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
