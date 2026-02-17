interface Props {
  role: 'user' | 'assistant'
  content: string
}

/** Minimal inline markdown renderer — handles code blocks, inline code, bold, lists, paragraphs */
function renderMarkdown(text: string): React.JSX.Element {
  // Split on code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g)

  const elements: React.JSX.Element[] = []
  let key = 0

  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      // Code block
      const content = part.slice(3, -3).replace(/^\w*\n/, '') // strip language hint
      elements.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded bg-surface-0 border border-border-subtle p-2 font-mono text-xs leading-relaxed">
          {content}
        </pre>
      )
    } else {
      // Split into paragraphs by double newline
      const paragraphs = part.split(/\n{2,}/)
      for (const para of paragraphs) {
        if (!para.trim()) continue

        // Check if this is a list
        const lines = para.split('\n')
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

export function MessageBubble({ role, content }: Props): React.JSX.Element {
  const isUser = role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 animate-fade-in`}>
      <div
        className={`max-w-[80%] px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'rounded-2xl rounded-br-sm bg-accent text-white'
            : 'rounded-2xl rounded-bl-sm border border-border-subtle bg-surface-2 text-text-primary'
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{content}</div>
        ) : (
          <div className="break-words">{renderMarkdown(content)}</div>
        )}
      </div>
    </div>
  )
}
