import { Check, LogOut, Minimize2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { CloseAction } from '../lib/types'
import { cn } from '../lib/utils'
import { ModalFrame, Spinner } from './primitives'

/**
 * Shown when the window X is clicked (backend calls window.__msvClosePrompt).
 * The user can hide to the notification area or really quit, and optionally
 * remember the answer so the prompt never appears again.
 */
export function CloseDialog({
  open,
  onOpenChange,
  defaultAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultAction: CloseAction
}) {
  const { t } = useI18n()
  const [action, setAction] = useState<CloseAction>(defaultAction)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setAction(defaultAction)
    setRemember(false)
    setBusy(false)
  }, [open, defaultAction])

  function cancel() {
    void api.dismissClosePrompt().catch(() => undefined)
    onOpenChange(false)
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.closeWindow(action, remember)
      // Hiding keeps this page alive; quitting destroys the window, but the
      // dialog still has to go away so the browser demo does not get stuck.
      if (result?.hidden) {
        toast.success(t('已最小化到小图标区'), t('右键小图标可以打开主界面、锁定密码库或退出。'))
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(t('关闭失败'), error instanceof ApiError ? error.message : t('请重试'))
      setBusy(false)
    }
  }

  const options: {
    value: CloseAction
    title: string
    description: string
    icon: ReactNode
  }[] = [
    {
      value: 'tray',
      title: t('最小化到小图标区'),
      description: t('窗口从任务栏收起，连接与密码库保持原状，随时点小图标回来。'),
      icon: <Minimize2 className="size-4" />,
    },
    {
      value: 'quit',
      title: t('直接关闭程序'),
      description: t('立即退出 MedSafeVault，内存中的密钥与所有连接都会断开。'),
      icon: <LogOut className="size-4" />,
    },
  ]

  return (
    <ModalFrame
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else cancel()
      }}
      icon={<X className="size-5" />}
      title={t('关闭 MedSafeVault')}
      description={t('请选择点击关闭按钮后的行为。')}
      width="520px"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[0.71875rem] text-ice-500">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--msv-accent)]"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            {t('记住我的选择，以后不再询问')}
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancel}
              className="h-9 rounded-lg border border-line px-4 text-[0.78125rem] text-ice-400 transition hover:border-line-strong hover:bg-[var(--msv-tint)] hover:text-ice-200"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
            >
              {busy ? <Spinner className="size-3.5" /> : <Check className="size-3.5" />}
              {t('确定')}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        {options.map((option) => {
          const active = action === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setAction(option.value)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition',
                active
                  ? 'border-[color-mix(in_srgb,var(--msv-accent)_55%,transparent)] bg-[var(--msv-accent-soft)]'
                  : 'border-line hover:border-line-strong hover:bg-[var(--msv-tint)]',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg',
                  active
                    ? 'bg-[var(--msv-accent)] text-white'
                    : 'bg-[var(--msv-tint-strong)] text-ice-500',
                )}
              >
                {option.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-medium text-ice-200">
                  {option.title}
                </span>
                <span className="mt-0.5 block text-[0.71875rem] leading-relaxed text-ice-500">
                  {option.description}
                </span>
              </span>
              <span
                className={cn(
                  'mt-1 grid size-4 shrink-0 place-items-center rounded-full border',
                  active
                    ? 'border-[var(--msv-accent)] bg-[var(--msv-accent)] text-white'
                    : 'border-line-strong',
                )}
              >
                {active && <Check className="size-2.5" />}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[0.6875rem] leading-relaxed text-ice-600">
        {t('可以在「设置 → 关闭行为」中修改默认选择，或重新开启每次询问。')}
      </p>
    </ModalFrame>
  )
}
