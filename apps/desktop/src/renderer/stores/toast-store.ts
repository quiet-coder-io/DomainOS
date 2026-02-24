import { create } from 'zustand'

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
  domainId?: string
  autoDismissMs: number
  createdAt: number
}

interface ToastState {
  toasts: Toast[]
  addToast(toast: Omit<Toast, 'id' | 'createdAt'>): string
  removeToast(id: string): void
}

const MAX_VISIBLE = 5

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast(input) {
    const id = crypto.randomUUID()
    const toast: Toast = { ...input, id, createdAt: Date.now() }
    const current = get().toasts
    // Keep only the most recent MAX_VISIBLE - 1, then add new
    const trimmed = current.length >= MAX_VISIBLE ? current.slice(-(MAX_VISIBLE - 1)) : current
    set({ toasts: [...trimmed, toast] })
    return id
  },

  removeToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))
