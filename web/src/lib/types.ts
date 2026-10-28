export type ColumnType =
  | 'text'
  | 'password'
  | 'number'
  | 'select'
  | 'textarea'
  | 'date'
  | 'url'

export interface Column {
  id?: number
  key: string
  label: string
  type: ColumnType
  encrypted: boolean
  /** Password tier: sealed with the derived subkey instead of the field key. */
  secret?: boolean
  masked: boolean
  frozen?: boolean
  width: number
  visible: boolean
  required: boolean
  options: string[]
  placeholder: string
  order?: number
}

export interface Page {
  id: number
  name: string
  icon: string
  description: string
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  columns: Column[]
  hidden_columns?: number
  record_count?: number
}

export interface PageTemplate {
  id: string
  name: string
  icon: string
  description: string
  columns: Partial<Column>[]
}

export type TableFont = 'mono' | 'sans'
export type UiScale = 'small' | 'standard' | 'large'
export type Accent = 'blue' | 'sky' | 'cyan' | 'teal' | 'emerald' | 'violet' | 'rose' | 'amber'

export interface Settings {
  auto_lock_minutes: number
  theme: string
  securecrt_path: string
  table_font: TableFont
  ui_scale: UiScale
  accent: Accent
  ui_font: string
  code_font: string
  mask_usernames: boolean
  mask_addresses: boolean
  compact_rows: boolean
}

export interface RecoveryStatus {
  enabled: boolean
  created_at: string | null
  generation: number
}

export interface StateInfo {
  initialized: boolean
  locked: boolean
  lock_reason: string | null
  auto_lock_minutes: number
  remaining_seconds: number | null
  theme: string
  settings: Settings
  recovery: RecoveryStatus
  version: string
  data_dir: string
  db_file: string
  vault_id: string | null
}

export interface Bootstrap {
  state: StateInfo
  templates: PageTemplate[]
  version: string
}

export interface RecoveryInfo {
  code: string
  created_at: string
  generation: number
  filename: string
}

export interface RecordCell {
  value: string
  masked: boolean
  has: boolean
}

export interface RecordItem {
  id: number
  page_id: number
  title: string
  cells: Record<string, RecordCell>
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface RecordDetail {
  id: number
  page_id: number
  page_name: string
  values: Record<string, string>
  columns: Column[]
  created_at: string
  updated_at: string
}

export interface RecordList {
  page: { id: number; name: string; icon: string; description: string }
  columns: Column[]
  rows: RecordItem[]
  total: number
  offset: number
  limit: number
}

export interface HistoryChange {
  key: string
  label: string
  masked: boolean
  before: string
  after: string
  has_before: boolean
  has_after: boolean
  secret: boolean
}

export interface HistoryItem {
  id: number
  action: string
  entity: 'record' | 'page' | 'vault'
  entity_id: number | null
  page_id: number | null
  page_name: string
  title: string
  created_at: string
  state: number
  undoable: boolean
  can_undo: boolean
  changes: HistoryChange[]
}

export interface UndoState {
  can_undo: boolean
  can_redo: boolean
  undo: { id: number; title: string } | null
  redo: { id: number; title: string } | null
}

export interface HistoryList {
  items: HistoryItem[]
  total: number
  undoable_id: number | null
  undo_state: UndoState
}

export interface RecyclePage {
  type: 'page'
  id: number
  name: string
  icon: string
  description: string
  deleted_at: string
  record_count: number
}

export interface RecycleRecord {
  type: 'record'
  id: number
  page_id: number
  page_name: string
  page_deleted: boolean
  title: string
  deleted_at: string
  preview: { label: string; value: string }[]
}

export interface RecycleList {
  pages: RecyclePage[]
  records: RecycleRecord[]
  counts: { pages: number; records: number }
}

export interface AboutInfo {
  version: string
  data_dir: string
  db_file: string
  db_size: number
  python: string
  platform?: string
  crypto: string
  stats: {
    pages: number
    records: number
    secrets: number
    history: number
    recycle_pages: number
    recycle_records: number
  } | null
}

export interface BackupInfo {
  created_at: string
  app_version: string
  vault_id: string
  pages: number
  records: number
  history: number
  has_recovery: boolean
}

export interface ExcelPreview {
  headers: string[]
  mapped: { key: string; label: string; header: string }[]
  unmatched: string[]
  rows: number
  samples: Record<string, string>[]
  path: string
  page_id: number
}
