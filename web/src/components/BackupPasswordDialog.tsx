/**
 * Password prompt shown before an encrypted backup is written. The password
 * seals the whole file, so it is asked for here rather than reusing the vault's
 * open password.
 */
import { Download, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { ModalFrame, Spinner, StrengthMeter } from './primitives'

export function BackupPasswordDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (password: string) => Promise<void> | void
}) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPassword('')
      setConfirm('')
      setVisible(false)
      setError('')
      setBusy(false)
    }
  }, [open])

  async function submit() {
    if (busy) return
    if (password.length < 8) {
      setError(t('备份密码至少需要 8 位'))
      return
    }
    if (password !== confirm) {
      setError(t('两次输入的备份密码不一致'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await onConfirm(password)
      onOpenChange(false)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : t('请重试'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalFrame
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<ShieldAlert className="size-5" />}
      title={t('设置备份密码')}
      description={t(
        '整个备份文件都会用这个密码加密，包括页面结构与记录条数。忘记它就无法恢复该备份，请把它与备份文件分开存放。',
      )}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-lg border border-line px-3.5 text-[0.75rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200"
          >
            {t('取消')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !password || !confirm}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--msv-accent)] px-4 text-[0.75rem] font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
            {t('加密并导出')}
          </button>
        </div>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div>
          <label className="field-label" htmlFor="backup-pw">
            {t('备份密码')}
          </label>
          <input
            id="backup-pw"
            className="msv-input"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            placeholder={t('至少 8 位，建议 12 位以上')}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError('')
            }}
          />
          <StrengthMeter value={password} />
        </div>
        <div>
          <label className="field-label" htmlFor="backup-pw2">
            {t('确认备份密码')}
          </label>
          <input
            id="backup-pw2"
            className="msv-input"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('再次输入备份密码')}
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value)
              setError('')
            }}
          />
        </div>

        <label className="flex items-center gap-2 text-[0.71875rem] text-ice-500">
          <input
            type="checkbox"
            className="msv-check"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          {t('显示密码')}
        </label>

        {error && <p className="text-[0.71875rem] text-rose-300">{error}</p>}

        <p className="text-[0.71875rem] leading-relaxed text-ice-600">
          {t(
            '导入这个备份时只需要输入备份密码，不需要当初的打开密码；恢复后仍用原来的打开密码解锁。',
          )}
        </p>
      </form>
    </ModalFrame>
  )
}
