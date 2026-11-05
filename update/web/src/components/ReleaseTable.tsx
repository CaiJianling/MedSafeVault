import { Button } from '@heroui/react'
import {
  AlertTriangle,
  Check,
  Download,
  FileQuestion,
  Pencil,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage, type Release } from '../lib/api'
import { toast } from '../lib/toast'
import { cn, formatBytes, shortHash } from '../lib/utils'
import { Chip, RowAction, Section, Spinner, Switch } from './primitives'

type Open = { kind: 'edit' | 'delete'; version: string } | null

export function ReleaseTable({
  releases,
  onChanged,
}: {
  releases: Release[]
  onChanged: () => Promise<void> | void
}) {
  const [open, setOpen] = useState<Open>(null)
  const [draftNotes, setDraftNotes] = useState('')
  const [draftMandatory, setDraftMandatory] = useState(false)
  const [busy, setBusy] = useState('')

  const total = releases.reduce((sum, item) => sum + (item.size_on_disk || item.size), 0)

  async function run(version: string, label: string, action: () => Promise<unknown>) {
    setBusy(version)
    try {
      await action()
      await onChanged()
      toast.success(`${label} · ${version}`)
      setOpen(null)
    } catch (error) {
      toast.danger(errorMessage(error, `${label}失败`))
    } finally {
      setBusy('')
    }
  }

  function startEdit(release: Release) {
    setDraftNotes(release.notes || '')
    setDraftMandatory(release.mandatory)
    setOpen({ kind: 'edit', version: release.version })
  }

  return (
    <Section
      title="已发布的版本"
      description="桌面端只看到「最新版」那一个；其余版本留在这里做灰度或回滚。"
      action={
        <div className="flex items-center gap-2">
          <Chip>{releases.length} 个</Chip>
          <Chip>{formatBytes(total)}</Chip>
        </div>
      }
    >
      {releases.length === 0 ? (
        <div className="adm-note">
          <FileQuestion className="mt-0.5 size-3.5 shrink-0" />
          <span>还没有登记任何版本。右边「发布新版本」选好 exe、填上版本号就能发布。</span>
        </div>
      ) : (
        <div className="adm-scroll">
          <table className="msv-table min-w-[760px]">
            <thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
                <th>大小</th>
                <th>sha256</th>
                <th>发布日期</th>
                <th>文件</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => {
                const editing = open?.kind === 'edit' && open.version === release.version
                const deleting = open?.kind === 'delete' && open.version === release.version
                return (
                  <tr key={release.version} data-active={editing || deleting ? 'true' : undefined}>
                    <td className="whitespace-nowrap font-mono text-[0.8125rem] text-ice-200">
                      {release.version}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {release.is_latest ? <Chip tone="mint">最新</Chip> : null}
                        {release.mandatory ? <Chip tone="amber">必须更新</Chip> : null}
                        {!release.exists ? <Chip tone="danger">文件缺失</Chip> : null}
                        {release.exists && !release.hash_matches ? (
                          <Chip tone="danger">散列不符</Chip>
                        ) : null}
                        {release.exists && !release.size_matches ? (
                          <Chip tone="amber">大小不符</Chip>
                        ) : null}
                        {!release.is_latest && release.exists && !release.mandatory ? (
                          <Chip>备用</Chip>
                        ) : null}
                      </div>
                    </td>
                    <td className="adm-mono whitespace-nowrap">
                      {release.size_text || formatBytes(release.size)}
                    </td>
                    <td className="adm-mono whitespace-nowrap" title={release.sha256 || '没有散列'}>
                      {shortHash(release.sha256, 8)}
                    </td>
                    <td className="adm-mono whitespace-nowrap">{release.released_at || '—'}</td>
                    <td className="max-w-[11rem] truncate text-ice-500" title={release.path}>
                      {release.file}
                    </td>
                    <td>
                      <div className="cell-actions">
                        {deleting ? (
                          <>
                            <span className="mr-1 whitespace-nowrap text-[0.71875rem] text-rose-300">
                              确定下架 {release.version}？
                            </span>
                            <RowAction
                              icon={<Trash2 className="size-3.5" />}
                              label="下架并删文件"
                              danger
                              withLabel
                              disabled={busy === release.version}
                              onPress={() =>
                                void run(release.version, '已下架并删除文件', () =>
                                  api.remove(release.version, true),
                                )
                              }
                            />
                            <RowAction
                              icon={<X className="size-3.5" />}
                              label="取消"
                              onPress={() => setOpen(null)}
                            />
                          </>
                        ) : (
                          <>
                            {!release.is_latest ? (
                              <RowAction
                                icon={<Star className="size-3.5" />}
                                label="设为最新"
                                withLabel
                                disabled={busy === release.version}
                                onPress={() =>
                                  void run(release.version, '已设为最新版', () =>
                                    api.patch(release.version, { latest: true }),
                                  )
                                }
                              />
                            ) : null}
                            <a
                              href={release.download}
                              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-ice-500 transition-colors hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
                              aria-label="在浏览器里下载这个版本"
                              title="在浏览器里下载这个版本"
                            >
                              <Download className="size-3.5" />
                            </a>
                            <RowAction
                              icon={<Pencil className="size-3.5" />}
                              label="编辑说明"
                              onPress={() => (editing ? setOpen(null) : startEdit(release))}
                            />
                            <RowAction
                              icon={<Trash2 className="size-3.5" />}
                              label="下架"
                              danger
                              onPress={() => setOpen({ kind: 'delete', version: release.version })}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open?.kind === 'edit'
        ? (() => {
            const release = releases.find((item) => item.version === open.version)
            if (!release) return null
            return (
              <div className="adm-rise mt-3 rounded-xl border border-line bg-[var(--msv-surface)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-[0.8125rem] text-ice-200">
                    编辑 <span className="font-mono">{release.version}</span>
                  </h4>
                  {busy === release.version ? <Spinner className="size-3.5 text-ice-500" /> : null}
                </div>
                <textarea
                  className="msv-input"
                  rows={3}
                  maxLength={2000}
                  value={draftNotes}
                  placeholder="这次更新改了什么"
                  onChange={(event) => setDraftNotes(event.target.value)}
                />
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <Switch checked={draftMandatory} onChange={setDraftMandatory} label="必须更新" />
                  <span className="adm-hash min-w-0 flex-1">
                    {release.path || release.file}
                    {!release.exists ? ' · 磁盘上找不到这个文件' : ''}
                  </span>
                </div>
                {release.exists && !release.hash_matches ? (
                  <div className="adm-note adm-note-danger mt-3">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      磁盘文件的 sha256 和登记值不一致：文件可能被替换过。桌面端下载时会校验失败，
                      建议重新发布同版本（勾选「覆盖同版本」）或下架。
                    </span>
                  </div>
                ) : null}
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onPress={() => setOpen(null)}>
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={busy === release.version}
                    onPress={() =>
                      void run(release.version, '已保存', () =>
                        api.patch(release.version, {
                          notes: draftNotes.trim(),
                          mandatory: draftMandatory,
                        }),
                      )
                    }
                  >
                    <Check className="mr-1 size-4" />
                    保存
                  </Button>
                </div>
              </div>
            )
          })()
        : null}

      <p className={cn('mt-3 text-[0.6875rem] leading-relaxed text-ice-600')}>
        下架只从 versions.json 里移掉这一条；勾选「下架并删文件」才会真的删掉 files/ 里的 exe。
        历史版本可以随时「设为最新」用来回滚。
      </p>
    </Section>
  )
}
