import { translate } from './i18n'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './utils'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

interface ToastOptions {
  duration?: number
  action?: { label: string; onClick: () => void }
}

interface ToastRecord {
  id: number
  kind: ToastKind
  title: string
  description?: string
  duration: number
  action?: { label: string; onClick: () => void }
}

type ToastFunction = (
  title: string,
  description?: string,
  options?: ToastOptions,
) => number

let sequence = 0
let records: ToastRecord[] = []
const listeners = new Set<() => void>()

function emit(next: ToastRecord[]) {
  records = next
  listeners.forEach((listener) => listener())
}

function dismiss(id: number) {
  emit(records.filter((item) => item.id !== id))
}

function push(kind: ToastKind, title: string, description?: string, options: ToastOptions = {}) {
  const id = ++sequence
  const duration = options.duration ?? (kind === 'error' ? 6200 : 4200)
  const record: ToastRecord = { id, kind, title, description, duration, action: options.action }
  emit([record, ...records].slice(0, 5))
  if (duration > 0) {
    window.setTimeout(() => dismiss(id), duration)
  }
  return id
}

const base = ((title, description, options) =>
  push('info', title, description, options)) as ToastFunction & {
  success: ToastFunction
  error: ToastFunction
  info: ToastFunction
  warning: ToastFunction
  dismiss: (id: number) => void
}

base.success = (title, description, options) =>
  push('success', title, description, options)
base.error = (title, description, options) => push('error', title, description, options)
base.info = (title, description, options) => push('info', title, description, options)
base.warning = (title, description, options) =>
  push('warning', title, description, options)
base.dismiss = dismiss

export const toast = base

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => records

const PALETTE: Record<
  ToastKind,
  { icon: typeof CheckCircle2; ring: string; iconClass: string; bar: string }
> = {
  success: {
    icon: CheckCircle2,
    ring: 'border-emerald-400/25',
    iconClass: 'text-emerald-300',
    bar: 'bg-emerald-400/70',
  },
  error: {
    icon: XCircle,
    ring: 'border-rose-400/25',
    iconClass: 'text-rose-300',
    bar: 'bg-rose-400/70',
  },
  warning: {
    icon: AlertTriangle,
    ring: 'border-amber-400/25',
    iconClass: 'text-amber-300',
    bar: 'bg-amber-400/70',
  },
  info: {
    icon: Info,
    ring: 'border-teal-400/25',
    iconClass: 'text-teal-300',
    bar: 'bg-teal-400/70',
  },
}

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-[68px] z-[100001] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2.5 sm:right-6">
      {items.map((item) => {
        const palette = PALETTE[item.kind]
        const Icon = palette.icon
        return (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto relative overflow-hidden rounded-xl border bg-[var(--msv-surface)]/95 p-3.5 pr-9 shadow-[0_24px_60px_-24px_rgba(0,0,0,.95)] backdrop-blur-xl animate-slide-in',
              palette.ring,
            )}
            role="status"
          >
            <div className="flex items-start gap-2.5">
              <Icon className={cn('mt-0.5 size-4 shrink-0', palette.iconClass)} />
              <div className="min-w-0 flex-1">
                <div className="text-[0.8125rem] font-medium text-ice-200">{item.title}</div>
                {item.description && (
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[0.75rem] leading-relaxed text-ice-500">
                    {item.description}
                  </div>
                )}
                {item.action && (
                  <button
                    type="button"
                    className="mt-1.5 text-[0.75rem] font-medium text-teal-300 hover:text-teal-200"
                    onClick={() => {
                      item.action?.onClick()
                      dismiss(item.id)
                    }}
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label={translate('关闭提示')}
              className="absolute right-2 top-2.5 rounded p-1 text-ice-600 transition hover:bg-[var(--msv-tint)] hover:text-ice-300"
              onClick={() => dismiss(item.id)}
            >
              <X className="size-3.5" />
            </button>
            {item.duration > 0 && (
              <span
                className={cn('absolute bottom-0 left-0 h-px w-full origin-left', palette.bar)}
                style={{ animation: `secret-countdown ${item.duration}ms linear forwards` }}
              />
            )}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
