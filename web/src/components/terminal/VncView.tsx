import RFB from '@novnc/novnc/lib/rfb.js'
import { Maximize2, MonitorX, RefreshCw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { cn } from '../../lib/utils'

type Status = 'connecting' | 'connected' | 'disconnected' | 'error'

/**
 * noVNC renders the remote screen inside the overlay. The WebSocket points at
 * the local relay in sessions.py, which forwards bytes to the VNC server, so
 * the VNC password never appears in a URL or in noVNC's own prompt.
 */
export function VncView({
  wsUrl,
  target,
  credentials,
  active,
}: {
  wsUrl: string
  target: string
  credentials?: { username: string; password: string }
  active: boolean
}) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  const credentialsRef = useRef(credentials)
  credentialsRef.current = credentials

  const connect = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    rfbRef.current?.disconnect()
    host.replaceChildren()
    setStatus('connecting')
    setMessage('')
    let rfb: RFB
    try {
      rfb = new RFB(host, wsUrl, {
        shared: true,
        credentials: {
          username: credentialsRef.current?.username || undefined,
          password: credentialsRef.current?.password || undefined,
        },
      })
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t('无法连接 VNC'))
      return
    }
    rfb.scaleViewport = true
    rfb.resizeSession = true
    rfb.background = '#070b12'
    rfb.addEventListener('connect', () => {
      setStatus('connected')
      rfb.focus()
    })
    rfb.addEventListener('credentialsrequired', () => {
      rfb.sendCredentials({
        username: credentialsRef.current?.username || undefined,
        password: credentialsRef.current?.password || undefined,
      })
    })
    rfb.addEventListener('securityfailure', (event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail
      setStatus('error')
      setMessage(detail?.reason || t('VNC 认证失败，请检查密码或服务器设置'))
    })
    rfb.addEventListener('disconnect', (event) => {
      const detail = (event as CustomEvent<{ clean?: boolean }>).detail
      setStatus((current) => (current === 'error' ? current : 'disconnected'))
      if (!detail?.clean) setMessage((current) => current || t('与 VNC 服务器的连接已断开'))
    })
    rfbRef.current = rfb
  }, [t, wsUrl])

  useEffect(() => {
    connect()
    return () => {
      try {
        rfbRef.current?.disconnect()
      } catch {
        /* ignore */
      }
      rfbRef.current = null
    }
  }, [connect, attempt])

  // The relay session is closed by the backend on exit and cannot be revived.
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => {
      try {
        rfbRef.current?.focus()
      } catch {
        /* ignore */
      }
    }, 120)
    return () => window.clearTimeout(timer)
  }, [active])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            status === 'connected'
              ? 'bg-emerald-400'
              : status === 'connecting'
                ? 'bg-amber-400'
                : 'bg-rose-400',
          )}
        />
        <span className="text-[0.6875rem] text-ice-500">
          {status === 'connected'
            ? t('已连接 {target}', { target })
            : status === 'connecting'
              ? t('正在连接 {target}…', { target })
              : status === 'error'
                ? t('连接失败')
                : t('已断开')}
        </span>
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1 text-[0.65625rem] text-ice-600">
          <ShieldCheck className="size-3" />
          {t('经本机代理转发')}
        </span>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
        >
          <RefreshCw className="size-3" />
          {t('重新连接')}
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              rfbRef.current?.focus()
              rfbRef.current?.sendCtrlAltDel()
            } catch {
              /* ignore */
            }
          }}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
        >
          <Maximize2 className="size-3" />
          {t('发送 Ctrl+Alt+Del')}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl bg-[#070b12]">
        <div ref={hostRef} className="absolute inset-0" />
        {status !== 'connected' && (
          <div className="absolute inset-0 grid place-items-center bg-[#070b12]/85 p-6">
            <div className="max-w-md text-center">
              <MonitorX
                className={cn(
                  'mx-auto mb-3 size-8',
                  status === 'error' ? 'text-rose-300' : 'text-ice-500',
                )}
              />
              <div className="text-[0.8125rem] text-ice-300">
                {status === 'connecting' ? t('正在建立 VNC 画面…') : message || t('VNC 画面不可用')}
              </div>
              {status !== 'connecting' && (
                <button
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[0.71875rem] text-ice-300 transition hover:bg-[var(--msv-tint)]"
                >
                  <RefreshCw className="size-3.5" />
                  {t('重新连接')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
