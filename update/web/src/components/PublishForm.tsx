import { Button } from '@heroui/react'
import { CheckCircle2, CloudUpload, FileStack, FolderOpen, PackageOpen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage, uploadFile, type DiskFile, type UploadRecord } from '../lib/api'
import { toast } from '../lib/toast'
import { cn, formatBytes, versionProblem } from '../lib/utils'
import { Field, Section, Spinner, Switch } from './primitives'

type Mode = 'upload' | 'existing'

/** 从文件名里猜版本号：MedSafeVault-2.1.0.exe → 2.1.0，省得再手打一遍。 */
function guessVersion(name: string): string {
  const matches = name.match(/\d+(?:\.\d+){1,3}/g) || []
  return matches.sort((a, b) => b.length - a.length)[0] || ''
}

export function PublishForm({
  files,
  appVersion,
  onPublished,
}: {
  files: DiskFile[]
  appVersion: string
  onPublished: (message: string) => void
}) {
  const [mode, setMode] = useState<Mode>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [percent, setPercent] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [record, setRecord] = useState<UploadRecord | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [existing, setExisting] = useState('')
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [mandatory, setMandatory] = useState(false)
  const [latest, setLatest] = useState(true)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const unregistered = files.filter((item) => !item.registered)
  const problem = version ? versionProblem(version) : ''
  const ready =
    !busy &&
    !uploading &&
    !problem &&
    version.trim() !== '' &&
    (mode === 'upload' ? Boolean(record) : existing !== '')

  async function startUpload(chosen: File) {
    setFile(chosen)
    setRecord(null)
    setUploadError('')
    setPercent(0)
    setUploading(true)
    if (!version.trim() || !versionProblem(version)) {
      const guess = guessVersion(chosen.name)
      if (guess) setVersion(guess)
    }
    try {
      const result = await uploadFile(chosen, (value) => setPercent(value))
      setRecord(result)
      setPercent(100)
    } catch (error) {
      setUploadError(errorMessage(error, '上传失败'))
      setFile(null)
      setPercent(0)
    } finally {
      setUploading(false)
    }
  }

  function takeFiles(list: FileList | null) {
    const chosen = list?.[0]
    if (!chosen) return
    void startUpload(chosen)
  }

  useEffect(() => {
    if (mode === 'existing' && !existing && unregistered.length) {
      setExisting(unregistered[0].file)
    }
  }, [mode, existing, unregistered])

  async function publish() {
    if (!ready) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        version: version.trim(),
        notes: notes.trim(),
        mandatory,
        latest,
        replace,
      }
      if (mode === 'upload' && record) body.upload_token = record.token
      if (mode === 'existing') body.existing_file = existing
      const result = await api.publish(body)
      const suffix = result.release.is_latest ? '，已设为最新版' : ''
      onPublished(`已发布 ${result.release.version}（${formatBytes(result.release.size)}）${suffix}`)
      setRecord(null)
      setFile(null)
      setPercent(0)
      setNotes('')
      setVersion('')
      setMandatory(false)
      setReplace(false)
      setLatest(true)
      if (input.current) input.current.value = ''
    } catch (error) {
      toast.danger(errorMessage(error, '发布失败'))
      if (error instanceof ApiError && error.status === 409) setReplace(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="发布新版本"
      description="选文件 → 填版本号 → 发布。服务端会算好大小与 sha256 写进 versions.json。"
      action={
        <div className="segmented" role="tablist">
          <button
            type="button"
            data-active={mode === 'upload' ? 'true' : 'false'}
            onClick={() => setMode('upload')}
          >
            <CloudUpload className="mr-1 inline size-3.5 align-[-2px]" />
            上传文件
          </button>
          <button
            type="button"
            data-active={mode === 'existing' ? 'true' : 'false'}
            onClick={() => setMode('existing')}
          >
            <FolderOpen className="mr-1 inline size-3.5 align-[-2px]" />
            用已有文件
          </button>
        </div>
      }
    >
      {mode === 'upload' ? (
        <div
          className={cn('adm-drop', drag && 'is-drag')}
          data-drag={drag ? 'true' : 'false'}
          onDragOver={(event) => {
            event.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDrag(false)
            takeFiles(event.dataTransfer.files)
          }}
        >
          <div className="flex items-start gap-3">
            <PackageOpen className="mt-0.5 size-5 shrink-0 text-ice-500" />
            <div className="min-w-0 flex-1">
              {file ? (
                <>
                  <p className="truncate text-[0.8125rem] text-ice-200">{file.name}</p>
                  <p className="mt-0.5 text-[0.71875rem] text-ice-600">
                    {formatBytes(file.size)} · {uploading ? `上传中 ${percent}%` : '已暂存到服务器'}
                  </p>
                  <div className="adm-bar mt-2.5">
                    <i style={{ width: `${record ? 100 : percent}%` }} />
                  </div>
                  {record ? (
                    <p className="adm-hash mt-2 flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                      <span>sha256 {record.sha256}</span>
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-[0.8125rem] text-ice-300">
                    把 MedSafeVault 的 exe 拖进来，或
                    <button
                      type="button"
                      className="ml-1 text-[var(--msv-accent-text)] underline underline-offset-4"
                      onClick={() => input.current?.click()}
                    >
                      选择文件
                    </button>
                  </p>
                  <p className="mt-1 text-[0.71875rem] leading-relaxed text-ice-600">
                    支持 .exe / .msi / .zip 等分发文件；上传只是暂存，填好版本号点「发布」才会写进版本表。
                  </p>
                </>
              )}
              <input
                ref={input}
                type="file"
                className="hidden"
                accept=".exe,.msi,.zip,.7z,.rar,.gz,.tar"
                onChange={(event) => takeFiles(event.target.files)}
              />
            </div>
            {file ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label="移除已选文件"
                className="size-8 min-w-8 rounded-lg text-ice-500"
                onPress={() => {
                  if (record) void api.discardUpload(record.token).catch(() => undefined)
                  setRecord(null)
                  setFile(null)
                  setPercent(0)
                  setUploadError('')
                  if (input.current) input.current.value = ''
                }}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Field
          label="files/ 目录里已有的文件"
          hint={
            unregistered.length
              ? '通常是 scp / U 盘拷进服务器的构建产物，直接登记即可，不用再传一遍。'
              : '目录里暂时没有未登记的文件；可以先用「上传文件」，或用 make_release.py 拷进去。'
          }
        >
          <select
            className="msv-input"
            value={existing}
            onChange={(event) => setExisting(event.target.value)}
          >
            <option value="">（选择一个文件）</option>
            {files.map((item) => (
              <option key={item.file} value={item.file}>
                {item.name} · {item.size_text}
                {item.registered ? ` · 已登记为 ${item.registered_for.join('/')}` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      {uploadError ? <div className="adm-note adm-note-danger mt-3">{uploadError}</div> : null}
      {uploading ? (
        <div className="adm-note mt-3">
          <Spinner className="mr-1 size-3.5" />
          <span>正在上传到服务器，请不要关闭页面。</span>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="版本号" required error={problem} htmlFor="pub-version">
          <input
            id="pub-version"
            className="msv-input font-mono"
            placeholder="2.1.0"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          />
        </Field>
        <Field label="当前桌面端版本" hint="只是提示，不用填。">
          <div className="msv-input flex items-center text-ice-500" aria-hidden="true">
            <FileStack className="mr-2 size-4" />
            <span className="font-mono text-[0.75rem]">{appVersion || '—'}</span>
          </div>
        </Field>
      </div>

      <Field label="更新说明" hint="会显示在桌面端的更新弹窗里。支持 Markdown：标题、列表、粗体、行内代码、代码块、引用、表格，普通换行也会保留。" className="mt-3">
        <textarea
          className="msv-input"
          rows={3}
          maxLength={2000}
          placeholder={
            '## 本次更新\n- 新增两步验证\n- 修复列表首行提示被表头遮挡\n\n**注意**：升级后需要重新登录一次。'
          }
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Switch checked={latest} onChange={setLatest} label="设为最新版" />
        <Switch checked={mandatory} onChange={setMandatory} label="必须更新" />
        <Switch checked={replace} onChange={setReplace} label="覆盖同版本" disabled={!version} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[0.6875rem] leading-relaxed text-ice-600">
          {mode === 'upload' && !record
            ? '先在上面选择或拖入文件。'
            : mode === 'existing' && !existing
              ? '先从 files/ 目录里挑一个文件。'
              : record
                ? `已暂存 ${formatBytes(record.size)}，发布后桌面端下次启动就会提示更新。`
                : '发布后桌面端下次启动就会提示更新。'}
        </p>
        <Button
          variant="primary"
          size="md"
          onPress={() => void publish()}
          isDisabled={!ready}
          className={cn('shrink-0', busy && 'opacity-80')}
        >
          {busy ? <Spinner className="mr-1.5" /> : null}
          发布版本
        </Button>
      </div>
    </Section>
  )
}
