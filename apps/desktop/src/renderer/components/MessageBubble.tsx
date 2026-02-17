interface Props {
  role: 'user' | 'assistant'
  content: string
}

export function MessageBubble({ role, content }: Props): React.JSX.Element {
  const isUser = role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-neutral-800 text-neutral-200'
        }`}
      >
        <pre className="whitespace-pre-wrap break-words font-sans">{content}</pre>
      </div>
    </div>
  )
}
