import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../stores'
import { MessageBubble } from './MessageBubble'
import { StopAlert } from './StopAlert'
import { GapFlagAlert } from './GapFlagAlert'
import { DecisionCard } from './DecisionCard'

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

export function ChatPanel({ domainId }: Props): React.JSX.Element {
  const {
    messages,
    isStreaming,
    streamingContent,
    isExtracting,
    extractionError,
    extractionResult,
    activeToolCall,
    sendMessage,
    clearMessages,
    extractKbUpdates,
    clearExtractionError,
    clearExtractionResult,
  } = useChatStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

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

  async function handleSend(): Promise<void> {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    await sendMessage(text, domainId)
  }

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

  return (
    <div className="flex min-h-0 h-full flex-col">
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
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-tertiary">
              Send a message to start chatting with this domain's AI assistant.
            </p>
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
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 resize-none rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            rows={2}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="flex items-center gap-1.5 self-end rounded bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <SendIcon />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
