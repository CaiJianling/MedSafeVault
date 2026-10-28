import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  EyeOff,
  GripVertical,
  KeyRound,
  Lock,
  Plus,
  Settings2,
  ShieldCheck,
  Snowflake,
  Trash2,
  Type,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useConfirm } from '../lib/confirm'
import { toast } from '../lib/toast'
import type { Column, ColumnType, Page, PageTemplate } from '../lib/types'
import { cn } from '../lib/utils'
import { PAGE_ICONS, PageIcon } from './PageIcon'
import { DrawerFrame, SelectMenu, Spinner, Switch } from './primitives'

interface EditableColumn {
  uid: string
  id?: number
  key: string
  label: string
  type: ColumnType
  encrypted: boolean
  masked: boolean
  frozen: boolean
  width: number
  visible: boolean
  required: boolean
  optionsText: string
  placeholder: string
}

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'password', label: '密码' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '下拉选项' },
  { value: 'textarea', label: '多行文本' },
  { value: 'date', label: '日期' },
  { value: 'url', label: '链接' },
]

const TYPE_LABEL: Record<ColumnType, string> = {
  text: '文本',
  password: '密码',
  number: '数字',
  select: '下拉',
  textarea: '多行',
  date: '日期',
  url: '链接',
}

const uid = () => `col_${Math.random().toString(36).slice(2, 10)}`

function toEditable(column: Partial<Column>): EditableColumn {
  return {
    uid: uid(),
    id: column.id,
    key: column.key ?? '',
    label: column.label ?? '',
    type: column.type ?? 'text',
    encrypted: Boolean(column.encrypted),
    masked: Boolean(column.masked),
    frozen: Boolean(column.frozen),
    width: Number(column.width) || 160,
    visible: column.visible !== false,
    required: Boolean(column.required),
    optionsText: (column.options ?? []).join('，'),
    placeholder: column.placeholder ?? '',
  }
}

function blankColumn(): EditableColumn {
  return toEditable({ label: '', type: 'text', width: 160 })
}

export function PageDialog({
  open,
  mode,
  page,
  templates,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  open: boolean
  mode: 'create' | 'edit'
  page: Page | null
  templates: PageTemplate[]
  onOpenChange: (open: boolean) => void
  onSaved: (page: Page, mode: 'create' | 'edit') => void
  onDeleted: (pageId: number) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('grid')
  const [templateId, setTemplateId] = useState('blank')
  const [columns, setColumns] = useState<EditableColumn[]>([blankColumn()])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!open) return
    setError('')
    setExpanded(null)
    if (mode === 'edit' && page) {
      setName(page.name)
      setDescription(page.description)
      setIcon(page.icon)
      setColumns(normalizeFrozen(page.columns.map(toEditable)))
      setTemplateId('')
      return
    }
    const blank = templates.find((item) => item.id === 'blank') ?? templates[templates.length - 1]
    setName('')
    setDescription(blank?.description ?? '')
    setIcon(blank?.icon ?? 'grid')
    setColumns((blank?.columns ?? [blankColumn()]).map(toEditable))
    setTemplateId('blank')
  }, [open, mode, page, templates])

  // A freshly added column can sit far below the fold, so bring it into view.
  useEffect(() => {
    if (!scrollTarget) return
    const node = rowRefs.current[scrollTarget]
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setScrollTarget(null)
  }, [scrollTarget, columns])

  const passwordCount = useMemo(
    () => columns.filter((column) => column.type === 'password').length,
    [columns],
  )

  function applyTemplate(template: PageTemplate) {
    setTemplateId(template.id)
    if (template.id !== 'blank') {
      setName(template.name)
      setDescription(template.description)
    } else {
      setName('')
      setDescription(template.description)
    }
    setIcon(template.icon)
    setColumns(normalizeFrozen(template.columns.map(toEditable)))
    setExpanded(null)
    setError('')
  }

  function updateColumn(index: number, patch: Partial<EditableColumn>) {
    setColumns((current) =>
      current.map((column, position) => (position === index ? { ...column, ...patch } : column)),
    )
    setError('')
  }

  function normalizeFrozen(list: EditableColumn[]): EditableColumn[] {
    let accepting = true
    return list.map((column) => {
      const frozen = accepting && column.frozen
      if (!frozen) accepting = false
      return frozen === column.frozen ? column : { ...column, frozen }
    })
  }

  function toggleFrozen(index: number) {
    setColumns((current) => {
      if (index > 0 && !current[index - 1].frozen) return current
      const unfreeze = current[index].frozen
      return current.map((column, position) => {
        if (position < index) return column
        if (position === index) return { ...column, frozen: !unfreeze }
        return unfreeze ? { ...column, frozen: false } : column
      })
    })
    setError('')
  }

  function move(index: number, delta: number) {
    setColumns((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return normalizeFrozen(next)
    })
  }

  function addColumn() {
    const column = blankColumn()
    setColumns((current) => [...current, column])
    setExpanded(column.uid)
    setScrollTarget(column.uid)
  }

  function removeColumn(index: number) {
    if (columns.length <= 1) {
      setError(t('页面至少需要保留一列'))
      return
    }
    setColumns((current) =>
      normalizeFrozen(current.filter((_, position) => position !== index)),
    )
    setError('')
  }

  async function save() {
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('请填写页面名称'))
      return
    }
    if (trimmed.length > 24) {
      setError(t('页面名称不能超过 24 个字符'))
      return
    }
    if (!columns.length) {
      setError(t('页面至少需要一列'))
      return
    }
    const labels = new Set<string>()
    for (const column of columns) {
      const label = column.label.trim()
      if (!label) {
        setError(t('列名称不能为空'))
        setExpanded(column.uid)
        return
      }
      if (label.length > 24) {
        setError(t('列名称「{label}」不能超过 24 个字符', { label }))
        setExpanded(column.uid)
        return
      }
      if (labels.has(label)) {
        setError(t('列名称「{label}」重复', { label }))
        setExpanded(column.uid)
        return
      }
      labels.add(label)
    }
    setError('')
    setSaving(true)
    try {
      const payload = {
        name: trimmed,
        icon,
        description: description.trim(),
        columns: columns.map((column) => ({
          id: column.id,
          key: column.key,
          label: column.label.trim(),
          type: column.type,
          encrypted: column.encrypted || column.type === 'password',
          masked: column.masked || column.type === 'password',
          frozen: column.frozen,
          width: Math.max(80, Math.min(600, Number(column.width) || 160)),
          visible: column.visible,
          required: column.required,
          placeholder: column.placeholder.trim(),
          options: column.optionsText
            .split(/[,，\n]/)
            .map((item) => item.trim())
            .filter(Boolean),
        })),
      }
      const result =
        mode === 'edit' && page
          ? await api.updatePage(page.id, payload)
          : await api.createPage(payload)
      toast.success(
        mode === 'edit' ? t('页面配置已保存') : t('页面已创建'),
        t('「{name}」· {n} 列', {
          name: result.page.name,
          n: result.page.columns.length,
        }),
      )
      onSaved(result.page, mode)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('保存页面失败'))
    } finally {
      setSaving(false)
    }
  }

  async function removePage() {
    if (!page) return
    const ok = await confirm({
      title: t('删除页面「{name}」？', { name: page.name }),
      description: t(
        '页面与其记录会一起移入回收站，不会立即销毁。你可以在侧边栏的「回收站」中恢复页面及其记录。',
      ),
      confirmText: t('移入回收站'),
      tone: 'danger',
      requireText: page.name,
      icon: <Trash2 className="size-5" />,
    })
    if (!ok) return
    try {
      await api.deletePage(page.id)
      toast.success(t('页面已移入回收站'), t('「{name}」可在回收站中恢复', { name: page.name }))
      onDeleted(page.id)
      onOpenChange(false)
    } catch (err) {
      toast.error(t('删除失败'), err instanceof ApiError ? err.message : t('请重试'))
    }
  }

  return (
    <DrawerFrame
      open={open}
      onOpenChange={onOpenChange}
      width="840px"
      icon={<Settings2 className="size-4" />}
      title={
        mode === 'edit'
          ? t('页面设置 · {name}', { name: page?.name ?? '' })
          : t('新建页面')
      }
      description={
        mode === 'edit'
          ? t('修改名称、图标与列配置。列结构的改动会记录到修改历史。')
          : t('从模板开始，或完全自定义列。列至少需要一列，保存后仍可继续调整。')
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {mode === 'edit' ? (
            <button
              type="button"
              onClick={removePage}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.71875rem] text-rose-300 transition hover:bg-rose-400/10 hover:text-rose-200"
            >
              <Trash2 className="size-3.5" />
              {t('删除页面')}
            </button>
          ) : (
            <span className="text-[0.71875rem] text-ice-600">{t('页面创建后可在「页面设置」中继续调整')}</span>
          )}
          <div className="flex items-center gap-2">
            <span className="mr-1 hidden text-[0.71875rem] text-ice-600 sm:block">
              {t('{n} 列', { n: columns.length })} · {t('密码字段 {n} 个', { n: passwordCount })}
            </span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-9 rounded-lg border border-line px-4 text-[0.78125rem] text-ice-400 transition hover:border-line-strong hover:bg-[var(--msv-tint)] hover:text-ice-200"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg btn-primary px-4 text-[0.78125rem] font-semibold  transition hover:brightness-105 disabled:opacity-50"
            >
              {saving && <Spinner className="size-3.5" />}
              {mode === 'edit' ? t('保存页面') : t('创建页面')}
            </button>
          </div>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.71875rem] text-rose-200">
          {error}
        </div>
      )}

      {mode === 'create' && (
        <section className="mb-5">
          <h3 className="mb-2 text-[0.71875rem] font-medium tracking-[0.1em] text-ice-600">
            {t('起始模板')}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {templates.map((template) => {
              const active = templateId === template.id
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className={cn(
                    'group rounded-xl border p-3 text-left transition',
                    active
                      ? 'border-teal-400/40 bg-teal-400/[0.07] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--msv-accent)_16%,transparent)]'
                      : 'border-line bg-[var(--msv-tint)] hover:border-line-strong hover:bg-[var(--msv-tint)]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'grid size-7 place-items-center rounded-lg border',
                        active
                          ? 'border-teal-400/30 bg-teal-400/10 text-teal-300'
                          : 'border-line bg-[var(--msv-tint)] text-ice-500',
                      )}
                    >
                      <PageIcon name={template.icon} className="size-3.5" />
                    </span>
                    <span className={cn('text-[0.75rem] font-medium', active ? 'text-teal-100' : 'text-ice-300')}>
                      {t(template.name)}
                    </span>
                    <span className="ml-auto font-mono text-[0.6875rem] text-ice-600">
                      {t('{n} 列', { n: template.columns.length })}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-[0.6875rem] leading-relaxed text-ice-600">
                    {t(template.description)}
                  </p>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-line bg-[var(--msv-tint)] p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_220px]">
          <div>
            <label className="field-label" htmlFor="page-name">
              {t('页面名称')}
              <span className="field-required">*</span>
            </label>
            <input
              id="page-name"
              className="msv-input"
              value={name}
              maxLength={24}
              placeholder={t('例如：服务器、网络设备、检验系统')}
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
            />
            <div className="mt-2.5">
              <label className="field-label" htmlFor="page-desc">
                {t('页面说明')}
              </label>
              <input
                id="page-desc"
                className="msv-input"
                value={description}
                maxLength={80}
                placeholder={t('一句话说明这个页面管理什么')}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <div>
            <span className="field-label">{t('页面图标')}</span>
            <div className="grid grid-cols-6 gap-1.5">
              {PAGE_ICONS.map((item) => {
                const Icon = item.icon
                const active = icon === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={t(item.label)}
                    onClick={() => setIcon(item.id)}
                    className={cn(
                      'grid aspect-square place-items-center rounded-lg border transition',
                      active
                        ? 'border-teal-400/40 bg-teal-400/10 text-teal-300'
                        : 'border-line bg-[var(--msv-tint)] text-ice-500 hover:border-line-strong hover:text-ice-300',
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.7} />
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-[0.71875rem] font-medium tracking-[0.1em] text-ice-600">
              {t('列配置')}
            </h3>
            <p className="mt-0.5 text-[0.6875rem] text-ice-600">
              {t(
                '所有字段都会以密文写入数据库，密码字段额外使用独立子密钥；「掩码」列默认显示为圆点；「冻结」列需从第一列开始依次冻结。',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={addColumn}
            disabled={columns.length >= 40}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-teal-400/25 bg-teal-400/[0.06] px-2.5 text-[0.71875rem] text-teal-200 transition hover:bg-teal-400/[0.12] disabled:opacity-40"
          >
            <Plus className="size-3.5" />
            {t('添加列')}
          </button>
        </div>

        <div className="space-y-1.5">
          {columns.map((column, index) => {
            const isOpen = expanded === column.uid
            return (
              <div
                key={column.uid}
                ref={(node) => {
                  rowRefs.current[column.uid] = node
                }}
                className={cn(
                  'overflow-hidden rounded-lg border transition-colors',
                  isOpen ? 'border-teal-400/30 bg-teal-400/[0.025]' : 'border-line bg-[var(--msv-tint)]',
                )}
              >
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : column.uid)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <GripVertical className="size-3.5 shrink-0 text-ice-700" />
                    <span className="w-5 shrink-0 font-mono text-[0.6875rem] text-ice-600">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[0.78125rem]',
                        column.label ? 'text-ice-200' : 'text-ice-600',
                      )}
                    >
                      {column.label || t('未命名列')}
                    </span>
                    <span className="chip shrink-0">{t(TYPE_LABEL[column.type])}</span>
                    {column.type === 'password' ? (
                      <span className="chip chip-amber shrink-0">
                        <Lock className="size-2.5" />
                        {t('强化加密')}
                      </span>
                    ) : (
                      <span className="chip chip-mint shrink-0">
                        <ShieldCheck className="size-2.5" />
                        {t('已加密')}
                      </span>
                    )}
                    {column.masked && (
                      <span className="chip shrink-0">
                        <EyeOff className="size-2.5" />
                        {t('掩码')}
                      </span>
                    )}
                    {column.required && (
                      <span className="chip chip-amber shrink-0">{t('必填')}</span>
                    )}
                    {column.frozen && (
                      <span className="chip chip-mint shrink-0">
                        <Snowflake className="size-2.5" />
                        {t('冻结')}
                      </span>
                    )}
                    {!column.visible && <span className="chip shrink-0">{t('隐藏')}</span>}
                    <ChevronDown
                      className={cn(
                        'size-3.5 shrink-0 text-ice-600 transition-transform',
                        isOpen && 'rotate-180 text-teal-300',
                      )}
                    />
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5">
                    <button
                      type="button"
                      aria-label={column.frozen ? t('取消冻结') : t('冻结列')}
                      title={
                        index > 0 && !columns[index - 1].frozen
                          ? t('请先冻结左侧相邻的列')
                          : column.frozen
                            ? t('取消冻结（其右侧列会一并取消）')
                            : t('固定在表格左侧')
                      }
                      disabled={index > 0 && !columns[index - 1].frozen}
                      onClick={() => toggleFrozen(index)}
                      className={cn(
                        'grid size-6 place-items-center rounded transition disabled:opacity-25',
                        column.frozen
                          ? 'bg-teal-400/10 text-teal-300 hover:bg-teal-400/15'
                          : 'text-ice-600 hover:bg-[var(--msv-tint-strong)] hover:text-ice-300',
                      )}
                    >
                      <Snowflake className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('上移')}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="grid size-6 place-items-center rounded text-ice-600 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-300 disabled:opacity-25"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('下移')}
                      disabled={index === columns.length - 1}
                      onClick={() => move(index, 1)}
                      className="grid size-6 place-items-center rounded text-ice-600 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-300 disabled:opacity-25"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('删除列')}
                      onClick={() => removeColumn(index)}
                      className="grid size-6 place-items-center rounded text-ice-600 transition hover:bg-rose-400/10 hover:text-rose-300"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-line/70 px-3.5 py-3.5 animate-fade-in">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="lg:col-span-2">
                        <label className="field-label">{t('列名称')}</label>
                        <input
                          className="msv-input"
                          value={column.label}
                          maxLength={24}
                          placeholder={t('例如：服务器地址')}
                          onChange={(event) => updateColumn(index, { label: event.target.value })}
                        />
                      </div>
                      <div>
                        <label className="field-label">{t('字段类型')}</label>
                        <SelectMenu
                          ariaLabel={t('字段类型')}
                          value={column.type}
                          items={TYPE_OPTIONS.map((option) => ({
                            ...option,
                            label: t(option.label),
                          }))}
                          onChange={(type) =>
                            updateColumn(index, {
                              type,
                              encrypted: type === 'password' ? true : column.encrypted,
                              masked: type === 'password' ? true : column.masked,
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="field-label">{t('列宽 (px)')}</label>
                        <input
                          className="msv-input"
                          type="number"
                          min={80}
                          max={600}
                          value={column.width}
                          onChange={(event) =>
                            updateColumn(index, { width: Number(event.target.value) })
                          }
                        />
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="field-label">{t('输入提示')}</label>
                        <input
                          className="msv-input"
                          value={column.placeholder}
                          maxLength={60}
                          placeholder={t('例如：203.0.113.10')}
                          onChange={(event) =>
                            updateColumn(index, { placeholder: event.target.value })
                          }
                        />
                      </div>
                      {column.type === 'select' && (
                        <div>
                          <label className="field-label">{t('下拉选项（用逗号分隔）')}</label>
                          <input
                            className="msv-input"
                            value={column.optionsText}
                            placeholder={t('物理机，虚拟机，云主机')}
                            onChange={(event) =>
                              updateColumn(index, { optionsText: event.target.value })
                            }
                          />
                        </div>
                      )}
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-lg border border-line/70 bg-[var(--msv-tint)] px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[0.71875rem] text-ice-400">
                        {column.type === 'password' ? (
                          <>
                            <Lock className="size-3 text-amber-300" />
                            {t('强化加密（独立子密钥）')}
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="size-3 text-[var(--msv-accent-text)]" />
                            {t('加密存储（AES-256-GCM）')}
                          </>
                        )}
                      </span>
                      <label className="flex items-center gap-2 text-[0.71875rem] text-ice-400">
                        <Switch
                          checked={column.masked}
                          onChange={(checked) => updateColumn(index, { masked: checked })}
                        />
                        <span className="inline-flex items-center gap-1">
                          <EyeOff className="size-3" />
                          {t('表格中掩码')}
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-[0.71875rem] text-ice-400">
                        <Switch
                          checked={column.required}
                          onChange={(checked) => updateColumn(index, { required: checked })}
                        />
                        <span className="inline-flex items-center gap-1">
                          <Type className="size-3" />
                          {t('必填')}
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-[0.71875rem] text-ice-400">
                        <Switch
                          checked={column.visible}
                          onChange={(checked) => updateColumn(index, { visible: checked })}
                        />
                        {t('在表格中显示')}
                      </label>
                      <label className="flex items-center gap-2 text-[0.71875rem] text-ice-400">
                        <Switch
                          checked={column.frozen}
                          disabled={index > 0 && !columns[index - 1].frozen}
                          onChange={() => toggleFrozen(index)}
                        />
                        <span className="inline-flex items-center gap-1">
                          <Snowflake className="size-3" />
                          {t('冻结列')}
                        </span>
                      </label>
                    </div>

                    <p className="mt-2 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-ice-600">
                      <KeyRound className="mt-0.5 size-3 shrink-0 text-teal-400" />
                      {column.type === 'password'
                        ? t(
                            '密码列使用由数据密钥派生的独立子密钥与专用认证标签加密，撤回历史中的旧值同样以密文保存。',
                          )
                        : t('该列的值以 AES-256-GCM 密文保存，撤回历史中的旧值同样以密文保存。')}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {columns.length > 10 && (
          <button
            type="button"
            onClick={addColumn}
            disabled={columns.length >= 40}
            className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-teal-400/30 bg-teal-400/[0.04] text-[0.75rem] text-teal-200 transition hover:border-teal-400/50 hover:bg-teal-400/[0.09] disabled:opacity-40"
          >
            <Plus className="size-3.5" />
            {t('在末尾添加列（共 {n} 列）', { n: columns.length })}
          </button>
        )}
      </section>
    </DrawerFrame>
  )
}
