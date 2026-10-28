import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileKey2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, api, copyText } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { RecoveryInfo } from '../lib/types'
import { formatDateTime, formatRecoveryCode, shortPath } from '../lib/utils'
import { ModalFrame } from './primitives'

export function RecoveryCodeDialog({
  open,
  info,
  mode = 'setup',
  onDone,
}: {
  open: boolean
  info: RecoveryInfo | null
  mode?: 'setup' | 'rotate'
  onDone: () => void
}) {
  const { t } = useI18n()
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState('')

  useEffect(() => {
    if (open) {
      setAcknowledged(false)
      setSavedPath('')
    }
  }, [open, info?.generation])

  if (!info) return null
  const code = info.code
  const groups = formatRecoveryCode(code).split('-')
  const canLeave = mode === 'rotate' || acknowledged

  async function saveFile() {
    setSaving(true)
    try {
      const result = await api.saveRecoveryFile()
      if (result.cancelled) return
      if (result.path) {
        setSavedPath(result.path)
        toast.success(t('恢复密钥文件已保存'), shortPath(result.path), { duration: 7000 })
      }
    } catch (error) {
      toast.error(
        t('保存失败'),
        error instanceof ApiError ? error.message : t('无法保存恢复密钥文件'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function copyCode() {
    try {
      await copyText(code)
      toast.success(t('恢复码已复制'), t('请粘贴到离线的密码本或加密笔记中'))
    } catch {
      toast.error(t('复制失败'), t('请手动抄写恢复码'))
    }
  }

  return (
    <ModalFrame
      open={open}
      onOpenChange={(next) => {
        if (!next && canLeave) onDone()
      }}
      size="md"
      width="560px"
      dismissable={false}
      icon={<FileKey2 className="size-5" />}
      title={t('保存恢复密钥')}
      description={
        mode === 'setup'
          ? t('密码库已创建。这是唯一一次完整展示恢复密钥的机会。')
          : t('新的恢复密钥已生成，旧的恢复密钥文件与恢复码将立即失效。')
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={saveFile}
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-teal-400/30 bg-teal-400/[0.08] px-3.5 text-[0.78125rem] font-medium text-teal-200 transition hover:bg-teal-400/[0.14] disabled:opacity-50"
          >
            <Download className="size-3.5" />
            {saving
              ? t('正在保存…')
              : savedPath
                ? t('再次保存 .msvkey')
                : t('保存 .msvkey 文件')}
          </button>
          {mode === 'setup' ? (
            <button
              type="button"
              disabled={!canLeave}
              onClick={onDone}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('进入密码库')}
              <Check className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onDone}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105"
            >
              {t('我已保存')}
              <Check className="size-3.5" />
            </button>
          )}
        </div>
      }
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-3 text-[0.71875rem] leading-relaxed text-amber-100">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div>
            <div className="font-medium text-amber-200">{t('它等同于密码库的主钥匙')}</div>
            <p className="mt-0.5 text-amber-100">
              {t(
                '请打印或保存到离线 U 盘，不要与数据库放在同一台电脑，也不要通过聊天工具发送。任何拿到恢复密钥的人都可以重设打开密码。',
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-[var(--msv-surface-soft)] p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[0.71875rem] font-medium tracking-[0.12em] text-ice-500">
            <KeyRound className="size-3" />
            {t('RECOVERY CODE · 第 {n} 代', { n: info.generation })}
          </span>
          <span className="text-[0.71875rem] text-ice-600">
            {formatDateTime(info.created_at)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 sm:gap-1">
          {groups.map((group, index) => (
            <div
              key={`${group}-${index}`}
              className="select-all rounded-md border border-line bg-[var(--msv-tint-strong)] py-2 text-center font-mono text-[0.78125rem] tracking-[0.09em] text-teal-100"
            >
              {group}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[0.71875rem] text-ice-600">
            {t('恢复码共 {n} 位，校验位已包含在末组', { n: groups.join('').length })}
          </span>
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[0.71875rem] text-ice-400 transition hover:border-teal-400/30 hover:text-teal-200"
          >
            <Copy className="size-3" />
            {t('复制恢复码')}
          </button>
        </div>
      </div>

      {savedPath && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-[0.71875rem] leading-relaxed text-emerald-200">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-all">{t('已保存至 {path}', { path: savedPath })}</span>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5">
        <label className="mt-0.5 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 size-3.5 accent-teal-400"
          />
          <span className="text-[0.71875rem] leading-relaxed text-ice-400">
            {t(
              '我已妥善保存恢复密钥，并理解：丢失打开密码且没有恢复密钥时，密码库无法恢复。',
            )}
          </span>
        </label>
      </div>
    </ModalFrame>
  )
}
