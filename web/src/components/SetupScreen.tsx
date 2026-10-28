import {
  ArrowRight,
  Check,
  CircleHelp,
  Eye,
  EyeOff,
  FileKey2,
  KeyRound,
  LockKeyhole,
  Power,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { RecoveryInfo, StateInfo } from '../lib/types'
import { cn, passwordStrength } from '../lib/utils'
import { BrandMark, Wordmark } from './Brand'
import { RecoveryCodeDialog } from './RecoveryCodeDialog'
import { Spinner, StrengthMeter } from './primitives'

const RULES = [
  { label: '至少 8 个字符', test: (value: string) => value.length >= 8 },
  {
    label: '包含大写与小写字母',
    test: (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value),
  },
  { label: '包含数字', test: (value: string) => /\d/.test(value) },
  { label: '包含符号（推荐）', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

const HIGHLIGHTS = [
  { icon: ShieldCheck, title: 'AES-256-GCM', detail: '字段级加密与完整性校验' },
  { icon: LockKeyhole, title: 'PBKDF2 600,000 次', detail: '主密码仅用于包裹数据密钥' },
  { icon: FileKey2, title: '一次性恢复密钥', detail: '忘记密码也能强制重设' },
  { icon: KeyRound, title: '自动锁定', detail: '离开工位自动清除内存密钥' },
]

export function SetupScreen({
  version,
  onReady,
  onQuit,
  onHelp,
}: {
  version: string
  onReady: (state: StateInfo) => void
  onQuit: () => void
  onHelp?: () => void
}) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ state: StateInfo; recovery: RecoveryInfo } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const strength = useMemo(() => passwordStrength(password), [password])
  const matched = Boolean(confirm) && password === confirm
  const ready = RULES.slice(0, 3).every((rule) => rule.test(password)) && matched

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    if (password.length < 8) {
      setError(t('打开密码至少需要 8 位'))
      inputRef.current?.focus()
      return
    }
    if (password !== confirm) {
      setError(t('两次输入的密码不一致'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const data = await api.initialize(password)
      setResult(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('初始化失败，请重试'))
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="vault-bg relative h-full overflow-hidden">
      <div className="orb left-[-10%] top-[-12%] size-[460px] bg-teal-500/15" />
      <div className="orb right-[-8%] top-[18%] size-[400px] bg-indigo-500/15" />
      <div className="orb bottom-[-20%] left-[30%] size-[460px] bg-cyan-600/10" />

      <div className="relative z-10 flex h-full min-h-0">
        <aside className="hidden min-w-0 flex-1 flex-col justify-between p-10 lg:flex xl:p-14">
          <div className="flex items-center gap-3">
            <BrandMark size="md" />
            <Wordmark />
          </div>

          <div className="max-w-[580px] animate-fade-up py-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-400/20 bg-teal-400/[0.06] px-3 py-1 text-[0.71875rem] font-medium tracking-[0.16em] text-teal-200">
              <Sparkles className="size-3" />
              {t('FIRST RUN · 创建本机保险库')}
            </div>
            <h1 className="font-display text-[2.25rem] font-semibold leading-[1.2] tracking-[-0.02em] text-ice-200 xl:text-[2.625rem]">
              {t('一条密码，')}
              <br />
              {t('守住整座')}
              <span className="brand-gradient">{t('医院的信息底账。')}</span>
            </h1>
            <p className="mt-4 max-w-[500px] text-[0.84375rem] leading-[1.9] text-ice-500">
              {t(
                '打开密码只用于在本机解锁，不会上传或写入任何服务器。密码库会生成一把随机数据密钥，所有账号、密码与修改历史都以它加密。',
              )}
            </p>

            <div className="mt-8 grid max-w-[520px] grid-cols-2 gap-2.5">
              {HIGHLIGHTS.map((item) => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-xl border border-line bg-[var(--msv-tint)] px-3.5 py-3"
                >
                  <item.icon
                    className="mt-0.5 size-[17px] shrink-0 text-teal-300"
                    strokeWidth={1.7}
                  />
                  <div>
                    <div className="text-[0.75rem] font-medium text-ice-300">{item.title}</div>
                    <div className="mt-0.5 text-[0.71875rem] leading-relaxed text-ice-600">
                      {t(item.detail)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-[0.71875rem] text-ice-600">
            <span className="inline-flex items-center gap-1.5">
              <LockKeyhole className="size-3" />
              {t('数据目录：{LOC}，按 Win+R 可直接打开', { LOC: '%APPDATA%\\MedSafeVault' })}
            </span>
            <span className="font-mono tracking-wider">v{version}</span>
          </div>
        </aside>

        <main className="flex w-full flex-1 items-center justify-center overflow-y-auto p-5 sm:p-8 lg:max-w-[620px] lg:flex-none">
          <div className="w-full max-w-[440px] animate-scale-in">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <BrandMark size="md" />
              <Wordmark />
            </div>

            <div className="panel rounded-[18px] p-6 sm:p-7">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl border border-teal-400/20 bg-teal-400/[0.08] text-teal-300">
                  <ShieldCheck className="size-5" strokeWidth={1.7} />
                </div>
                <div className="flex items-center gap-1.5 text-[0.6875rem] tracking-[0.12em] text-ice-600">
                  <span className="flex size-4 items-center justify-center rounded-full bg-teal-400/15 text-[0.6875rem] text-teal-300">
                    1
                  </span>
                  <span className="h-px w-5 bg-line" />
                  <span className="flex size-4 items-center justify-center rounded-full border border-line text-[0.6875rem] text-ice-600">
                    2
                  </span>
                  <span className="ml-1">{t('设置密码 → 保存密钥')}</span>
                </div>
              </div>

              <h2 className="font-display text-[1.3125rem] font-semibold tracking-tight text-ice-200">
                {t('设置打开密码')}
              </h2>
              <p className="mt-1 text-[0.78125rem] leading-relaxed text-ice-500">
                {t(
                  '每次启动 MedSafeVault 时都需要输入它。密码不会被保存，也无法被找回——请务必记牢。',
                )}
              </p>

              <form onSubmit={submit} className="mt-5">
                <label className="field-label" htmlFor="setup-password">
                  {t('打开密码')}
                </label>
                <div className="relative">
                  <input
                    id="setup-password"
                    ref={inputRef}
                    className={cn('msv-input pr-11', error && 'border-rose-400/50')}
                    type={visible ? 'text' : 'password'}
                    value={password}
                    autoFocus
                    autoComplete="new-password"
                    placeholder={t('至少 8 位，建议 12 位以上')}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      if (error) setError('')
                    }}
                  />
                  <button
                    type="button"
                    aria-label={visible ? t('隐藏密码') : t('显示密码')}
                    className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ice-500 transition hover:bg-[var(--msv-tint)] hover:text-ice-200"
                    onClick={() => setVisible((value) => !value)}
                  >
                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <StrengthMeter value={password} />

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {RULES.map((rule) => {
                    const passed = rule.test(password)
                    return (
                      <div
                        key={rule.label}
                        className={cn(
                          'flex items-center gap-1.5 text-[0.71875rem] transition-colors',
                          passed ? 'text-teal-300' : 'text-ice-600',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-3.5 place-items-center rounded-full border',
                            passed
                              ? 'border-teal-400/40 bg-teal-400/15'
                              : 'border-line bg-[var(--msv-tint)]',
                          )}
                        >
                          {passed && <Check className="size-2.5" strokeWidth={3} />}
                        </span>
                        {t(rule.label)}
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4">
                  <label className="field-label" htmlFor="setup-confirm">
                    {t('确认密码')}
                  </label>
                  <div className="relative">
                    <input
                      id="setup-confirm"
                      className={cn('msv-input pr-10', confirm && !matched && 'border-rose-400/50')}
                      type={visible ? 'text' : 'password'}
                      value={confirm}
                      autoComplete="new-password"
                      placeholder={t('再次输入打开密码')}
                      onChange={(event) => {
                        setConfirm(event.target.value)
                        if (error) setError('')
                      }}
                    />
                    {matched && (
                      <Check className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-teal-400" />
                    )}
                  </div>
                </div>

                <div className="min-h-[24px] pt-1.5 text-[0.71875rem] text-rose-300">{error}</div>

                <button
                  type="submit"
                  disabled={loading || !ready}
                  className="btn-primary mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[0.8125rem] font-semibold transition hover:brightness-105 active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? (
                    <>
                      <Spinner className="size-3.5" />
                      {t('正在派生密钥…')}
                    </>
                  ) : (
                    <>
                      {t('创建密码库')}
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-4 flex items-start gap-2 text-[0.71875rem] leading-relaxed text-ice-600">
                <KeyRound className="mt-0.5 size-3 shrink-0" />
                <span>
                  {t(
                    '密钥派生会在本机进行 600,000 次 PBKDF2 迭代，创建过程可能需要几秒钟。当前强度：',
                  )}
                  <span className="text-ice-500">{strength.label}</span>
                </span>
              </p>
            </div>

            <div className="mt-5 flex items-center justify-between px-1 text-[0.71875rem] text-ice-600">
              <span>{t('MedSafeVault v{version} · 纯本地加密存储', { version })}</span>
              <span className="flex items-center gap-1">
                {onHelp && (
                  <button
                    type="button"
                    onClick={onHelp}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 transition hover:bg-[var(--msv-tint)] hover:text-ice-400"
                  >
                    <CircleHelp className="size-3" />
                    {t('帮助')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onQuit}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 transition hover:bg-[var(--msv-tint)] hover:text-ice-400"
                >
                  <Power className="size-3" />
                  {t('退出')}
                </button>
              </span>
            </div>
          </div>
        </main>
      </div>

      <RecoveryCodeDialog
        open={Boolean(result)}
        info={result?.recovery ?? null}
        mode="setup"
        onDone={() => {
          if (result) onReady(result.state)
        }}
      />
    </div>
  )
}
