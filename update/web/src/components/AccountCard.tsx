import { Button } from '@heroui/react'
import { Copy, KeyRound, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage, type Summary } from '../lib/api'
import { toast } from '../lib/toast'
import { formatBytes } from '../lib/utils'
import { Field, Section, Spinner } from './primitives'

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[0.6875rem] text-ice-600">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ice-400" title={value}>
        {value || '—'}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`复制${label}`}
        className="size-7 min-w-7 rounded-lg text-ice-600"
        onPress={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => toast.success(`已复制${label}`))
            .catch(() => toast.danger('浏览器不允许复制'))
        }}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  )
}

export function AccountCard({
  summary,
  username,
  onChanged,
}: {
  summary: Summary | null
  username: string
  onChanged: () => void
}) {
  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const mismatch = again !== '' && again !== newPass
  const canSubmit = oldPass !== '' && newPass.length >= 8 && !mismatch && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      await api.changePassword(oldPass, newPass)
      setOldPass('')
      setNewPass('')
      setAgain('')
      toast.success('登录口令已修改，其他浏览器需要重新登录')
      onChanged()
    } catch (error) {
      setError(errorMessage(error, '修改口令失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="账号与服务" description="口令只以 PBKDF2 散列存在 admin.json 里，服务器上没有明文。">
      {summary?.using_default_password ? (
        <div className="adm-note adm-note-danger mb-3">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            还在用首次生成的初始口令。这是台能被科室其他电脑访问的服务器，请在下面改掉。
          </span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <PathRow label="登录账号" value={username || summary?.username || '—'} />
        <PathRow label="数据目录" value={summary?.root || ''} />
        <PathRow label="版本表" value={summary?.config || ''} />
        <PathRow label="暂存目录" value={summary?.staging || ''} />
        <div className="flex items-center gap-2 text-[0.6875rem] text-ice-600">
          <span className="w-16 shrink-0">其他设置</span>
          <span>
            上传上限 {formatBytes(summary?.max_upload || 0)} · 登录有效
            {summary?.session_hours ?? 8} 小时 · 口令改于 {summary?.password_updated_at || '—'}
          </span>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <h4 className="field-label mb-2">
          <KeyRound className="size-3.5" />
          修改登录口令
        </h4>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Field label="当前口令" htmlFor="pass-old">
            <input
              id="pass-old"
              type="password"
              className="msv-input"
              autoComplete="current-password"
              value={oldPass}
              onChange={(event) => setOldPass(event.target.value)}
            />
          </Field>
          <Field label="新口令" error={newPass && newPass.length < 8 ? '至少 8 位' : undefined} htmlFor="pass-new">
            <input
              id="pass-new"
              type="password"
              className="msv-input"
              autoComplete="new-password"
              value={newPass}
              onChange={(event) => setNewPass(event.target.value)}
            />
          </Field>
          <Field label="确认新口令" error={mismatch ? '两次输入不一致' : undefined} htmlFor="pass-again">
            <input
              id="pass-again"
              type="password"
              className="msv-input"
              autoComplete="new-password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
            />
          </Field>
        </div>
        {error ? <div className="adm-note adm-note-danger mt-2.5">{error}</div> : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[0.6875rem] leading-relaxed text-ice-600">
            忘记口令：
            <code className="font-mono text-ice-400">--set-password</code>
          </span>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={!canSubmit}
            onPress={() => void submit()}
          >
            {busy ? <Spinner className="mr-1.5" /> : null}
            修改口令
          </Button>
        </div>
      </div>
    </Section>
  )
}
