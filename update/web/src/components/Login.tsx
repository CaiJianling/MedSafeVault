import { Button } from '@heroui/react'
import { KeyRound, Loader2, ShieldCheck, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage } from '../lib/api'
import type { Info } from '../lib/api'
import { ThemeControl } from './ThemeControl'
import { Field, Spinner } from './primitives'

/** 登录页：账号口令 + 这个服务当前的最新版，让操作者输口令前先确认连对了机器。 */
export function Login({
  info,
  onLoggedIn,
}: {
  info: Info | null
  onLoggedIn: (username: string, mustChangePassword: boolean) => void
}) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstField.current?.focus()
    const timer = window.setInterval(() => setRetry((value) => value - 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  async function submit() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api.login(username.trim(), password)
      setPassword('')
      onLoggedIn(result.username, result.must_change_password)
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setRetry(Number(error.extra.retry_after || 300))
      }
      setError(errorMessage(error, '登录失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vault-bg flex min-h-screen items-center justify-center px-4 py-10">
      {/* 登录前也能选主题：三档控件和顶栏那颗是同一个组件。 */}
      <ThemeControl className="absolute right-4 top-4" />

      <div className="adm-rise panel w-full max-w-[26rem] rounded-2xl">
        <div className="flex items-center gap-3 border-b border-line px-6 py-5">
          <span className="brand-mark flex size-10 items-center justify-center rounded-xl">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[0.9375rem] font-medium text-ice-200">
              {info?.service || 'MedSafeVault 更新服务'}
            </h1>
            <p className="mt-0.5 text-[0.75rem] text-ice-600">
              管理后台 · 登录后才能发布版本
            </p>
          </div>
        </div>

        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label="账号" htmlFor="login-user">
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ice-600" />
              <input
                id="login-user"
                ref={firstField}
                className="msv-input pl-9"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </Field>

          <Field label="口令" htmlFor="login-pass">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ice-600" />
              <input
                id="login-pass"
                type="password"
                className="msv-input pl-9"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </Field>

          {error ? (
            <div className="adm-note adm-note-danger" role="alert">
              {error}
            </div>
          ) : null}

          {retry > 0 ? (
            <div className="adm-note adm-note-amber">
              <Loader2 className="mt-0.5 size-3.5 animate-spin" />
              <span>失败次数过多，约 {retry} 秒后可以再试。</span>
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isDisabled={busy || !username || !password || retry > 0}
          >
            {busy ? <Spinner className="mr-1.5" /> : null}
            登录
          </Button>
        </form>

        <div className="border-t border-line px-6 py-4 text-[0.71875rem] leading-relaxed text-ice-600">
          {info ? (
            <>
              当前最新
              <span className="mx-1 font-mono text-ice-300">{info.latest || '（还没有版本）'}</span>
              · 已登记 {info.releases} 个版本 · 端口 {info.listening?.port || '—'}
            </>
          ) : (
            <>读不到服务信息，请确认这台机器上的 update/server.py 已经在跑。</>
          )}
        </div>
      </div>
    </div>
  )
}
