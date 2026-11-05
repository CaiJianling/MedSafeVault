/** 管理后台与 update/server.py 之间的唯一通道。
 *
 * 会话靠 HttpOnly Cookie 维持（浏览器自动带上），所以这里只管两件事：
 * 给每个写请求带上 `X-Msv-Requested-With`（服务端用它挡跨站表单），
 * 以及把服务端的 `{ok:false,error:"…"}` 变成可以直接显示的异常。
 */

export type Release = {
  version: string
  notes: string
  mandatory: boolean
  released_at: string
  size: number
  sha256: string
  download: string
  filename: string
  file: string
  path: string
  exists: boolean
  size_on_disk: number
  size_text: string
  recorded_size: number
  recorded_sha256: string
  size_matches: boolean
  hash_matches: boolean
  is_latest: boolean
}

export type DiskFile = {
  file: string
  name: string
  suffix: string
  size: number
  size_text: string
  registered: boolean
  registered_for: string[]
}

export type Info = {
  ok: boolean
  service: string
  app_version: string
  logged_in: boolean
  username: string
  latest: string
  releases: number
  listening: { host: string; port: number }
  addresses: string[]
  client_endpoints: string[]
}

export type Summary = Info & {
  root: string
  config: string
  staging: string
  max_upload: number
  using_default_password: boolean
  password_updated_at: string
  session_hours: number
}

export type AuditEvent = {
  time: string
  ip: string
  user: string
  action: string
  detail: string
}

export type UploadRecord = {
  token: string
  filename: string
  size: number
  sha256: string
  created_at: string
}

export class ApiError extends Error {
  status: number
  extra: Record<string, unknown>

  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.extra = extra
  }
}

const ORIGIN_HEADER = { 'X-Msv-Requested-With': 'msv-admin' }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' || method === 'HEAD' ? undefined : ORIGIN_HEADER,
    body: body === undefined ? undefined : JSON.stringify(body),
  }
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(0, '连不上更新服务，请确认服务进程还在运行')
  }
  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new ApiError(
      response.status,
      (payload && (payload.error as string)) || `服务返回 ${response.status}`,
      payload || {},
    )
  }
  return payload as T
}

/** 上传用 XHR 而不是 fetch：fetch 拿不到上传进度。 */
export function uploadFile(
  file: File,
  onProgress: (percent: number, loaded: number) => void,
): Promise<UploadRecord> {
  return new Promise((resolve, reject) => {
    const query = `/api/admin/upload?name=${encodeURIComponent(file.name)}`
    const xhr = new XMLHttpRequest()
    xhr.open('POST', query)
    xhr.withCredentials = true
    Object.entries(ORIGIN_HEADER).forEach(([key, value]) => xhr.setRequestHeader(key, value))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)), event.loaded)
      }
    }
    xhr.onload = () => {
      let payload: any = null
      try {
        payload = JSON.parse(xhr.responseText || 'null')
      } catch {
        payload = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload && payload.ok) {
        onProgress(100, file.size)
        resolve(payload.upload as UploadRecord)
        return
      }
      reject(
        new ApiError(
          xhr.status,
          (payload && payload.error) || `上传失败（HTTP ${xhr.status}）`,
          payload || {},
        ),
      )
    }
    xhr.onerror = () => reject(new ApiError(0, '上传中断，请检查网络或服务是否重启过'))
    xhr.ontimeout = () => reject(new ApiError(0, '上传超时'))
    xhr.send(file)
  })
}

export const api = {
  info: () => call<Info>('GET', '/api/info'),
  health: () => call<Info & { admin_page: boolean }>('GET', '/healthz'),
  login: (username: string, password: string) =>
    call<{ username: string; expires_at: string; must_change_password: boolean }>(
      'POST',
      '/api/admin/login',
      { username, password },
    ),
  logout: () => call<{ ok: boolean }>('POST', '/api/admin/logout', {}),
  session: () => call<Summary>('GET', '/api/admin/session'),
  releases: () => call<{ releases: Release[]; latest: string }>('GET', '/api/admin/releases'),
  files: () => call<{ files: DiskFile[] }>('GET', '/api/admin/files'),
  audit: () => call<{ events: AuditEvent[] }>('GET', '/api/admin/audit'),
  discardUpload: (token: string) =>
    call<{ ok: boolean }>('POST', `/api/admin/uploads/${encodeURIComponent(token)}`, {}),
  publish: (body: Record<string, unknown>) =>
    call<{ release: Release; releases: Release[]; latest: string }>('POST', '/api/admin/releases', body),
  patch: (version: string, body: Record<string, unknown>) =>
    call<{ release: Release; releases: Release[]; latest: string }>(
      'PATCH',
      `/api/admin/releases/${encodeURIComponent(version)}`,
      body,
    ),
  remove: (version: string, deleteFile: boolean) =>
    call<{ removed: { version: string; file: string; file_removed: string } }>(
      'DELETE',
      `/api/admin/releases/${encodeURIComponent(version)}`,
      { delete_file: deleteFile },
    ),
  changePassword: (oldPassword: string, newPassword: string) =>
    call<{ username: string; updated_at: string }>('POST', '/api/admin/password', {
      old_password: oldPassword,
      new_password: newPassword,
    }),
  /** 用桌面端同样的方式问一遍“有没有新版”，给页面上的自测按钮用。 */
  checkAsClient: (current: string) =>
    call<{
      ok: boolean
      latest: string
      current: string
      has_update: boolean
      update: Release | null
      message?: string
    }>('GET', `/api/version?current=${encodeURIComponent(current)}`),
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', 'true')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let done = false
    try {
      done = document.execCommand('copy')
    } catch {
      done = false
    }
    document.body.removeChild(area)
    return done
  }
}
