import { useEffect, useState } from 'react'
import { useIntakeStore } from '../stores'

export function IntakeTokenDisplay(): React.JSX.Element {
  const { getToken, getPort } = useIntakeStore()
  const [token, setToken] = useState<string | null>(null)
  const [port, setPort] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState<'token' | 'port' | null>(null)

  useEffect(() => {
    getToken().then(setToken)
    getPort().then(setPort)
  }, [getToken, getPort])

  const copyToClipboard = async (text: string, which: 'token' | 'port') => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!token) return <></>

  return (
    <div className="flex-shrink-0 border-t border-border px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-tertiary">Token:</span>
        <span className="flex-1 truncate font-mono text-[10px] text-text-secondary">
          {revealed ? token : `${token.slice(0, 8)}${'*'.repeat(12)}`}
        </span>
        <button
          onClick={() => setRevealed(!revealed)}
          className="text-[10px] text-text-tertiary hover:text-text-secondary"
        >
          {revealed ? 'hide' : 'show'}
        </button>
        <button
          onClick={() => copyToClipboard(token, 'token')}
          className="text-[10px] text-text-tertiary hover:text-text-secondary"
        >
          {copied === 'token' ? 'copied' : 'copy'}
        </button>
      </div>
      {port && (
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[10px] text-text-tertiary">Port:</span>
          <span className="font-mono text-[10px] text-text-secondary">{port}</span>
          <button
            onClick={() => copyToClipboard(String(port), 'port')}
            className="text-[10px] text-text-tertiary hover:text-text-secondary"
          >
            {copied === 'port' ? 'copied' : 'copy'}
          </button>
        </div>
      )}
    </div>
  )
}
