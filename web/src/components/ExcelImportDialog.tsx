import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Sheet,
  Upload,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import type { ExcelPreview } from '../lib/types'
import { cn } from '../lib/utils'
import { ModalFrame, Spinner } from './primitives'

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function ExcelImportDialog({
  open,
  preview,
  pageName,
  onOpenChange,
  onImported,
}: {
  open: boolean
  preview: ExcelPreview | null
  pageName: string
  onOpenChange: (open: boolean) => void
  onImported: (count: number) => void
}) {
  const { t } = useI18n()
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setImporting(false)
      setError('')
    }
  }, [open, preview])

  if (!preview) return null

  async function runImport() {
    if (importing || !preview) return
    setImporting(true)
    setError('')
    try {
      const result = await api.importExcel(preview.page_id, preview.path)
      toast.success(
        t('导入完成'),
        t('已写入 {n} 条记录，可在修改历史中撤回', { n: result.count }),
      )
      onImported(result.count)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('导入失败，请检查文件格式'))
    } finally {
      setImporting(false)
    }
  }

  const sampleColumns = preview.mapped.slice(0, 8)

  return (
    <ModalFrame
      open={open}
      onOpenChange={onOpenChange}
      icon={<FileSpreadsheet className="size-5" />}
      title={t('导入 Excel / CSV')}
      description={t('{file} · 预览将写入「{page}」', {
        file: basename(preview.path),
        page: pageName,
      })}
      width="820px"
      bodyClassName="max-h-[66vh] overflow-y-auto pr-1"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[0.71875rem] text-ice-600">
            <Upload className="size-3" />
            {t('密码类字段会在导入时加密，历史中可整体撤回')}
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
              type="button"
              onClick={runImport}
              disabled={importing || preview.rows === 0}
              className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[0.78125rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
            >
              {importing ? <Spinner className="size-3.5" /> : <Upload className="size-3.5" />}
              {t('导入 {n} 条记录', { n: preview.rows })}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t('数据行'), value: preview.rows, hint: t('不含表头与空行') },
          { label: t('已匹配列'), value: preview.mapped.length, hint: t('写入当前页面') },
          { label: t('未匹配表头'), value: preview.unmatched.length, hint: t('将被忽略') },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5"
          >
            <div className="text-[0.6875rem] tracking-[0.08em] text-ice-600">{item.label}</div>
            <div className="mt-0.5 font-mono text-[1.1875rem] leading-tight text-ice-200">
              {item.value}
            </div>
            <div className="text-[0.6875rem] text-ice-600">{item.hint}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2">
          <CheckCircle2 className="size-3.5 text-teal-400" />
          <h3 className="text-[0.71875rem] font-medium tracking-[0.08em] text-ice-500">
            {t('列映射')}
          </h3>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {preview.mapped.map((item) => (
            <span
              key={item.key}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-[var(--msv-tint)] px-2 py-1 text-[0.71875rem]"
            >
              <span className="text-ice-300">{item.label}</span>
              <ArrowRight className="size-2.5 text-ice-600" />
              <span className="max-w-[160px] truncate text-teal-200">{item.header}</span>
            </span>
          ))}
        </div>
      </div>

      {preview.unmatched.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[0.71875rem] leading-relaxed text-amber-100">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <span>
            {t('以下表头没有对应列，导入时会被忽略：')}
            <span className="ml-1 text-amber-200">{preview.unmatched.join('、')}</span>
          </span>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-2">
          <Sheet className="size-3.5 text-teal-400" />
          <h3 className="text-[0.71875rem] font-medium tracking-[0.08em] text-ice-500">
            {t('数据预览')}
          </h3>
          <span className="h-px flex-1 bg-line" />
          <span className="text-[0.6875rem] text-ice-600">
            {t('最多显示前 {n} 行', { n: preview.samples.length })}
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[0.71875rem]">
            <thead>
              <tr className="bg-[var(--msv-table-head)]">
                <th className="w-10 border-b border-line px-2 py-2 text-left font-mono text-[0.6875rem] font-normal text-ice-600">
                  #
                </th>
                {sampleColumns.map((column) => (
                  <th
                    key={column.key}
                    className="whitespace-nowrap border-b border-line px-2.5 py-2 text-left text-[0.6875rem] font-medium text-ice-500"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.samples.length === 0 ? (
                <tr>
                  <td
                    colSpan={sampleColumns.length + 1}
                    className="px-3 py-6 text-center text-[0.71875rem] text-ice-600"
                  >
                    {t('文件中没有可预览的数据行')}
                  </td>
                </tr>
              ) : (
                preview.samples.map((sample, index) => (
                  <tr key={index} className="border-b border-line/60 last:border-0">
                    <td className="px-2 py-1.5 font-mono text-[0.6875rem] text-ice-600">
                      {index + 1}
                    </td>
                    {sampleColumns.map((column) => {
                      const value = sample[column.key] ?? ''
                      const secret = /^[•·*]+$/.test(value)
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            'max-w-[200px] truncate px-2.5 py-1.5',
                            secret ? 'mask-dots text-[0.71875rem]' : 'text-ice-300',
                          )}
                          title={secret ? t('加密字段已隐藏') : value}
                        >
                          {value || <span className="text-ice-600">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {preview.mapped.length > sampleColumns.length && (
          <p className="mt-1.5 text-[0.6875rem] text-ice-600">
            {t('预览仅展示前 8 列，其余 {n} 列也会正常导入。', {
              n: preview.mapped.length - 8,
            })}
          </p>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.71875rem] text-rose-200">
          {error}
        </div>
      )}

      <p className="mt-3 text-[0.6875rem] leading-relaxed text-ice-600">
        {t(
          '导入不会自动去重。若表中已有相同记录，请先导出核对；导入完成后可使用顶部的撤回按钮整体撤销。',
        )}
      </p>
    </ModalFrame>
  )
}
