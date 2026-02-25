import { useEffect } from 'react'
import type { AttachedFile } from '../common/file-attach-utils'
import { formatFileSize } from '../common/file-attach-utils'

interface Props {
  files: AttachedFile[]
  error: string | null
  onRemove: (id: string) => void
  onRemoveAll: () => void
  onClearError: () => void
}

const FileIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.5 1h4l2.5 2.5V10a.75.75 0 0 1-.75.75h-5.5A.75.75 0 0 1 3 10V1.75A.75.75 0 0 1 3.5 1z" stroke="currentColor" strokeWidth="1" fill="none" />
    <path d="M7.5 1v2.5H10" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
)

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

export function ChatAttachmentsBar({ files, error, onRemove, onRemoveAll, onClearError }: Props): React.JSX.Element | null {
  // Auto-dismiss error toast (4s)
  useEffect(() => {
    if (error) {
      const t = setTimeout(onClearError, 4000)
      return () => clearTimeout(t)
    }
  }, [error, onClearError])

  if (files.length === 0 && !error) return null

  return (
    <div className="flex flex-col gap-1">
      {/* Error toast */}
      {error && (
        <div className="rounded border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs text-danger animate-fade-in">
          {error}
          <button onClick={onClearError} className="ml-2 text-danger/60 hover:text-danger">×</button>
        </div>
      )}

      {/* File chips */}
      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-1 rounded-full border border-border bg-surface-0 px-2 py-0.5 text-[0.65rem] text-text-secondary animate-fade-in"
              title={`${f.originalName} · ${formatFileSize(f.size)} · sha256: ${f.sha256.slice(0, 12)}...`}
            >
              <FileIcon />
              <span className="max-w-[120px] truncate">{f.displayName}</span>
              <span className="text-text-tertiary">{formatFileSize(f.size)}</span>
              {f.truncated && (
                <span className="rounded bg-warning/15 px-1 text-[0.55rem] text-warning">truncated</span>
              )}
              <button
                onClick={() => onRemove(f.id)}
                className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
                title="Remove"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          {files.length > 1 && (
            <button
              onClick={onRemoveAll}
              className="text-[0.6rem] text-text-tertiary hover:text-text-secondary underline"
            >
              Remove all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
