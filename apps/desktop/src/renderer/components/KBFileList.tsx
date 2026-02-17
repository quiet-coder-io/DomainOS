import { useEffect } from 'react'
import { useKBStore } from '../stores'

interface Props {
  domainId: string
}

const DocIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
    <path d="M3 1h4l3 3v7H3V1z" stroke="currentColor" strokeWidth="1" fill="none" />
    <path d="M7 1v3h3" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
)

export function KBFileList({ domainId }: Props): React.JSX.Element {
  const { files, loading, lastSyncResult, scanAndSync, fetchFiles } = useKBStore()

  useEffect(() => {
    fetchFiles(domainId)
  }, [domainId, fetchFiles])

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  /** Split path into directory + filename */
  function splitPath(path: string): { dir: string; name: string } {
    const lastSlash = path.lastIndexOf('/')
    if (lastSlash === -1) return { dir: '', name: path }
    return { dir: path.slice(0, lastSlash + 1), name: path.slice(lastSlash + 1) }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-secondary">KB Files</h3>
        <button
          onClick={() => scanAndSync(domainId)}
          disabled={loading}
          className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-3 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Re-scan'}
        </button>
      </div>

      {lastSyncResult && (
        <div className="mb-2 rounded bg-surface-2 px-3 py-1.5 text-xs text-text-tertiary">
          Last sync:{' '}
          <span className="text-success">+{lastSyncResult.added}</span>{' '}
          <span className="text-warning">~{lastSyncResult.updated}</span>{' '}
          <span className="text-danger">-{lastSyncResult.deleted}</span>
        </div>
      )}

      {files.length === 0 && !loading && (
        <p className="text-xs text-text-tertiary">
          No files indexed. Click Re-scan to index the knowledge base.
        </p>
      )}

      {files.length > 0 && (
        <div className="max-h-64 overflow-y-auto overflow-x-hidden">
          <div>
            {files.map((file) => {
              const { dir, name } = splitPath(file.relativePath)
              return (
                <div key={file.id} className="flex items-start gap-1.5 border-b border-border-subtle/50 py-1.5">
                  <span className="mt-0.5 text-text-tertiary"><DocIcon /></span>
                  <div className="min-w-0 flex-1">
                    {dir && (
                      <div className="truncate font-mono text-[0.65rem] text-text-primary">{dir}</div>
                    )}
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-text-tertiary">{name}</span>
                      <span className="shrink-0 text-[0.65rem] text-text-tertiary">{formatSize(file.sizeBytes)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
