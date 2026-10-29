import { ExternalLink, MonitorPlay, Power, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { Spinner } from '../primitives'

/**
 * RDP stays in the system mstsc window (WebView2 cannot embed it), but the tab
 * keeps it reachable: bring it to the foreground or close it from here.
 */
export function RdpPane({
  pid,
  target,
  title,
}: {
  pid: number
  target: string
  title: string
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState('')

  async function focus() {
    setBusy('focus')
    try {
      const result = await api.rdpFocus(pid)
      if (!result.focused) {
        toast.info(t('远程桌面窗口暂时找不到'), t('它可能已经关闭，或仍在启动中。'))
      }
    } catch (error) {
      toast.error(t('无法显示窗口'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy('')
    }
  }

  async function close() {
    setBusy('close')
    try {
      const result = await api.rdpClose(pid)
      toast.success(result.closed ? t('远程桌面已关闭') : t('远程桌面窗口已不在运行'))
    } catch (error) {
      toast.error(t('关闭失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-[var(--msv-surface)] p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--msv-accent-soft)] text-[var(--msv-accent-text)]">
            <MonitorPlay className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[0.9375rem] font-semibold text-ice-200" title={title}>
              {title}
            </h3>
            <p className="mt-1 font-mono text-[0.75rem] text-ice-500">{target}</p>
          </div>
        </div>

        <p className="mt-4 text-[0.75rem] leading-relaxed text-ice-500">
          {t(
            '远程桌面由 Windows 自带的 mstsc 打开，窗口在任务栏中照常使用；关闭此标签页会同时结束远程桌面。',
          )}
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--msv-accent)_22%,transparent)] bg-[var(--msv-accent-soft)] px-3 py-2 text-[0.71875rem] leading-relaxed text-ice-500">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--msv-accent-text)]" />
          {t(
            '是否自动填充用户名或密码由「设置 → 远程连接」决定。自动填充密码时使用 Windows 临时凭据，mstsc 退出后立即删除。',
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void focus()}
            disabled={Boolean(busy)}
            className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
          >
            {busy === 'focus' ? <Spinner className="size-3.5" /> : <ExternalLink className="size-3.5" />}
            {t('显示远程桌面窗口')}
          </button>
          <button
            type="button"
            onClick={() => void close()}
            disabled={Boolean(busy)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--msv-danger-text)_30%,transparent)] px-3.5 text-[0.78125rem] text-[var(--msv-danger-text)] transition hover:bg-[color-mix(in_srgb,var(--msv-danger-text)_10%,transparent)] disabled:opacity-50"
          >
            {busy === 'close' ? <Spinner className="size-3.5" /> : <Power className="size-3.5" />}
            {t('关闭远程桌面')}
          </button>
        </div>
      </div>
    </div>
  )
}
