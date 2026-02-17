import { useEffect } from 'react'
import { useKBStore } from '../stores'

interface Props {
  domainId: string
}

export function KBFileList({ domainId }: Props): React.JSX.Element {
  const { files, loading, lastSyncResult, scanAndSync, fetchFiles } = useKBStore()

  useEffect(() => {
    fetchFiles(domainId)
  }, [domainId, fetchFiles])

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-300">KB Files</h3>
        <button
          onClick={() => scanAndSync(domainId)}
          disabled={loading}
          className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Re-scan'}
        </button>
      </div>

      {lastSyncResult && (
        <div className="mb-2 rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-400">
          Last sync: +{lastSyncResult.added} added, ~{lastSyncResult.updated} updated, -{lastSyncResult.deleted} deleted
        </div>
      )}

      {files.length === 0 && !loading && (
        <p className="text-xs text-neutral-500">
          No files indexed. Click Re-scan to index the knowledge base.
        </p>
      )}

      {files.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-500">
                <th className="pb-1 pr-2">File</th>
                <th className="pb-1 pr-2">Size</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-b border-neutral-800/50">
                  <td className="py-1.5 pr-2 text-neutral-300">{file.relativePath}</td>
                  <td className="py-1.5 pr-2 text-neutral-500">{formatSize(file.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
