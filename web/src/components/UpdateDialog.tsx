/**
 * Intranet update flow: check → prompt → download → verify → restart.
 *
 * The dialog is opened from two places: automatically once per app start when
 * an update endpoint is configured, and from settings → 关于 → 检查更新. All
 * numbers shown here come from the backend (`backend/updater.py`), which is
 * also the place that refuses a download whose sha256 does not match.
 */
import { AlertTriangle, Download, RefreshCw, Rocket, XCircle } from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { UpdateInfo, UpdateSnapshot } from '../lib/types'
import { cn, formatBytes } from '../lib/utils'
import { ModalFrame, Spinner } from './primitives'

// Markdown 解析器（react-markdown + gfm）有 1 MB 多，只有真的要看更新说明时才需要，
// 拆成单独的 chunk 按需加载：主界面的启动体积不受影响。
const Markdown = lazy(() =>
  import('./Markdown').then((module) => ({ default: module.Markdown })),
)

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

type Phase = 'checking' | 'available' | 'download' | 'ready' | 'error'

export function UpdateDialog({
  open,
  onOpenChange,
  url,
  version,
  autoDownload,
  onBadge,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  version: string
  /** 从「关于 → 立即更新」进来时，检查完直接开始下载。 */
  autoDownload?: boolean
  /** 有新版但用户选择「以后再说」时，让顶栏的设置按钮和设置里的「关于」带上红点。 */
  onBadge?: (show: boolean) => void
}) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('checking')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  const pollRef = useRef<number | null>(null)
  // 只在打开时读一次：自动下载是「这次打开」的行为，取消后不再偷偷重来
  const autoRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const poll = useCallback(() => {
    stopPolling()
    pollRef.current = window.setInterval(async () => {
      try {
        const result = await api.getUpdateStatus()
        setSnapshot(result.update)
        if (result.update.state === 'downloading' || result.update.state === 'verifying') {
          return
        }
        stopPolling()
        if (result.update.state === 'ready') {
          setPhase('ready')
        } else if (result.update.state === 'error') {
          setPhase('error')
          setError(result.update.error || t('下载失败'))
        }
      } catch {
        stopPolling()
      }
    }, 350)
  }, [stopPolling, t])

  useEffect(() => {
    if (!open) {
      stopPolling()
      return
    }
    let cancelled = false
    setError('')
    setSnapshot(null)
    setPhase('checking')
    autoRef.current = Boolean(autoDownload)
    if (!url) {
      setPhase('error')
      setError(t('尚未填写更新服务地址，请在设置 → 关于里填写后再检查。'))
      return () => {
        cancelled = true
      }
    }
    api
      .checkUpdate()
      .then((result) => {
        if (cancelled) return
        setInfo(result.update.info)
        if (result.update.info.available) {
          setPhase('available')
          if (autoRef.current) {
            autoRef.current = false
            void startDownload(result.update.info)
          }
        } else {
          setPhase('error')
          onBadge?.(false)
          setError(
            t('当前已是最新版本（{v}）。更新服务上的最新版是 {latest}。', {
              v: version,
              latest: result.update.info.latest,
            }),
          )
        }
      })
      .catch((error) => {
        if (cancelled) return
        setPhase('error')
        setError(message(error, t('无法连接更新服务')))
      })
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [open, url, version, nonce, stopPolling, t])

  async function startDownload(release?: UpdateInfo | null) {
    if (!(release ?? info)) return
    setBusy(true)
    setError('')
    try {
      const result = await api.downloadUpdate()
      setSnapshot(result.update)
      setPhase('download')
      onBadge?.(false)  // 已经开始处理这次更新，红点收起
      poll()
    } catch (error) {
      setPhase('error')
      setError(message(error, t('无法开始下载')))
    } finally {
      setBusy(false)
    }
  }

  async function cancelDownload() {
    stopPolling()
    try {
      await api.cancelUpdate()
    } catch {
      /* the job already ended; nothing to cancel */
    }
    setPhase('available')
    setSnapshot(null)
  }

  async function restart() {
    setBusy(true)
    setError('')
    try {
      await api.installUpdate()
      onBadge?.(false)
      toast.info(t('正在更新'), t('程序会短暂关闭后自动重新启动。'))
    } catch (error) {
      setPhase('error')
      setError(message(error, t('无法启动更新')))
      setBusy(false)
    }
  }

  /** 关掉弹窗；如果还有没处理的更新（已下载但没重启也算），留一个红点。 */
  const close = useCallback(
    (next: boolean) => {
      if (!next) {
        onBadge?.(phase === 'available' || phase === 'download' || phase === 'ready')
      }
      onOpenChange(next)
    },
    [onBadge, onOpenChange, phase],
  )

  const percent = snapshot?.progress?.percent ?? 0
  const received = snapshot?.progress?.received ?? 0
  const total = snapshot?.progress?.total ?? info?.size ?? 0
  const verifying = snapshot?.state === 'verifying'

  return (
    <ModalFrame
      open={open}
      onOpenChange={close}
      size="sm"
      icon={
        phase === 'error' ? (
          <XCircle className="size-5" />
        ) : (
          <Rocket className="size-5" />
        )
      }
      title={
        phase === 'ready'
          ? t('更新已下载完成')
          : phase === 'download'
            ? t('正在下载更新')
            : phase === 'error'
              ? t('检查更新')
              : t('发现新版本')
      }
      description={
        phase === 'checking'
          ? t('正在联系更新服务…')
          : phase === 'error'
            ? t('更新服务：{url}', { url })
            : info
              ? t('当前版本 {v} → 新版本 {next}（{size}）', {
                  v: version,
                  next: info.version,
                  size: info.size ? formatBytes(info.size) : t('大小未知'),
                })
              : t('正在联系更新服务…')
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {phase === 'available' && (
            <>
              <button
                type="button"
                onClick={() => close(false)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[0.78125rem] text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
              >
                {t('以后再说')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void startDownload()}
                className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
              >
                {busy ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
                {t('立即更新')}
              </button>
            </>
          )}
          {phase === 'download' && (
            <button
              type="button"
              onClick={cancelDownload}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[0.78125rem] text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
            >
              {t('取消下载')}
            </button>
          )}
          {phase === 'ready' && (
            <button
              type="button"
              disabled={busy}
              onClick={restart}
              className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
            >
              {busy ? <Spinner className="size-3.5" /> : <Rocket className="size-3.5" />}
              {t('立即重启并更新')}
            </button>
          )}
          {phase === 'error' && (
            <>
              <button
                type="button"
                onClick={() => close(false)}
                className="inline-flex h-9 items-center rounded-lg px-3 text-[0.78125rem] text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
              >
                {t('关闭')}
              </button>
              {url && (
                <button
                  type="button"
                  onClick={() => setNonce((value) => value + 1)}
                  className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[0.78125rem] font-semibold transition hover:brightness-105"
                >
                  <RefreshCw className="size-3.5" />
                  {t('重新检查')}
                </button>
              )}
            </>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {phase === 'checking' && (
          <p className="flex items-center gap-2 text-[0.78125rem] text-ice-500">
            <Spinner className="size-3.5" />
            {t('正在联系 {url}', { url })}
          </p>
        )}

        {(phase === 'available' || phase === 'download' || phase === 'ready') && info && (
          <>
            {info.notes && (
              <div className="max-h-[220px] overflow-y-auto rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5">
                <Suspense
                  fallback={
                    <p className="whitespace-pre-line text-[0.75rem] leading-relaxed text-ice-500">
                      {info.notes}
                    </p>
                  }
                >
                  <Markdown text={info.notes} />
                </Suspense>
              </div>
            )}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.71875rem]">
              <dt className="text-ice-600">{t('版本号')}</dt>
              <dd className="font-mono text-ice-300">{info.version}</dd>
              <dt className="text-ice-600">{t('文件大小')}</dt>
              <dd className="font-mono text-ice-300">
                {info.size ? formatBytes(info.size) : t('未知')}
              </dd>
              <dt className="text-ice-600">{t('sha256')}</dt>
              <dd className="truncate font-mono text-ice-400" title={info.sha256}>
                {info.sha256 ? `${info.sha256.slice(0, 16)}…` : t('未提供')}
              </dd>
              {info.released_at && (
                <>
                  <dt className="text-ice-600">{t('发布时间')}</dt>
                  <dd className="text-ice-300">{info.released_at}</dd>
                </>
              )}
            </dl>
            {info.mandatory && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[0.71875rem] leading-relaxed text-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {t('该版本被标记为必须更新，建议尽快完成升级。')}
              </p>
            )}
          </>
        )}

        {phase === 'download' && (
          <div className="space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--msv-tint-strong)]">
              <div
                className={cn(
                  'h-full rounded-full bg-[var(--msv-accent)] transition-[width] duration-200',
                  verifying && 'opacity-70',
                )}
                style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[0.6875rem] text-ice-600">
              <span>
                {verifying
                  ? t('正在校验 sha256…')
                  : t('已下载 {done} / {all}', {
                      done: formatBytes(received),
                      all: total ? formatBytes(total) : t('未知'),
                    })}
              </span>
              <span className="font-mono">{percent.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {phase === 'ready' && (
          <p className="flex items-start gap-2 rounded-lg border border-teal-400/25 bg-teal-400/[0.07] px-3 py-2 text-[0.71875rem] leading-relaxed text-teal-100">
            <Rocket className="mt-0.5 size-3.5 shrink-0" />
            {t('新程序已校验通过，保存在数据目录的 updates 文件夹。点击「立即重启并更新」后程序会退出并把新版本就位，约几秒后自动打开新版本；万一窗口没有自动回来，直接双击 MedSafeVault.exe 就是新版本，旧版本留在 MedSafeVault.exe.old。')}
          </p>
        )}

        {phase === 'error' && (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-[0.75rem] leading-relaxed text-rose-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
            {url && (
              <p className="text-[0.6875rem] leading-relaxed text-ice-600">
                {t('更新服务：{url}。请确认服务已启动、终端能访问该地址，并且 versions.json 已登记当前版本之后的版本。', {
                  url,
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </ModalFrame>
  )
}
