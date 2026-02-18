import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../stores'
import { MessageBubble } from './MessageBubble'
import { StopAlert } from './StopAlert'
import { GapFlagAlert } from './GapFlagAlert'
import { DecisionCard } from './DecisionCard'

interface Props {
  domainId: string
  apiKey: string
}

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.5 8H13.5M13.5 8L9 3.5M13.5 8L9 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export function ChatPanel({ domainId, apiKey }: Props): React.JSX.Element {
  const { messages, isStreaming, streamingContent, sendMessage } = useChatStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  async function handleSend(): Promise<void> {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    await sendMessage(text, domainId, apiKey)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex min-h-0 h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-tertiary">
              Send a message to start chatting with this domain's AI assistant.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            <MessageBubble role={msg.role} content={msg.content} />
            {msg.role === 'assistant' && msg.stopBlocks?.length ? <StopAlert stopBlocks={msg.stopBlocks} /> : null}
            {msg.role === 'assistant' && msg.gapFlags?.length ? <GapFlagAlert gapFlags={msg.gapFlags} /> : null}
            {msg.role === 'assistant' && msg.decisions?.length ? <DecisionCard decisions={msg.decisions} /> : null}
          </div>
        ))}
        {isStreaming && streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} />
        )}
        {isStreaming && !streamingContent && (
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
      <div className="border-t border-border-subtle p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 resize-none rounded border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            rows={2}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="flex items-center gap-1.5 self-end rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <SendIcon />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
