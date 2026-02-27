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
  | { type: 'heading'; level: number; text: string }
  | { type: 'hr' }

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

// --- Line classification for block-level parsing ---

type LineType = 'heading' | 'hr' | 'table-row' | 'bullet' | 'numbered' | 'empty' | 'text'

function classifyLine(line: string): LineType {
  const t = line.trim()
  if (!t) return 'empty'
  if (/^#{1,6}\s/.test(t)) return 'heading'
  if (/^-{3,}$/.test(t) || /^\*{3,}$/.test(t) || /^_{3,}$/.test(t)) return 'hr'
  if (isRowLike(t)) return 'table-row'
  if (/^[-*]\s/.test(t)) return 'bullet'
  if (/^\d+[.)]\s/.test(t)) return 'numbered'
  return 'text'
}

/** Flush accumulated text lines into a paragraph block */
function flushText(textBuf: string[], blocks: MarkdownBlock[]): void {
  if (textBuf.length === 0) return
  blocks.push({ type: 'paragraph', text: textBuf.join('\n') })
  textBuf.length = 0
}

/** Parse markdown text into intermediate blocks (pure data, no JSX).
 *  Scans line-by-line so single-newline-separated blocks are detected correctly. */
function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  // Stage 1: isolate fenced code blocks
  const parts = text.split(/(```[\s\S]*?```)/g)
  const blocks: MarkdownBlock[] = []

  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      const content = part.slice(3, -3).replace(/^\w*\n/, '')
      blocks.push({ type: 'code-block', content })
      continue
    }

    // Stage 2: line-by-line scan for block-level elements
    const lines = part.split('\n')
    const textBuf: string[] = []

    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const kind = classifyLine(line)

      if (kind === 'empty') {
        flushText(textBuf, blocks)
        i++
        continue
      }

      if (kind === 'heading') {
        flushText(textBuf, blocks)
        const match = line.trim().match(/^(#{1,6})\s+(.*)$/)!
        blocks.push({ type: 'heading', level: match[1].length, text: match[2] })
        i++
        continue
      }

      if (kind === 'hr') {
        flushText(textBuf, blocks)
        blocks.push({ type: 'hr' })
        i++
        continue
      }

      // Collect consecutive table rows
      if (kind === 'table-row') {
        flushText(textBuf, blocks)
        const tableLines: string[] = []
        while (i < lines.length && classifyLine(lines[i]) === 'table-row') {
          tableLines.push(lines[i])
          i++
        }
        // Validate table structure: header + separator + body
        if (tableLines.length >= 2) {
          const headers = parseTableRow(tableLines[0])
          const headerCols = headers.length
          const hasAnyHeaderText = headers.some((h) => h.length > 0)
          if (headerCols >= 2 && hasAnyHeaderText && isSeparatorRow(tableLines[1], headerCols)) {
            const bodyRows = tableLines.slice(2).map(parseTableRow)
            blocks.push({ type: 'table', headers, bodyRows, colCount: headerCols })
            continue
          }
        }
        // Not a valid table — treat as paragraph
        blocks.push({ type: 'paragraph', text: tableLines.join('\n') })
        continue
      }

      // Collect consecutive list items (bullets or numbered)
      if (kind === 'bullet' || kind === 'numbered') {
        flushText(textBuf, blocks)
        const items: string[] = []
        while (i < lines.length) {
          const lk = classifyLine(lines[i])
          if (lk === 'bullet') {
            items.push(lines[i].trim().replace(/^[-*]\s/, ''))
            i++
          } else if (lk === 'numbered') {
            items.push(lines[i].trim().replace(/^\d+[.)]\s/, ''))
            i++
          } else {
            break
          }
        }
        blocks.push({ type: 'list', items })
        continue
      }

      // Plain text — accumulate
      textBuf.push(line)
      i++
    }

    flushText(textBuf, blocks)
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
      case 'heading': {
        const Tag = `h${Math.min(block.level, 6)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        const sizes: Record<number, string> = { 1: 'text-lg font-bold', 2: 'text-base font-bold', 3: 'text-sm font-semibold', 4: 'text-sm font-semibold', 5: 'text-xs font-semibold', 6: 'text-xs font-semibold' }
        elements.push(<Tag key={key++} className={`${sizes[block.level] ?? sizes[3]} my-1.5`}>{renderInline(block.text)}</Tag>)
        break
      }
      case 'hr':
        elements.push(<hr key={key++} className="my-2 border-border-subtle" />)
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
