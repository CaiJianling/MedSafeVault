import { isMockOnly, mockCall } from './mock'
import { translateServerText } from './i18n'
import type {
  AboutInfo,
  BackupInfo,
  Bootstrap,
  ConnectResult,
  DataLocation,
  EnvironmentInfo,
  ExcelPreview,
  HistoryList,
  LocalListing,
  Page,
  PageTemplate,
  PendingLocation,
  RecordDetail,
  RecordList,
  RecycleList,
  RecoveryInfo,
  RecoveryStatus,
  RemoteListing,
  SessionInfo,
  Settings,
  StateInfo,
  UndoState,
} from './types'

type Mode = 'native' | 'mock'

export class ApiError extends Error {
  locked: boolean
  code?: string
  payload?: Record<string, unknown>

  constructor(
    message: string,
    options: { locked?: boolean; code?: string; payload?: Record<string, unknown> } = {},
  ) {
    // Backend and demo errors are raised in Chinese; this is the single place
    // where they are localised, so no call site has to remember to translate.
    super(translateServerText(message))
    this.name = 'ApiError'
    this.locked = Boolean(options.locked)
    this.code = options.code
    this.payload = options.payload
  }
}

let modePromise: Promise<Mode> | null = null
let lockedListener: (() => void) | null = null

export function setLockedListener(listener: (() => void) | null): void {
  lockedListener = listener
}

function detectMode(): Promise<Mode> {
  if (isMockOnly) return Promise.resolve('mock')
  if (window.pywebview) return Promise.resolve('native')

  return new Promise<Mode>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      window.removeEventListener('pywebviewready', onReady)
      window.clearInterval(poll)
      window.clearTimeout(timer)
    }
    const finish = (mode: Mode) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(mode)
    }
    const onReady = () => finish('native')
    const poll = window.setInterval(() => {
      if (window.pywebview) finish('native')
    }, 60)
    const timeout = window.pywebview ? 15_000 : import.meta.env.DEV ? 1_800 : 20_000
    const timer = window.setTimeout(() => {
      if (settled) return
      if (import.meta.env.DEV) {
        finish('mock')
      } else {
        settled = true
        cleanup()
        reject(
          new ApiError('无法连接 MedSafeVault 本地服务，请关闭应用后重新启动。'),
        )
      }
    }, timeout)
    window.addEventListener('pywebviewready', onReady)
  })
}

function resolveMode(): Promise<Mode> {
  if (!modePromise) modePromise = detectMode()
  return modePromise
}

/**
 * pywebview creates `window.pywebview.api` as an empty object and fills it a
 * moment later, so "the bridge exists" is not the same as "this call exists".
 * Wait for the actual method instead of failing the first screen.
 */
async function waitForNativeMethod(
  method: string,
  timeoutMs = 10_000,
): Promise<(...args: unknown[]) => Promise<unknown>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const holder = window.pywebview?.api as Record<string, unknown> | undefined
    const fn = holder?.[method]
    if (typeof fn === 'function') {
      return (fn as (...args: unknown[]) => Promise<unknown>).bind(holder)
    }
    if (Date.now() >= deadline) {
      throw new ApiError('本地服务未就绪，请重新启动应用。')
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
}

export async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const mode = await resolveMode()
  if (mode === 'mock') {
    try {
      return await mockCall<T>(method, args)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(error instanceof Error ? error.message : String(error))
    }
  }
  const api = await waitForNativeMethod(method)
  let raw: unknown
  try {
    raw = await api(...args)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : String(error))
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if ('ok' in record) {
      if (record.ok === false) {
        if (record.locked) lockedListener?.()
        throw new ApiError(translateServerText(String(record.error || '操作失败')), {
          locked: Boolean(record.locked),
          code: typeof record.code === 'string' ? record.code : undefined,
          payload: record,
        })
      }
      const { ok: _ok, ...rest } = record
      return rest as T
    }
  }
  return raw as T
}

async function copyFallback(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    document.body.removeChild(area)
  }
}

export async function copyText(text: string): Promise<void> {
  const mode = await resolveMode()
  if (mode === 'native') {
    await call('copy_text', text)
    return
  }
  await copyFallback(text)
}

export async function copySecret(recordId: number, key: string): Promise<number> {
  const mode = await resolveMode()
  if (mode === 'native') {
    const result = await call<{ seconds: number }>('copy_secret', recordId, key)
    return result.seconds ?? 30
  }
  const result = await call<{ seconds: number }>('copy_secret', recordId, key)
  const revealed = await call<{ value: string }>('reveal_secret', recordId, key)
  await copyFallback(revealed.value)
  return result.seconds ?? 30
}

export const api = {
  bootstrap: () => call<Bootstrap>('get_bootstrap'),
  getState: () => call<{ state: StateInfo }>('get_state'),
  initialize: (password: string) =>
    call<{ state: StateInfo; recovery: RecoveryInfo }>('initialize', password),
  unlock: (password: string) => call<{ state: StateInfo }>('unlock', password),
  lock: () => call<{ state: StateInfo }>('lock'),
  heartbeat: () =>
    call<{ locked: boolean; remaining_seconds: number | null }>('heartbeat'),
  activity: () =>
    call<{ locked: boolean; remaining_seconds: number | null }>('activity'),
  changeMasterPassword: (oldPassword: string, newPassword: string) =>
    call<{ ok: boolean }>('change_master_password', oldPassword, newPassword),

  getRecoveryStatus: () => call<{ recovery: RecoveryStatus }>('get_recovery_status'),
  rotateRecovery: () =>
    call<{ recovery: RecoveryInfo; status: RecoveryStatus }>('rotate_recovery'),
  saveRecoveryFile: () =>
    call<{ path?: string; cancelled?: boolean }>('save_recovery_file'),
  pickRecoveryFile: () =>
    call<{ path?: string; cancelled?: boolean }>('pick_recovery_file'),
  startRecoveryWithCode: (code: string) =>
    call<{ ok: boolean; vault_id: string }>('start_recovery_with_code', code),
  finishRecovery: (newPassword: string) =>
    call<{ state: StateInfo }>('finish_recovery', newPassword),
  cancelRecovery: () => call<{ ok: boolean }>('cancel_recovery'),

  getTemplates: () => call<{ templates: PageTemplate[] }>('get_templates'),
  getPages: () => call<{ pages: Page[] }>('get_pages'),
  getPage: (pageId: number) => call<{ page: Page }>('get_page', pageId),
  createPage: (payload: Partial<Page>) =>
    call<{ page: Page }>('create_page', payload),
  updatePage: (pageId: number, payload: Partial<Page>) =>
    call<{ page: Page }>('update_page', pageId, payload),
  deletePage: (pageId: number) =>
    call<{ ok: boolean; recycle_id: number }>('delete_page', pageId),

  listRecords: (
    pageId: number,
    query = '',
    offset = 0,
    limit = 50,
    sortKey: string | null = null,
    sortDir: 'asc' | 'desc' = 'asc',
  ) =>
    call<RecordList>(
      'list_records',
      pageId,
      query,
      offset,
      limit,
      sortKey,
      sortDir,
    ),
  getRecord: (recordId: number) =>
    call<{ record: RecordDetail }>('get_record', recordId),
  saveRecord: (pageId: number, values: Record<string, string>, recordId: number | null = null) =>
    call<{ record: unknown; page_id: number }>('save_record', pageId, values, recordId),
  deleteRecord: (recordId: number) =>
    call<{ ok: boolean; record_id: number; page_id: number }>('delete_record', recordId),
  deleteRecords: (recordIds: number[]) =>
    call<{ ok: boolean; moved: number[]; skipped: number }>('delete_records', recordIds),
  suggestValues: (pageId: number, key: string, query = '', limit = 10) =>
    call<{ values: string[] }>('suggest_values', pageId, key, query, limit),
  revealSecret: (recordId: number, key: string) =>
    call<{ value: string }>('reveal_secret', recordId, key),
  generatePassword: (length = 20, symbols = true) =>
    call<{ value: string; score?: number }>('generate_password', length, symbols),

  getHistory: (offset = 0, limit = 40, kind = 'all', query = '') =>
    call<HistoryList>('get_history', offset, limit, kind, query),
  revealHistory: (historyId: number, side: 'before' | 'after', key: string) =>
    call<{ value: string }>('reveal_history', historyId, side, key),
  undo: () => call<{ message: string; undo_state: UndoState }>('undo'),
  redo: () => call<{ message: string; undo_state: UndoState }>('redo'),

  getRecycle: () => call<RecycleList>('get_recycle'),
  restoreRecord: (recordId: number) =>
    call<{ ok: boolean }>('restore_record', recordId),
  restorePage: (pageId: number) => call<{ ok: boolean }>('restore_page', pageId),
  purgeRecord: (recordId: number) => call<{ ok: boolean }>('purge_record', recordId),
  purgePage: (pageId: number) => call<{ ok: boolean }>('purge_page', pageId),
  emptyRecycle: () =>
    call<{ ok: boolean; pages: number; records: number }>('empty_recycle'),

  connect: (recordId: number, mode = '') =>
    call<ConnectResult>('connect', recordId, mode),

  // Built-in sessions (SSH terminal, FTP/SFTP browser, VNC relay).
  terminalList: () => call<{ sessions: SessionInfo[] }>('terminal_list'),
  terminalRead: (sessionId: string, cursor: number) =>
    call<{ data: string; cursor: number; closed: boolean; error: string }>(
      'terminal_read',
      sessionId,
      cursor,
    ),
  terminalWrite: (sessionId: string, data: string) =>
    call<{ ok: boolean }>('terminal_write', sessionId, data),
  terminalResize: (sessionId: string, cols: number, rows: number) =>
    call<{ ok: boolean }>('terminal_resize', sessionId, cols, rows),
  sessionClose: (sessionId: string) =>
    call<{ ok: boolean }>('session_close', sessionId),
  filesList: (sessionId: string, path = '') =>
    call<RemoteListing>('files_list', sessionId, path),
  filesMkdir: (sessionId: string, path: string) =>
    call<{ ok: boolean }>('files_mkdir', sessionId, path),
  filesRemove: (sessionId: string, path: string, isDir: boolean) =>
    call<{ ok: boolean }>('files_remove', sessionId, path, isDir),
  filesRename: (sessionId: string, oldPath: string, newPath: string) =>
    call<{ ok: boolean }>('files_rename', sessionId, oldPath, newPath),
  filesDownload: (sessionId: string, remote: string, filename = '') =>
    call<{ cancelled?: boolean; saved?: string; name?: string }>(
      'files_download',
      sessionId,
      remote,
      filename,
    ),
  filesUpload: (sessionId: string, remoteDir: string) =>
    call<{ cancelled?: boolean; uploaded?: string; name?: string }>(
      'files_upload',
      sessionId,
      remoteDir,
    ),
  localList: (path = '') => call<{ listing: LocalListing }>('local_list', path),
  rdpFocus: (pid: number) => call<{ focused: boolean }>('rdp_focus', pid),
  rdpClose: (pid: number) => call<{ closed: boolean }>('rdp_close', pid),

  previewExcel: (pageId: number) =>
    call<{ cancelled?: boolean; locked?: boolean; path?: string; preview?: ExcelPreview }>(
      'preview_excel',
      pageId,
    ),
  previewExcelFile: (pageId: number, path: string, password: string) =>
    call<{ locked?: boolean; path?: string; preview?: ExcelPreview }>(
      'preview_excel_file',
      pageId,
      path,
      password,
    ),
  importExcel: (pageId: number, path: string, password = '') =>
    call<{ count: number }>('import_excel', pageId, path, password),
  exportExcel: (pageId: number, password = '') =>
    call<{ cancelled?: boolean; path?: string; count?: number; sealed?: boolean }>(
      'export_excel',
      pageId,
      password,
    ),
  exportTemplate: (pageId: number) =>
    call<{ cancelled?: boolean; path?: string }>('export_template', pageId),

  exportBackup: (password: string) =>
    call<{ cancelled?: boolean; path?: string; sealed?: boolean }>('export_backup', password),
  pickBackup: () =>
    call<{ cancelled?: boolean; path?: string; info?: BackupInfo; sealed?: boolean }>(
      'pick_backup',
    ),
  previewBackup: (password: string) =>
    call<{ info: BackupInfo }>('preview_backup', password),
  restoreBackup: (password: string) =>
    call<{ state: StateInfo; info: BackupInfo; auto_backup: string | null }>(
      'restore_backup',
      password,
    ),
  cancelBackup: () => call<{ ok: boolean }>('cancel_backup'),

  setSettings: (patch: Partial<Settings>) =>
    call<{ settings: Settings }>('set_settings', patch),
  chooseSecurecrt: () =>
    call<{ cancelled?: boolean; settings?: Settings }>('choose_securecrt'),
  chooseProgram: (key: string) =>
    call<{ cancelled?: boolean; settings?: Settings; path?: string }>('choose_program', key),
  getAbout: () => call<{ about: AboutInfo }>('get_about'),
  openDataDir: () => call<{ ok: boolean }>('open_data_dir'),
  openPath: (path: string) => call<{ ok: boolean }>('open_path', path),

  // Data directory: a change is only written to the config and applied by the
  // backend while the app shuts down, so the UI always shows "restart needed".
  getDataLocation: () => call<{ location: DataLocation }>('get_data_location'),
  setDataLocation: (mode: string, path?: string) =>
    call<{
      pending: PendingLocation | null
      location: { mode: string; path: string }
      already_there?: boolean
    }>('set_data_location', mode, path ?? ''),
  cancelDataLocation: () => call<{ pending: null }>('cancel_data_location'),
  chooseDataDir: () => call<{ cancelled?: boolean; path?: string }>('choose_data_dir'),
  getEnvironment: () => call<{ environment: EnvironmentInfo }>('get_environment'),

  // Window close: the backend asks first (window.__msvClosePrompt), then the
  // dialog reports what the user picked.
  dismissClosePrompt: () => call<{ ok: boolean }>('dismiss_close_prompt'),
  closeWindow: (action: 'tray' | 'quit', remember: boolean) =>
    call<{ ok: boolean; hidden?: boolean }>('close_window', action, remember),

  quit: () => call<{ ok: boolean }>('quit'),
}
