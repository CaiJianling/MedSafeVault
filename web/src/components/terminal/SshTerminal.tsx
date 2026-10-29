import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ClipboardCopy, Eraser, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, copyText } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { cn } from '../../lib/utils'

/**
 * xterm.js view over one backend SSH channel. Output is polled with a byte
 * cursor, so re-rendering or collapsing the overlay never loses or repeats
 * data; input is batched to keep the bridge quiet while typing fast.
 */
export function SshTerminal({
  sessionId,
  active,
  onClosed,
}: {
  sessionId: string
  active: boolean
  onClosed: (reason: string) => void
}) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [notice, setNotice] = useState('')
  const closedRef = useRef(onClosed)
  closedRef.current = onClosed

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Consolas", "Microsoft YaHei Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: true,
      theme: {
        background: '#070b12',
        foreground: '#cbd5e1',
        cursor: '#2dd4bf',
        selectionBackground: '#155e75',
        black: '#0b1220',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    let stopped = false
    let cursor = 0
    let pendingInput = ''
    let sending = false
    let inputTimer: number | undefined

    const pushResize = () => {
      if (stopped || !fitRef.current) return
      try {
        fit.fit()
        void api.terminalResize(sessionId, term.cols, term.rows).catch(() => undefined)
      } catch {
        /* the panel can be zero-sized while collapsed */
      }
    }

    const flushInput = async () => {
      if (sending || !pendingInput) return
      const data = pendingInput
      pendingInput = ''
      sending = true
      try {
        await api.terminalWrite(sessionId, data)
        // Typing is a real user action: keep the vault from auto-locking.
        void api.activity().catch(() => undefined)
      } catch (error) {
        setStatus('closed')
        setNotice(error instanceof ApiError ? error.message : t('无法发送输入'))
      } finally {
        sending = false
        if (pendingInput) void flushInput()
      }
    }

    const dataListener = term.onData((data) => {
      pendingInput += data
      if (inputTimer) return
      inputTimer = window.setTimeout(() => {
        inputTimer = undefined
        void flushInput()
      }, 16)
    })

    const readLoop = async () => {
      if (stopped) return
      try {
        const result = await api.terminalRead(sessionId, cursor)
        if (stopped) return
        if (result.data) term.write(result.data)
        cursor = result.cursor
        if (result.closed) {
          setStatus('closed')
          setNotice(result.error || t('会话已结束'))
          closedRef.current(result.error || t('会话已结束'))
          return
        }
        setStatus('open')
      } catch (error) {
        if (stopped) return
        if (error instanceof ApiError && error.locked) return
        setStatus('closed')
        setNotice(error instanceof ApiError ? error.message : t('终端连接已断开'))
        return
      }
      if (!stopped) window.setTimeout(readLoop, 120)
    }

    const observer = new ResizeObserver(() => pushResize())
    observer.observe(host)
    window.setTimeout(() => {
      pushResize()
      void readLoop()
    }, 30)

    return () => {
      stopped = true
      observer.disconnect()
      if (inputTimer) window.clearTimeout(inputTimer)
      dataListener.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId, t])

  // Refit when the overlay is shown again; a hidden panel cannot measure.
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit()
        const term = termRef.current
        if (term) void api.terminalResize(sessionId, term.cols, term.rows).catch(() => undefined)
      } catch {
        /* ignore */
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [active, sessionId])

  async function copySelection() {
    const selected = termRef.current?.getSelection() ?? ''
    if (!selected) {
      toast.info(t('请先选中要复制的文字'))
      return
    }
    await copyText(selected)
    toast.success(t('已复制选中内容'))
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-line bg-[#070b12]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            status === 'open' ? 'bg-emerald-400' : status === 'closed' ? 'bg-rose-400' : 'bg-amber-400',
          )}
        />
        <span className="text-[0.6875rem] text-ice-500">
          {status === 'open' ? t('已连接') : status === 'closed' ? t('已断开') : t('正在连接…')}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void copySelection()}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-ice-500 transition hover:bg-white/[0.06] hover:text-ice-200"
        >
          <ClipboardCopy className="size-3" />
          {t('复制选中')}
        </button>
        <button
          type="button"
          onClick={() => termRef.current?.clear()}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-ice-500 transition hover:bg-white/[0.06] hover:text-ice-200"
        >
          <Eraser className="size-3" />
          {t('清屏')}
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              fitRef.current?.fit()
            } catch {
              /* ignore */
            }
          }}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-ice-500 transition hover:bg-white/[0.06] hover:text-ice-200"
        >
          <RotateCw className="size-3" />
          {t('适配窗口')}
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1.5" />
      {status === 'closed' && (
        <div className="shrink-0 border-t border-rose-400/20 bg-rose-400/[0.06] px-3 py-1.5 text-[0.6875rem] text-rose-200">
          {notice || t('会话已结束')} · {t('关闭此标签页会清除上面的屏幕内容')}
        </div>
      )}
    </div>
  )
}
