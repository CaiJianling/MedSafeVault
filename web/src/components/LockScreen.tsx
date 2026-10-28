import {
  ArrowRight,
  CircleHelp,
  Eye,
  EyeOff,
  FileKey2,
  HardDrive,
  History,
  KeyRound,
  LockKeyhole,
  Power,
  ShieldCheck,
  Timer,
} from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import type { StateInfo } from '../lib/types'
import { cn } from '../lib/utils'
import { BrandMark, Wordmark } from './Brand'
import { Spinner } from './primitives'

const FEATURES = [
  { icon: ShieldCheck, title: '字段级加密', detail: 'AES-256-GCM 独立密钥包装' },
  { icon: HardDrive, title: '纯本地存储', detail: '数据不离开这台电脑' },
  { icon: FileKey2, title: '恢复密钥', detail: '忘记密码也能安全找回' },
  { icon: History, title: '变更可撤回', detail: '每次修改都有加密记录' },
]

export function LockScreen({
  state,
  onUnlocked,
  onRecovery,
  onQuit,
  onHelp,
}: {
  state: StateInfo
  onUnlocked: (state: StateInfo) => void
  onRecovery: () => void
  onQuit: () => void
  onHelp?: () => void
}) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const autoLocked = state.lock_reason === 'auto'

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (loading) return
    if (!password) {
      setError(t('请输入打开密码'))
      inputRef.current?.focus()
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await api.unlock(password)
      setPassword('')
      onUnlocked(result.state)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('解锁失败，请重试'))
      inputRef.current?.focus()
      inputRef.current?.select()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="vault-bg relative h-full overflow-hidden">
      <div className="orb left-[-8%] top-[-10%] size-[420px] bg-teal-500/15" />
      <div className="orb right-[-6%] top-[6%] size-[380px] bg-indigo-500/15" />
      <div className="orb bottom-[-18%] left-[38%] size-[420px] bg-cyan-600/10" />

      <div className="relative z-10 flex h-full min-h-0">
        <aside className="hidden min-w-0 flex-1 flex-col justify-between p-10 lg:flex xl:p-14">
          <div className="flex items-center gap-3">
            <BrandMark size="md" />
            <Wordmark />
          </div>

          <div className="max-w-[560px] py-10 animate-fade-up">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-400/20 bg-teal-400/[0.06] px-3 py-1 text-[0.71875rem] font-medium tracking-[0.16em] text-teal-200">
              <span className="size-1.5 rounded-full bg-teal-300 shadow-[0_0_10px_rgba(94,234,212,.9)]" />
              LOCAL-FIRST · ZERO CLOUD
            </div>
            <h1 className="font-display text-[2.375rem] font-semibold leading-[1.18] tracking-[-0.02em] text-ice-200 xl:text-[2.75rem]">
              {t('把医院的钥匙，')}
              <br />
              {t('锁进一座')}
              <span className="brand-gradient">{t('看得见的保险库。')}</span>
            </h1>
            <p className="mt-4 max-w-[470px] text-[0.84375rem] leading-[1.9] text-ice-500">
              {t(
                '服务器、网络设备、数据库与应用账号集中管理。主密码解锁、字段级加密、恢复密钥与可撤回的修改历史，为信息科日常运维留下一份可靠底账。',
              )}
            </p>

            <div className="mt-9 grid max-w-[500px] grid-cols-2 gap-2.5">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="flex items-start gap-3 rounded-xl border border-line bg-[var(--msv-tint)] px-3.5 py-3"
                >
                  <feature.icon
                    className="mt-0.5 size-[17px] shrink-0 text-teal-300"
                    strokeWidth={1.7}
                  />
                  <div>
                    <div className="text-[0.75rem] font-medium text-ice-300">
                      {t(feature.title)}
                    </div>
                    <div className="mt-0.5 text-[0.71875rem] leading-relaxed text-ice-600">
                      {t(feature.detail)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-[0.71875rem] text-ice-600">
            <span className="inline-flex items-center gap-1.5">
              <LockKeyhole className="size-3" />
              {t('数据仅保存在本机 · 不上传云端')}
            </span>
            <span className="font-mono tracking-wider">
              VAULT {state.vault_id ? state.vault_id.slice(0, 8).toUpperCase() : 'LOCAL'}
            </span>
          </div>
        </aside>

        <main className="flex w-full flex-1 items-center justify-center overflow-y-auto p-5 sm:p-8 lg:max-w-[600px] lg:flex-none">
          <div className="w-full max-w-[410px] animate-scale-in">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <BrandMark size="md" />
              <Wordmark />
            </div>

            <div className="panel rounded-[18px] p-6 sm:p-7">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl border border-teal-400/20 bg-teal-400/[0.08] text-teal-300">
                  <KeyRound className="size-5" strokeWidth={1.7} />
                </div>
                <span className="chip">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  {t('已加密')}
                </span>
              </div>

              <h2 className="font-display text-[1.3125rem] font-semibold tracking-tight text-ice-200">
                {t('解锁保险库')}
              </h2>
              <p className="mt-1 text-[0.78125rem] leading-relaxed text-ice-500">
                {t('输入打开密码以继续。密码只在本机校验，不会被保存。')}
              </p>

              {autoLocked && (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] px-3 py-2.5 text-[0.71875rem] leading-relaxed text-amber-200">
                  <Timer className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {t('超过 {n} 分钟无操作，已自动锁定。请重新输入打开密码。', {
                      n: state.auto_lock_minutes || 5,
                    })}
                  </span>
                </div>
              )}
              {state.lock_reason === 'manual' && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2 text-[0.71875rem] text-ice-500">
                  <LockKeyhole className="size-3.5" />
                  {t('保险库已手动锁定，加密密钥已从内存清除。')}
                </div>
              )}

              <form onSubmit={submit} className="mt-5">
                <label className="field-label" htmlFor="unlock-password">
                  {t('打开密码')}
                </label>
                <div className="relative">
                  <input
                    id="unlock-password"
                    ref={inputRef}
                    className={cn('msv-input pr-11', error && 'border-rose-400/50')}
                    type={visible ? 'text' : 'password'}
                    value={password}
                    autoFocus
                    autoComplete="current-password"
                    placeholder={t('输入打开密码')}
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
                <div className="min-h-[22px] pt-1.5 text-[0.71875rem] text-rose-300">{error}</div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-[0.8125rem] font-semibold transition hover:brightness-105 active:scale-[0.995] disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Spinner className="size-3.5" />
                      {t('正在校验…')}
                    </>
                  ) : (
                    <>
                      {t('解锁')}
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-[0.6875rem] tracking-[0.12em] text-ice-600">
                  {t('忘记密码')}
                </span>
                <div className="h-px flex-1 bg-line" />
              </div>

              <button
                type="button"
                onClick={onRecovery}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-[var(--msv-tint)] px-3.5 py-3 text-left transition hover:border-teal-400/25 hover:bg-teal-400/[0.04]"
              >
                <FileKey2 className="size-4 shrink-0 text-teal-300" />
                <span className="flex-1">
                  <span className="block text-[0.75rem] font-medium text-ice-300">
                    {t('使用恢复密钥')}
                  </span>
                  <span className="mt-0.5 block text-[0.71875rem] text-ice-600">
                    {t('导入 .msvkey 文件或输入恢复码，重设打开密码')}
                  </span>
                </span>
                <ArrowRight className="size-3.5 text-ice-600" />
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between px-1 text-[0.71875rem] text-ice-600">
              <span>MedSafeVault v{state.version} · AES-256-GCM</span>
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
    </div>
  )
}
