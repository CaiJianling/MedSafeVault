import {
  ArchiveRestore,
  FileText,
  Layers,
  ShieldAlert,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { RecycleList } from '../lib/types'
import { cn, relativeTime } from '../lib/utils'
import { PageIcon } from './PageIcon'
import { DrawerFrame, EmptyState, Segmented, Spinner, Tip } from './primitives'

export function RecycleDrawer({
  open,
  onOpenChange,
  onChanged,
  onPageRestored,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  onPageRestored: (pageId: number) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [data, setData] = useState<RecycleList | null>(null)
  const [tab, setTab] = useState<'pages' | 'records'>('pages')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.getRecycle()
      setData(result)
    } catch (error) {
      toast.error(
        t('无法加载回收站'),
        error instanceof ApiError ? error.message : t('请稍后重试'),
      )
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function restorePage(id: number, name: string) {
    setBusy(`page-${id}`)
    try {
      await api.restorePage(id)
      toast.success(t('页面已恢复'), t('「{name}」及其记录已回到密码库', { name }))
      await load()
      onPageRestored(id)
      onChanged()
    } catch (error) {
      toast.error(t('恢复失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy(null)
    }
  }

  async function restoreRecord(id: number, title: string) {
    setBusy(`record-${id}`)
    try {
      await api.restoreRecord(id)
      toast.success(t('记录已恢复'), t('「{name}」已回到原页面', { name: title }))
      await load()
      onChanged()
    } catch (error) {
      toast.error(t('恢复失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy(null)
    }
  }

  async function purge(kind: 'page' | 'record', id: number, name: string) {
    const ok = await confirm({
      title: t('永久删除？'),
      description: t(
        '「{name}」将被永久销毁，数据库中的密文与历史快照都会清理，无法恢复。\n建议先确认已导出备份。',
        { name },
      ),
      confirmText: t('永久删除'),
      tone: 'danger',
      requireText: t('删除'),
      icon: <Trash2 className="size-5" />,
    })
    if (!ok) return
    setBusy(`${kind}-${id}`)
    try {
      if (kind === 'page') await api.purgePage(id)
      else await api.purgeRecord(id)
      toast.success(t('已永久删除'), t('「{name}」已从回收站清除', { name }))
      await load()
      onChanged()
    } catch (error) {
      toast.error(t('删除失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy(null)
    }
  }

  async function emptyAll() {
    if (!data?.counts.pages && !data?.counts.records) return
    const ok = await confirm({
      title: t('清空回收站？'),
      description: t(
        '将永久删除 {pages} 个页面与 {records} 条记录，包含它们的所有加密数据与历史快照，此操作无法撤回。',
        { pages: data.counts.pages, records: data.counts.records },
      ),
      confirmText: t('清空回收站'),
      tone: 'danger',
      requireText: t('清空'),
      icon: <ShieldAlert className="size-5" />,
    })
    if (!ok) return
    setEmptying(true)
    try {
      const result = await api.emptyRecycle()
      toast.success(
        t('回收站已清空'),
        t('永久删除 {pages} 个页面、{records} 条记录', {
          pages: result.pages,
          records: result.records,
        }),
      )
      await load()
      onChanged()
    } catch (error) {
      toast.error(t('清空失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setEmptying(false)
    }
  }

  const pages = data?.pages ?? []
  const records = data?.records ?? []
  const counts = data?.counts ?? { pages: 0, records: 0 }
  const empty = tab === 'pages' ? pages.length === 0 : records.length === 0

  return (
    <DrawerFrame
      open={open}
      onOpenChange={onOpenChange}
      width="620px"
      icon={<Trash2 className="size-4" />}
      title={t('回收站')}
      description={t('删除的页面与记录会保留在这里，数据仍以密文存储，可随时恢复。')}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[0.71875rem] text-ice-600">
            <ArchiveRestore className="size-3" />
            {t('{pages} 个页面 · {records} 条记录', {
              pages: counts.pages,
              records: counts.records,
            })}
          </span>
          <button
            type="button"
            onClick={emptyAll}
            disabled={emptying || (!counts.pages && !counts.records)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.71875rem] text-rose-300 transition hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {emptying ? <Spinner className="size-3" /> : <Trash2 className="size-3.5" />}
            {t('清空回收站')}
          </button>
        </div>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={(value) => setTab(value)}
          items={[
            { value: 'pages', label: t('页面'), count: counts.pages },
            { value: 'records', label: t('记录'), count: counts.records },
          ]}
        />
        <span className="text-[0.6875rem] text-ice-600">{t('恢复后可继续使用原加密数据')}</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-line bg-[var(--msv-tint)] p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <div className="skeleton size-8 rounded-lg" />
                <div className="skeleton h-3.5 w-36" />
              </div>
              <div className="skeleton h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : empty ? (
        <EmptyState
          icon={<Trash2 className="size-6" />}
          title={tab === 'pages' ? t('回收站里没有页面') : t('回收站里没有记录')}
          description={
            tab === 'pages'
              ? t('删除页面时会连同其记录一起移入这里，可在确认无误后永久清空。')
              : t('删除单条记录后会出现在这里，恢复后回到原页面。')
          }
        />
      ) : tab === 'pages' ? (
        <div className="space-y-2">
          {pages.map((page) => (
            <article
              key={page.id}
              className="group flex items-start gap-3 rounded-xl border border-line bg-[var(--msv-tint)] p-3.5 transition hover:border-line-strong hover:bg-[var(--msv-tint)]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-[var(--msv-tint)] text-ice-500">
                <PageIcon name={page.icon} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="truncate text-[0.8125rem] font-medium text-ice-200">
                    {page.name}
                  </h4>
                  <span className="chip shrink-0">{t('{n} 条记录', { n: page.record_count })}</span>
                </div>
                <p className="mt-0.5 truncate text-[0.71875rem] text-ice-600">
                  {page.description || t('无页面说明')}
                </p>
                <div className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-ice-600">
                  <Layers className="size-3" />
                  {t('删除于 {time}', { time: page.deleted_at })}
                  <span className="text-ice-500">· {relativeTime(page.deleted_at)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => restorePage(page.id, page.name)}
                  disabled={Boolean(busy)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-teal-400/25 bg-teal-400/[0.07] px-2.5 text-[0.71875rem] text-teal-200 transition hover:bg-teal-400/[0.13] disabled:opacity-45"
                >
                  {busy === `page-${page.id}` ? (
                    <Spinner className="size-3" />
                  ) : (
                    <Undo2 className="size-3.5" />
                  )}
                  {t('恢复')}
                </button>
                <Tip text={t('永久删除')}>
                  <button
                    type="button"
                    aria-label={t('永久删除页面')}
                    onClick={() => purge('page', page.id, page.name)}
                    disabled={Boolean(busy)}
                    className="grid size-8 place-items-center rounded-lg text-ice-600 transition hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </Tip>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record) => (
            <article
              key={record.id}
              className="flex items-start gap-3 rounded-xl border border-line bg-[var(--msv-tint)] p-3.5 transition hover:border-line-strong hover:bg-[var(--msv-tint)]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-[var(--msv-tint)] text-ice-500">
                <FileText className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="truncate text-[0.8125rem] font-medium text-ice-200">
                    {record.title}
                  </h4>
                  <span className={cn('chip shrink-0', record.page_deleted && 'chip-amber')}>
                    {record.page_name}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.71875rem] text-ice-500">
                  {record.preview.length ? (
                    record.preview.map((item) => (
                      <span key={item.label} className="max-w-[200px] truncate">
                        <span className="text-ice-600">{item.label}：</span>
                        {item.value}
                      </span>
                    ))
                  ) : (
                    <span className="text-ice-600">{t('无可见预览字段')}</span>
                  )}
                </div>
                <div className="mt-1 text-[0.6875rem] text-ice-600">
                  {t('删除于 {time}', { time: record.deleted_at })} ·{' '}
                  {relativeTime(record.deleted_at)}
                  {record.page_deleted && ` · ${t('所属页面也在回收站中')}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => restoreRecord(record.id, record.title)}
                  disabled={Boolean(busy) || record.page_deleted}
                  title={record.page_deleted ? t('请先恢复所属页面') : t('恢复记录')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-teal-400/25 bg-teal-400/[0.07] px-2.5 text-[0.71875rem] text-teal-200 transition hover:bg-teal-400/[0.13] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {busy === `record-${record.id}` ? (
                    <Spinner className="size-3" />
                  ) : (
                    <Undo2 className="size-3.5" />
                  )}
                  {t('恢复')}
                </button>
                <Tip text={t('永久删除')}>
                  <button
                    type="button"
                    aria-label={t('永久删除记录')}
                    onClick={() => purge('record', record.id, record.title)}
                    disabled={Boolean(busy)}
                    className="grid size-8 place-items-center rounded-lg text-ice-600 transition hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </Tip>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5 text-[0.6875rem] leading-relaxed text-ice-600">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
        {t(
          '回收站不会自动清理。永久删除会同时移除相关历史快照；若需要留档，请先导出加密备份。',
        )}
      </p>
    </DrawerFrame>
  )
}
