import { useEffect, useRef } from 'react'
import { useToastStore } from '../stores/toast-store'
import type { Toast } from '../stores/toast-store'

const TYPE_STYLES: Record<Toast['type'], string> = {
  info: 'border-accent/40',
  success: 'border-success/40',
  error: 'border-danger/40',
  warning: 'border-warning/40',
}

const TYPE_ICONS: Record<Toast['type'], string> = {
  info: '\u2139',    // ℹ
  success: '\u2713', // ✓
  error: '\u2717',   // ✗
  warning: '\u26A0', // ⚠
}

function ToastCard({ toast }: { toast: Toast }): React.JSX.Element {
  const removeToast = useToastStore((s) => s.removeToast)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      removeToast(toast.id)
    }, toast.autoDismissMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast.id, toast.autoDismissMs, removeToast])

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border bg-surface-1 px-3 py-2.5 shadow-xl animate-in slide-in-from-right-5 ${TYPE_STYLES[toast.type]}`}
    >
      <span className="mt-0.5 text-xs text-text-tertiary">{TYPE_ICONS[toast.type]}</span>
      <p className="flex-1 text-sm text-text-secondary leading-snug">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="ml-1 text-xs text-text-tertiary hover:text-text-secondary"
      >
        &times;
      </button>
    </div>
  )
}

export function ToastContainer(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
