import {
  Eye,
  EyeOff,
  History,
  Layers,
  Lock,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { translateServerText, useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { HistoryChange, HistoryItem, UndoState } from '../lib/types'
import { cn, dayLabel, formatTime, relativeTime } from '../lib/utils'
import { DrawerFrame, EmptyState, Segmented, Spinner, Tip } from './primitives'

const ACTION_META: Record<string, { label: string; tone: string; icon: LucideIcon }> = {
  create_record: {
    label: '新增',
    tone: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10',
    icon: Plus,
  },
  update_record: {
    label: '修改',
    tone: 'text-teal-300 border-teal-400/25 bg-teal-400/10',
    icon: Pencil,
  },
  delete_record: {
    label: '删除',
    tone: 'text-rose-300 border-rose-400/25 bg-rose-400/10',
    icon: Trash2,
  },
  restore_record: {
    label: '恢复',
    tone: 'text-amber-300 border-amber-400/25 bg-amber-400/10',
    icon: RotateCcw,
  },
  create_page: {
    label: '新建页面',
    tone: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10',
    icon: Layers,
  },
  update_page: {
    label: '页面配置',
    tone: 'text-sky-300 border-sky-400/25 bg-sky-400/10',
    icon: Layers,
  },
  delete_page: {
    label: '删除页面',
    tone: 'text-rose-300 border-rose-400/25 bg-rose-400/10',
    icon: Trash2,
  },
  restore_page: {
    label: '恢复页面',
    tone: 'text-amber-300 border-amber-400/25 bg-amber-400/10',
    icon: RotateCcw,
  },
  import_records: {
    label: 'Excel 导入',
    tone: 'text-indigo-300 border-indigo-400/25 bg-indigo-400/10',
    icon: Upload,
  },
  restore_backup: {
    label: '恢复备份',
    tone: 'text-amber-300 border-amber-400/25 bg-amber-400/10',
    icon: RotateCcw,
  },
  change_master_password: {
    label: '安全设置',
    tone: 'text-teal-300 border-teal-400/25 bg-teal-400/10',
    icon: Lock,
  },
}

function HistoryValue({
  value,
  present,
  tone,
}: {
  value: string
  present: boolean
  tone?: string
}) {
  const { t } = useI18n()
  if (!present) {
    return <span className="text-[0.71875rem] italic text-ice-600">{t('未设置')}</span>
  }
  if (!value) {
    return <span className="text-[0.71875rem] italic text-ice-600">{t('（空）')}</span>
  }
  return (
    <span
      className={cn(
        'break-all font-mono text-[0.71875rem] leading-relaxed',
        tone ?? 'text-ice-300',
      )}
    >
      {value}
    </span>
  )
}

function ChangeRow({ item, change }: { item: HistoryItem; change: HistoryChange }) {
  const { t } = useI18n()
  const [revealed, setRevealed] = useState<{ before: string; after: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const label =
    change.key === '__status' || change.key === 'status'
      ? t('状态')
      : change.key === '__import' || change.key === 'import'
        ? t('导入')
        : translateServerText(change.label)
  const revealLabel = revealed ? t('隐藏历史密码') : t('查看历史密码')

  async function reveal() {
    if (revealed) {
      setRevealed(null)
      return
    }
    setLoading(true)
    try {
      const [before, after] = await Promise.all([
        change.has_before && change.masked
          ? api.revealHistory(item.id, 'before', change.key)
          : Promise.resolve({ value: change.before }),
        change.has_after && change.masked
          ? api.revealHistory(item.id, 'after', change.key)
          : Promise.resolve({ value: change.after }),
      ])
      setRevealed({ before: before.value, after: after.value })
    } catch (error) {
      toast.error(
        t('无法查看历史值'),
        error instanceof ApiError ? error.message : t('解密失败'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="group/change flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-[var(--msv-tint)]">
      <span
        className="mt-0.5 w-[76px] shrink-0 truncate text-[0.71875rem] text-ice-500"
        title={label}
      >
        {label}
      </span>
      <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-start gap-1.5">
        <div className="min-w-0 rounded border border-rose-400/10 bg-rose-400/[0.035] px-2 py-1">
          <HistoryValue
            value={translateServerText(revealed ? revealed.before : change.before)}
            present={change.has_before}
            tone="text-[var(--msv-danger-text)]"
          />
        </div>
        <span className="pt-1 text-[0.6875rem] text-ice-600">→</span>
        <div className="min-w-0 rounded border border-emerald-400/10 bg-emerald-400/[0.035] px-2 py-1">
          <HistoryValue
            value={translateServerText(revealed ? revealed.after : change.after)}
            present={change.has_after}
            tone="text-[var(--msv-success-text)]"
          />
        </div>
      </div>
      {change.masked && (
        <Tip text={revealLabel}>
          <button
            type="button"
            onClick={reveal}
            disabled={loading}
            aria-label={revealLabel}
            className={cn(
              'mt-0.5 grid size-6 shrink-0 place-items-center rounded transition',
              revealed
                ? 'bg-teal-400/10 text-teal-300'
                : 'text-ice-600 opacity-60 hover:bg-[var(--msv-tint-strong)] hover:text-ice-300 group-hover/change:opacity-100',
            )}
          >
            {loading ? (
              <Spinner className="size-3" />
            ) : revealed ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
        </Tip>
      )}
    </div>
  )
}

export function HistoryDrawer({
  open,
  onOpenChange,
  onChanged,
  externalRefresh = 0,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  externalRefresh?: number
}) {
  const { t } = useI18n()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [kind, setKind] = useState<'all' | 'record' | 'page'>('all')
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [undoState, setUndoState] = useState<UndoState | null>(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  const requestRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query.trim()), 260)
    return () => window.clearTimeout(timer)
  }, [query])

  const fetchHistory = useCallback(
    async (offset: number, append: boolean) => {
      const requestId = ++requestRef.current
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const result = await api.getHistory(offset, 40, kind, appliedQuery)
        if (requestId !== requestRef.current) return
        setItems((current) => (append ? [...current, ...result.items] : result.items))
        setTotal(result.total)
        setUndoState(result.undo_state)
      } catch (error) {
        if (requestId !== requestRef.current) return
        toast.error(
          t('无法加载修改历史'),
          error instanceof ApiError ? error.message : t('请稍后重试'),
        )
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [kind, appliedQuery, t],
  )

  useEffect(() => {
    if (!open) return
    fetchHistory(0, false)
  }, [open, fetchHistory, version, externalRefresh])

  async function undo() {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.undo()
      toast.success(t('操作已撤回'), translateServerText(result.message))
      setVersion((value) => value + 1)
      onChanged()
    } catch (error) {
      toast.error(t('撤回失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy(false)
    }
  }

  async function redo() {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.redo()
      toast.success(t('操作已恢复'), translateServerText(result.message))
      setVersion((value) => value + 1)
      onChanged()
    } catch (error) {
      toast.error(t('恢复失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy(false)
    }
  }

  async function undoOne() {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.undo()
      toast.success(t('已撤回'), translateServerText(result.message))
      setVersion((value) => value + 1)
      onChanged()
    } catch (error) {
      toast.error(t('撤回失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy(false)
    }
  }

  const groups = new Map<string, HistoryItem[]>()
  for (const item of items) {
    const label = dayLabel(item.created_at)
    const list = groups.get(label) ?? []
    list.push(item)
    groups.set(label, list)
  }

  return (
    <DrawerFrame
      open={open}
      onOpenChange={onOpenChange}
      width="660px"
      icon={<History className="size-4" />}
      title={t('修改历史')}
      description={t('所有增删改都以加密快照保存 · 共 {n} 条', { n: total })}
      headerExtra={
        <IconButtonRefresh busy={loading} onPress={() => setVersion((value) => value + 1)} />
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Tip
              text={
                undoState?.undo
                  ? translateServerText(undoState.undo.title)
                  : t('没有可撤回的操作')
              }
            >
              <button
                type="button"
                onClick={undo}
                disabled={!undoState?.can_undo || busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Undo2 className="size-3.5" />
                {t('撤回最近')}
              </button>
            </Tip>
            <Tip
              text={
                undoState?.redo ? translateServerText(undoState.redo.title) : t('没有可恢复的操作')
              }
            >
              <button
                type="button"
                onClick={redo}
                disabled={!undoState?.can_redo || busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Redo2 className="size-3.5" />
                {t('重做')}
              </button>
            </Tip>
          </div>
          <span className="truncate text-[0.71875rem] text-ice-600">
            {undoState?.undo
              ? t('最近：{title}', { title: translateServerText(undoState.undo.title) })
              : t('历史记录不会被静默删除')}
          </span>
        </div>
      }
    >
      <div className="sticky -top-4 z-10 -mx-1 mb-3 flex items-center gap-2 bg-ink-900/95 px-1 py-2 backdrop-blur">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ice-600" />
          <input
            className="msv-input h-9 pl-8 text-[0.75rem]"
            placeholder={t('搜索标题、页面…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Segmented
          value={kind}
          onChange={(value) => setKind(value)}
          items={[
            { value: 'all', label: t('全部') },
            { value: 'record', label: t('记录') },
            { value: 'page', label: t('页面') },
          ]}
        />
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-line bg-[var(--msv-tint)] p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <div className="skeleton h-4 w-12" />
                <div className="skeleton h-3 w-40" />
                <div className="skeleton ml-auto h-3 w-16" />
              </div>
              <div className="skeleton h-8 w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title={query ? t('没有匹配的修改') : t('还没有修改记录')}
          description={
            query
              ? t('换一个关键词，或切换到「全部」查看。')
              : t('新增、编辑、删除、导入与页面配置变更都会记录在这里，密码类字段以密文保存。')
          }
        />
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([label, rows]) => (
            <section key={label}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[0.6875rem] font-medium tracking-[0.12em] text-ice-600">
                  {label}
                </span>
                <span className="h-px flex-1 bg-line" />
                <span className="font-mono text-[0.6875rem] text-ice-600">{rows.length}</span>
              </div>
              <div className="space-y-1.5">
                {rows.map((item) => {
                  const meta = ACTION_META[item.action] ?? {
                    label: item.action,
                    tone: 'text-ice-300 border-line bg-[var(--msv-tint)]',
                    icon: History,
                  }
                  const Icon = meta.icon
                  return (
                    <article
                      key={item.id}
                      className={cn(
                        'rounded-xl border border-line bg-[var(--msv-tint)] p-3 transition hover:border-line-strong hover:bg-[var(--msv-tint-strong)]',
                        item.state === 1 && 'opacity-65',
                        item.state === 2 && 'opacity-45',
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border',
                            meta.tone,
                          )}
                        >
                          <Icon className="size-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <h4
                              className="min-w-0 flex-1 truncate text-[0.78125rem] font-medium text-ice-200"
                              title={translateServerText(item.title)}
                            >
                              {translateServerText(item.title)}
                            </h4>
                            <span className="text-[0.6875rem] text-ice-600">{t(meta.label)}</span>
                            {item.state === 1 && (
                              <span className="chip chip-amber shrink-0">{t('已撤回')}</span>
                            )}
                            {item.state === 2 && (
                              <span className="chip shrink-0">{t('已失效')}</span>
                            )}
                            {item.can_undo && (
                              <Tip text={t('撤回这次修改')}>
                                <button
                                  type="button"
                                  onClick={() => undoOne()}
                                  disabled={busy}
                                  aria-label={t('撤回这次修改')}
                                  className="grid size-6 shrink-0 place-items-center rounded text-ice-600 transition hover:bg-teal-400/10 hover:text-teal-300 disabled:opacity-40"
                                >
                                  <RotateCcw className="size-3.5" />
                                </button>
                              </Tip>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-ice-600">
                            <span>{item.page_name || t('密码库')}</span>
                            <span>·</span>
                            <span title={item.created_at}>{relativeTime(item.created_at)}</span>
                            <span className="font-mono text-ice-500">
                              {formatTime(item.created_at)}
                            </span>
                          </div>

                          <div className="mt-2 space-y-px">
                            {item.changes.length ? (
                              item.changes.map((change) => (
                                <ChangeRow
                                  key={`${item.id}-${change.key}`}
                                  item={item}
                                  change={change}
                                />
                              ))
                            ) : (
                              <span className="text-[0.71875rem] italic text-ice-600">
                                {t('无字段级差异')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}

          {items.length < total && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                onClick={() => fetchHistory(items.length, true)}
                disabled={loadingMore}
                className="inline-flex h-8 items-center gap-2 rounded-lg border border-line px-3 text-[0.71875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200 disabled:opacity-50"
              >
                {loadingMore ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
                {t('加载更早的记录（还有 {n} 条）', { n: total - items.length })}
              </button>
            </div>
          )}
        </div>
      )}
    </DrawerFrame>
  )
}

function IconButtonRefresh({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const { t } = useI18n()
  return (
    <Tip text={t('刷新')}>
      <button
        type="button"
        onClick={onPress}
        disabled={busy}
        aria-label={t('刷新修改历史')}
        className="grid size-8 place-items-center rounded-lg border border-line text-ice-500 transition hover:border-line-strong hover:text-ice-200 disabled:opacity-40"
      >
        <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
      </button>
    </Tip>
  )
}
