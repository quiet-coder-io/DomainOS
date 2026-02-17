import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../stores'
import { MessageBubble } from './MessageBubble'

interface Props {
  domainId: string
  apiKey: string
}

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
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !isStreaming && (
          <p className="py-12 text-center text-sm text-neutral-500">
            Send a message to start chatting with this domain's AI assistant.
          </p>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
        {isStreaming && streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} />
        )}
        {isStreaming && !streamingContent && (
          <div className="mb-3 flex justify-start">
            <div className="rounded-lg bg-neutral-800 px-4 py-2.5 text-sm text-neutral-400">
              Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-800 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 resize-none rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            rows={2}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="self-end rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
