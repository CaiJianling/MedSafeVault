import { Button } from '@heroui/react'
import { LogOut, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  api,
  ApiError,
  errorMessage,
  type DiskFile,
  type Info,
  type Release,
  type Summary,
} from './lib/api'
import { applyTheme, currentTheme } from './lib/theme'
import { toast, ToastHost } from './lib/toast'
import { AccountCard } from './components/AccountCard'
import { AddressCard } from './components/AddressCard'
import { AuditCard } from './components/AuditCard'
import { Login } from './components/Login'
import { PublishForm } from './components/PublishForm'
import { ReleaseTable } from './components/ReleaseTable'
import { Chip } from './components/primitives'

export default function App() {
  const [info, setInfo] = useState<Info | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [releases, setReleases] = useState<Release[]>([])
  const [files, setFiles] = useState<DiskFile[]>([])
  const [username, setUsername] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [booting, setBooting] = useState(true)
  const [fatal, setFatal] = useState('')
  const [signal, setSignal] = useState(0)
  const [dark, setDark] = useState(currentTheme() === 'dark')

  const refresh = useCallback(async () => {
    const [session, releaseList, diskFiles] = await Promise.all([
      api.session(),
      api.releases(),
      api.files(),
    ])
    setSummary(session)
    setReleases(releaseList.releases)
    setFiles(diskFiles.files)
    setUsername(session.username)
    setSignedIn(true)
    setFatal('')
    setSignal((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await api.info()
        if (!cancelled) setInfo(payload)
      } catch (error) {
        if (!cancelled) setFatal(errorMessage(error, '连不上更新服务'))
      }
      try {
        await refresh()
      } catch (error) {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          setFatal(errorMessage(error, '读不到服务信息'))
        }
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setDark(next === 'dark')
  }

  async function signOut() {
    try {
      await api.logout()
    } catch {
      /* 已经过期也无所谓，下面照样回到登录页 */
    }
    setSignedIn(false)
    setSummary(null)
    setReleases([])
    setFiles([])
    toast('已退出登录')
  }

  if (booting) {
    return (
      <div className="vault-bg flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-[0.8125rem] text-ice-500">
          <span className="brand-mark flex size-9 items-center justify-center rounded-xl">
            <ShieldCheck className="size-4" />
          </span>
          正在连接更新服务…
        </div>
      </div>
    )
  }

  if (!signedIn) {
    return (
      <>
        <Login
          info={info}
          onToggleTheme={toggleTheme}
          onLoggedIn={(name, mustChange) => {
            setUsername(name)
            void refresh().then(() => {
              if (mustChange) {
                toast.danger('这是首次生成的初始口令，请在「账号与服务」里改掉')
              } else {
                toast.success(`欢迎回来，${name}`)
              }
            })
          }}
        />
        <ToastHost />
      </>
    )
  }

  const latest = info?.latest || summary?.latest || ''

  return (
    <div className="vault-bg min-h-screen">
      <header className="glass-bar admin-head sticky top-0 z-30">
        <div className="flex min-w-0 items-center gap-3">
          <span className="brand-mark flex size-9 shrink-0 items-center justify-center rounded-xl">
            <ShieldCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[0.875rem] font-medium text-ice-200">
              {summary?.service || info?.service || 'MedSafeVault 更新服务'}
            </h1>
            <p className="mt-0.5 truncate text-[0.6875rem] text-ice-600">
              管理后台 · {summary?.app_version ? `桌面端 ${summary.app_version} · ` : ''}
              最新 {latest || '（无）'}
            </p>
          </div>
          <Chip tone="mint" className="ml-1 hidden sm:inline-flex">
            {releases.length} 个版本
          </Chip>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[0.75rem] text-ice-500 md:inline">{username}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={dark ? '切换到亮色' : '切换到暗色'}
            className="size-8 min-w-8 rounded-lg text-ice-500"
            onPress={toggleTheme}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void signOut()}
            className="min-w-0"
          >
            <LogOut className="mr-1.5 size-3.5" />
            退出
          </Button>
        </div>
      </header>

      {fatal ? (
        <div className="admin-wrap">
          <div className="adm-note adm-note-danger">{fatal}</div>
        </div>
      ) : null}

      <main className="admin-wrap grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="adm-rise min-w-0 space-y-4">
          <AddressCard info={info} count={releases.length} latest={latest} />
          <ReleaseTable releases={releases} onChanged={() => void refresh()} />
        </div>
        <div className="adm-rise space-y-4 lg:sticky lg:top-[4.75rem]">
          <PublishForm
            files={files}
            appVersion={summary?.app_version || info?.app_version || ''}
            onPublished={(message) => {
              toast.success(message)
              void refresh()
            }}
          />
          <AccountCard summary={summary} username={username} onChanged={() => void refresh()} />
          <AuditCard signal={signal} />
        </div>
      </main>

      <footer className="admin-wrap pt-1 text-[0.6875rem] leading-relaxed text-ice-600">
        版本表写在 <code className="font-mono text-ice-500">versions.json</code>，
        软件放在 <code className="font-mono text-ice-500">files/</code>；
        命令行登记可用 <code className="font-mono text-ice-500">python update/make_release.py</code>。
      </footer>
      <ToastHost />
    </div>
  )
}
