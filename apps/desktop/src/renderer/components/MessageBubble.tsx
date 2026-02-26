interface Props {
  role: 'user' | 'assistant'
  content: string
  status?: 'cancelled' | 'error'
  metadata?: Record<string, unknown>
  attachments?: Array<{ filename: string; sizeBytes: number; sha256: string; truncated?: boolean }>
  onExtractKb?: () => void
}

const FileIcon = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.5 1h4l2.5 2.5V10a.75.75 0 0 1-.75.75h-5.5A.75.75 0 0 1 3 10V1.75A.75.75 0 0 1 3.5 1z" stroke="currentColor" strokeWidth="1" fill="none" />
    <path d="M7.5 1v2.5H10" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
)

// --- Table helpers ---

const isRowLike = (l: string) => {
  const t = l.trim()
  return t.startsWith('|') && t.endsWith('|')
}

const parseTableRow = (line: string) =>
  line.trim().slice(1, -1).split('|').map((c) => c.trim())

const isSeparatorRow = (line: string, expectedCols: number) => {
  const cells = parseTableRow(line)
  if (cells.length !== expectedCols) return false
  return cells.every((c) => /^:?-{3,}:?$/.test(c))
}

/** Minimal inline markdown renderer — handles code blocks, tables, inline code, bold, lists, paragraphs */
function renderMarkdown(text: string): React.JSX.Element {
  // Split on code blocks first — tables inside fences are never seen by paragraph loop
  const parts = text.split(/(```[\s\S]*?```)/g)

  const elements: React.JSX.Element[] = []
  let key = 0

  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      // Code block
      const content = part.slice(3, -3).replace(/^\w*\n/, '') // strip language hint
      elements.push(
        <pre key={key++} className="my-2 rounded bg-surface-0 border border-border-subtle p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </pre>
      )
    } else {
      // Split into paragraphs by double newline
      const paragraphs = part.split(/\n{2,}/)
      for (const para of paragraphs) {
        if (!para.trim()) continue

        const lines = para.split('\n')

        // Table detection: header + separator + body rows, column count must match
        const nonEmpty = lines.filter((l) => l.trim().length > 0)
        const isTable =
          nonEmpty.length >= 2 &&
          isRowLike(nonEmpty[0]) &&
          isRowLike(nonEmpty[1]) &&
          (() => {
            const headers = parseTableRow(nonEmpty[0])
            const headerCols = headers.length
            const hasAnyHeaderText = headers.some((h) => h.length > 0)
            return headerCols >= 2 && hasAnyHeaderText &&
              isSeparatorRow(nonEmpty[1], headerCols) &&
              nonEmpty.slice(2).every(isRowLike)
          })()

        if (isTable) {
          const headers = parseTableRow(nonEmpty[0])
          const bodyRows = nonEmpty.slice(2).map(parseTableRow)
          const colCount = headers.length
          const normalize = (row: string[]) => {
            if (row.length === colCount) return row
            if (row.length < colCount) return row.concat(Array(colCount - row.length).fill(''))
            return row.slice(0, colCount)
          }
          elements.push(
            <div key={key++} className="my-2 max-w-full overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="border border-border-subtle bg-surface-0 px-2 py-1 text-left font-semibold align-top">
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => (
                    <tr key={ri}>
                      {normalize(row).map((cell, ci) => (
                        <td key={ci} className="border border-border-subtle px-2 py-1 align-top">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        } else {
          // Check if this is a list
          const isList = lines.every((l) => /^[\s]*[-*]\s/.test(l) || !l.trim())

          if (isList) {
            const items = lines.filter((l) => /^[\s]*[-*]\s/.test(l))
            elements.push(
              <ul key={key++} className="my-1 list-disc pl-4 space-y-0.5">
                {items.map((item, i) => (
                  <li key={i}>{renderInline(item.replace(/^[\s]*[-*]\s/, ''))}</li>
                ))}
              </ul>
            )
          } else {
            elements.push(<p key={key++} className="my-1">{renderInline(para)}</p>)
          }
        }
      }
    }
  }

  return <>{elements}</>
}

/** Render inline markdown: bold, inline code */
function renderInline(text: string): React.ReactNode {
  // Split on inline code and bold
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-surface-0 px-1 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

const ExtractIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 7h8M7 3v8M4.5 1.5h5M4.5 12.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

export function MessageBubble({ role, content, status, metadata, attachments, onExtractKb }: Props): React.JSX.Element {
  const isUser = role === 'user'

  return (
    <div className={`group relative flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 animate-fade-in`}>
      <div
        className={`max-w-[80%] px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-2xl rounded-br-sm bg-accent text-white'
            : 'rounded-2xl rounded-bl-sm border border-border-subtle bg-surface-2 text-text-primary'
        }`}
      >
        {/* Attachment badges for user messages */}
        {isUser && attachments && attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attachments.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[0.6rem]"
              >
                <FileIcon />
                {a.filename}
              </span>
            ))}
          </div>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{content}</div>
        ) : (
          <div className="break-words">{renderMarkdown(content)}</div>
        )}
        {status === 'cancelled' && (
          <span className="mt-1 inline-block text-[10px] text-text-tertiary italic">Stopped</span>
        )}
        {status === 'error' && (
          <span
            className="mt-1 inline-block rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger"
            title={typeof metadata?.errorMessage === 'string' ? metadata.errorMessage : undefined}
          >
            Error
          </span>
        )}
      </div>
      {/* Per-message "Update KB" button — hover-visible on assistant messages */}
      {!isUser && onExtractKb && (
        <button
          onClick={onExtractKb}
          className="absolute -bottom-1 right-0 flex items-center gap-1 rounded border border-border bg-surface-0 px-1.5 py-0.5 text-[0.6rem] text-text-tertiary opacity-0 transition-opacity hover:bg-surface-2 hover:text-text-secondary group-hover:opacity-100"
          title="Extract KB updates from this message"
        >
          <ExtractIcon />
          Update KB
        </button>
      )}
    </div>
  )
}
