import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { cn } from './utils'

export type ToastKind = 'success' | 'danger' | 'info'

type ToastRecord = { id: number; kind: ToastKind; text: string }

let sequence = 0
let items: ToastRecord[] = []
const listeners = new Set<() => void>()

function emit(next: ToastRecord[]) {
  items = next
  listeners.forEach((listener) => listener())
}

function dismiss(id: number) {
  emit(items.filter((item) => item.id !== id))
}

function push(kind: ToastKind, text: string, duration = kind === 'danger' ? 6000 : 3600) {
  const id = ++sequence
  emit([{ id, kind, text }, ...items].slice(0, 4))
  if (duration > 0) window.setTimeout(() => dismiss(id), duration)
  return id
}

export const toast = Object.assign((text: string) => push('info', text), {
  success: (text: string) => push('success', text),
  danger: (text: string) => push('danger', text),
  dismiss,
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const ICONS = { success: CheckCircle2, danger: AlertTriangle, info: Info }

export function ToastHost() {
  const records = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  )
  if (!records.length) return null
  return (
    <div className="adm-toasts" role="status" aria-live="polite">
      {records.map((item) => {
        const Icon = ICONS[item.kind]
        return (
          <div key={item.id} className="adm-toast" data-tone={item.kind}>
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                item.kind === 'success' && 'text-emerald-300',
                item.kind === 'danger' && 'text-rose-300',
                item.kind === 'info' && 'text-sky-300',
              )}
            />
            <span className="min-w-0 flex-1">{item.text}</span>
            <button
              type="button"
              aria-label="关闭提示"
              className="shrink-0 rounded p-0.5 text-[var(--msv-tooltip-fg)] opacity-60 transition hover:opacity-100"
              onClick={() => dismiss(item.id)}
            >
              <XCircle className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
