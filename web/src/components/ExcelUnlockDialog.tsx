/**
 * Asked when an imported workbook is protected by an opening password. The
 * password only lives in memory for this import; it is never written to the
 * vault or to disk.
 */
import { FileLock2, Unlock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { ModalFrame, Spinner } from './primitives'

export function ExcelUnlockDialog({
  open,
  fileName,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  fileName: string
  onOpenChange: (open: boolean) => void
  onSubmit: (password: string) => Promise<void> | void
}) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPassword('')
      setVisible(false)
      setBusy(false)
      setError('')
    }
  }, [open])

  async function submit() {
    if (busy || !password) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(password)
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
      icon={<FileLock2 className="size-5" />}
      title={t('解锁 Excel')}
      description={t('「{file}」设置了打开密码，验证后即可预览并导入。', {
        file: fileName,
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
            disabled={busy || !password}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--msv-accent)] px-4 text-[0.75rem] font-medium text-[var(--msv-accent-contrast)] transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Spinner className="size-3.5" /> : <Unlock className="size-3.5" />}
            {t('预览文件')}
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
          <label className="field-label" htmlFor="excel-unlock-pw">
            {t('Excel 打开密码')}
          </label>
          <input
            id="excel-unlock-pw"
            className="msv-input"
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            autoFocus
            placeholder={t('输入打开这个工作簿时设置的密码')}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
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

        <p className="text-[0.6875rem] leading-relaxed text-ice-600">
          {t('密码只在本机内存中用于解密这个文件，不会被保存。')}
        </p>
      </form>
    </ModalFrame>
  )
}
