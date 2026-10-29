import { useTheme } from '@heroui/react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, api, setLockedListener } from './lib/api'
import { ConfirmProvider } from './lib/confirm'
import { translateServerText, useI18n } from './lib/i18n'
import { toast, Toaster } from './lib/toast'
import type { ConnectResult, Page, PageTemplate, StateInfo, UndoState } from './lib/types'
import { isEditableTarget, throttle } from './lib/utils'
import { BrandMark } from './components/Brand'
import { CloseDialog } from './components/CloseDialog'
import { Header } from './components/Header'
import { HelpDrawer } from './components/HelpDrawer'
import { HistoryDrawer } from './components/HistoryDrawer'
import { LockScreen } from './components/LockScreen'
import { PageDialog } from './components/PageDialog'
import { PageTabs } from './components/PageTabs'
import { RecycleDrawer } from './components/RecycleDrawer'
import { RecoveryDialog } from './components/RecoveryDialog'
import { RecordsPane } from './components/RecordsPane'
import { SettingsDialog } from './components/SettingsDialog'
import { SetupScreen } from './components/SetupScreen'
import { TerminalOverlay, type TerminalTab } from './components/TerminalOverlay'
import { Spinner } from './components/primitives'

type Phase = 'boot' | 'error' | 'setup' | 'locked' | 'ready'
export type ThemeMode = 'system' | 'light' | 'dark'

function BootScreen({ label }: { label: string }) {
  const { t } = useI18n()
  return (
    <div className="vault-bg flex h-full flex-col items-center justify-center gap-5">
      <div className="orb left-[30%] top-[20%] size-[360px] bg-teal-500/10" />
      <div className="orb bottom-[10%] right-[25%] size-[300px] bg-indigo-500/10" />
      <div className="relative z-10 flex flex-col items-center">
        <div className="mint-glow rounded-2xl">
          <BrandMark size="lg" />
        </div>
        <div className="mt-5 font-display text-[1.125rem] font-semibold tracking-tight text-ice-200">
          MedSafe<span className="text-teal-300">Vault</span>
        </div>
        <div className="mt-1 text-[0.71875rem] tracking-[0.16em] text-ice-600">
          {t('医安密管平台')}
        </div>
        <div className="mt-6 flex items-center gap-2 text-[0.71875rem] text-ice-500">
          <Spinner className="size-3.5 text-teal-300" />
          {label}
        </div>
      </div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="vault-bg flex h-full items-center justify-center p-6">
      <div className="panel w-full max-w-[440px] rounded-2xl p-6 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl border border-rose-400/25 bg-rose-400/10 text-rose-300">
          <AlertTriangle className="size-5" />
        </div>
        <h1 className="mt-4 font-display text-[1.125rem] font-semibold text-ice-200">
          {t('无法打开密码库')}
        </h1>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-ice-500">{message}</p>
        <p className="mt-3 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5 text-left text-[0.71875rem] leading-relaxed text-ice-600">
          {t(
            '请确认通过 MedSafeVault.exe 启动，而不是直接打开网页文件。如果问题持续，请检查数据目录是否可写，或关闭杀毒软件的拦截后重试。',
          )}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="btn-primary mt-5 inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold"
        >
          <RefreshCw className="size-3.5" />
          {t('重新加载')}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme('system')
  const [phase, setPhase] = useState<Phase>('boot')
  const [state, setState] = useState<StateInfo | null>(null)
  const [templates, setTemplates] = useState<PageTemplate[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [bootError, setBootError] = useState('')

  const [pageDialog, setPageDialog] = useState<'create' | 'edit' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [recycleOpen, setRecycleOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [closePromptOpen, setClosePromptOpen] = useState(false)

  const themeMode = (theme === 'light' || theme === 'dark' ? theme : 'system') as ThemeMode

  // The vault directory owns the light/dark choice: settings.theme is applied
  // once as soon as the state arrives — so a copied data directory keeps its
  // look on another machine — and every toggle is written straight back.
  const themeSynced = useRef(false)
  useEffect(() => {
    if (themeSynced.current || !state) return
    themeSynced.current = true
    const stored = state.settings.theme
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      if (stored !== themeMode) setTheme(stored)
    }
  }, [state, themeMode, setTheme])

  const applyTheme = useCallback(
    (mode: ThemeMode) => {
      setTheme(mode)
      void api.setSettings({ theme: mode }).catch(() => {
        /* locked or offline: the local choice still applies for this session */
      })
    },
    [setTheme],
  )

  // Layout scale, accent palette and font choices are plain attributes/variables
  // on <html>; all sizes in the app are rem-based, so the root font size acts as
  // a crisp zoom and the accent hue retints every surface.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-ui-scale', state?.settings.ui_scale ?? 'standard')
    root.setAttribute('data-table-font', state?.settings.table_font ?? 'mono')
    root.setAttribute('data-accent', state?.settings.accent ?? 'blue')

    const sans = state?.settings.ui_font
    const mono = state?.settings.code_font
    root.style.setProperty(
      '--msv-font-sans',
      sans
        ? `"${sans}", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif`
        : '',
    )
    root.style.setProperty(
      '--msv-font-mono',
      mono
        ? `"${mono}", Consolas, "Microsoft YaHei Mono", "Microsoft YaHei UI", monospace`
        : '',
    )
  }, [
    state?.settings.ui_scale,
    state?.settings.table_font,
    state?.settings.accent,
    state?.settings.ui_font,
    state?.settings.code_font,
  ])

  const closeOverlays = useCallback(() => {
    setPageDialog(null)
    setHistoryOpen(false)
    setRecycleOpen(false)
    setSettingsOpen(false)
    setRecoveryOpen(false)
  }, [])

  // The backend cannot open a React dialog itself, so clicking the window X
  // calls this hook (see Api.on_window_closing).
  useEffect(() => {
    window.__msvClosePrompt = () => setClosePromptOpen(true)
    return () => {
      window.__msvClosePrompt = undefined
    }
  }, [])

  const handleConnectResult = useCallback((result: ConnectResult) => {
    if (result.transport === 'builtin' && result.session_id) {
      const kind: TerminalTab['kind'] =
        result.kind === 'files' || result.kind === 'vnc' ? result.kind : 'ssh'
      const tab: TerminalTab = {
        key: result.session_id,
        kind,
        protocol: (result.protocol || result.mode || kind).toUpperCase(),
        title: result.title || result.target,
        target: result.target,
        sessionId: result.session_id,
        wsUrl: result.ws_url,
        credentials: result.credentials,
      }
      setTabs((current) => [...current.filter((item) => item.key !== tab.key), tab])
      setActiveTab(tab.key)
      setTerminalOpen(true)
      return
    }
    if (result.transport === 'window' && result.pid != null) {
      // mstsc owns its own window; the tab keeps it one click away.
      const tab: TerminalTab = {
        key: `rdp-${result.pid}`,
        kind: 'rdp',
        protocol: 'RDP',
        title: result.title || result.target,
        target: result.target,
        pid: result.pid,
      }
      setTabs((current) => [...current.filter((item) => item.key !== tab.key), tab])
    }
  }, [])

  const closeTerminalTab = useCallback((tab: TerminalTab) => {
    if (tab.sessionId) void api.sessionClose(tab.sessionId).catch(() => undefined)
    else if (tab.pid != null) void api.rdpClose(tab.pid).catch(() => undefined)
    setTabs((current) => current.filter((item) => item.key !== tab.key))
    setActiveTab((current) => (current === tab.key ? null : current))
  }, [])

  const closeAllTerminalTabs = useCallback(() => {
    for (const tab of tabs) {
      if (tab.sessionId) void api.sessionClose(tab.sessionId).catch(() => undefined)
      else if (tab.pid != null) void api.rdpClose(tab.pid).catch(() => undefined)
    }
    setTabs([])
    setActiveTab(null)
    setTerminalOpen(false)
  }, [tabs])

  const handleSessionLocked = useCallback(() => {
    setState((previous) =>
      previous
        ? { ...previous, locked: true, lock_reason: 'auto', remaining_seconds: 0 }
        : previous,
    )
    setPhase('locked')
    setPages([])
    setActiveId(null)
    setRemaining(0)
    setUndoState(null)
    setTabs([])
    setActiveTab(null)
    setTerminalOpen(false)
    closeOverlays()
  }, [closeOverlays])

  const refreshPages = useCallback(async () => {
    try {
      const result = await api.getPages()
      setPages(result.pages)
      setActiveId((previous) => {
        if (previous && result.pages.some((page) => page.id === previous)) return previous
        return result.pages[0]?.id ?? null
      })
      return result.pages
    } catch (error) {
      if (error instanceof ApiError && error.locked) {
        handleSessionLocked()
        return []
      }
      toast.error(
        t('无法加载页面'),
        error instanceof ApiError ? error.message : t('请稍后重试'),
      )
      return []
    }
  }, [handleSessionLocked, t])

  const loadWorkspace = useCallback(async () => {
    setWorkspaceLoading(true)
    try {
      await refreshPages()
    } finally {
      setWorkspaceLoading(false)
    }
  }, [refreshPages])

  const handleUnlocked = useCallback(
    (next: StateInfo) => {
      setState(next)
      setPhase('ready')
      setRemaining(next.auto_lock_minutes > 0 ? next.auto_lock_minutes * 60 : null)
      setRecoveryOpen(false)
      void loadWorkspace()
    },
    [loadWorkspace],
  )

  useEffect(() => {
    let cancelled = false
    api
      .bootstrap()
      .then((data) => {
        if (cancelled) return
        setTemplates(data.templates)
        setState(data.state)
        if (!data.state.initialized) {
          setPhase('setup')
        } else if (data.state.locked) {
          setPhase('locked')
        } else {
          setPhase('ready')
          setRemaining(
            data.state.auto_lock_minutes > 0 ? data.state.auto_lock_minutes * 60 : null,
          )
          void loadWorkspace()
        }
      })
      .catch((error) => {
        if (cancelled) return
        setBootError(
          error instanceof ApiError ? error.message : t('本地服务初始化失败'),
        )
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [loadWorkspace, t])

  useEffect(() => {
    setLockedListener(handleSessionLocked)
    return () => setLockedListener(null)
  }, [handleSessionLocked])

  useEffect(() => {
    window.__msvNativeMessage = (title, message) => toast.info(title, message)
    return () => {
      window.__msvNativeMessage = undefined
    }
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return
    let collapsed = false
    const check = async () => {
      try {
        const result = await api.heartbeat()
        if (collapsed) return
        if (result.locked) {
          handleSessionLocked()
          return
        }
        setRemaining(result.remaining_seconds)
      } catch (error) {
        if (error instanceof ApiError && error.locked) handleSessionLocked()
      }
    }
    void check()
    const timer = window.setInterval(check, 10_000)
    const tick = window.setInterval(() => {
      setRemaining((value) => (value == null ? null : Math.max(0, value - 1)))
    }, 1000)
    const onActivity = throttle(() => {
      api
        .activity()
        .then((result) => {
          if (collapsed) return
          if (result.locked) handleSessionLocked()
          else setRemaining(result.remaining_seconds)
        })
        .catch((error) => {
          if (error instanceof ApiError && error.locked) handleSessionLocked()
        })
    }, 6000)
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity)
    window.addEventListener('wheel', onActivity, { passive: true })
    return () => {
      collapsed = true
      window.clearInterval(timer)
      window.clearInterval(tick)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      window.removeEventListener('wheel', onActivity)
    }
  }, [phase, handleSessionLocked])

  useEffect(() => {
    if (phase !== 'ready') return
    let cancelled = false
    api
      .getHistory(0, 1, 'all', '')
      .then((result) => {
        if (!cancelled) setUndoState(result.undo_state)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [phase, dataVersion])

  const notifyChanged = useCallback(() => {
    setDataVersion((value) => value + 1)
    void refreshPages()
  }, [refreshPages])

  const runUndo = useCallback(async () => {
    if (undoBusy) return
    setUndoBusy(true)
    try {
      const result = await api.undo()
      toast.success(t('操作已撤回'), translateServerText(result.message))
      setUndoState(result.undo_state)
      notifyChanged()
    } catch (error) {
      toast.error(t('撤回失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setUndoBusy(false)
    }
  }, [undoBusy, notifyChanged, t])

  const runRedo = useCallback(async () => {
    if (undoBusy) return
    setUndoBusy(true)
    try {
      const result = await api.redo()
      toast.success(t('操作已恢复'), translateServerText(result.message))
      setUndoState(result.undo_state)
      notifyChanged()
    } catch (error) {
      toast.error(t('重做失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setUndoBusy(false)
    }
  }, [undoBusy, notifyChanged, t])

  useEffect(() => {
    if (phase !== 'ready') return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) void runRedo()
        else void runUndo()
      } else if (key === 'y') {
        event.preventDefault()
        void runRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, runUndo, runRedo])

  async function lockNow() {
    try {
      const result = await api.lock()
      setState(result.state)
      setPhase('locked')
      setPages([])
      setActiveId(null)
      setRemaining(0)
      setUndoState(null)
      setTabs([])
      setActiveTab(null)
      setTerminalOpen(false)
      closeOverlays()
    } catch (error) {
      toast.error(t('锁定失败'), error instanceof ApiError ? error.message : t('请重试'))
      handleSessionLocked()
    }
  }

  async function quitApp() {
    try {
      await api.quit()
    } catch {
      /* window is closing */
    }
  }

  const activePage = pages.find((page) => page.id === activeId) ?? pages[0] ?? null

  let content: ReactNode
  if (phase === 'boot') {
    content = <BootScreen label={t('正在打开本地保险库…')} />
  } else if (phase === 'error') {
    content = <ErrorScreen message={bootError} onRetry={() => window.location.reload()} />
  } else if (phase === 'setup') {
    content = (
      <SetupScreen
        version={state?.version ?? ''}
        onReady={handleUnlocked}
        onQuit={quitApp}
        onHelp={() => setHelpOpen(true)}
      />
    )
  } else if (phase === 'locked' || !state) {
    content = state ? (
      <LockScreen
        state={state}
        onUnlocked={handleUnlocked}
        onRecovery={() => setRecoveryOpen(true)}
        onQuit={quitApp}
        onHelp={() => setHelpOpen(true)}
      />
    ) : (
      <BootScreen label={t('正在读取密码库状态…')} />
    )
  } else {
    content = (
      <div className="vault-bg relative flex h-full flex-col overflow-hidden">
        <div className="orb pointer-events-none left-[-6%] top-[-14%] size-[380px] bg-teal-500/[0.07]" />
        <div className="orb pointer-events-none bottom-[-18%] right-[-4%] size-[360px] bg-indigo-500/[0.07]" />

        <Header
          state={state}
          remaining={remaining}
          undoState={undoState}
          theme={themeMode}
          onTheme={applyTheme}
          locale={locale}
          onLocale={setLocale}
          onUndo={() => void runUndo()}
          onRedo={() => void runRedo()}
          onHistory={() => setHistoryOpen(true)}
          onRecycle={() => setRecycleOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onHelp={() => setHelpOpen(true)}
          onLock={lockNow}
          sessionCount={tabs.length}
          terminalOpen={terminalOpen}
          onTerminal={() => setTerminalOpen((value) => !value)}
        />

        <PageTabs
          pages={pages}
          activeId={activePage?.id ?? null}
          onSelect={setActiveId}
          onAdd={() => setPageDialog('create')}
        />

        <main className="relative z-10 min-h-0 flex-1 p-2.5 sm:p-3.5">
          {workspaceLoading && pages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-[0.71875rem] text-ice-500">
                <Spinner className="size-5 text-teal-300" />
                {t('正在解开页面与记录…')}
              </div>
            </div>
          ) : (
            <RecordsPane
              key={activePage?.id ?? 'empty'}
              page={activePage}
              refreshToken={dataVersion}
              compact={state.settings.compact_rows}
              onChanged={notifyChanged}
              onEditPage={() => setPageDialog('edit')}
              onAddPage={() => setPageDialog('create')}
              onConnectResult={handleConnectResult}
            />
          )}
        </main>

        <PageDialog
          open={pageDialog !== null}
          mode={pageDialog === 'edit' ? 'edit' : 'create'}
          page={pageDialog === 'edit' ? activePage : null}
          templates={templates}
          onOpenChange={(open) => {
            if (!open) setPageDialog(null)
          }}
          onSaved={(page, mode) => {
            notifyChanged()
            if (mode === 'create') setActiveId(page.id)
          }}
          onDeleted={() => notifyChanged()}
        />

        <HistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          onChanged={notifyChanged}
          externalRefresh={dataVersion}
        />

        <RecycleDrawer
          open={recycleOpen}
          onOpenChange={setRecycleOpen}
          onChanged={notifyChanged}
          onPageRestored={(pageId) => {
            setActiveId(pageId)
            notifyChanged()
          }}
        />

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          state={state}
          theme={themeMode}
          onTheme={applyTheme}
          locale={locale}
          onLocale={setLocale}
          onSettings={(settings) => {
            setState((previous) =>
              previous
                ? { ...previous, settings, auto_lock_minutes: settings.auto_lock_minutes }
                : previous,
            )
            setRemaining(settings.auto_lock_minutes > 0 ? settings.auto_lock_minutes * 60 : null)
            setDataVersion((value) => value + 1)
          }}
          onRestored={(next) => {
            setState(next)
            setPhase('ready')
            setRemaining(next.auto_lock_minutes > 0 ? next.auto_lock_minutes * 60 : null)
            setDataVersion((value) => value + 1)
            void loadWorkspace()
          }}
        />

        <TerminalOverlay
          open={terminalOpen}
          tabs={tabs}
          activeKey={activeTab}
          onActive={setActiveTab}
          onCollapse={() => setTerminalOpen(false)}
          onCloseTab={closeTerminalTab}
          onCloseAll={closeAllTerminalTabs}
        />
      </div>
    )
  }

  return (
    <ConfirmProvider>
      {content}
      <RecoveryDialog
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
        onRecovered={handleUnlocked}
      />
      <HelpDrawer
        open={helpOpen}
        onOpenChange={setHelpOpen}
        version={state?.version ?? ''}
        onOpenSettings={
          phase === 'ready'
            ? () => {
                setHelpOpen(false)
                setSettingsOpen(true)
              }
            : undefined
        }
      />
      <CloseDialog
        open={closePromptOpen}
        onOpenChange={setClosePromptOpen}
        defaultAction={state?.settings.close_action ?? 'tray'}
      />
      <Toaster />
    </ConfirmProvider>
  )
}
