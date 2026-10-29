/**
 * Export dialog for one page's records. A workbook password is optional: when
 * enabled the finished .xlsx is wrapped with the ECMA-376 agile encryption that
 * Excel itself uses, so the recipient is prompted for it when opening the file.
 */
import { Download, FileSpreadsheet, LockKeyhole } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { ModalFrame, Spinner, StrengthMeter } from './primitives'

export function ExcelExportDialog({
  open,
  pageName,
  rowCount,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  pageName: string
  rowCount: number
  onOpenChange: (open: boolean) => void
  onConfirm: (password: string) => Promise<void> | void
}) {
  const { t } = useI18n()
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setProtect(false)
      setPassword('')
      setConfirm('')
      setVisible(false)
      setError('')
      setBusy(false)
    }
  }, [open])

  async function submit() {
    if (busy) return
    if (protect) {
      if (password.length < 8) {
        setError(t('Excel 密码至少需要 8 位'))
        return
      }
      if (password !== confirm) {
        setError(t('两次输入的 Excel 密码不一致'))
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      await onConfirm(protect ? password : '')
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
      icon={<FileSpreadsheet className="size-5" />}
      title={t('导出 Excel')}
      description={t('将「{page}」的 {n} 条记录导出为 .xlsx 文件。', {
        page: pageName,
        n: rowCount,
      })}
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
            disabled={busy || (protect && (!password || !confirm))}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--msv-accent)] px-4 text-[0.75rem] font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? (
              <Spinner className="size-3.5" />
            ) : protect ? (
              <LockKeyhole className="size-3.5" />
            ) : (
              <Download className="size-3.5" />
            )}
            {protect ? t('加密并导出') : t('导出')}
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
        <div className="rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2 text-[0.71875rem] text-ice-500">
          <div className="flex items-center justify-between gap-3">
            <span>{t('页面')}</span>
            <span className="truncate text-ice-200">{pageName}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span>{t('记录条数')}</span>
            <span className="font-mono text-ice-200">{rowCount}</span>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 transition hover:border-line-strong">
          <input
            type="checkbox"
            className="msv-check mt-0.5"
            checked={protect}
            onChange={(event) => {
              setProtect(event.target.checked)
              setError('')
            }}
          />
          <span className="min-w-0">
            <span className="block text-[0.78125rem] text-ice-200">
              {t('用密码保护工作簿')}
            </span>
            <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-ice-600">
              {t('打开文件时需要输入密码，适合通过邮件或共享目录传递。')}
            </span>
          </span>
        </label>

        {protect && (
          <div className="space-y-3">
            <div>
              <label className="field-label" htmlFor="excel-pw">
                {t('Excel 密码')}
              </label>
              <input
                id="excel-pw"
                className="msv-input"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
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
              <label className="field-label" htmlFor="excel-pw2">
                {t('确认 Excel 密码')}
              </label>
              <input
                id="excel-pw2"
                className="msv-input"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder={t('再次输入 Excel 密码')}
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
          </div>
        )}

        {error && <p className="text-[0.71875rem] text-rose-300">{error}</p>}

        <p className="text-[0.6875rem] leading-relaxed text-ice-600">
          {protect
            ? t(
                '密码只保护这个 Excel 文件；软件内的数据仍由保险库加密。忘记密码将无法打开该文件，请另行记下。',
              )
            : t('未设密码的导出文件包含解密后的明文字段，请存放在受控位置。')}
        </p>
      </form>
    </ModalFrame>
  )
}
