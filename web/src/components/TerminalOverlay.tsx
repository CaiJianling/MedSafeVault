import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  FolderSync,
  MonitorPlay,
  Power,
  SquareTerminal,
  Wifi,
  X,
  ChevronsDown,
} from 'lucide-react'
import { useConfirm } from '../lib/confirm'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'
import { FileBrowser } from './terminal/FileBrowser'
import { RdpPane } from './terminal/RdpPane'
import { SshTerminal } from './terminal/SshTerminal'
import { VncView } from './terminal/VncView'

export type TerminalKind = 'ssh' | 'files' | 'vnc' | 'rdp'

export interface TerminalTab {
  key: string
  kind: TerminalKind
  protocol: string
  title: string
  target: string
  sessionId?: string
  wsUrl?: string
  pid?: number
  credentials?: { username: string; password: string }
}

/** Durations live here because the CSS keyframes end a little earlier. */
const OPEN_MS = 420
const CLOSE_MS = 300

type OverlayPhase = 'closed' | 'opening' | 'open' | 'closing'

interface Ripple {
  x: number
  y: number
  r: number
}

/** The header button is the anchor the workspace collapses back into. */
function terminalButtonCenter(): { x: number; y: number } {
  const button = document.querySelector<HTMLElement>('[aria-label="连接终端"]')
  const rect = button?.getBoundingClientRect()
  if (rect && rect.width > 0) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  return { x: window.innerWidth - 40, y: 36 }
}

/** Radius reaches the farthest viewport corner, so the circle covers the screen. */
function rippleAt(point: { x: number; y: number }): Ripple {
  const x = Math.min(Math.max(point.x, 0), window.innerWidth)
  const y = Math.min(Math.max(point.y, 0), window.innerHeight)
  const r =
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 24
  return { x, y, r }
}

function TabIcon({ tab, className }: { tab: TerminalTab; className?: string }) {
  if (tab.kind === 'ssh') return <SquareTerminal className={className} />
  if (tab.kind === 'files') return <FolderSync className={className} />
  return <MonitorPlay className={className} />
}

/**
 * Full-window terminal workspace. The overlay itself only hides when collapsed;
 * sessions stay alive on the backend and the tabs keep their buffers, so
 * reopening from the header button returns to exactly the same screen.
 */
export function TerminalOverlay({
  open,
  tabs,
  activeKey,
  onActive,
  onCollapse,
  onCloseTab,
  onCloseAll,
}: {
  open: boolean
  tabs: TerminalTab[]
  activeKey: string | null
  onActive: (key: string) => void
  onCollapse: () => void
  onCloseTab: (tab: TerminalTab) => void
  onCloseAll: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0] ?? null

  // The workspace stays mounted (sessions keep running), so the reveal is
  // driven by a small state machine instead of mount/unmount animations.
  const [phase, setPhase] = useState<OverlayPhase>(open ? 'opening' : 'closed')
  const [ripple, setRipple] = useState<Ripple>(() => rippleAt(terminalButtonCenter()))
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const wasOpen = useRef(open)

  useEffect(() => {
    const track = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointerdown', track, { capture: true, passive: true })
    return () => window.removeEventListener('pointerdown', track, { capture: true })
  }, [])

  useEffect(() => {
    if (open === wasOpen.current) return
    wasOpen.current = open
    if (open) {
      // Grow from the click that opened the workspace: the row's connect menu
      // or the header terminal button.
      setRipple(rippleAt(pointer.current ?? terminalButtonCenter()))
      setPhase('opening')
    } else {
      // Shrink back into the button the workspace belongs to.
      setRipple(rippleAt(terminalButtonCenter()))
      setPhase((current) => (current === 'closed' ? current : 'closing'))
    }
  }, [open])

  useEffect(() => {
    if (phase === 'opening') {
      const timer = window.setTimeout(() => setPhase('open'), OPEN_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'closing') {
      const timer = window.setTimeout(() => setPhase('closed'), CLOSE_MS)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [phase])

  const rippleStyle = {
    '--msv-rip-x': `${ripple.x}px`,
    '--msv-rip-y': `${ripple.y}px`,
    '--msv-rip-r': `${ripple.r}px`,
  } as CSSProperties

  async function closeTab(tab: TerminalTab) {
    if (tab.kind === 'rdp') {
      const ok = await confirm({
        title: t('结束这个远程桌面？'),
        description: t('关闭标签页会同时关闭 mstsc 窗口，未保存的远程操作会丢失。'),
        confirmText: t('关闭远程桌面'),
        tone: 'danger',
      })
      if (!ok) return
    }
    onCloseTab(tab)
  }

  async function closeAll() {
    if (!tabs.length) return
    const ok = await confirm({
      title: t('关闭全部连接？'),
      description: t('{n} 个标签页会被逐个结束，终端缓冲区同时清除。', { n: tabs.length }),
      confirmText: t('全部关闭'),
      tone: 'danger',
    })
    if (!ok) return
    onCloseAll()
  }

  return (
    <div
      style={rippleStyle}
      className={cn(
        'fixed inset-0 z-[70]',
        phase === 'closed' && 'pointer-events-none invisible',
        phase === 'closing' && 'pointer-events-none',
        (phase === 'opening' || phase === 'open') && 'pointer-events-auto',
      )}
      aria-hidden={phase === 'closed' || phase === 'closing'}
    >
      {/* Scrim fades while the workspace surface itself grows/shrinks, so the
          opening reads as a ripple from the trigger instead of a black disc. */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 bg-[#03060c]/80 backdrop-blur-sm',
          phase === 'opening' && 'terminal-scrim-in',
          phase === 'closing' && 'terminal-scrim-out',
        )}
      />
      <div
        className={cn(
          'absolute inset-0 flex flex-col p-0 sm:p-3',
          phase === 'opening' && 'terminal-ripple-in',
          phase === 'closing' && 'terminal-ripple-out',
        )}
      >
        <section
          className={cn(
            'flex h-full min-h-0 flex-col overflow-hidden border border-line bg-[var(--msv-surface-soft)] shadow-[0_30px_80px_-20px_rgba(0,0,0,.75)] sm:rounded-2xl',
            phase === 'opening' && 'terminal-panel-in',
            phase === 'closing' && 'terminal-panel-out',
          )}
        >
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ice-200">
            <Wifi className="size-4 text-[var(--msv-accent-text)]" />
            {t('连接终端')}
          </span>
          <span className="rounded-full border border-line px-1.5 py-px font-mono text-[0.65625rem] text-ice-500">
            {tabs.length}
          </span>
          <span className="hidden text-[0.6875rem] text-ice-600 lg:inline">
            {t('会话仅在内存中，锁定密码库会全部断开')}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void closeAll()}
            disabled={!tabs.length}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--msv-danger-text)_30%,transparent)] px-2 text-[0.6875rem] text-[var(--msv-danger-text)] transition hover:bg-[color-mix(in_srgb,var(--msv-danger-text)_10%,transparent)] disabled:opacity-40"
          >
            <Power className="size-3" />
            {t('全部关闭')}
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[0.6875rem] text-ice-300 transition hover:border-line-strong hover:bg-[var(--msv-tint)]"
          >
            <ChevronsDown className="size-3.5" />
            {t('收起到终端按钮')}
          </button>
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t('收起到终端按钮')}
            className="grid size-7 place-items-center rounded-md text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
          >
            <X className="size-4" />
          </button>
        </header>

        {tabs.length > 0 && (
          <div className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-line px-2 pt-1.5">
            {tabs.map((tab) => {
              const isActive = active?.key === tab.key
              return (
                <div
                  key={tab.key}
                  className={cn(
                    'group/tab flex h-8 shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 text-[0.71875rem] transition',
                    isActive
                      ? 'border-line bg-[var(--msv-surface)] text-ice-200'
                      : 'border-transparent text-ice-500 hover:text-ice-300',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onActive(tab.key)}
                    className="inline-flex min-w-0 max-w-[220px] items-center gap-1.5"
                    title={tab.title}
                  >
                    <TabIcon tab={tab} className="size-3.5 shrink-0 text-[var(--msv-accent-text)]" />
                    <span className="truncate">{tab.title}</span>
                    <span className="shrink-0 rounded bg-[var(--msv-tint-strong)] px-1 font-mono text-[0.59375rem] uppercase text-ice-500">
                      {tab.protocol || tab.kind}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('关闭标签页')}
                    onClick={() => void closeTab(tab)}
                    className="grid size-4 shrink-0 place-items-center rounded text-ice-600 transition hover:bg-[color-mix(in_srgb,var(--msv-danger-text)_12%,transparent)] hover:text-[var(--msv-danger-text)]"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          {tabs.length === 0 ? (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <SquareTerminal className="mx-auto mb-3 size-9 text-ice-600" />
                <div className="text-[0.8125rem] text-ice-400">{t('还没有打开任何连接')}</div>
                <p className="mt-1.5 text-[0.71875rem] leading-relaxed text-ice-600">
                  {t('在记录列表中点击连接按钮，选择 SSH、FTP、SFTP、VNC 或 RDP 即可在这里打开标签页。')}
                </p>
              </div>
            </div>
          ) : (
            tabs.map((tab) => {
              const isActive = active?.key === tab.key
              return (
                <div
                  key={tab.key}
                  className={cn('absolute inset-0 min-h-0 p-2', isActive ? 'block' : 'hidden')}
                >
                  {tab.kind === 'ssh' && tab.sessionId ? (
                    <SshTerminal
                      sessionId={tab.sessionId}
                      active={isActive}
                      onClosed={() => undefined}
                    />
                  ) : tab.kind === 'files' && tab.sessionId ? (
                    <FileBrowser
                      sessionId={tab.sessionId}
                      protocol={tab.protocol}
                      title={tab.title}
                    />
                  ) : tab.kind === 'vnc' && tab.wsUrl ? (
                    <VncView
                      wsUrl={tab.wsUrl}
                      target={tab.target}
                      credentials={tab.credentials}
                      active={isActive}
                    />
                  ) : tab.kind === 'rdp' && tab.pid != null ? (
                    <RdpPane pid={tab.pid} target={tab.target} title={tab.title} />
                  ) : (
                    <div className="grid h-full place-items-center text-[0.75rem] text-ice-500">
                      {t('会话信息不完整，请关闭这个标签页后重新连接')}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
        </section>
      </div>
    </div>
  )
}
