import { Modal } from '@heroui/react'
import { AlertTriangle, ShieldQuestion } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useI18n } from './i18n'
import { cn } from './utils'

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  tone?: 'primary' | 'danger'
  requireText?: string
  icon?: ReactNode
}

type ConfirmFunction = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFunction | null>(null)

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [typed, setTyped] = useState('')
  const pendingRef = useRef<PendingConfirm | null>(null)

  const confirm = useCallback<ConfirmFunction>((options) => {
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve }
      pendingRef.current = next
      setPending(next)
      setTyped('')
    })
  }, [])

  const close = useCallback((value: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    setTyped('')
    current?.resolve(value)
  }, [])

  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false)
    }
  }, [])

  const options = pending?.options
  const danger = options?.tone === 'danger'
  const blocked = Boolean(options?.requireText) && typed.trim() !== options?.requireText

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal.Root
        isOpen={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) close(false)
        }}
      >
        <Modal.Backdrop variant="blur">
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="max-w-[440px] border border-line bg-ink-850">
              <Modal.Header className="gap-3">
                <Modal.Icon
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl border',
                    danger
                      ? 'border-rose-400/25 bg-rose-400/10 text-rose-300'
                      : 'border-teal-400/25 bg-teal-400/10 text-teal-300',
                  )}
                >
                  {options?.icon ?? (danger ? <AlertTriangle className="size-5" /> : <ShieldQuestion className="size-5" />)}
                </Modal.Icon>
                <div className="min-w-0">
                  <Modal.Heading className="text-[1rem] font-semibold text-ice-200">
                    {options?.title ?? ''}
                  </Modal.Heading>
                </div>
              </Modal.Header>
              <Modal.Body className="pt-1">
                {options?.description && (
                  <div className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-ice-400">
                    {options.description}
                  </div>
                )}
                {options?.requireText && (
                  <div className="mt-4">
                    <div className="field-label">
                      {t('输入 {text} 以确认', { text: options.requireText })}
                    </div>
                    <input
                      className="msv-input"
                      autoFocus
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !blocked) close(true)
                      }}
                    />
                  </div>
                )}
              </Modal.Body>
              <Modal.Footer className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="h-9 rounded-lg border border-line px-4 text-[0.8125rem] text-ice-400 transition hover:border-line-strong hover:bg-[var(--msv-tint)] hover:text-ice-200"
                  onClick={() => close(false)}
                >
                  {options?.cancelText ?? t('取消')}
                </button>
                <button
                  type="button"
                  disabled={blocked}
                  className={cn(
                    'h-9 rounded-lg px-4 text-[0.8125rem] font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
                    danger
                      ? 'bg-[var(--danger)] text-[var(--danger-foreground)] hover:brightness-110'
                      : 'bg-teal-400  hover:bg-teal-300',
                  )}
                  onClick={() => close(true)}
                >
                  {options?.confirmText ?? t('确认')}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFunction {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider')
  return context
}
