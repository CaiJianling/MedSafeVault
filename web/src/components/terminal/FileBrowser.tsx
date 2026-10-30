import {
  ArrowUp,
  Check,
  Download,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ApiError, api } from '../../lib/api'
import { useConfirm } from '../../lib/confirm'
import { useI18n } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import type { LocalListing, RemoteEntry, RemoteListing } from '../../lib/types'
import { cn, formatBytes, formatDateTime, shortPath } from '../../lib/utils'
import { Spinner } from '../primitives'

function joinRemote(dir: string, name: string): string {
  if (!dir || dir === '.') return name
  return `${dir.replace(/\/+$/, '')}/${name}`
}

function parentRemote(path: string): string {
  const trimmed = (path || '').replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') return '/'
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

function stamp(seconds: number): string {
  if (!seconds) return ''
  return formatDateTime(new Date(seconds * 1000).toISOString())
}

/** One column of a dual-pane FTP/SFTP browser. */
function Pane({
  icon,
  title,
  path,
  roots,
  entries,
  loading,
  error,
  selected,
  onSelect,
  onOpen,
}: {
  icon: ReactNode
  title: string
  path: string
  roots?: { name: string; path: string }[]
  entries: RemoteEntry[]
  loading: boolean
  error: string
  selected: string | null
  onSelect: (name: string | null) => void
  onOpen: (entry: RemoteEntry) => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-line bg-[var(--msv-surface)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[var(--msv-accent-text)]">{icon}</span>
        <span className="shrink-0 text-[0.71875rem] font-medium text-ice-300">{title}</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ice-600"
          title={path || t('此电脑')}
        >
          {path || t('此电脑')}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[0.71875rem] text-ice-500">
            <Spinner className="size-4 text-[var(--msv-accent-text)]" />
            {t('正在读取目录…')}
          </div>
        ) : error ? (
          <div className="m-2 rounded-lg border border-[color-mix(in_srgb,var(--msv-danger-text)_25%,transparent)] bg-[color-mix(in_srgb,var(--msv-danger-text)_7%,transparent)] px-3 py-2 text-[0.71875rem] leading-relaxed text-[var(--msv-danger-text)]">
            {error}
          </div>
        ) : roots ? (
          <div className="p-1">
            {roots.map((root) => (
              <button
                key={root.path}
                type="button"
                onClick={() => onOpen({ name: root.path, is_dir: true, size: 0, mtime: 0 })}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.75rem] text-ice-300 transition hover:bg-[var(--msv-tint-strong)]"
              >
                <HardDrive className="size-3.5 shrink-0 text-ice-500" />
                <span className="truncate">{root.name}</span>
              </button>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[0.71875rem] text-ice-600">
            {t('这个目录是空的')}
          </div>
        ) : (
          <div className="p-1">
            {entries.map((entry) => {
              const active = selected === entry.name
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => onSelect(entry.name)}
                  onDoubleClick={() => onOpen(entry)}
                  title={entry.name}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[0.75rem] transition',
                    active
                      ? 'bg-[var(--msv-accent-soft)] text-[var(--msv-accent-text)]'
                      : 'text-ice-300 hover:bg-[var(--msv-tint-strong)]',
                  )}
                >
                  {entry.is_dir ? (
                    <Folder className="size-3.5 shrink-0 text-[var(--msv-warning-text)]" />
                  ) : (
                    <File className="size-3.5 shrink-0 text-ice-500" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {entry.is_dir ? (
                    <span className="shrink-0 text-[0.65625rem] text-ice-600">{t('目录')}</span>
                  ) : (
                    <span className="shrink-0 font-mono text-[0.65625rem] tabular-nums text-ice-600">
                      {formatBytes(entry.size)}
                    </span>
                  )}
                  <span
                    className="hidden w-[104px] shrink-0 text-right font-mono text-[0.65625rem] text-ice-600 lg:block"
                    title={stamp(entry.mtime)}
                  >
                    {stamp(entry.mtime)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-line px-3 py-1.5 text-[0.65625rem] text-ice-600">
        {roots ? t('选择一个磁盘开始浏览') : t('双击文件夹进入 · 单击选中文件')}
      </div>
    </div>
  )
}

export function FileBrowser({
  sessionId,
  protocol,
  title,
}: {
  sessionId: string
  protocol: string
  title: string
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [localPath, setLocalPath] = useState('')
  const [local, setLocal] = useState<LocalListing | null>(null)
  const [localError, setLocalError] = useState('')
  const [localLoading, setLocalLoading] = useState(false)
  const [localSel, setLocalSel] = useState<string | null>(null)

  const [remote, setRemote] = useState<RemoteListing | null>(null)
  const [remoteError, setRemoteError] = useState('')
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteSel, setRemoteSel] = useState<string | null>(null)

  const [busy, setBusy] = useState('')
  const [editor, setEditor] = useState<{ kind: 'mkdir' | 'rename'; value: string } | null>(null)

  const loadLocal = useCallback(async (path: string) => {
    setLocalLoading(true)
    setLocalError('')
    try {
      const result = await api.localList(path)
      setLocal(result.listing)
      setLocalPath(result.listing.path)
      setLocalSel(null)
    } catch (error) {
      setLocalError(error instanceof ApiError ? error.message : t('无法读取本地目录'))
    } finally {
      setLocalLoading(false)
    }
  }, [t])

  const loadRemote = useCallback(async (path: string) => {
    setRemoteLoading(true)
    setRemoteError('')
    try {
      const result = await api.filesList(sessionId, path)
      setRemote(result)
      setRemoteSel(null)
    } catch (error) {
      setRemoteError(error instanceof ApiError ? error.message : t('无法读取远程目录'))
    } finally {
      setRemoteLoading(false)
    }
  }, [sessionId, t])

  useEffect(() => {
    void loadLocal('')
    void loadRemote('')
  }, [loadLocal, loadRemote])

  const localEntry = local?.entries.find((entry) => entry.name === localSel) ?? null
  const remoteEntry = remote?.entries.find((entry) => entry.name === remoteSel) ?? null

  function openLocal(entry: RemoteEntry) {
    if (entry.is_dir) void loadLocal(entry.name)
  }

  function openRemote(entry: RemoteEntry) {
    if (entry.is_dir) void loadRemote(joinRemote(remote?.path ?? '', entry.name))
  }

  async function withBusy(key: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    try {
      await action()
    } catch (error) {
      toast.error(t('操作失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setBusy('')
    }
  }

  function upload() {
    void withBusy('upload', async () => {
      const result = await api.filesUpload(sessionId, remote?.path ?? '')
      if (result.cancelled) return
      toast.success(t('已上传'), t('{name} 已上传到 {path}', {
        name: result.name ?? '',
        path: remote?.path ?? '',
      }))
      await loadRemote(remote?.path ?? '')
      await loadLocal(localPath)
    })
  }

  function download() {
    if (!remoteEntry || remoteEntry.is_dir) {
      toast.info(t('请先在右侧选中一个文件'))
      return
    }
    void withBusy('download', async () => {
      const result = await api.filesDownload(
        sessionId,
        joinRemote(remote?.path ?? '', remoteEntry.name),
        remoteEntry.name,
      )
      if (result.cancelled) return
      toast.success(t('已下载'), shortPath(result.saved ?? '', 66))
      await loadLocal(localPath)
    })
  }

  async function remove() {
    if (!remoteEntry) {
      toast.info(t('请先在右侧选中要删除的内容'))
      return
    }
    const ok = await confirm({
      title: remoteEntry.is_dir ? t('删除这个目录？') : t('删除这个文件？'),
      description: t('「{name}」将从远程服务器上永久删除，无法撤回。', { name: remoteEntry.name }),
      confirmText: t('删除'),
      tone: 'danger',
    })
    if (!ok) return
    await withBusy('delete', async () => {
      await api.filesRemove(
        sessionId,
        joinRemote(remote?.path ?? '', remoteEntry.name),
        remoteEntry.is_dir,
      )
      toast.success(t('已删除'), remoteEntry.name)
      await loadRemote(remote?.path ?? '')
    })
  }

  async function submitEditor() {
    if (!editor) return
    const value = editor.value.trim()
    if (!value) return
    const target = remote?.path ?? ''
    await withBusy(editor.kind, async () => {
      if (editor.kind === 'mkdir') {
        await api.filesMkdir(sessionId, joinRemote(target, value))
        toast.success(t('目录已创建'), value)
      } else {
        if (!remoteEntry) return
        await api.filesRename(
          sessionId,
          joinRemote(target, remoteEntry.name),
          joinRemote(target, value),
        )
        toast.success(t('已重命名'), `${remoteEntry.name} → ${value}`)
      }
      setEditor(null)
      await loadRemote(target)
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1.5 text-[0.71875rem] text-ice-400">
          <Server className="size-3.5 text-[var(--msv-accent-text)]" />
          <span className="max-w-[340px] truncate" title={title}>
            {title}
          </span>
          <span className="chip chip-mint uppercase">{protocol}</span>
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void loadLocal(localPath)}
          disabled={localLoading || Boolean(busy)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[0.6875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200 disabled:opacity-40"
        >
          <RefreshCw className={cn('size-3', localLoading && 'animate-spin')} />
          {t('刷新本地')}
        </button>
        <button
          type="button"
          onClick={() => void loadLocal(local?.parent ?? '')}
          disabled={!local?.path || localLoading}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[0.6875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200 disabled:opacity-40"
        >
          <ArrowUp className="size-3" />
          {t('上级')}
        </button>
        <button
          type="button"
          onClick={() => void loadRemote(parentRemote(remote?.path ?? ''))}
          disabled={remoteLoading || !remote?.path}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[0.6875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200 disabled:opacity-40"
        >
          <ArrowUp className="size-3" />
          {t('远程上级')}
        </button>
        <button
          type="button"
          onClick={() => void loadRemote(remote?.path ?? '')}
          disabled={remoteLoading || Boolean(busy)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[0.6875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200 disabled:opacity-40"
        >
          <RefreshCw className={cn('size-3', remoteLoading && 'animate-spin')} />
          {t('刷新远程')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <Pane
          icon={<HardDrive className="size-3.5" />}
          title={t('本地')}
          path={local?.path ?? ''}
          roots={local?.roots}
          entries={local?.entries ?? []}
          loading={localLoading}
          error={localError}
          selected={localSel}
          onSelect={setLocalSel}
          onOpen={openLocal}
        />
        <Pane
          icon={<Server className="size-3.5" />}
          title={t('远程')}
          path={remote?.path ?? ''}
          entries={remote?.entries ?? []}
          loading={remoteLoading}
          error={remoteError}
          selected={remoteSel}
          onSelect={setRemoteSel}
          onOpen={openRemote}
        />
      </div>

      {editor && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--msv-accent)_35%,transparent)] bg-[var(--msv-accent-soft)] px-2.5 py-1.5">
          <span className="shrink-0 text-[0.6875rem] text-[var(--msv-accent-text)]">
            {editor.kind === 'mkdir' ? t('新建文件夹') : t('重命名为')}
          </span>
          <input
            autoFocus
            className="msv-input h-7 min-w-0 flex-1 text-[0.75rem]"
            value={editor.value}
            onChange={(event) => setEditor({ ...editor, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitEditor()
              if (event.key === 'Escape') setEditor(null)
            }}
          />
          <button
            type="button"
            onClick={() => void submitEditor()}
            disabled={Boolean(busy) || !editor.value.trim()}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--msv-accent-solid)] px-2 text-[0.6875rem] font-medium text-[var(--msv-accent-solid-fg)] transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? <Spinner className="size-3" /> : <Check className="size-3" />}
            {t('确定')}
          </button>
          <button
            type="button"
            onClick={() => setEditor(null)}
            className="grid size-7 place-items-center rounded-md text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
            aria-label={t('取消')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <button
          type="button"
          onClick={upload}
          disabled={Boolean(busy)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--msv-accent-solid)] px-2.5 text-[0.71875rem] font-medium text-[var(--msv-accent-solid-fg)] transition hover:brightness-110 disabled:opacity-40"
        >
          {busy === 'upload' ? <Spinner className="size-3.5" /> : <Upload className="size-3.5" />}
          {t('上传到远程')}
        </button>
        <button
          type="button"
          onClick={download}
          disabled={Boolean(busy) || !remoteEntry || remoteEntry.is_dir}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-300 transition hover:border-line-strong hover:bg-[var(--msv-tint)] disabled:opacity-40"
        >
          {busy === 'download' ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
          {t('下载选中')}
        </button>
        <button
          type="button"
          onClick={() => setEditor({ kind: 'mkdir', value: '' })}
          disabled={Boolean(busy)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-300 transition hover:border-line-strong hover:bg-[var(--msv-tint)] disabled:opacity-40"
        >
          <FolderPlus className="size-3.5" />
          {t('新建文件夹')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!remoteEntry) {
              toast.info(t('请先在右侧选中要重命名的内容'))
              return
            }
            setEditor({ kind: 'rename', value: remoteEntry.name })
          }}
          disabled={Boolean(busy) || !remoteEntry}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-300 transition hover:border-line-strong hover:bg-[var(--msv-tint)] disabled:opacity-40"
        >
          <Pencil className="size-3.5" />
          {t('重命名')}
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={Boolean(busy) || !remoteEntry}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--msv-danger-text)_30%,transparent)] px-2.5 text-[0.71875rem] text-[var(--msv-danger-text)] transition hover:bg-[color-mix(in_srgb,var(--msv-danger-text)_10%,transparent)] disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          {t('删除')}
        </button>
        <div className="flex-1" />
        <span className="min-w-0 truncate text-[0.6875rem] text-ice-600" title={remote?.path}>
          {localEntry && !localEntry.is_dir
            ? t('本地已选：{name}', { name: localEntry.name })
            : t('上传会弹出文件选择框，直接传到右侧当前目录')}
        </span>
      </div>
    </div>
  )
}
