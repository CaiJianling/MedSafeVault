import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, copySecret, copyText } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { RecordCell } from '../lib/types'
import { cn } from '../lib/utils'
import { Spinner, Tip } from './primitives'

const REVEAL_SECONDS = 20

export function SecretCell({
  recordId,
  fieldKey,
  label,
  cell,
}: {
  recordId: number
  fieldKey: string
  label: string
  cell: RecordCell | undefined
}) {
  const { t } = useI18n()
  const [revealed, setRevealed] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    }
  }, [])

  if (!cell || !cell.has) {
    return <span className="text-ice-600">—</span>
  }

  const masked = cell.masked
  const value = cell.value

  async function reveal() {
    if (revealed) {
      hide()
      return
    }
    setLoading(true)
    try {
      const result = await api.revealSecret(recordId, fieldKey)
      setRevealed(result.value)
      setNonce((value) => value + 1)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setRevealed(null), REVEAL_SECONDS * 1000)
    } catch (error) {
      toast.error(
        t('无法查看'),
        error instanceof ApiError ? error.message : t('解密失败，请重试'),
      )
    } finally {
      setLoading(false)
    }
  }

  function hide() {
    if (timer.current) window.clearTimeout(timer.current)
    setRevealed(null)
  }

  async function copy() {
    try {
      if (masked && !revealed) {
        const seconds = await copySecret(recordId, fieldKey)
        toast.success(
          t('{label}已复制', { label }),
          t('剪贴板将在 {n} 秒后自动清空', { n: seconds }),
        )
      } else {
        await copyText(revealed ?? value)
        toast.success(t('{label}已复制', { label }))
      }
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      toast.error(t('复制失败'), error instanceof ApiError ? error.message : t('无法写入剪贴板'))
    }
  }

  if (!masked) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate" title={value}>
          {value}
        </span>
        <Tip
          text={copied ? t('已复制') : t('复制')}
          className={cn(
            'shrink-0 opacity-0 transition-opacity',
            'pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100',
            'focus-within:pointer-events-auto focus-within:opacity-100',
            copied && 'pointer-events-auto opacity-100',
          )}
        >
          <button
            type="button"
            aria-label={t('复制{label}', { label })}
            onClick={copy}
            className="grid size-5 place-items-center rounded text-ice-600 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-300"
          >
            {copied ? (
              <Check className="size-3 text-[var(--msv-accent-text)]" />
            ) : (
              <Copy className="size-3" />
            )}
          </button>
        </Tip>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        {revealed ? (
          <div className="relative overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--msv-accent)_28%,transparent)] bg-[var(--msv-accent-soft)] px-2 py-0.5">
            <span className="secret-shown block truncate pr-1 font-mono text-[0.75rem] text-[var(--msv-accent-text)]">
              {revealed || '∅'}
            </span>
            <span key={nonce} className="secret-countdown" />
          </div>
        ) : (
          <span className="mask-dots select-none" aria-label={t('密码已隐藏')}>
            ••••••••
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Tip text={revealed ? t('隐藏密码') : t('查看密码（20 秒后自动隐藏）')}>
          <button
            type="button"
            aria-label={revealed ? t('隐藏密码') : t('查看密码')}
            disabled={loading}
            onClick={reveal}
            className={cn(
              'grid size-6 place-items-center rounded-md transition',
              revealed
                ? 'bg-[var(--msv-accent-soft)] text-[var(--msv-accent-text)] hover:brightness-110'
                : 'text-ice-600 hover:bg-[var(--msv-tint-strong)] hover:text-ice-300',
            )}
          >
            {loading ? (
              <Spinner className="size-3" />
            ) : revealed ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
        </Tip>
        <Tip
          text={copied ? t('已复制') : t('复制（30 秒后自动清空剪贴板）')}
          className={cn(
            'opacity-0 transition-opacity',
            'pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100',
            'focus-within:pointer-events-auto focus-within:opacity-100',
            copied && 'pointer-events-auto opacity-100',
          )}
        >
          <button
            type="button"
            aria-label={t('复制密码')}
            onClick={copy}
            className="grid size-6 place-items-center rounded-md text-ice-600 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-300"
          >
            {copied ? (
              <Check className="size-3.5 text-[var(--msv-accent-text)]" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </Tip>
      </div>
    </div>
  )
}
