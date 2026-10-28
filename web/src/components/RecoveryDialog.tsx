import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  FileKey2,
  KeyRound,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { StateInfo } from '../lib/types'
import { cn, formatRecoveryCode, shortPath } from '../lib/utils'
import { ModalFrame, Spinner, StrengthMeter } from './primitives'

type Step = 'method' | 'code' | 'password'

export function RecoveryDialog({
  open,
  onOpenChange,
  onRecovered,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRecovered: (state: StateInfo) => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState<Step>('method')
  const [code, setCode] = useState('')
  const [fileLabel, setFileLabel] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [vaultId, setVaultId] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setStep('method')
      setCode('')
      setFileLabel('')
      setPassword('')
      setConfirm('')
      setError('')
      setVaultId('')
      setLoading(false)
    }
  }, [open])

  useEffect(() => {
    if (step === 'password') passwordRef.current?.focus()
  }, [step])

  async function pickFile() {
    if (loading) return
    setError('')
    setLoading(true)
    try {
      const result = await api.pickRecoveryFile()
      if (result.cancelled) return
      setFileLabel(result.path ? shortPath(result.path) : t('恢复密钥文件'))
      setVaultId('')
      setStep('password')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('无法读取恢复密钥文件'))
    } finally {
      setLoading(false)
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    const normalized = formatRecoveryCode(code)
    if (normalized.replace(/-/g, '').length < 16) {
      setError(t('请输入完整的恢复码'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await api.startRecoveryWithCode(normalized)
      setVaultId(result.vault_id)
      setStep('password')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('恢复码校验失败'))
    } finally {
      setLoading(false)
    }
  }

  async function finish(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    if (password.length < 8) {
      setError(t('新的打开密码至少需要 8 位'))
      passwordRef.current?.focus()
      return
    }
    if (password !== confirm) {
      setError(t('两次输入的密码不一致'))
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await api.finishRecovery(password)
      toast.success(t('打开密码已重设'), t('请使用新密码解锁密码库，并妥善保存恢复密钥'))
      onRecovered(result.state)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('重设密码失败，请重新导入恢复密钥'))
    } finally {
      setLoading(false)
    }
  }

  function close() {
    if (step === 'password' || step === 'code') {
      api.cancelRecovery().catch(() => undefined)
    }
    onOpenChange(false)
  }

  const title =
    step === 'method' ? t('使用恢复密钥') : step === 'code' ? t('输入恢复码') : t('重设打开密码')
  const description =
    step === 'method'
      ? t('恢复密钥用于在忘记打开密码时重新获得访问权限。')
      : step === 'code'
        ? t('恢复码由 32 位字母与数字组成，不区分大小写。')
        : t('输入一次新的打开密码。旧的打开密码将立即失效。')

  return (
    <ModalFrame
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      icon={
        step === 'password' ? <ShieldCheck className="size-5" /> : <FileKey2 className="size-5" />
      }
      title={title}
      description={description}
      width="500px"
      footer={
        step === 'code' ? (
          <div className="flex w-full items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setStep('method')
                setError('')
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[0.78125rem] text-ice-500 transition hover:bg-[var(--msv-tint)] hover:text-ice-200"
            >
              <ArrowLeft className="size-3.5" />
              {t('返回')}
            </button>
            <button
              type="submit"
              form="recovery-code-form"
              disabled={loading}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
            >
              {loading && <Spinner className="size-3.5" />}
              {t('验证恢复码')}
            </button>
          </div>
        ) : step === 'password' ? (
          <div className="flex w-full items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[0.71875rem] text-ice-600">
              <ShieldCheck className="size-3 text-teal-400" />
              {fileLabel ||
                (vaultId
                  ? t('密码库 {id}', { id: vaultId.slice(0, 8).toUpperCase() })
                  : t('恢复会话已建立'))}
            </span>
            <button
              type="submit"
              form="recovery-reset-form"
              disabled={loading}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
            >
              {loading && <Spinner className="size-3.5" />}
              {t('重设并解锁')}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        ) : undefined
      }
    >
      {step === 'method' && (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={pickFile}
            disabled={loading}
            className="group flex w-full items-center gap-3.5 rounded-xl border border-line bg-[var(--msv-tint)] p-4 text-left transition hover:border-teal-400/30 hover:bg-teal-400/[0.045] disabled:opacity-60"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-teal-400/20 bg-teal-400/[0.08] text-teal-300">
              {loading ? <Spinner /> : <UploadCloud className="size-5" strokeWidth={1.7} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.8125rem] font-medium text-ice-200">
                {t('导入恢复密钥文件')}
              </span>
              <span className="mt-0.5 block text-[0.71875rem] leading-relaxed text-ice-500">
                {t('选择首次初始化时保存的 .msvkey 文件，自动校验所属密码库')}
              </span>
            </span>
            <ArrowRight className="size-4 text-ice-600 transition group-hover:translate-x-0.5 group-hover:text-teal-300" />
          </button>

          <button
            type="button"
            onClick={() => {
              setStep('code')
              setError('')
            }}
            className="group flex w-full items-center gap-3.5 rounded-xl border border-line bg-[var(--msv-tint)] p-4 text-left transition hover:border-teal-400/30 hover:bg-teal-400/[0.045]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-[var(--msv-tint-strong)] text-ice-400">
              <KeyRound className="size-5" strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.8125rem] font-medium text-ice-200">
                {t('手动输入恢复码')}
              </span>
              <span className="mt-0.5 block text-[0.71875rem] leading-relaxed text-ice-500">
                {t('从纸质密码本或离线备份中找回 32 位恢复码')}
              </span>
            </span>
            <ArrowRight className="size-4 text-ice-600 transition group-hover:translate-x-0.5 group-hover:text-teal-300" />
          </button>

          {error && (
            <div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.71875rem] text-rose-200">
              {error}
            </div>
          )}

          <p className="pt-1 text-[0.71875rem] leading-relaxed text-ice-600">
            {t(
              '恢复密钥文件包含与主密钥等价的凭证。若它已丢失，且打开密码也忘记，密码库数据将无法解密。',
            )}
          </p>
        </div>
      )}

      {step === 'code' && (
        <form id="recovery-code-form" onSubmit={submitCode}>
          <label className="field-label" htmlFor="recovery-code">
            {t('恢复码')}
          </label>
          <textarea
            id="recovery-code"
            className="msv-input font-mono text-[1rem] tracking-[0.16em]"
            rows={3}
            autoFocus
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            value={code}
            onChange={(event) => {
              setCode(formatRecoveryCode(event.target.value))
              if (error) setError('')
            }}
          />
          <div className="mt-1.5 flex items-center justify-between text-[0.71875rem] text-ice-600">
            <span>{t('粘贴时会自动分组，连字符可省略')}</span>
            <span className="font-mono">{code.replace(/-/g, '').length}/32</span>
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.71875rem] text-rose-200">
              {error}
            </div>
          )}
        </form>
      )}

      {step === 'password' && (
        <form id="recovery-reset-form" onSubmit={finish}>
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-teal-400/20 bg-teal-400/[0.06] px-3 py-2 text-[0.71875rem] text-teal-100">
            <ShieldCheck className="size-3.5 shrink-0" />
            {t('恢复密钥已验证。请设置新的打开密码，数据本身无需重新加密。')}
          </div>

          <label className="field-label" htmlFor="recovery-new">
            {t('新的打开密码')}
          </label>
          <div className="relative">
            <input
              id="recovery-new"
              ref={passwordRef}
              className={cn('msv-input pr-11', error && 'border-rose-400/50')}
              type={visible ? 'text' : 'password'}
              value={password}
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

          <label className="field-label mt-4" htmlFor="recovery-confirm">
            {t('确认新密码')}
          </label>
          <input
            id="recovery-confirm"
            className="msv-input"
            type={visible ? 'text' : 'password'}
            value={confirm}
            autoComplete="new-password"
            placeholder={t('再次输入新密码')}
            onChange={(event) => {
              setConfirm(event.target.value)
              if (error) setError('')
            }}
          />

          {error && (
            <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.71875rem] text-rose-200">
              {error}
            </div>
          )}
        </form>
      )}
    </ModalFrame>
  )
}
