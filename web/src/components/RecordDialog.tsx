import {
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Save,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { Column, Page, RecordDetail } from '../lib/types'
import { cn, formatDateTime, isMonospaceColumn, passwordStrength } from '../lib/utils'
import { Field, ModalFrame, SelectMenu, Spinner } from './primitives'
import { SuggestInput } from './SuggestInput'

type Values = Record<string, string>

function initialValues(columns: Column[]): Values {
  const values: Values = {}
  for (const column of columns) {
    values[column.key] = ''
  }
  return values
}

/** Columns that may offer previously used values; anything secret is excluded. */
function isSuggestable(column: Column) {
  if (column.secret || column.masked) return false
  return column.type !== 'password' && column.type !== 'textarea' && column.type !== 'date'
}

export function RecordDialog({
  open,
  page,
  recordId,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  page: Page
  recordId: number | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [values, setValues] = useState<Values>({})
  const [detail, setDetail] = useState<RecordDetail | null>(null)
  const [columns, setColumns] = useState<Column[]>(page.columns)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({})
  const suggestTimers = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setError('')
    setVisible({})
    setDetail(null)
    setSuggestions({})
    if (!recordId) {
      setColumns(page.columns)
      setValues(initialValues(page.columns))
      return
    }
    setLoading(true)
    api
      .getRecord(recordId)
      .then((result) => {
        setDetail(result.record)
        setColumns(result.record.columns)
        const next: Values = {}
        for (const column of result.record.columns) {
          next[column.key] = result.record.values[column.key] ?? ''
        }
        setValues(next)
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('无法读取记录'))
      })
      .finally(() => setLoading(false))
  }, [open, recordId, page, t])

  const visibleColumns = useMemo(
    () => columns.filter((column) => column.visible || column.required),
    [columns],
  )

  const secretFields = visibleColumns.filter((column) => column.secret)

  useEffect(() => {
    const timers = suggestTimers.current
    return () => {
      for (const timer of Object.values(timers)) window.clearTimeout(timer)
      suggestTimers.current = {}
    }
  }, [])

  // Other records in the same column usually repeat values such as the OS or
  // the host name, so the list is prefetched when the dialog opens.
  useEffect(() => {
    if (!open) return
    const targets = visibleColumns.filter(isSuggestable)
    if (!targets.length) return
    let cancelled = false
    for (const column of targets) {
      api
        .suggestValues(page.id, column.key, '', 12)
        .then((result) => {
          if (cancelled) return
          setSuggestions((current) => ({ ...current, [column.key]: result.values }))
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [open, page.id, visibleColumns])

  function requestSuggestions(key: string, query: string) {
    if (suggestTimers.current[key]) window.clearTimeout(suggestTimers.current[key])
    suggestTimers.current[key] = window.setTimeout(() => {
      api
        .suggestValues(page.id, key, query, 12)
        .then((result) => setSuggestions((current) => ({ ...current, [key]: result.values })))
        .catch(() => undefined)
    }, 240)
  }

  function update(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    if (value.trim()) requestSuggestions(key, value.trim())
  }

  async function generate(key: string) {
    setGenerating(key)
    try {
      const result = await api.generatePassword(20, true)
      update(key, result.value)
      setVisible((current) => ({ ...current, [key]: true }))
      toast.success(t('已生成 20 位强密码'), t('保存后将使用密码专用子密钥加密'))
    } catch (err) {
      toast.error(t('生成失败'), err instanceof ApiError ? err.message : t('请重试'))
    } finally {
      setGenerating(null)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const nextErrors: Record<string, string> = {}
    for (const column of columns) {
      if (column.required && !String(values[column.key] || '').trim()) {
        nextErrors[column.key] = t('请填写{label}', { label: column.label })
      }
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      const first = Object.keys(nextErrors)[0]
      document.getElementById(`field-${first}`)?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: Values = {}
      for (const column of columns) {
        payload[column.key] = String(values[column.key] ?? '')
      }
      await api.saveRecord(page.id, payload, recordId)
      toast.success(
        recordId ? t('记录已更新') : t('记录已添加'),
        t('修改已写入加密历史，可随时撤回'),
      )
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }

  const title = recordId ? t('编辑记录') : t('新增{name}记录', { name: page.name })

  return (
    <ModalFrame
      open={open}
      onOpenChange={onOpenChange}
      icon={<KeyRound className="size-5" />}
      title={title}
      description={
        recordId && detail
          ? t('创建于 {created} · 最近更新 {updated}', {
              created: formatDateTime(detail.created_at),
              updated: formatDateTime(detail.updated_at),
            })
          : t('{name} · {n} 个字段，{m} 个密码字段', {
              name: page.name,
              n: visibleColumns.length,
              m: secretFields.length,
            })
      }
      width="780px"
      bodyClassName="max-h-[64vh] overflow-y-auto pr-1"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[0.71875rem] text-ice-600">
            <Lock className="size-3" />
            {t('每个字段都以密文写入数据库，内存密钥锁定后自动清除')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-9 rounded-lg border border-line px-4 text-[0.78125rem] text-ice-400 transition hover:border-line-strong hover:bg-[var(--msv-tint)] hover:text-ice-200"
            >
              {t('取消')}
            </button>
            <button
              type="submit"
              form="record-form"
              disabled={saving || loading}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
            >
              {saving ? <Spinner className="size-3.5" /> : <Save className="size-3.5" />}
              {recordId ? t('保存修改') : t('添加记录')}
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="grid grid-cols-2 gap-4 py-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index}>
              <div className="skeleton mb-2 h-2.5 w-16" />
              <div className="skeleton h-10 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <form id="record-form" onSubmit={submit}>
          {error && (
            <div className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.71875rem] text-rose-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            {visibleColumns.map((column) => {
              const value = values[column.key] ?? ''
              const isSecret = column.type === 'password' || column.masked
              const isShown = visible[column.key]
              const strength = isSecret ? passwordStrength(value) : null
              const wide = column.type === 'textarea' || column.type === 'url'
              const hint = column.placeholder || t('输入{label}', { label: column.label })
              return (
                <Field
                  key={column.key}
                  className={wide ? 'sm:col-span-2' : undefined}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {column.label}
                      {column.secret ? (
                        <Lock className="size-2.5 text-amber-300" />
                      ) : (
                        <ShieldCheck className="size-2.5 text-[var(--msv-accent-text)]/70" />
                      )}
                    </span>
                  }
                  required={column.required}
                  error={errors[column.key]}
                  htmlFor={`field-${column.key}`}
                >
                  {column.type === 'textarea' ? (
                    <textarea
                      id={`field-${column.key}`}
                      className={cn('msv-input', errors[column.key] && 'border-rose-400/50')}
                      rows={3}
                      value={value}
                      placeholder={hint}
                      onChange={(event) => update(column.key, event.target.value)}
                    />
                  ) : column.type === 'select' ? (
                    <SelectMenu
                      ariaLabel={column.label}
                      placeholder={t('未选择')}
                      value={value}
                      items={[
                        { value: '', label: t('未选择') },
                        ...column.options.map((option) => ({ value: option, label: option })),
                      ]}
                      onChange={(next) => update(column.key, next)}
                    />
                  ) : isSecret ? (
                    <div>
                      <div className="relative">
                        <input
                          id={`field-${column.key}`}
                          className={cn(
                            'msv-input pr-[68px] font-mono text-[0.78125rem]',
                            errors[column.key] && 'border-rose-400/50',
                          )}
                          type={isShown ? 'text' : 'password'}
                          value={value}
                          autoComplete="new-password"
                          spellCheck={false}
                          placeholder={column.placeholder || t('输入或生成密码')}
                          onChange={(event) => update(column.key, event.target.value)}
                        />
                        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                          <button
                            type="button"
                            aria-label={isShown ? t('隐藏密码') : t('显示密码')}
                            className="grid size-7 place-items-center rounded-md text-ice-500 transition hover:bg-[var(--msv-tint)] hover:text-ice-200"
                            onClick={() =>
                              setVisible((current) => ({
                                ...current,
                                [column.key]: !current[column.key],
                              }))
                            }
                          >
                            {isShown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          </button>
                          <button
                            type="button"
                            aria-label={t('生成随机密码')}
                            title={t('生成 20 位随机强密码')}
                            disabled={generating === column.key}
                            className="grid size-7 place-items-center rounded-md text-teal-300 transition hover:bg-teal-400/10 hover:text-teal-200"
                            onClick={() => generate(column.key)}
                          >
                            {generating === column.key ? (
                              <Spinner className="size-3.5" />
                            ) : (
                              <Wand2 className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                      {isSecret && value && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="flex flex-1 gap-1">
                            {[0, 1, 2, 3].map((index) => (
                              <span
                                key={index}
                                className={cn(
                                  'h-0.5 flex-1 rounded-full',
                                  index < (strength?.score ?? 0)
                                    ? strength?.tone
                                    : 'bg-[var(--msv-tint-strong)]',
                                )}
                              />
                            ))}
                          </div>
                          <span className="text-[0.6875rem] text-ice-600">{strength?.label}</span>
                        </div>
                      )}
                    </div>
                  ) : column.type === 'date' ? (
                    <input
                      id={`field-${column.key}`}
                      className={cn('msv-input', errors[column.key] && 'border-rose-400/50')}
                      type="date"
                      value={value}
                      onChange={(event) => update(column.key, event.target.value)}
                    />
                  ) : isSuggestable(column) ? (
                    <SuggestInput
                      id={`field-${column.key}`}
                      value={value}
                      suggestions={suggestions[column.key] ?? []}
                      placeholder={hint}
                      className={cn(
                        isMonospaceColumn(column) && 'font-mono text-[0.78125rem] tabular-nums',
                        errors[column.key] && 'border-rose-400/50',
                      )}
                      onChange={(next) => update(column.key, next)}
                    />
                  ) : (
                    <input
                      id={`field-${column.key}`}
                      className={cn(
                        'msv-input',
                        isMonospaceColumn(column) && 'font-mono text-[0.78125rem] tabular-nums',
                        errors[column.key] && 'border-rose-400/50',
                      )}
                      type="text"
                      inputMode={column.type === 'number' ? 'numeric' : undefined}
                      value={value}
                      placeholder={hint}
                      onChange={(event) => update(column.key, event.target.value)}
                    />
                  )}
                </Field>
              )
            })}
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-lg border border-teal-400/15 bg-teal-400/[0.035] px-3 py-2.5 text-[0.71875rem] leading-relaxed text-ice-500">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-teal-300" />
            {secretFields.length
              ? t(
                  '本页每个字段都以 AES-256-GCM 密文保存；其中 {n} 个密码字段额外使用由数据密钥派生的独立子密钥。忘记打开密码时需要恢复密钥才能解密。',
                  { n: secretFields.length },
                )
              : t(
                  '本页每个字段都以 AES-256-GCM 密文保存，认证标签绑定记录与字段，可防止篡改与拼接。忘记打开密码时需要恢复密钥才能解密。',
                )}
          </div>
        </form>
      )}
    </ModalFrame>
  )
}
