import { useState, useRef, useEffect, useCallback } from 'react'
import { useChatStore, useSkillStore } from '../stores'
import { MessageBubble } from './MessageBubble'
import { SkillSelector } from './SkillSelector'
import { StopAlert } from './StopAlert'
import { GapFlagAlert } from './GapFlagAlert'
import { DecisionCard } from './DecisionCard'
import { ChatAttachmentsBar } from './ChatAttachmentsBar'
import { BrainIcon } from './icons/BrainIcon'
import type { AttachedFile, AttachmentMeta } from '../common/file-attach-utils'
import type { GmailContextMessage } from '../../preload/api'
import {
  isAllowedFile,
  isBinaryFormat,
  hasEncodingIssues,
  sha256,
  formatFileSize,
  truncateContent,
  buildFileSection,
  buildLlmFileBlock,
  buildEmailSection,
  buildLlmEmailBlock,
  fileSectionChars,
  separatorChars,
  deduplicateDisplayName,
  MAX_FILE_SIZE,
  MAX_BINARY_FILE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_CHARS_PER_FILE,
  MAX_TOTAL_CHARS,
  MAX_FILE_COUNT,
  BASE_BLOCK_OVERHEAD_CHARS,
} from '../common/file-attach-utils'

interface Props {
  domainId: string
}

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 8H13.5M13.5 8L9 3.5M13.5 8L9 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SpinnerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" className="animate-spin" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
  </svg>
)

const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <rect x="2" y="2" width="10" height="10" rx="1.5" />
  </svg>
)

const PaperclipIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

type Suggestion = {
  id: 'latest' | 'status' | 'deadlines' | 'brainstorm'
  label: string
  text?: string
  featured?: boolean
}

const SUGGESTIONS: Suggestion[] = [
  { id: 'latest', label: "What's the latest" },
  { id: 'status', label: "Status update" },
  { id: 'deadlines', label: "Any deadlines coming up?" },
  {
    id: 'brainstorm',
    label: "Deep brainstorm",
    text: "Start a deep brainstorm session in this domain. Use technique-guided facilitation, capture ideas as we go, then synthesize into strategic options.",
    featured: true,
  },
]

function chipClass(featured?: boolean): string {
  const base = 'rounded-full px-3 py-1.5 text-xs transition-colors'
  return featured
    ? `${base} border border-accent/40 bg-accent/5 text-text-secondary hover:border-accent/60 hover:bg-accent/10 hover:text-text-primary`
    : `${base} border border-border text-text-secondary hover:border-accent/50 hover:bg-accent/5 hover:text-text-primary`
}

export function ChatPanel({ domainId }: Props): React.JSX.Element {
  const {
    messagesByDomain,
    isStreamingByDomain,
    isSendingByDomain,
    streamingContentByDomain,
    activeToolCallByDomain,
    isExtracting,
    extractionError,
    extractionResult,
    sendMessage,
    cancelChat,
    clearMessages,
    extractKbUpdates,
    clearExtractionError,
    clearExtractionResult,
  } = useChatStore()

  // Derive active domain slice
  const messages = messagesByDomain[domainId] ?? []
  const isStreaming = isStreamingByDomain[domainId] ?? false
  const isSending = isSendingByDomain[domainId] ?? false
  const streamingContent = streamingContentByDomain[domainId] ?? ''
  const activeToolCall = activeToolCallByDomain[domainId] ?? null
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // --- File attachment state ---
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // --- Gmail email drop state ---
  const [isFetchingEmail, setIsFetchingEmail] = useState(false)
  const [emailPreview, setEmailPreview] = useState<{
    messages: GmailContextMessage[]
    url: string
  } | null>(null)
  const [emailSearchPrompt, setEmailSearchPrompt] = useState<{ url: string } | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Auto-dismiss extraction error toast (5s)
  useEffect(() => {
    if (extractionError) {
      const t = setTimeout(clearExtractionError, 5000)
      return () => clearTimeout(t)
    }
  }, [extractionError, clearExtractionError])

  // Auto-dismiss extraction success banner (3s)
  useEffect(() => {
    if (extractionResult) {
      const t = setTimeout(clearExtractionResult, 3000)
      return () => clearTimeout(t)
    }
  }, [extractionResult, clearExtractionResult])

  // Escape key to cancel processing (only when NOT in confirm mode)
  useEffect(() => {
    if (!isStreaming && !isSending) return
    function handleEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') cancelChat()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isStreaming, isSending, cancelChat])

  // --- File processing with budget enforcement ---
  const processFiles = useCallback(async (files: File[]): Promise<void> => {
    const errors: string[] = []
    const newFiles: AttachedFile[] = []
    let skippedCount = 0

    // Get current state for budget calculation
    const currentFiles = attachedFiles
    let remainingSlots = MAX_FILE_COUNT - currentFiles.length

    // Running budgets (including existing files)
    let runningBytes = currentFiles.reduce((s, f) => s + f.size, 0)
    const existingFileCount = currentFiles.length
    let runningChars = existingFileCount > 0
      ? currentFiles.reduce((s, f) => s + fileSectionChars(f), 0)
        + separatorChars(existingFileCount)
        + BASE_BLOCK_OVERHEAD_CHARS
      : 0

    // Collect existing hashes for dedup
    const existingHashes = new Set(currentFiles.map((f) => f.sha256))
    const existingDisplayNames = currentFiles.map((f) => f.displayName)
    let acceptedInThisBatch = 0

    for (const file of files) {
      // Slot check
      if (remainingSlots <= 0) {
        skippedCount++
        continue
      }

      // 1. Allowed file check
      if (!isAllowedFile(file.name)) {
        errors.push(`${file.name}: unsupported file type`)
        continue
      }

      const isBinary = isBinaryFormat(file.name)
      const sizeLimit = isBinary ? MAX_BINARY_FILE_SIZE : MAX_FILE_SIZE

      // 2. Size check (binary files get a larger limit since extraction compresses)
      if (file.size > sizeLimit) {
        errors.push(`${file.name}: exceeds ${formatFileSize(sizeLimit)} limit`)
        continue
      }

      // 3. Read content — binary files go through main process extraction
      let rawContent: string
      try {
        if (isBinary) {
          const buffer = await file.arrayBuffer()
          const result = await window.domainOS.file.extractText(file.name, buffer)
          if (!result.ok || !result.value) {
            errors.push(`${file.name}: ${result.error ?? 'no text could be extracted'}`)
            continue
          }
          rawContent = result.value
        } else {
          rawContent = await file.text()
        }
      } catch {
        errors.push(`${file.name}: could not read file`)
        continue
      }

      // 4. Encoding check (skip for binary — main process already decoded)
      if (!isBinary && hasEncodingIssues(rawContent)) {
        errors.push(`${file.name}: unsupported encoding`)
        continue
      }

      // 5. Truncate if needed
      const { content, truncated } = truncateContent(rawContent)

      // 6. Build section string and compute hash
      const tempFile: AttachedFile = {
        id: '',
        kind: 'file',
        displayName: file.name,
        originalName: file.name,
        size: file.size,
        content,
        sha256: '',
        truncated,
      }
      const sectionStr = buildFileSection(tempFile)
      const hash = await sha256(sectionStr)

      // 7. Hash-based dedup
      if (existingHashes.has(hash)) {
        // Silently skip duplicates
        continue
      }

      // Check against new files in this batch too
      if (newFiles.some((f) => f.sha256 === hash)) {
        continue
      }

      // 8. Budget check
      const isFirstFileTotal = existingFileCount === 0 && acceptedInThisBatch === 0
      const charCost = sectionStr.length
        + (isFirstFileTotal ? BASE_BLOCK_OVERHEAD_CHARS : 0)
        + ((existingFileCount + acceptedInThisBatch) > 0 ? 2 : 0) // separator \n\n

      if (runningBytes + file.size > MAX_TOTAL_SIZE) {
        errors.push(`${file.name}: would exceed total size limit`)
        continue
      }
      if (runningChars + charCost > MAX_TOTAL_CHARS) {
        errors.push(`${file.name}: would exceed total character limit`)
        continue
      }

      // 9. Display-name dedup
      const allDisplayNames = [...existingDisplayNames, ...newFiles.map((f) => f.displayName)]
      const displayName = deduplicateDisplayName(file.name, allDisplayNames)

      // 10. Accept
      const accepted: AttachedFile = {
        id: crypto.randomUUID(),
        kind: 'file',
        displayName,
        originalName: file.name,
        size: file.size,
        content,
        sha256: hash,
        truncated,
      }
      newFiles.push(accepted)
      existingHashes.add(hash)
      remainingSlots--
      acceptedInThisBatch++
      runningBytes += file.size
      runningChars += charCost
    }

    if (skippedCount > 0) {
      errors.push(`Maximum ${MAX_FILE_COUNT} files (${skippedCount} skipped)`)
    }

    if (newFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...newFiles])
      }
    if (errors.length > 0) {
      setFileError(errors.join('; '))
    }
  }, [attachedFiles])

  // --- Gmail email drop ---
  const handleGmailDrop = useCallback(async (url: string, subjectHint?: string) => {
    if (isFetchingEmail) return

    if (attachedFiles.length >= MAX_FILE_COUNT) {
      setFileError(`Maximum ${MAX_FILE_COUNT} attachments`)
      return
    }

    setIsFetchingEmail(true)
    setFileError(null)

    try {
      const res = await window.domainOS.gmail.fetchForContext({ url, subjectHint })
      if (!res.ok || !res.value?.length) {
        if (res.error === 'NEEDS_SUBJECT') {
          // Opaque Gmail URL — prompt user for subject to search
          setEmailSearchPrompt({ url })
        } else {
          setFileError(res.error ?? 'Could not fetch email')
        }
        return
      }
      setEmailPreview({ messages: res.value, url })
    } catch (err) {
      console.error('[gmail-drop] fetchForContext failed:', err)
      setFileError(err instanceof Error ? err.message : 'Failed to fetch email')
    } finally {
      setIsFetchingEmail(false)
    }
  }, [attachedFiles, isFetchingEmail])

  const confirmEmailAttach = useCallback(async () => {
    if (!emailPreview) return
    const { messages } = emailPreview

    // Format each message with structured headers
    const formatted = messages.map((m) => {
      const toStr = Array.isArray(m.to) ? m.to.join(', ') : m.to
      return `From: ${m.from}\nTo: ${toStr}\nSubject: ${m.subject}\nDate: ${m.date}\n\n${m.body}`
    }).join('\n\n---\n\n')

    // Truncate first, then compute size from final content
    const { content, truncated } = truncateContent(formatted)
    const sizeBytes = new TextEncoder().encode(content).length

    const primaryMsg = messages[messages.length - 1]
    const senderName = primaryMsg.from.replace(/<.*>/, '').trim() || primaryMsg.from
    const subjectShort = primaryMsg.subject.length > 40
      ? primaryMsg.subject.slice(0, 40) + '...'
      : primaryMsg.subject

    const tempFile: AttachedFile = {
      id: '',
      kind: 'email',
      displayName: `${subjectShort} — ${senderName}`,
      originalName: `email-${primaryMsg.messageId}.eml`,
      size: sizeBytes,
      content,
      sha256: '',
      truncated,
    }

    // Dedup hash based on email section content
    const sectionStr = buildEmailSection(tempFile)
    const hash = await sha256(sectionStr)

    const existingHashes = new Set(attachedFiles.map((f) => f.sha256))
    if (existingHashes.has(hash)) {
      setEmailPreview(null)
      return
    }

    // Budget checks (using sizeBytes from truncated content)
    const currentBytes = attachedFiles.reduce((s, f) => s + f.size, 0)
    if (currentBytes + sizeBytes > MAX_TOTAL_SIZE) {
      setFileError('Email would exceed total size limit')
      setEmailPreview(null)
      return
    }

    const existingChars = attachedFiles.length > 0
      ? attachedFiles.reduce((s, f) => s + fileSectionChars(f), 0)
        + separatorChars(attachedFiles.length) + BASE_BLOCK_OVERHEAD_CHARS
      : 0
    if (existingChars + sectionStr.length > MAX_TOTAL_CHARS) {
      setFileError('Email would exceed total character limit')
      setEmailPreview(null)
      return
    }

    const allDisplayNames = attachedFiles.map((f) => f.displayName)
    const displayName = deduplicateDisplayName(tempFile.displayName, allDisplayNames)

    setAttachedFiles((prev) => [...prev, {
      ...tempFile,
      id: crypto.randomUUID(),
      displayName,
      sha256: hash,
    }])
    setEmailPreview(null)
  }, [emailPreview, attachedFiles])

  // --- Drag-and-drop handlers ---
  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (isStreaming) return
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list')) {
      setIsDragOver(true)
    }
  }

  function handleDragLeave(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    // Only clear if leaving the container (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (isStreaming) return

    // Gmail URL detection — validate before claiming the drop
    if (e.dataTransfer.types.includes('text/uri-list')) {
      const uriData = e.dataTransfer.getData('text/uri-list').split('\n')[0]?.trim()
      if (uriData) {
        try {
          const u = new URL(uriData)
          if (u.hostname.endsWith('mail.google.com')) {
            // Chrome sets text/plain to the URL when dragging links — try text/html for subject
            let subjectHint: string | undefined
            const htmlData = e.dataTransfer.getData('text/html')
            if (htmlData) {
              const match = htmlData.match(/<a[^>]*>([^<]+)<\/a>/i)
              if (match?.[1]) {
                const text = match[1].trim()
                // Only use if it doesn't look like a URL
                if (text && !/^https?:\/\//i.test(text)) subjectHint = text
              }
            }
            if (!subjectHint) {
              const plainText = e.dataTransfer.getData('text/plain')?.trim()
              if (plainText && !/^https?:\/\//i.test(plainText)) subjectHint = plainText
            }
            handleGmailDrop(uriData, subjectHint)
            return
          }
        } catch {
          // Not a valid URL — fall through to file handling
        }
      }
      // Non-Gmail URL drops fall through to file handling below
    }

    // Directory detection via webkitGetAsEntry
    if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i]
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry?.()
          if (entry?.isDirectory) {
            setFileError('Folders not supported — drop individual files')
            return
          }
        }
      }
    }

    // Collect files
    const droppedFiles: File[] = []
    if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) droppedFiles.push(file)
        }
      }
    } else if (e.dataTransfer.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        droppedFiles.push(e.dataTransfer.files[i])
      }
    }

    if (droppedFiles.length === 0) {
      setFileError('No readable files found')
      return
    }

    processFiles(droppedFiles)
  }

  // --- Attachment management ---
  function handleRemoveFile(id: string): void {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function handleRemoveAllFiles(): void {
    setAttachedFiles([])
  }

  function handleClearFileError(): void {
    setFileError(null)
  }

  // --- Send with display/LLM split + confirm gate ---
  async function handleSend(): Promise<void> {
    const text = input.trim()
    if (!text || isStreaming) return

    const attachmentMeta: AttachmentMeta[] | undefined = attachedFiles.length > 0
      ? attachedFiles.map((f) => ({
          filename: f.originalName,
          sizeBytes: f.size,
          sha256: f.sha256,
          ...(f.truncated ? { truncated: true } : {}),
        }))
      : undefined

    // Partition attachments by kind
    const fileAttachments = attachedFiles.filter((f) => f.kind === 'file')
    const emailAttachments = attachedFiles.filter((f) => f.kind === 'email')

    let llmContent = text
    if (fileAttachments.length > 0) {
      llmContent = `${buildLlmFileBlock(fileAttachments)}\n\n${llmContent}`
    }
    if (emailAttachments.length > 0) {
      llmContent = `${buildLlmEmailBlock(emailAttachments)}\n\n${llmContent}`
    }

    const { getActiveSkillId, clearActiveSkill } = useSkillStore.getState()
    const activeSkillId = getActiveSkillId(domainId) ?? undefined

    // Snapshot before clearing so we can restore on failure
    const savedInput = input
    const savedAttachments = attachedFiles

    setInput('')
    setAttachedFiles([])

    try {
      await sendMessage(text, llmContent, domainId, attachmentMeta, activeSkillId)
      clearActiveSkill(domainId)
    } catch {
      // Restore on failure so user doesn't lose their work
      setInput(savedInput)
      setAttachedFiles(savedAttachments)
    }
  }

  async function handleSuggestionClick(text: string): Promise<void> {
    if (isStreaming) return
    const { getActiveSkillId, clearActiveSkill } = useSkillStore.getState()
    const activeSkillId = getActiveSkillId(domainId) ?? undefined
    await sendMessage(text, text, domainId, undefined, activeSkillId)
    clearActiveSkill(domainId)
  }

  // --- Keyboard handlers ---
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleExtractSingle(messageIndex: number): void {
    const msg = messages[messageIndex]
    if (!msg || msg.role !== 'assistant' || isExtracting || isStreaming) return
    extractKbUpdates(domainId, msg.content, messageIndex)
  }

  function handleExtractAll(): void {
    if (isExtracting || isStreaming) return

    // Collect last 10 assistant messages, capped at 30k chars total
    const assistantMessages: Array<{ content: string; index: number; timestamp: string }> = []
    for (let i = messages.length - 1; i >= 0 && assistantMessages.length < 10; i--) {
      if (messages[i].role === 'assistant') {
        assistantMessages.unshift({
          content: messages[i].content,
          index: i,
          timestamp: new Date().toISOString(),
        })
      }
    }

    if (assistantMessages.length === 0) return

    // Build combined content with boundaries, capped at 30k chars
    let combined = ''
    const included: typeof assistantMessages = []
    for (const msg of assistantMessages) {
      const wrapped = `[ASSISTANT MESSAGE #${msg.index} | ${msg.timestamp}]\n${msg.content}\n[/MESSAGE]\n\n`
      if (combined.length + wrapped.length > 30000) break
      combined += wrapped
      included.push(msg)
    }

    if (!combined) return

    extractKbUpdates(domainId, combined)
  }

  const hasAssistantMessages = messages.some((m) => m.role === 'assistant')

  // Attachment summary for display
  const totalAttachSize = attachedFiles.reduce((s, f) => s + f.size, 0)
  const totalAttachChars = attachedFiles.reduce((s, f) => s + f.content.length, 0)

  return (
    <div
      className="relative flex min-h-0 h-full flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop zone overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-lg pointer-events-none animate-fade-in">
          <div className="flex flex-col items-center gap-2 text-accent">
            <PaperclipIcon />
            <span className="text-sm font-medium">Drop files or emails to attach</span>
          </div>
        </div>
      )}

      {/* Toast: extraction error */}
      {extractionError && (
        <div className="mx-4 mt-2 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger animate-fade-in">
          KB extraction failed — {extractionError}
          <button onClick={clearExtractionError} className="ml-2 text-danger/60 hover:text-danger">×</button>
        </div>
      )}

      {/* Banner: extraction success */}
      {extractionResult && (
        <div className="mx-4 mt-2 rounded border border-success/30 bg-success/5 px-3 py-2 text-xs text-success animate-fade-in">
          Added {extractionResult.proposalCount} KB proposals from {extractionResult.messageLabel}
          <button onClick={clearExtractionResult} className="ml-2 text-success/60 hover:text-success">×</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {!messages.some((m) => m.role !== 'system') && !isStreaming && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="text-sm text-text-tertiary">
              Send a message to start chatting with this domain's AI assistant.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => handleSuggestionClick(s.text ?? s.label)}
                  className={chipClass(s.featured)}
                >
                  {s.featured && <BrainIcon aria-hidden="true" className="inline-block h-3 w-3 mr-1" />}
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) =>
          msg.role === 'system' ? (
            <div key={i} className="my-4 flex items-center gap-3">
              <div className="flex-1 border-t border-red-500/40" />
              <span className="text-xs font-medium text-red-400">Switched to {msg.content}</span>
              <div className="flex-1 border-t border-red-500/40" />
            </div>
          ) : (
            <div key={i}>
              <MessageBubble
                role={msg.role}
                content={msg.content}
                status={msg.status}
                metadata={msg.metadata}
                attachments={msg.attachments}
                onExtractKb={msg.role === 'assistant' ? () => handleExtractSingle(i) : undefined}
              />
              {msg.role === 'assistant' && msg.stopBlocks?.length ? <StopAlert stopBlocks={msg.stopBlocks} /> : null}
              {msg.role === 'assistant' && msg.gapFlags?.length ? <GapFlagAlert gapFlags={msg.gapFlags} /> : null}
              {msg.role === 'assistant' && msg.decisions?.length ? <DecisionCard decisions={msg.decisions} /> : null}
            </div>
          )
        )}
        {isStreaming && streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} />
        )}
        {activeToolCall?.status === 'running' && (
          <div className="mb-3 flex justify-start animate-fade-in">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-surface-2 border border-border-subtle px-4 py-2.5 text-xs text-text-secondary">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              {activeToolCall.toolName === 'gmail_search'
                ? `Searching Gmail${activeToolCall.detail?.query ? `: "${activeToolCall.detail.query}"` : ''}...`
                : `Reading email${activeToolCall.detail?.subject ? `: ${activeToolCall.detail.subject}` : ''}...`}
            </div>
          </div>
        )}
        {isStreaming && !streamingContent && !activeToolCall && (
          <div className="mb-3 flex justify-start animate-fade-in">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-surface-2 border border-border-subtle px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border-subtle px-4 py-2">
        <div className="mb-1.5 flex gap-2">
          <button
            onClick={clearMessages}
            disabled={isStreaming || messages.filter((m) => m.role !== 'system').length === 0}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
            title="Clear chat history"
          >
            Clear
          </button>
          <button
            onClick={handleExtractAll}
            disabled={isStreaming || isExtracting || !hasAssistantMessages}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
            title="Extract KB updates from last 10 messages"
          >
            {isExtracting ? <SpinnerIcon /> : null}
            Update All
          </button>
        </div>

        {/* Skill selector */}
        <SkillSelector domainId={domainId} />

        {/* Attachments bar */}
        <ChatAttachmentsBar
          files={attachedFiles}
          error={fileError}
          onRemove={handleRemoveFile}
          onRemoveAll={handleRemoveAllFiles}
          onClearError={handleClearFileError}
        />

        {/* Email fetch loading indicator */}
        {isFetchingEmail && (
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary animate-fade-in">
            <SpinnerIcon /> Fetching email...
          </div>
        )}

        {/* Email subject search prompt (when opaque Gmail URL can't be resolved) */}
        {emailSearchPrompt && (
          <div className="mx-0 mt-1 rounded border border-accent/30 bg-accent/5 px-3 py-2 text-xs animate-fade-in">
            <div className="mb-1 text-text-secondary">
              Enter the email subject to find it:
            </div>
            <div className="flex gap-1.5">
              <input
                autoFocus
                type="text"
                placeholder="e.g. Loan refinance - Lender due diligence"
                className="flex-1 rounded border border-border bg-surface-1 px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const subject = e.currentTarget.value.trim()
                    if (subject) {
                      const url = emailSearchPrompt.url
                      setEmailSearchPrompt(null)
                      handleGmailDrop(url, subject)
                    }
                  } else if (e.key === 'Escape') {
                    setEmailSearchPrompt(null)
                  }
                }}
              />
              <button
                onClick={() => setEmailSearchPrompt(null)}
                className="rounded border border-border px-2 py-0.5 text-[0.65rem] text-text-secondary hover:bg-surface-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Email preview confirmation */}
        {emailPreview && (() => {
          const latest = emailPreview.messages[emailPreview.messages.length - 1]
          const senderName = latest.from.replace(/<.*>/, '').trim() || latest.from
          // Clean preview: take first 3 non-empty lines, join with · , cap at 120 chars
          const bodySnippet = latest.body
            .replace(/\r/g, '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 3)
            .join(' · ')
            .slice(0, 120)
          const msgCount = emailPreview.messages.length

          return (
            <div className="mx-0 mt-1 rounded border border-accent/30 bg-accent/5 px-3 py-2 text-xs animate-fade-in">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div>
                    <span className="font-medium text-text-primary">{latest.subject}</span>
                    <span className="ml-2 text-text-tertiary">from {senderName}</span>
                  </div>
                  <div className="mt-0.5 text-text-tertiary truncate">
                    {msgCount > 1 && <span className="font-medium">Will attach last {msgCount} messages · </span>}
                    {bodySnippet}{latest.body.length > 120 ? '...' : ''}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={confirmEmailAttach}
                    className="rounded bg-accent px-2 py-0.5 text-[0.65rem] text-white hover:bg-accent-hover"
                  >
                    Attach
                  </button>
                  <button
                    onClick={() => setEmailPreview(null)}
                    className="rounded border border-border px-2 py-0.5 text-[0.65rem] text-text-secondary hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Attachment summary */}
        {attachedFiles.length > 0 && (
          <div className="mt-1 mb-1 text-[0.65rem] text-text-tertiary">
            Attached: {attachedFiles.length} file{attachedFiles.length !== 1 ? 's' : ''} · {formatFileSize(totalAttachSize)} · {totalAttachChars.toLocaleString()} chars
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 resize-none rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            rows={2}
            placeholder={attachedFiles.length > 0
              ? 'Type a message about attached files... (Enter to send)'
              : 'Type a message... (Enter to send, Shift+Enter for newline)'}
            disabled={isStreaming}
          />
          {(isStreaming || isSending) ? (
            <button
              onClick={cancelChat}
              className="flex items-center gap-1.5 self-end rounded bg-danger px-3 py-2 text-sm text-white hover:bg-danger/80"
            >
              <StopIcon />
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex items-center gap-1.5 self-end rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <SendIcon />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
