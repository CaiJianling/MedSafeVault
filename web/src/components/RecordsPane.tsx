import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileDown,
  FileSpreadsheet,
  KeyRound,
  Link2,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, copyText } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { translateServerText, useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { Column, ConnectMode, ConnectResult, ExcelPreview, Page, RecordItem } from '../lib/types'
import { cn, relativeTime, shortPath } from '../lib/utils'
import { ExcelExportDialog } from './ExcelExportDialog'
import { ExcelImportDialog } from './ExcelImportDialog'
import { ExcelUnlockDialog } from './ExcelUnlockDialog'
import { PageIcon } from './PageIcon'
import {
  ContextMenu,
  Dropdown,
  EmptyState,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  NumText,
  PlainButton,
  SelectMenu,
  Spinner,
  Tip,
} from './primitives'
import { RecordDialog } from './RecordDialog'
import { RecordTable } from './RecordTable'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export function RecordsPane({
  page,
  refreshToken,
  compact,
  onChanged,
  onEditPage,
  onAddPage,
  onConnectResult,
}: {
  page: Page | null
  refreshToken: number
  compact: boolean
  onChanged: () => void
  onEditPage: () => void
  onAddPage: () => void
  onConnectResult?: (result: ConnectResult) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [rows, setRows] = useState<RecordItem[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshLocal, setRefreshLocal] = useState(0)
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordId, setRecordId] = useState<number | null>(null)
  const [preview, setPreview] = useState<ExcelPreview | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [lockedFile, setLockedFile] = useState<string | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [excelBusy, setExcelBusy] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pageInput, setPageInput] = useState('')
  const [rowMenu, setRowMenu] = useState<{
    row: RecordItem
    x: number
    y: number
  } | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelected(new Set())
    setRowMenu(null)
  }, [page?.id, appliedQuery, sortKey, sortDir, limit])

  useEffect(() => {
    setExportOpen(false)
    setLockedFile(null)
    setImportPassword('')
  }, [page?.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedQuery(query.trim())
      setOffset(0)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [query])

  const load = useCallback(async () => {
    if (!page) return
    setLoading(true)
    setError('')
    try {
      const result = await api.listRecords(
        page.id,
        appliedQuery,
        offset,
        limit,
        sortKey,
        sortDir,
      )
      setRows(result.rows)
      setColumns(result.columns)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('无法加载记录'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [page?.id, appliedQuery, offset, limit, sortKey, sortDir, t])

  useEffect(() => {
    load()
  }, [load, refreshToken, refreshLocal])

  useEffect(() => {
    if (offset > 0 && offset >= total && total >= 0 && !loading) {
      setOffset(Math.max(0, (Math.ceil(total / limit) - 1) * limit))
    }
  }, [total, offset, limit, loading])

  const secretCount = page?.columns.filter((column) => column.secret).length ?? 0
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.floor(offset / limit) + 1
  const initialLoading = loading && rows.length === 0
  const displayColumns = columns.length
    ? columns
    : (page?.columns.filter((column) => column.visible) ?? [])

  function sortBy(key: string) {
    if (sortKey === key) {
      setSortDir((value) => (value === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setOffset(0)
  }

  function jumpToPage(raw: string) {
    setPageInput('')
    const target = Math.round(Number(raw))
    if (!Number.isFinite(target) || target <= 0) return
    const pages = Math.max(1, Math.ceil(total / limit))
    const next = Math.min(target, pages)
    setOffset((next - 1) * limit)
  }

  function openNew() {
    setRecordId(null)
    setRecordOpen(true)
  }

  function openEdit(row: RecordItem) {
    setRecordId(row.id)
    setRecordOpen(true)
  }

  async function removeRecord(row: RecordItem) {
    const ok = await confirm({
      title: t('删除这条记录？'),
      description: t('「{name}」会被移入回收站，可随时恢复。', { name: row.title }),
      confirmText: t('移入回收站'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.deleteRecord(row.id)
      toast.success(
        t('记录已移入回收站'),
        t('「{name}」可在回收站中恢复', { name: row.title }),
      )
      setRefreshLocal((value) => value + 1)
      onChanged()
    } catch (err) {
      toast.error(t('删除失败'), err instanceof ApiError ? err.message : t('请重试'))
    }
  }

  async function connect(row: RecordItem, mode: ConnectMode | '' = '') {
    try {
      const result = await api.connect(row.id, mode)
      toast.success(t('连接已启动'), translateServerText(result.message))
      onConnectResult?.(result)
    } catch (err) {
      toast.error(
        t('无法连接'),
        err instanceof ApiError ? err.message : t('请检查地址与客户端配置'),
      )
    }
  }

  function toggleRow(row: RecordItem) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set())
  }

  /** Rows keep masked cells, so copy pulls the real value through the API. */
  async function rowText(row: RecordItem) {
    const cells: string[] = []
    for (const column of columns) {
      const cell = row.cells[column.key]
      if (!cell?.has) continue
      if (cell.masked) {
        try {
          cells.push((await api.revealSecret(row.id, column.key)).value)
        } catch {
          cells.push('')
        }
      } else {
        cells.push(cell.value)
      }
    }
    return cells.join('\t')
  }

  async function copyRow(row: RecordItem) {
    try {
      await copyText(await rowText(row))
      toast.success(t('已复制整行'), row.title)
    } catch {
      toast.error(t('复制失败'), t('无法写入剪贴板'))
    }
  }

  async function copySelection() {
    const chosen = rows.filter((row) => selected.has(row.id))
    if (!chosen.length) return
    try {
      const header = columns.map((column) => column.label).join('\t')
      const body = await Promise.all(chosen.map((row) => rowText(row)))
      await copyText([header, ...body].join('\n'))
      toast.success(
        t('已复制 {n} 条记录', { n: chosen.length }),
        t('已包含表头，可直接粘贴到 Excel'),
      )
    } catch {
      toast.error(t('复制失败'), t('无法写入剪贴板'))
    }
  }

  async function deleteSelection() {
    const ids = [...selected]
    if (!ids.length) return
    const ok = await confirm({
      title: t('移入回收站 {n} 条记录？', { n: ids.length }),
      description: t('选中的记录会一起移入回收站，可以逐条撤回或恢复。'),
      confirmText: t('移入回收站'),
      tone: 'danger',
    })
    if (!ok) return
    setBulkBusy(true)
    try {
      const result = await api.deleteRecords(ids)
      toast.success(
        t('{n} 条记录已移入回收站', { n: result.moved.length }),
        result.skipped ? t('{n} 条无法删除', { n: result.skipped }) : undefined,
      )
      setSelected(new Set())
      setRefreshLocal((value) => value + 1)
      onChanged()
    } catch (err) {
      toast.error(t('删除失败'), err instanceof ApiError ? err.message : t('请重试'))
    } finally {
      setBulkBusy(false)
    }
  }

  async function startImport() {
    if (!page || excelBusy) return
    setExcelBusy('preview')
    try {
      const result = await api.previewExcel(page.id)
      if (result.cancelled) return
      if (result.locked && result.path) {
        setLockedFile(result.path)
        return
      }
      if (result.preview) {
        setImportPassword('')
        setPreview(result.preview)
        setPreviewOpen(true)
      }
    } catch (err) {
      toast.error(t('无法读取文件'), err instanceof ApiError ? err.message : t('请检查 Excel 格式'))
    } finally {
      setExcelBusy('')
    }
  }

  async function unlockExcel(file: string, password: string) {
    if (!page) return
    const result = await api.previewExcelFile(page.id, file, password)
    if (result.locked || !result.preview) {
      throw new Error(t('Excel 打开密码不正确'))
    }
    // Keep the password for the later import step; the unlock dialog closes
    // because the file is no longer locked.
    setImportPassword(password)
    setPreview(result.preview)
    setLockedFile(null)
    setPreviewOpen(true)
  }

  async function exportExcel(password: string) {
    if (!page) return
    setExcelBusy('export')
    try {
      const result = await api.exportExcel(page.id, password)
      if (result.cancelled) return
      const detail = password
        ? t('{n} 条记录已写入（已设置打开密码）\n{path}', {
            n: result.count ?? 0,
            path: shortPath(result.path ?? ''),
          })
        : t('{n} 条记录已写入\n{path}', {
            n: result.count ?? 0,
            path: shortPath(result.path ?? ''),
          })
      toast.success(t('导出完成'), detail, { duration: 7000 })
    } finally {
      setExcelBusy('')
    }
  }

  async function exportTemplate() {
    if (!page || excelBusy) return
    setExcelBusy('template')
    try {
      const result = await api.exportTemplate(page.id)
      if (result.cancelled) return
      toast.success(t('导入模板已生成'), shortPath(result.path ?? ''), { duration: 7000 })
    } catch (err) {
      toast.error(t('生成模板失败'), err instanceof ApiError ? err.message : t('请重试'))
    } finally {
      setExcelBusy('')
    }
  }

  if (!page) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<KeyRound className="size-6" />}
          title={t('还没有可用页面')}
          description={t(
            '创建一个页面，为服务器、网络设备或业务系统建立自己的字段结构。',
          )}
          action={
            <button
              type="button"
              onClick={onAddPage}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105"
            >
              <Plus className="size-4" />
              {t('新建页面')}
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <section className="panel-soft flex shrink-0 flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-[color-mix(in_srgb,var(--msv-accent)_22%,transparent)] bg-[linear-gradient(140deg,var(--msv-accent-soft),color-mix(in_srgb,var(--msv-accent)_4%,transparent))] text-[var(--msv-accent-text)]">
          <PageIcon name={page.icon} className="size-[19px]" />
          <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-[var(--msv-surface)] bg-emerald-400" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-[1.0625rem] font-semibold tracking-tight text-ice-200">
              {page.name}
            </h2>
            <span className="chip chip-mint shrink-0">
              <ShieldCheck className="size-3" />
              {t('已加密')}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.71875rem] text-ice-600">
            <span className="truncate">{page.description || t('暂无页面说明')}</span>
            <span className="hidden h-2.5 w-px bg-line sm:block" />
            <NumText text={t('{n} 条记录', { n: total })} />
            <NumText text={t('{n} 个密码字段', { n: secretCount })} />
            <span className="hidden items-center gap-1 lg:inline-flex">
              <ShieldCheck className="size-3 text-[var(--msv-accent-text)]" />
              {t('全部字段已加密')}
            </span>
            <NumText text={t('更新于 {time}', { time: relativeTime(page.updated_at) })} />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={openNew}
            className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[0.78125rem] font-semibold transition hover:brightness-105 active:scale-[0.99]"
          >
            <Plus className="size-4" />
            {t('新增记录')}
          </button>

          <Dropdown
            width="w-60"
            trigger={
              <PlainButton className="h-9">
                <FileSpreadsheet className="size-3.5 text-[var(--msv-accent-text)]" />
                Excel
                {excelBusy ? <Spinner className="size-3" /> : <ChevronDown className="size-3" />}
              </PlainButton>
            }
          >
            <MenuLabel>{t('导入与导出')}</MenuLabel>
            <MenuItem
              icon={<Upload className="size-3.5" />}
              label={excelBusy === 'preview' ? t('正在选择文件…') : t('从 Excel / CSV 导入')}
              onSelect={startImport}
              disabled={Boolean(excelBusy)}
            />
            <MenuItem
              icon={<Download className="size-3.5" />}
              label={excelBusy === 'export' ? t('正在导出…') : t('导出当前页 Excel')}
              onSelect={() => setExportOpen(true)}
              disabled={Boolean(excelBusy) || (page.record_count ?? total) === 0}
            />
            <MenuSeparator />
            <MenuItem
              icon={<FileDown className="size-3.5" />}
              label={t('下载导入模板')}
              onSelect={exportTemplate}
              disabled={Boolean(excelBusy)}
            />
          </Dropdown>

          <IconButton
            label={t('页面设置')}
            tip={t('页面设置与列配置')}
            onPress={onEditPage}
          >
            <Settings2 className="size-4" />
          </IconButton>
          <IconButton
            label={t('刷新')}
            tip={t('刷新记录')}
            onPress={() => setRefreshLocal((value) => value + 1)}
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          </IconButton>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-[var(--msv-surface)]">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative w-full max-w-[320px] min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ice-600" />
            <input
              ref={searchRef}
              className="msv-input h-8 pl-8 pr-8 text-[0.75rem]"
              placeholder={t('搜索名称、地址、账号、备注…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label={t('清除搜索')}
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-ice-600 hover:bg-[var(--msv-tint-strong)] hover:text-ice-300"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-[0.71875rem] text-ice-600">
            {appliedQuery ? (
              <NumText text={t('找到 {n} 条匹配记录', { n: total })} />
            ) : (
              <NumText text={t('共 {n} 条 · 每页 {size} 条', { n: total, size: limit })} />
            )}
          </div>

          <div className="flex-1" />

          {sortKey && (
            <button
              type="button"
              onClick={() => {
                setSortKey(null)
                setSortDir('asc')
                setOffset(0)
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--msv-accent)_25%,transparent)] bg-[var(--msv-accent-soft)] px-2 text-[0.71875rem] text-[var(--msv-accent-text)] transition hover:brightness-105"
            >
              {t('排序：{label}', {
                label: columns.find((column) => column.key === sortKey)?.label ?? sortKey,
              })}
              <span>{sortDir === 'asc' ? '↑' : '↓'}</span>
              <X className="size-2.5" />
            </button>
          )}

          <span className="hidden items-center gap-1.5 text-[0.6875rem] text-ice-600 lg:inline-flex">
            <Link2 className="size-3" />
            {t('双击行可编辑')}
          </span>
        </div>

        {error ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<ShieldCheck className="size-6 text-rose-300" />}
              title={t('无法加载记录')}
              description={error}
              action={
                <button
                  type="button"
                  onClick={() => setRefreshLocal((value) => value + 1)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 text-[0.75rem] text-ice-300 transition hover:bg-[var(--msv-tint)]"
                >
                  <RefreshCw className="size-3.5" />
                  {t('重试')}
                </button>
              }
            />
          </div>
        ) : rows.length === 0 && !loading ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={appliedQuery ? <Search className="size-6" /> : <KeyRound className="size-6" />}
              title={
                appliedQuery ? t('没有找到「{q}」', { q: appliedQuery }) : t('这个页面还没有记录')
              }
              description={
                appliedQuery
                  ? t('搜索会匹配所有字段，包括已加密的用户名与密码。试试更短的关键词。')
                  : t('手动添加第一条记录，或从现有 Excel 表格批量导入。密码类字段会自动加密。')
              }
              action={
                appliedQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      searchRef.current?.focus()
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 text-[0.75rem] text-ice-300 transition hover:bg-[var(--msv-tint)]"
                  >
                    <X className="size-3.5" />
                    {t('清除搜索')}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openNew}
                      className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105"
                    >
                      <Plus className="size-4" />
                      {t('新增记录')}
                    </button>
                    <button
                      type="button"
                      onClick={startImport}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3.5 text-[0.75rem] text-ice-300 transition hover:bg-[var(--msv-tint)]"
                    >
                      <Upload className="size-3.5" />
                      {t('导入 Excel')}
                    </button>
                  </div>
                )
              }
            />
          </div>
        ) : (
          <RecordTable
            columns={displayColumns}
            rows={rows}
            loading={initialLoading}
            compact={compact}
            sortKey={sortKey}
            sortDir={sortDir}
            selected={selected}
            onSort={sortBy}
            onEdit={openEdit}
            onDelete={removeRecord}
            onConnect={connect}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            onRowMenu={(row, position) => setRowMenu({ row, ...position })}
          />
        )}

        {selected.size > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-[var(--msv-accent-soft)] px-3 py-2 animate-fade-up">
            <span className="inline-flex items-center gap-1.5 text-[0.71875rem] font-medium text-[var(--msv-accent-text)]">
              <ListChecks className="size-3.5" />
              {t('已选择 {n} 条', { n: selected.size })}
            </span>
            <span className="hidden h-3 w-px bg-line sm:block" />
            <button
              type="button"
              onClick={copySelection}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-[var(--msv-surface)] px-2 text-[0.71875rem] text-ice-300 transition hover:border-line-strong hover:text-ice-200"
            >
              <Copy className="size-3" />
              {t('复制所选')}
            </button>
            <button
              type="button"
              onClick={deleteSelection}
              disabled={bulkBusy}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-400/[0.08] px-2 text-[0.71875rem] text-rose-200 transition hover:bg-rose-400/[0.14] disabled:opacity-50"
            >
              {bulkBusy ? <Spinner className="size-3" /> : <Trash2 className="size-3" />}
              {t('移入回收站')}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[0.71875rem] text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
            >
              <X className="size-3" />
              {t('清除选择')}
            </button>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-3 py-2">
          <div className="flex items-center gap-2 text-[0.71875rem] text-ice-600">
            <span className={cn('tabular-nums', total > 0 && 'font-mono')}>
              {total === 0
                ? t('暂无记录')
                : `${offset + 1}–${Math.min(offset + rows.length, total)} / ${total}`}
            </span>
            <span className="hidden h-3 w-px bg-line sm:block" />
            <div className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap sm:flex">
              <span className="shrink-0">{t('每页')}</span>
              <SelectMenu
                ariaLabel={t('每页条数')}
                align="center"
                centered
                className="h-6 w-[56px] shrink-0 gap-1 rounded-md px-1.5 text-[0.71875rem] text-ice-400"
                value={String(limit)}
                items={PAGE_SIZE_OPTIONS.map((size) => ({
                  value: String(size),
                  label: String(size),
                }))}
                onChange={(value) => {
                  setLimit(Number(value))
                  setOffset(0)
                }}
              />
              <span className="shrink-0">{t('条')}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Tip text={t('上一页')}>
              <button
                type="button"
                aria-label={t('上一页')}
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="grid size-7 place-items-center rounded-md border border-line text-ice-500 transition hover:border-line-strong hover:text-ice-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" />
              </button>
            </Tip>
            <span className="min-w-[64px] text-center font-mono text-[0.71875rem] text-ice-500">
              {currentPage} / {pageCount}
            </span>
            <Tip text={t('下一页')}>
              <button
                type="button"
                aria-label={t('下一页')}
                disabled={offset + limit >= total || loading}
                onClick={() => setOffset(offset + limit)}
                className="grid size-7 place-items-center rounded-md border border-line text-ice-500 transition hover:border-line-strong hover:text-ice-200 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </Tip>

            {pageCount > 1 && (
              <div className="ml-1 flex items-center gap-1.5 text-[0.71875rem] text-ice-600">
                <span className="hidden h-3 w-px bg-line lg:block" />
                <span className="shrink-0">{t('跳至')}</span>
                <input
                  aria-label={t('跳转到第几页')}
                  className="h-6 w-[46px] rounded-md border border-line bg-[var(--msv-surface)] px-1.5 text-center font-mono text-[0.71875rem] text-ice-300 outline-none transition focus:border-[color-mix(in_srgb,var(--msv-accent)_62%,transparent)]"
                  value={pageInput}
                  inputMode="numeric"
                  placeholder={String(currentPage)}
                  onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      jumpToPage(pageInput)
                    }
                    if (event.key === 'Escape') setPageInput('')
                  }}
                  onBlur={() => jumpToPage(pageInput)}
                />
                <span className="shrink-0">
                  {t('页')} · {t('共 {n} 页', { n: pageCount })}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      <ContextMenu
        position={rowMenu ? { x: rowMenu.x, y: rowMenu.y } : null}
        onClose={() => setRowMenu(null)}
        width="w-60"
      >
        {rowMenu && (
          <>
            <MenuLabel>{rowMenu.row.title}</MenuLabel>
            <MenuItem
              icon={<Pencil className="size-3.5" />}
              label={t('编辑记录')}
              onSelect={() => openEdit(rowMenu.row)}
            />
            <MenuItem
              icon={<Link2 className="size-3.5" />}
              label={t('打开连接')}
              onSelect={() => connect(rowMenu.row)}
            />
            <MenuItem
              icon={<Copy className="size-3.5" />}
              label={t('复制整行')}
              hint={t('含密码')}
              onSelect={() => copyRow(rowMenu.row)}
            />
            <MenuSeparator />
            <MenuItem
              icon={selected.has(rowMenu.row.id) ? <Check className="size-3.5" /> : undefined}
              label={selected.has(rowMenu.row.id) ? t('取消选择') : t('选择此记录')}
              onSelect={() => toggleRow(rowMenu.row)}
            />
            <MenuItem
              icon={<Trash2 className="size-3.5" />}
              label={t('移入回收站')}
              danger
              onSelect={() => removeRecord(rowMenu.row)}
            />
          </>
        )}
      </ContextMenu>

      <RecordDialog
        open={recordOpen}
        page={page}
        recordId={recordId}
        onOpenChange={setRecordOpen}
        onSaved={() => {
          setRefreshLocal((value) => value + 1)
          onChanged()
        }}
      />

      <ExcelImportDialog
        open={previewOpen}
        preview={preview}
        password={importPassword}
        pageName={page.name}
        onOpenChange={(open) => {
          setPreviewOpen(open)
          if (!open) {
            setPreview(null)
            setImportPassword('')
          }
        }}
        onImported={() => {
          setRefreshLocal((value) => value + 1)
          onChanged()
        }}
      />

      <ExcelExportDialog
        open={exportOpen}
        pageName={page.name}
        rowCount={page.record_count ?? total}
        onOpenChange={setExportOpen}
        onConfirm={exportExcel}
      />

      <ExcelUnlockDialog
        open={Boolean(lockedFile)}
        fileName={(lockedFile ?? '').split(/[\\/]/).pop() || lockedFile || ''}
        onOpenChange={(open) => {
          if (!open) setLockedFile(null)
        }}
        onSubmit={(password) => {
          if (lockedFile) return unlockExcel(lockedFile, password)
          return undefined
        }}
      />
    </div>
  )
}
