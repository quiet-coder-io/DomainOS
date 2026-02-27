import React, { useMemo } from 'react'
import { fnv1aHash } from '../common/hash'

interface Props {
  role: 'user' | 'assistant'
  content: string
  status?: 'cancelled' | 'error'
  errorMessage?: string
  attachments?: Array<{ filename: string; sizeBytes: number; sha256: string; truncated?: boolean }>
  messageIndex?: number
  onExtractKb?: (messageIndex: number) => void
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

// --- LRU cache for parsed markdown blocks ---
// Stores intermediate block representation (pure data arrays, not React nodes)
// so the cache is theme-safe — JSX is rendered from blocks on each call.

type MarkdownBlock =
  | { type: 'code-block'; content: string }
  | { type: 'table'; headers: string[]; bodyRows: string[][]; colCount: number }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string }

const LRU_MAX = 50
const lruCache = new Map<string, MarkdownBlock[]>()

function lruGet(key: string): MarkdownBlock[] | undefined {
  const val = lruCache.get(key)
  if (val !== undefined) {
    // Move to end (most recently used)
    lruCache.delete(key)
    lruCache.set(key, val)
  }
  return val
}

function lruSet(key: string, val: MarkdownBlock[]): void {
  if (lruCache.size >= LRU_MAX) {
    // Delete oldest entry (first key)
    const firstKey = lruCache.keys().next().value
    if (firstKey !== undefined) lruCache.delete(firstKey)
  }
  lruCache.set(key, val)
}

function makeCacheKey(content: string): string {
  return `${fnv1aHash(content)}:${content.length}`
}

/** Parse markdown text into intermediate blocks (pure data, no JSX) */
function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const parts = text.split(/(```[\s\S]*?```)/g)
  const blocks: MarkdownBlock[] = []

  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      const content = part.slice(3, -3).replace(/^\w*\n/, '')
      blocks.push({ type: 'code-block', content })
    } else {
      const paragraphs = part.split(/\n{2,}/)
      for (const para of paragraphs) {
        if (!para.trim()) continue

        const lines = para.split('\n')
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
          blocks.push({ type: 'table', headers, bodyRows, colCount: headers.length })
        } else {
          const isList = lines.every((l) => /^[\s]*[-*]\s/.test(l) || !l.trim())
          if (isList) {
            const items = lines.filter((l) => /^[\s]*[-*]\s/.test(l)).map((l) => l.replace(/^[\s]*[-*]\s/, ''))
            blocks.push({ type: 'list', items })
          } else {
            blocks.push({ type: 'paragraph', text: para })
          }
        }
      }
    }
  }

  return blocks
}

/** Render inline markdown: bold, inline code */
function renderInline(text: string): React.ReactNode {
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

/** Render parsed blocks to JSX */
function renderBlocks(blocks: MarkdownBlock[]): React.JSX.Element {
  const elements: React.JSX.Element[] = []
  let key = 0

  for (const block of blocks) {
    switch (block.type) {
      case 'code-block':
        elements.push(
          <pre key={key++} className="my-2 rounded bg-surface-0 border border-border-subtle p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {block.content}
          </pre>
        )
        break
      case 'table': {
        const normalize = (row: string[]) => {
          if (row.length === block.colCount) return row
          if (row.length < block.colCount) return row.concat(Array(block.colCount - row.length).fill(''))
          return row.slice(0, block.colCount)
        }
        elements.push(
          <div key={key++} className="my-2 max-w-full overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {block.headers.map((h, i) => (
                    <th key={i} className="border border-border-subtle bg-surface-0 px-2 py-1 text-left font-semibold align-top">
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.bodyRows.map((row, ri) => (
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
        break
      }
      case 'list':
        elements.push(
          <ul key={key++} className="my-1 list-disc pl-4 space-y-0.5">
            {block.items.map((item, i) => (
              <li key={i}>{renderInline(item)}</li>
            ))}
          </ul>
        )
        break
      case 'paragraph':
        elements.push(<p key={key++} className="my-1">{renderInline(block.text)}</p>)
        break
    }
  }

  return <>{elements}</>
}

/** Render markdown with LRU-cached parsing */
function renderMarkdown(text: string): React.JSX.Element {
  const cacheKey = makeCacheKey(text)
  let blocks = lruGet(cacheKey)
  if (!blocks) {
    blocks = parseMarkdownBlocks(text)
    lruSet(cacheKey, blocks)
  }
  return renderBlocks(blocks)
}

const ExtractIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 7h8M7 3v8M4.5 1.5h5M4.5 12.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

function MessageBubbleInner({ role, content, status, errorMessage, attachments, messageIndex, onExtractKb }: Props): React.JSX.Element {
  const isUser = role === 'user'
  const rendered = useMemo(() => isUser ? null : renderMarkdown(content), [content, isUser])

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
          <div className="break-words">{rendered}</div>
        )}
        {status === 'cancelled' && (
          <span className="mt-1 inline-block text-[10px] text-text-tertiary italic">Stopped</span>
        )}
        {status === 'error' && (
          <span
            className="mt-1 inline-block rounded bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger"
            title={errorMessage}
          >
            Error
          </span>
        )}
      </div>
      {/* Per-message "Update KB" button — hover-visible on assistant messages */}
      {!isUser && onExtractKb && messageIndex != null && (
        <button
          onClick={() => onExtractKb(messageIndex)}
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

export const MessageBubble = React.memo(MessageBubbleInner)
