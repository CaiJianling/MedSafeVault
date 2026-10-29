import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'msv-locale'

/**
 * Chinese source text is the dictionary key. English values may contain a
 * `single|plural` pair; the plural form is chosen from the `n` variable.
 */
const EN: Record<string, string> = {
  // ---------------------------------------------------------------- common
  '医安密管平台': 'Medical Password Vault',
  '医安密管平台 · 本地桌面版': 'Medical password vault · Local desktop',
  '取消': 'Cancel',
  '确认': 'Confirm',
  '关闭': 'Close',
  '删除': 'Delete',
  '恢复': 'Restore',
  '刷新': 'Refresh',
  '重试': 'Retry',
  '复制': 'Copy',
  '复制失败': 'Copy failed',
  '无法写入剪贴板': 'Cannot write to the clipboard',
  '请重试': 'Please try again',
  '请稍后重试': 'Please try again later',
  '操作失败': 'Operation failed',
  '导出失败': 'Export failed',
  '删除失败': 'Delete failed',
  '恢复失败': 'Restore failed',
  '重做失败': 'Redo failed',
  '撤回失败': 'Undo failed',
  '锁定失败': 'Lock failed',
  '保存失败，请重试': 'Save failed. Please try again.',
  '设置未保存': 'Settings not saved',
  '生成失败': 'Generation failed',
  '清空失败': 'Failed to empty',
  '修改失败，请重试': 'Change failed. Please try again.',
  '打开密码': 'Open password',
  '打开密码已修改': 'Open password changed',
  '打开密码已重设': 'Open password reset',
  '新的打开密码至少需要 8 位': 'The new open password must be at least 8 characters',
  '打开密码至少需要 8 位': 'The open password must be at least 8 characters',
  '两次输入的密码不一致': 'The passwords do not match',
  '两次输入的新密码不一致': 'The new passwords do not match',
  '显示密码': 'Show password',
  '隐藏密码': 'Hide password',
  '正在保存…': 'Saving…',
  '保存失败': 'Save failed',
  '永久删除': 'Delete permanently',
  '移入回收站': 'Move to recycle bin',
  '数据目录': 'Data folder',
  '数据库文件': 'Database file',
  '数据库': 'Database',
  '版本': 'Version',
  '加密': 'Encryption',
  '系统': 'System',
  '页面': 'Pages',
  '记录': 'Records',
  '历史': 'History',
  '历史快照': 'History snapshots',
  '加密字段': 'Encrypted fields',
  '回收站页面': 'Recycle pages',
  '回收站记录': 'Recycle records',
  '数据库大小': 'Database size',
  '创建时间': 'Created',
  '来源：{path}': 'Source: {path}',
  '已加密': 'Encrypted',
  '未设置': 'Not set',
  '（空）': '(empty)',
  '密码库': 'Vault',
  '无字段级差异': 'No field-level differences',
  '今天': 'Today',
  '昨天': 'Yesterday',
  '更早': 'Earlier',
  '刚刚': 'just now',
  '{n} 分钟前': '{n} min ago|{n} min ago',
  '{n} 小时前': '{n} h ago|{n} h ago',
  '{n} 天前': '{n} day ago|{n} days ago',
  '{y} 年 {m} 月 {d} 日': '{mon} {d}, {y}',
  '未填写': 'Not set',
  '不锁定': 'Off',
  '太弱': 'Too weak',
  '较弱': 'Weak',
  '一般': 'Fair',
  '较强': 'Strong',
  '很强': 'Very strong',
  '关闭提示': 'Dismiss notification',
  '输入 {text} 以确认': 'Type {text} to confirm',
  '正在校验…': 'Verifying…',
  '正在派生密钥…': 'Deriving key…',
  '正在打开本地保险库…': 'Opening the local vault…',
  '正在读取密码库状态…': 'Reading vault status…',
  '正在解开页面与记录…': 'Unlocking pages and records…',

  // ---------------------------------------------------------------- app
  '无法打开密码库': 'Cannot open the vault',
  '请确认通过 MedSafeVault.exe 启动，而不是直接打开网页文件。如果问题持续，请检查数据目录是否可写，或关闭杀毒软件的拦截后重试。':
    'Launch MedSafeVault.exe instead of opening the web page directly. If the problem persists, make sure the data folder is writable and that your antivirus is not blocking the app.',
  '重新加载': 'Reload',
  '无法加载页面': 'Cannot load pages',
  '本地服务初始化失败': 'The local service failed to start',
  '本地服务未就绪，请重新启动应用。': 'The local service is not ready. Restart the app.',
  '无法连接 MedSafeVault 本地服务，请关闭应用后重新启动。':
    'Cannot reach the MedSafeVault local service. Close the app and start it again.',
  '操作已撤回': 'Change undone',
  '操作已恢复': 'Change restored',
  '无法加载记录': 'Cannot load records',
  '无法加载修改历史': 'Cannot load change history',
  '无法加载回收站': 'Cannot load the recycle bin',

  // ---------------------------------------------------------------- header
  '自动锁定已关闭': 'Auto-lock is off',
  '不自动锁定': 'No auto-lock',
  '无操作 {n} 分钟后自动锁定 · 点击调整': 'Auto-locks after {n} min idle · click to adjust',
  '密钥仅在本机内存': 'Keys stay in local memory',
  '撤回：{title}': 'Undo: {title}',
  '没有可撤回的操作': 'Nothing to undo',
  '撤回': 'Undo',
  '恢复：{title}': 'Redo: {title}',
  '没有可恢复的操作': 'Nothing to redo',
  '修改历史': 'History',
  '修改历史与撤回': 'Changes and undo',
  '回收站': 'Recycle bin',
  '设置': 'Settings',
  '锁定': 'Lock',
  '主题': 'Theme',
  '跟随系统': 'System',
  '亮色': 'Light',
  '暗色': 'Dark',
  '语言': 'Language',
  '切换主题': 'Switch theme',
  '切换语言': 'Switch language',
  '中文': '中文',
  'English': 'English',
  '简体中文': 'Simplified Chinese',
  '{n} 个': '{n}',
  '{n} 条': '{n}',

  // ---------------------------------------------------------------- tabs
  '密码库页面': 'Vault pages',
  '{n} 列已隐藏': '{n} column hidden|{n} columns hidden',
  '新建页面': 'New page',

  // ---------------------------------------------------------------- records
  '删除这条记录？': 'Delete this record?',
  '「{name}」会被移入回收站，可随时恢复。':
    '"{name}" will move to the recycle bin and can be restored anytime.',
  '记录已移入回收站': 'Record moved to the recycle bin',
  '「{name}」可在回收站中恢复': '"{name}" can be restored from the recycle bin',
  '连接已启动': 'Connection launched',
  '无法连接': 'Cannot connect',
  '请检查地址与客户端配置': 'Check the address and client configuration',
  '无法读取文件': 'Cannot read the file',
  '请检查 Excel 格式': 'Check the Excel format',
  '导出完成': 'Export complete',
  '{n} 条记录已写入\n{path}': '{n} record written\n{path}|{n} records written\n{path}',
  '请关闭占用中的文件后重试': 'Close the file in use and try again',
  '导入模板已生成': 'Import template generated',
  '生成模板失败': 'Failed to generate the template',
  '还没有可用页面': 'No pages yet',
  '创建一个页面，为服务器、网络设备或业务系统建立自己的字段结构。':
    'Create a page with your own fields for servers, network devices, or business systems.',
  '暂无页面说明': 'No page description',
  '{n} 条记录': '{n} record|{n} records',
  '{n} 个加密字段': '{n} encrypted field|{n} encrypted fields',
  '更新于 {time}': 'Updated {time}',
  '新增记录': 'Add record',
  '导入与导出': 'Import & export',
  '正在选择文件…': 'Choosing file…',
  '从 Excel / CSV 导入': 'Import from Excel / CSV',
  '正在导出…': 'Exporting…',
  '导出当前页 Excel': 'Export this page',
  '下载导入模板': 'Download import template',
  '页面设置': 'Page settings',
  '页面设置与列配置': 'Page settings and columns',
  '刷新记录': 'Refresh records',
  '搜索名称、地址、账号、备注…': 'Search name, address, account, notes…',
  '清除搜索': 'Clear search',
  '找到 {n} 条匹配记录': '{n} matching record|{n} matching records',
  '共 {n} 条 · 每页 {size} 条': '{n} total · {size} per page|{n} total · {size} per page',
  '排序：{label}': 'Sort: {label}',
  '双击行可编辑': 'Double-click a row to edit',
  '没有找到「{q}」': 'No results for "{q}"',
  '这个页面还没有记录': 'This page has no records yet',
  '搜索会匹配所有字段，包括已加密的用户名与密码。试试更短的关键词。':
    'Search matches every field, including encrypted usernames and passwords. Try a shorter keyword.',
  '手动添加第一条记录，或从现有 Excel 表格批量导入。密码类字段会自动加密。':
    'Add your first record manually or import an existing spreadsheet. Secret fields are encrypted automatically.',
  '导入 Excel': 'Import Excel',
  '暂无记录': 'No records',
  '每页': 'Per page',
  '条': '',
  '上一页': 'Previous page',
  '下一页': 'Next page',
  '排序：{label} {dir}': 'Sort: {label} {dir}',

  // ---------------------------------------------------------------- table
  '操作': 'Actions',
  '加密字段提示': 'Encrypted field',
  '打开连接（RDP / SecureCRT / 浏览器）': 'Open connection (RDP / SecureCRT / browser)',
  '编辑记录': 'Edit record',
  '复制{label}': 'Copy {label}',
  '已复制{label}': '{label} copied',
  '已复制': 'Copied',
  '连接': 'Connect',
  '编辑': 'Edit',

  // ---------------------------------------------------------------- secret cell
  '无法查看': 'Cannot reveal',
  '解密失败，请重试': 'Decryption failed. Please try again.',
  '{label}已复制': '{label} copied',
  '剪贴板将在 {n} 秒后自动清空': 'Clipboard clears in {n}s',
  '密码已隐藏': 'Password hidden',
  '查看密码': 'Show password',
  '查看密码（20 秒后自动隐藏）': 'Show password (auto-hides in 20s)',
  '复制密码': 'Copy password',
  '复制（30 秒后自动清空剪贴板）': 'Copy (clears the clipboard in 30s)',

  // ---------------------------------------------------------------- settings
  '常规': 'General',
  '安全': 'Security',
  '数据': 'Data',
  '关于': 'About',
  '所有设置即时保存。安全与数据操作只影响这台电脑上的本地密码库。':
    'All settings save instantly. Security and data actions only affect the local vault on this computer.',
  'MedSafeVault · 本地加密': 'MedSafeVault · Local encryption',
  '自动锁定': 'Auto-lock',
  '计时从最后一次键鼠操作开始；锁定时会立即清除内存中的数据密钥。':
    'Timing starts from the last input. Locking immediately clears the in-memory data key.',
  '无操作后自动锁定': 'Auto-lock when idle',
  '建议在信息科共用电脑上设为 3–5 分钟；设为「不自动锁定」仅在专用终端上使用。':
    '3–5 minutes is recommended on shared computers; use "No auto-lock" only on a dedicated terminal.',
  '{n} 分钟': '{n} min',
  '显示与隐私': 'Display & privacy',
  '这里是全局默认值；单个页面中标记为「掩码」的列始终隐藏。':
    'Global defaults. Columns marked "Masked" in a page are always hidden.',
  '在表格中隐藏用户名': 'Hide usernames in the table',
  '用户名仍会加密存储，仅默认显示为圆点。':
    'Usernames remain encrypted; only the display is masked.',
  '隐藏地址类字段': 'Hide address fields',
  '服务器地址、管理地址与带外地址默认以圆点显示。':
    'Server, management, and out-of-band addresses are masked by default.',
  '紧凑行高': 'Compact rows',
  '每行高度从 48px 缩小到 38px，一屏显示更多记录。':
    'Row height shrinks from 48px to 38px to fit more records.',
  '远程连接': 'Remote connections',
  '仅用于 SSH / Telnet 终端；Windows 服务器会自动使用 mstsc，网页地址使用默认浏览器。':
    'Applies to SSH / Telnet terminals. Windows servers use mstsc; web addresses use the default browser.',
  'SecureCRT 路径': 'SecureCRT path',
  '未配置，将尝试常见安装位置': 'Not configured; common install locations will be tried',
  '选择程序': 'Choose app',
  'SecureCRT 路径已更新': 'SecureCRT path updated',
  '无法选择程序': 'Cannot choose the app',
  '修改打开密码': 'Change open password',
  '只重新包裹数据密钥，不会重写数据库中的每条密文，因此修改很快。':
    'Only the data key is rewrapped, so the change is fast and existing ciphertext stays untouched.',
  '当前密码': 'Current password',
  '新密码': 'New password',
  '确认新密码': 'Confirm new password',
  '· 强度 {label}': '· Strength: {label}',
  '更新密码': 'Update password',
  '请输入当前打开密码': 'Enter the current open password',
  '数据密钥已用新密码重新包裹，请妥善保管新密码':
    'The data key was rewrapped with the new password. Keep it safe.',
  '恢复密钥': 'Recovery key',
  '恢复密钥可以在忘记打开密码时重设密码。它不依赖旧密码，请离线保存。':
    'A recovery key resets a forgotten password without the old one. Keep it offline.',
  '重新生成': 'Regenerate',
  '已启用': 'Enabled',
  '未启用': 'Disabled',
  '第 {n} 代': 'Generation {n}',
  '创建于 {date}': 'Created {date}',
  '重新生成会使所有旧的恢复密钥文件立即失效。生成后请立刻保存新的 .msvkey 文件，并删除旧文件以免混淆。':
    'Regenerating invalidates every old recovery file. Save the new .msvkey immediately and delete the old one to avoid confusion.',
  '安全边界': 'Security boundary',
  '这些机制共同保护数据库文件本身。': 'These layers protect the database file itself.',
  '字段级 AES-256-GCM': 'Field-level AES-256-GCM',
  '每个加密字段独立密文，AAD 绑定记录与字段，防篡改与拼接。':
    'Each field is encrypted separately; AAD binds record and field to prevent tampering and splicing.',
  '随机数据密钥': 'Random data key',
  'DEK 只存在于解锁后的内存中，磁盘上仅有被主密码包裹的版本。':
    'The DEK exists only in memory after unlock; the disk holds only the wrapped copy.',
  '超时或手动锁定会清除内存密钥，后续操作需要重新输入打开密码。':
    'Timeout or manual lock wipes in-memory keys; further use requires the open password.',
  '恢复密钥独立包裹': 'Independent recovery wrapping',
  '恢复码经 PBKDF2 派生另一把 KEK，同样只包裹 DEK，不保存明文。':
    'The recovery code derives a separate KEK that wraps only the DEK. No plaintext is stored.',
  '加密备份': 'Encrypted backup',
  '导出包含页面、记录与历史快照的完整备份。备份文件本身仍由打开密码保护。':
    'Export pages, records, and history snapshots. The backup stays protected by the open password.',
  '导出完整备份': 'Export full backup',
  '从备份恢复': 'Restore from backup',
  '打开数据目录': 'Open data folder',
  '建议在每次批量导入、修改页面结构或升级版本前导出一次，并保存到离线介质。':
    'Export before bulk imports, page changes, or upgrades, and keep the file offline.',
  '确认恢复备份': 'Confirm backup restore',
  '恢复会用备份内容替换当前密码库。恢复前会自动生成一份当前数据的加密备份。':
    'Restoring replaces the vault with the backup. An encrypted backup of the current data is created first.',
  '这会覆盖当前所有页面、记录与历史': 'This overwrites all pages, records, and history',
  '备份的打开密码': 'Backup open password',
  '输入导出该备份时使用的打开密码': 'Enter the password used when exporting this backup',
  '覆盖并恢复': 'Overwrite & restore',
  '本地存储': 'Local storage',
  '密码库只保存在本机，不会同步到任何服务器。':
    'The vault lives only on this computer and never syncs to a server.',
  '路径已复制': 'Path copied',
  '密码库已锁定，解锁后可查看数据统计。':
    'The vault is locked. Unlock it to view data statistics.',
  '运行环境': 'Runtime',
  '用于排查兼容性问题，可复制后反馈。':
    'For compatibility troubleshooting; copy and share when reporting an issue.',
  '单文件桌面应用 · 数据不离开本机':
    'Single-file desktop app · Data never leaves this machine',
  '数据库 {size}': 'Database {size}',
  '重新生成恢复密钥？': 'Regenerate the recovery key?',
  '新的恢复密钥生成后，之前保存的所有恢复密钥文件与恢复码会立即失效。请确认你仍能访问当前密码库，并在生成后立即保存新文件。':
    'A new recovery key invalidates all saved recovery files and codes immediately. Make sure you can still access this vault and save the new file right away.',
  '生成': 'Generate',
  '恢复密钥已更新': 'Recovery key updated',
  '旧的恢复密钥文件已失效': 'Old recovery key files are no longer valid',
  '加密备份已导出': 'Encrypted backup exported',
  '{path}\n包含 {pages} 个页面、{records} 条记录':
    '{path}\nContains {pages} page and {records} records|{path}\nContains {pages} pages and {records} records',
  '无法读取备份': 'Cannot read the backup',
  '文件可能已损坏': 'The file may be corrupted',
  '请输入备份的打开密码': 'Enter the backup open password',
  '备份已恢复': 'Backup restored',
  '恢复前的数据已自动备份至：\n{path}': 'Current data was backed up to:\n{path}',
  '密码库已替换为备份内容': 'The vault was replaced with the backup',
  '外观': 'Appearance',
  '主题模式': 'Theme',
  '跟随系统设置，或在亮色与暗色之间手动切换。选择会保存在本机，下次启动自动应用。':
    'Follow the system setting or choose light or dark manually. Your choice is saved locally and applied next time.',
  '界面语言': 'Interface language',
  '首次启动跟随系统语言；切换后会立即生效并保存在本机。':
    'The first launch follows the system language. Changes apply instantly and are saved locally.',

  // ---------------------------------------------------------------- page dialog
  '文本': 'Text',
  '密码': 'Password',
  '数字': 'Number',
  '下拉选项': 'Select',
  '多行文本': 'Long text',
  '日期': 'Date',
  '链接': 'Link',
  '下拉': 'Select',
  '多行': 'Long',
  '页面至少需要保留一列': 'A page needs at least one column',
  '页面至少需要一列': 'A page needs at least one column',
  '请填写页面名称': 'Enter a page name',
  '页面名称不能超过 24 个字符': 'The page name cannot exceed 24 characters',
  '列名称不能为空': 'Column name cannot be empty',
  '列名称「{label}」不能超过 24 个字符':
    'Column name "{label}" cannot exceed 24 characters',
  '列名称「{label}」重复': 'Duplicate column name "{label}"',
  '页面配置已保存': 'Page settings saved',
  '「{name}」· {n} 列': '"{name}" · {n} column|"{name}" · {n} columns',
  '保存页面失败': 'Failed to save the page',
  '删除页面「{name}」？': 'Delete page "{name}"?',
  '页面与其记录会一起移入回收站，不会立即销毁。你可以在侧边栏的「回收站」中恢复页面及其记录。':
    'The page and its records move to the recycle bin; nothing is destroyed. Restore them from the recycle bin anytime.',
  '页面已移入回收站': 'Page moved to the recycle bin',
  '页面设置 · {name}': 'Page settings · {name}',
  '修改名称、图标与列配置。列结构的改动会记录到修改历史。':
    'Edit the name, icon, and columns. Column changes are recorded in history.',
  '从模板开始，或完全自定义列。列至少需要一列，保存后仍可继续调整。':
    'Start from a template or build your own columns. At least one column is required; you can adjust it later.',
  '删除页面': 'Delete page',
  '页面创建后可在「页面设置」中继续调整':
    'You can refine it later in Page settings',
  '{n} 列 · {n} 个加密字段': '{n} columns · {n} encrypted fields',
  '保存页面': 'Save page',
  '创建页面': 'Create page',
  '起始模板': 'Starter template',
  '{n}列': '{n} col|{n} cols',
  '页面名称': 'Page name',
  '例如：服务器、网络设备、检验系统': 'e.g. Servers, Network devices, LIS',
  '页面说明': 'Page description',
  '一句话说明这个页面管理什么': 'One line about what this page manages',
  '页面图标': 'Page icon',
  '列配置': 'Columns',
  '勾选「加密」的列会以密文写入数据库；「掩码」列在表格中默认显示为圆点。':
    'Encrypted columns are stored as ciphertext; masked columns show dots by default.',
  '添加列': 'Add column',
  '未命名列': 'Untitled column',
  '掩码': 'Masked',
  '必填': 'Required',
  '隐藏': 'Hidden',
  '上移': 'Move up',
  '下移': 'Move down',
  '删除列': 'Delete column',
  '列名称': 'Column name',
  '例如：服务器地址': 'e.g. Server address',
  '字段类型': 'Field type',
  '列宽 (px)': 'Width (px)',
  '输入提示': 'Placeholder',
  '例如：203.0.113.10': 'e.g. 192.168.0.10',
  '下拉选项（用逗号分隔）': 'Options (comma separated)',
  '物理机，虚拟机，云主机': 'Physical, Virtual, Cloud',
  '加密存储': 'Encrypt at rest',
  '表格中掩码': 'Mask in table',
  '在表格中显示': 'Show in table',
  '该列的值会独立加密，撤回历史中的旧值同样以密文保存。关闭加密后，之后保存的明文将不再加密。':
    'Values in this column are encrypted independently, and history keeps ciphertext. After disabling encryption, newly saved values are stored in plaintext.',

  // ---------------------------------------------------------------- setup
  '至少 8 个字符': 'At least 8 characters',
  '包含大写与小写字母': 'Upper and lower case letters',
  '包含数字': 'Includes a number',
  '包含符号（推荐）': 'Includes a symbol (recommended)',
  '初始化失败，请重试': 'Initialization failed. Please try again.',
  'FIRST RUN · 创建本机保险库': 'FIRST RUN · Create this vault',
  '一条密码，': 'One password,',
  '守住整座': 'guarding the hospital’s',
  '医院的信息底账': 'entire information ledger',
  '。': '.',
  '打开密码只用于在本机解锁，不会上传或写入任何服务器。密码库会生成一把随机数据密钥，所有账号、密码与修改历史都以它加密。':
    'The open password only unlocks this device and is never uploaded. A random data key encrypts every account, password, and history entry.',
  '字段级加密与完整性校验': 'Field-level encryption and integrity checks',
  '主密码仅用于包裹数据密钥': 'The master password only wraps the data key',
  '一次性恢复密钥': 'One-time recovery key',
  '忘记密码也能强制重设': 'Force a reset if the password is lost',
  '离开工位自动清除内存密钥': 'Clears memory keys when you step away',
  '数据目录：%APPDATA%\\MedSafeVault': 'Data folder: %APPDATA%\\MedSafeVault',
  '设置密码 → 保存密钥': 'Set password → Save key',
  '设置打开密码': 'Set the open password',
  '每次启动 MedSafeVault 时都需要输入它。密码不会被保存，也无法被找回——请务必记牢。':
    'Required every time MedSafeVault starts. It is never stored and cannot be recovered—commit it to memory.',
  '至少 8 位，建议 12 位以上': 'At least 8 characters; 12+ recommended',
  '确认密码': 'Confirm password',
  '再次输入打开密码': 'Re-enter the open password',
  '创建密码库': 'Create vault',
  '密钥派生会在本机进行 600,000 次 PBKDF2 迭代，创建过程可能需要几秒钟。当前强度：{label}':
    'Key derivation runs 600,000 local PBKDF2 iterations and may take a few seconds. Current strength: {label}',
  'MedSafeVault v{version} · 纯本地加密存储':
    'MedSafeVault v{version} · Fully local encrypted storage',
  '退出': 'Quit',

  // ---------------------------------------------------------------- lock
  '字段级加密': 'Field-level encryption',
  'AES-256-GCM 独立密钥包装': 'Independent AES-256-GCM key wrapping',
  '纯本地存储': 'Fully local storage',
  '数据不离开这台电脑': 'Data never leaves this computer',
  '忘记密码也能安全找回': 'Recover safely if the password is lost',
  '变更可撤回': 'Undoable changes',
  '每次修改都有加密记录': 'Every change has an encrypted log',
  '请输入打开密码': 'Enter the open password',
  '解锁失败，请重试': 'Unlock failed. Please try again.',
  '把医院的钥匙，': 'The hospital’s keys,',
  '锁进一座': 'locked in a',
  '看得见的保险库': 'vault you can see',
  '服务器、网络设备、数据库与应用账号集中管理。主密码解锁、字段级加密、恢复密钥与可撤回的修改历史，为信息科日常运维留下一份可靠底账。':
    'Manage servers, network devices, databases, and app accounts in one place—master-password unlock, field-level encryption, recovery keys, and undoable history for everyday IT operations.',
  '数据仅保存在本机 · 不上传云端': 'Stored only on this machine · Never uploaded',
  '解锁保险库': 'Unlock vault',
  '输入打开密码以继续。密码只在本机校验，不会被保存。':
    'Enter the open password to continue. It is verified locally and never stored.',
  '超过 {n} 分钟无操作，已自动锁定。请重新输入打开密码。':
    'Locked automatically after {n} minutes idle. Enter the open password again.',
  '保险库已手动锁定，加密密钥已从内存清除。':
    'The vault was locked manually. Encryption keys were cleared from memory.',
  '输入打开密码': 'Enter the open password',
  '解锁': 'Unlock',
  '忘记密码': 'Forgot password?',
  '使用恢复密钥': 'Use a recovery key',
  '导入 .msvkey 文件或输入恢复码，重设打开密码':
    'Import a .msvkey file or enter a recovery code to reset the password',

  // ---------------------------------------------------------------- history
  '新增': 'Added',
  '修改': 'Edited',
  '页面已创建': 'Page created',
  '已恢复': 'Restored',
  '页面已删除': 'Page deleted',
  '恢复页面': 'Page restored',
  '页面配置': 'Page settings',
  'Excel 导入': 'Excel import',
  '恢复备份': 'Backup restored',
  '安全设置': 'Security change',
  '状态': 'Status',
  '导入': 'Import',
  '无法查看历史值': 'Cannot reveal the history value',
  '解密失败': 'Decryption failed',
  '隐藏历史密码': 'Hide history secret',
  '查看历史密码': 'Reveal history secret',
  '所有增删改都以加密快照保存 · 共 {n} 条':
    'Every change is stored as an encrypted snapshot · {n} total',
  '撤回最近': 'Undo latest',
  '重做': 'Redo',
  '最近：{title}': 'Latest: {title}',
  '历史记录不会被静默删除': 'History is never silently deleted',
  '搜索标题、页面…': 'Search title, page…',
  '全部': 'All',
  '没有匹配的修改': 'No matching changes',
  '还没有修改记录': 'No changes yet',
  '换一个关键词，或切换到「全部」查看。': 'Try another keyword or switch to All.',
  '新增、编辑、删除、导入与页面配置变更都会记录在这里，密码类字段以密文保存。':
    'Creates, edits, deletes, imports, and page changes are recorded here; secret fields stay encrypted.',
  '已撤回': 'Undone',
  '已失效': 'Discarded',
  '撤回这次修改': 'Undo this change',
  '加载更早的记录（还有 {n} 条）':
    'Load earlier changes ({n} left)|Load earlier changes ({n} left)',
  '刷新修改历史': 'Refresh history',

  // ---------------------------------------------------------------- recycle
  '页面已恢复': 'Page restored',
  '「{name}」及其记录已回到密码库': '"{name}" and its records are back in the vault',
  '记录已恢复': 'Record restored',
  '「{title}」已回到原页面': '"{title}" is back on its page',
  '永久删除？': 'Delete permanently?',
  '「{name}」将被永久销毁，数据库中的密文与历史快照都会清理，无法恢复。\n建议先确认已导出备份。':
    '"{name}" will be destroyed permanently together with its ciphertext and history snapshots. This cannot be undone.\nExport a backup first.',
  '清空回收站？': 'Empty the recycle bin?',
  '将永久删除 {pages} 个页面与 {records} 条记录，包含它们的所有加密数据与历史快照，此操作无法撤回。':
    'This permanently deletes {pages} pages and {records} records, including all encrypted data and history snapshots. It cannot be undone.',
  '清空回收站': 'Empty recycle bin',
  '清空': 'Empty',
  '已永久删除': 'Permanently deleted',
  '「{name}」已从回收站清除': '"{name}" was removed from the recycle bin',
  '回收站已清空': 'Recycle bin emptied',
  '永久删除 {pages} 个页面、{records} 条记录':
    'Permanently deleted {pages} pages and {records} records',
  '删除的页面与记录会保留在这里，数据仍以密文存储，可随时恢复。':
    'Deleted pages and records stay here, still encrypted, and can be restored anytime.',
  '{pages} 个页面 · {records} 条记录': '{pages} pages · {records} records',
  '恢复后可继续使用原加密数据':
    'Restored items keep their original encrypted data',
  '回收站里没有页面': 'No pages in the recycle bin',
  '回收站里没有记录': 'No records in the recycle bin',
  '删除页面时会连同其记录一起移入这里，可在确认无误后永久清空。':
    'Deleting a page moves it and its records here; empty it once you are sure.',
  '删除单条记录后会出现在这里，恢复后回到原页面。':
    'Deleted records appear here and return to their page when restored.',
  '无页面说明': 'No description',
  '删除于 {date}': 'Deleted {date}',
  '永久删除页面': 'Delete page permanently',
  '永久删除记录': 'Delete record permanently',
  '无可见预览字段': 'No preview fields',
  '所属页面也在回收站中': 'The parent page is also in the recycle bin',
  '请先恢复所属页面': 'Restore the parent page first',
  '恢复记录': 'Restore record',
  '回收站不会自动清理。永久删除会同时移除相关历史快照；若需要留档，请先导出加密备份。':
    'The recycle bin is never cleaned automatically. Permanent deletion also removes history snapshots; export a backup first if you need a record.',

  // ---------------------------------------------------------------- record dialog
  '无法读取记录': 'Cannot read the record',
  '已生成 20 位强密码': 'Generated a 20-character password',
  '保存后将以 AES-256-GCM 加密': 'It will be encrypted with AES-256-GCM when saved',
  '请填写{label}': '{label} is required',
  '记录已更新': 'Record updated',
  '记录已添加': 'Record added',
  '修改已写入加密历史，可随时撤回':
    'The change is in encrypted history and can be undone',
  '新增{name}记录': 'New {name} record',
  '创建于 {created} · 最近更新 {updated}': 'Created {created} · Updated {updated}',
  '{name} · {n} 个字段，{m} 个加密字段':
    '{name} · {n} fields, {m} encrypted',
  '密码类字段仅在保存时加密，内存密钥锁定后自动清除':
    'Secret fields are encrypted on save; memory keys are cleared when locked',
  '保存修改': 'Save changes',
  '添加记录': 'Add record',
  '未选择': 'Not selected',
  '输入或生成密码': 'Enter or generate a password',
  '生成随机密码': 'Generate random password',
  '生成 20 位随机强密码': 'Generate a 20-character strong password',
  '输入{label}': 'Enter {label}',
  '当前页面包含 {n} 个加密字段：用户名与密码都会以独立密文写入数据库。忘记打开密码时，需要恢复密钥才能再次解密。':
    'This page has {n} encrypted fields; usernames and passwords are stored as separate ciphertexts. A recovery key is required if the open password is lost.',

  // ---------------------------------------------------------------- excel
  '导入完成': 'Import complete',
  '已写入 {n} 条记录，可在修改历史中撤回':
    '{n} record written; undo it from history|{n} records written; undo them from history',
  '导入失败，请检查文件格式': 'Import failed. Check the file format.',
  '导入 Excel / CSV': 'Import Excel / CSV',
  '{file} · 预览将写入「{page}」': '{file} · Preview will be written to "{page}"',
  '密码类字段会在导入时加密，历史中可整体撤回':
    'Secret fields are encrypted on import; the whole batch can be undone',
  '导入 {n} 条记录': 'Import {n} record|Import {n} records',
  '数据行': 'Data rows',
  '不含表头与空行': 'Excludes the header and empty rows',
  '已匹配列': 'Matched columns',
  '写入当前页面': 'Written to this page',
  '未匹配表头': 'Unmatched headers',
  '将被忽略': 'Will be ignored',
  '列映射': 'Column mapping',
  '以下表头没有对应列，导入时会被忽略：':
    'These headers have no matching columns and will be ignored:',
  '数据预览': 'Data preview',
  '最多显示前 {n} 行': 'First {n} rows shown',
  '文件中没有可预览的数据行': 'No previewable rows in the file',
  '加密字段已隐藏': 'Encrypted field hidden',
  '预览仅展示前 8 列，其余 {n} 列也会正常导入。':
    'Preview shows the first 8 columns; the other {n} will still be imported.',
  '导入不会自动去重。若表中已有相同记录，请先导出核对；导入完成后可使用顶部的撤回按钮整体撤销。':
    'Imports are not deduplicated. Export first if the page may contain duplicates. Undo the whole batch from the header.',

  // ---------------------------------------------------------------- recovery
  '恢复密钥文件': 'Recovery key file',
  '无法读取恢复密钥文件': 'Cannot read the recovery key file',
  '请输入完整的恢复码': 'Enter the complete recovery code',
  '恢复码校验失败': 'Recovery code verification failed',
  '请使用新密码解锁密码库，并妥善保存恢复密钥':
    'Unlock with the new password and keep the recovery key safe',
  '重设密码失败，请重新导入恢复密钥':
    'Reset failed. Import the recovery key again.',
  '输入恢复码': 'Enter recovery code',
  '重设打开密码': 'Reset open password',
  '恢复密钥用于在忘记打开密码时重新获得访问权限。':
    'A recovery key restores access when the open password is forgotten.',
  '恢复码由 32 位字母与数字组成，不区分大小写。':
    'The code has 32 letters and digits and is not case-sensitive.',
  '输入一次新的打开密码。旧的打开密码将立即失效。':
    'Set a new open password. The old one stops working immediately.',
  '返回': 'Back',
  '验证恢复码': 'Verify code',
  '密码库 {id}': 'Vault {id}',
  '恢复会话已建立': 'Recovery session established',
  '重设并解锁': 'Reset & unlock',
  '导入恢复密钥文件': 'Import recovery key file',
  '选择首次初始化时保存的 .msvkey 文件，自动校验所属密码库':
    'Choose the .msvkey file saved at setup; its vault is verified automatically',
  '手动输入恢复码': 'Enter the code manually',
  '从纸质密码本或离线备份中找回 32 位恢复码':
    'Find the 32-character code in your paper book or offline backup',
  '恢复密钥文件包含与主密钥等价的凭证。若它已丢失，且打开密码也忘记，密码库数据将无法解密。':
    'The recovery file is equivalent to the master key. If it is lost and the password forgotten, the data cannot be decrypted.',
  '恢复码': 'Recovery code',
  '粘贴时会自动分组，连字符可省略':
    'Groups are added automatically; hyphens are optional',
  '恢复密钥已验证。请设置新的打开密码，数据本身无需重新加密。':
    'Recovery key verified. Set a new open password; the data itself needs no re-encryption.',
  '新的打开密码': 'New open password',
  '再次输入新密码': 'Re-enter the new password',
  '恢复密钥文件已保存': 'Recovery key file saved',
  '无法保存恢复密钥文件': 'Cannot save the recovery key file',
  '恢复码已复制': 'Recovery code copied',
  '请粘贴到离线的密码本或加密笔记中':
    'Paste it into an offline password book or encrypted note',
  '请手动抄写恢复码': 'Copy the recovery code by hand',
  '保存恢复密钥': 'Save the recovery key',
  '密码库已创建。这是唯一一次完整展示恢复密钥的机会。':
    'The vault is ready. This is the only time the full recovery key will be shown.',
  '新的恢复密钥已生成，旧的恢复密钥文件与恢复码将立即失效。':
    'A new recovery key was generated. Old files and codes stop working immediately.',
  '再次保存 .msvkey': 'Save .msvkey again',
  '保存 .msvkey 文件': 'Save .msvkey file',
  '进入密码库': 'Enter vault',
  '我已保存': "I've saved it",
  '它等同于密码库的主钥匙': "It is equivalent to the vault's master key",
  '请打印或保存到离线 U 盘，不要与数据库放在同一台电脑，也不要通过聊天工具发送。任何拿到恢复密钥的人都可以重设打开密码。':
    'Print it or save it to an offline USB drive. Do not keep it on the same computer as the database or send it through chat. Anyone with it can reset the open password.',
  'RECOVERY CODE · 第 {n} 代': 'RECOVERY CODE · Generation {n}',
  '恢复码共 {n} 位，校验位已包含在末组':
    '{n} characters total; the checksum is in the last group',
  '复制恢复码': 'Copy code',
  '已保存至 {path}': 'Saved to {path}',
  '我已妥善保存恢复密钥，并理解：丢失打开密码且没有恢复密钥时，密码库无法恢复。':
    'I have saved the recovery key and understand the vault cannot be recovered without it if the open password is lost.',

  // ---------------------------------------------------------------- page icons
  '服务器': 'Server',
  '网络': 'Network',
  '应用': 'App',
  '云': 'Cloud',
  '密钥': 'Key',
  '通用': 'General',
  '终端': 'Terminal',
  '网站': 'Website',
  '保险库': 'Vault',
  '目录': 'Folder',
  // ------------------------------------------- round C & D feedback
  // ---------- accent palettes and font pickers
  '主题配色': 'Accent colour',
  '配色会同时适配亮色与暗色，所有色值都按对比度校准过。':
    'Each palette is tuned for both light and dark, and every value was checked for contrast.',
  '界面字体': 'Interface font',
  '留空使用系统默认；列表来自本机已安装的字体。':
    'Leave empty for the system default; the list comes from fonts installed on this machine.',
  '读取系统字体': 'Read installed fonts',
  '代码字体': 'Code font',
  '用于列表中的端口、地址、账号与密码等等宽文本。':
    'Used for monospaced text in the table: ports, addresses, accounts and passwords.',
  '系统默认': 'System default',
  '等宽默认': 'Monospace default',
  '当前环境无法读取系统字体': 'This environment cannot list system fonts',
  '已提供常用字体列表，可直接选择。': 'A list of common fonts is offered instead.',
  '已读取 {n} 个系统字体': 'Read {n} system font|Read {n} system fonts',
  '未获得字体读取权限': 'Font access was not granted',
  '请在权限提示中允许后重试。': 'Allow the permission prompt and try again.',
  '海蓝': 'Ocean blue',
  '天青': 'Sky',
  '湖青': 'Cyan',
  '松绿': 'Pine green',
  '翡翠': 'Emerald',
  '紫罗兰': 'Violet',
  '玫红': 'Rose',
  '琥珀': 'Amber',
  // ---------- backend generated titles and messages
  '使用中': 'In use',
  '修改页面「{from}」→「{to}」': 'Page renamed from {from} to {to}',
  '新建页面「{name}」': 'Created page {name}',
  '修改页面「{name}」': 'Updated page {name}',
  '删除页面「{name}」': 'Moved page {name} to the recycle bin',
  '彻底删除页面「{name}」及 {n} 条记录':
    'Deleted page {name} and {n} record permanently|Deleted page {name} and {n} records permanently',
  '恢复页面「{name}」': 'Restored page {name}',
  '新增记录「{name}」': 'Added record {name}',
  '修改记录「{name}」': 'Edited record {name}',
  '删除记录「{name}」': 'Moved record {name} to the recycle bin',
  '恢复记录「{name}」': 'Restored record {name}',
  '彻底删除记录「{name}」': 'Deleted record {name} permanently',
  '从 Excel 导入 {n} 条记录到「{name}」':
    'Imported {n} record into {name} from Excel|Imported {n} records into {name} from Excel',
  '清空回收站（{pages} 个页面，{records} 条记录）':
    'Emptied the recycle bin ({pages} page, {records} record)|Emptied the recycle bin ({pages} pages, {records} records)',
  '已撤回：{title}': 'Undone: {title}',
  '已恢复：{title}': 'Redone: {title}',
  '「{name}」不能为空': '{name} cannot be empty',
  '列名称「{name}」重复': 'Column name {name} is duplicated',
  '已启动 SecureCRT：{target}': 'SecureCRT started: {target}',
  '已启动远程桌面：{target}': 'Remote desktop started: {target}',
  '已在浏览器中打开 {address}': 'Opened {address} in the browser',
  '{n} 列：{rest}': '{n} column: {rest}|{n} columns: {rest}',
  '「{name}」已回到原页面': '"{name}" is back in its page',
  '删除于 {time}': 'Deleted {time}',
  '历史输入': 'Previous entries',
  '取消冻结': 'Unfreeze',
  '取消冻结（其右侧列会一并取消）': 'Unfreeze (columns to the right unfreeze too)',
  '固定在表格左侧': 'Pin to the left side of the table',
  '请先冻结左侧相邻的列': 'Freeze the column to its left first',
  '密钥派生会在本机进行 600,000 次 PBKDF2 迭代，创建过程可能需要几秒钟。当前强度：':
    'Key derivation runs 600,000 PBKDF2 iterations on this machine, so setup takes a few seconds. Current strength:',
  '数据目录：{LOC}，按 Win+R 可直接打开': 'Data folder: {LOC} — press Win+R to open it',
  '医院的信息底账。': 'the whole IT ledger of the hospital.',
  '看得见的保险库。': 'a vault you can see.',
  '医疗业务': 'Clinical systems',
  '存储': 'Storage',
  '工作站': 'Workstation',
  '打印机': 'Printer',
  '监控': 'Surveillance',
  '账号': 'Accounts',
  '网络设备': 'Network gear',
  '应用系统': 'Applications',
  '新页面': 'New page',
  '其他账号': 'Other accounts',
  '物理机、虚拟机与云主机': 'Physical, virtual and cloud servers',
  '交换机、路由器与安全设备': 'Switches, routers and security appliances',
  '业务系统与网站账号': 'Business systems and website accounts',
  '数据库实例与连接账号': 'Database instances and connection accounts',
  '从基础字段开始': 'Start from the basic fields',
  '零散账号与密钥': 'Miscellaneous accounts and keys',
  '跳至': 'Go to',
  '页': 'page',
  '共 {n} 页': '{n} page|{n} pages',
  '跳转到第几页': 'Jump to page',
  '{n} 列': '{n} column|{n} columns',
  '密码字段 {n} 个': '{n} password field|{n} password fields',
  '冻结列': 'Freeze column',
  '打开连接': 'Open connection',
  '{name} · {n} 个字段，{m} 个密码字段': '{name} · {n} fields, {m} password fields',
  '{n} 个密码字段': '{n} password field|{n} password fields',
  '{n} 条无法删除': '{n} could not be removed',
  '{n} 条记录已移入回收站': '{n} record moved to the recycle bin|{n} records moved to the recycle bin',
  '保存后将使用密码专用子密钥加密': 'Sealed with the dedicated password subkey once saved',
  '全选本页': 'Select this page',
  '全部字段已加密': 'All fields encrypted',
  '冻结': 'Frozen',
  '列表字体': 'List font',
  '加密存储（AES-256-GCM）': 'Encrypted storage (AES-256-GCM)',
  '取消选择': 'Deselect',
  '在末尾添加列（共 {n} 列）': 'Add a column at the end ({n} columns)',
  '已包含表头，可直接粘贴到 Excel': 'Header included, ready to paste into Excel',
  '大': 'Large',
  '密码列使用由数据密钥派生的独立子密钥与专用认证标签加密，撤回历史中的旧值同样以密文保存。':
    'Password columns use a separate subkey derived from the data key with its own auth tag; older values in the undo history stay encrypted as well.',
  '密码字段提示': 'Password column, sealed with its own subkey',
  '小': 'Small',
  '已复制 {n} 条记录': '{n} record copied|{n} records copied',
  '已复制整行': 'Row copied',
  '已选择 {n} 条': '{n} selected',
  '强化加密': 'Hardened',
  '强化加密（独立子密钥）': 'Hardened encryption (separate subkey)',
  '所有字段都会以密文写入数据库，密码字段额外使用独立子密钥；「掩码」列默认显示为圆点；「冻结」列需从第一列开始依次冻结。':
    'Every field is written to the database as ciphertext, and password columns get an extra subkey. Masked columns show dots, and freezing must start from the first column.',
  '含密码': 'with secrets',
  '整体缩放界面，投影或高分屏上可以选择更大的布局。':
    'Scales the whole interface; choose a larger layout for projectors or high-DPI screens.',
  '本页每个字段都以 AES-256-GCM 密文保存，认证标签绑定记录与字段，可防止篡改与拼接。忘记打开密码时需要恢复密钥才能解密。':
    'Every field on this page is stored as AES-256-GCM ciphertext, with an auth tag bound to the record and column so values cannot be swapped. Recovering a forgotten open password also restores access to the data.',
  '本页每个字段都以 AES-256-GCM 密文保存；其中 {n} 个密码字段额外使用由数据密钥派生的独立子密钥。忘记打开密码时需要恢复密钥才能解密。':
    'Every field on this page is stored as AES-256-GCM ciphertext, and the {n} password columns add a separate subkey derived from the data key. Recovering a forgotten open password also restores access to the data.',
  '标准': 'Standard',
  '每个字段都以密文写入数据库，内存密钥锁定后自动清除':
    'Every field is stored as ciphertext; the in-memory key is wiped when the vault locks',
  '每页条数': 'Rows per page',
  '清除选择': 'Clear selection',
  '界面大小': 'Interface size',
  '移入回收站 {n} 条记录？': 'Move {n} records to the recycle bin?',
  '等宽': 'Monospace',
  '等宽字体让端口、IP 与账号对齐，更易分辨 0/O 与 1/l。':
    'Monospace keeps ports, addresses and accounts aligned and makes 0/O and 1/l easier to tell apart.',
  '该列的值以 AES-256-GCM 密文保存，撤回历史中的旧值同样以密文保存。':
    'Values in this column are sealed with AES-256-GCM, including the older values kept in the undo history.',
  '选中的记录会一起移入回收站，可以逐条撤回或恢复。':
    'The selected records move to the recycle bin together, and each one can still be undone or restored.',
  '选择此记录': 'Select this record',
  '选择记录': 'Select record',
  '复制整行': 'Copy row',
  '复制所选': 'Copy selection',
  // ------------------------------------------------- data folder and help
  '帮助说明': 'Help',
  '医安密管平台 {v} · 加密、数据目录与日常操作说明': 'Medical Password Vault {v} · encryption, data folder and everyday operations',
  '所有数据只保存在本机，不会上传到任何服务器。': 'Everything stays on this computer; nothing is uploaded to any server.',
  '打开设置': 'Open settings',
  '快速上手': 'Getting started',
  '本软件是信息科自用的本机密码与资产台账：服务器、网络设备、应用系统、数据库的账号集中记录在一台电脑上，字段级加密，不联网、不同步。': 'A local password and asset register for the IT department: server, network, application and database accounts kept on one machine, encrypted field by field, never synced.',
  '首次启动设置一个打开密码（至少 8 位，建议 12 位以上），它只用于解锁，不会保存在磁盘上。': 'On first start, set an open password (8 characters minimum, 12 or more recommended). It only unlocks the vault and is never stored on disk.',
  '立刻导出恢复密钥文件，或抄下 32 位恢复码，存到与这台电脑分开的地方。': 'Export the recovery key file right away, or write down the 32-character recovery code and keep it away from this computer.',
  '用顶部标签页分类：服务器、网络设备、应用系统、数据库，也可以新建自定义页面并自行配置列。': 'Use the tabs to sort entries — servers, network gear, applications, databases — or create a custom page and define its own columns.',
  '录入时用行内小眼睛核对密码；离开座位点右上角「锁定」，或等待自动锁定倒计时结束。': 'While typing, use the eye icon to check a password; when you leave the desk click Lock at the top right, or let the auto-lock countdown run out.',
  '定期在设置 → 数据中导出加密备份，并把备份文件放到共享盘。': 'Export an encrypted backup regularly from Settings → Data and keep the file on a share.',
  '加密与密钥': 'Encryption and keys',
  '随机生成的 256 位数据密钥（DEK）负责加密内容；打开密码通过': 'A random 256-bit data key (DEK) encrypts the content; the open password is stretched with',
  '次迭代派生出包裹密钥（KEK），只用来包裹 DEK，密码本身不落盘。': 'iterations into a key-encryption key (KEK) that only wraps the DEK — the password itself is never stored.',
  '每个字段单独用': 'Every field is encrypted separately with',
  '加密并绑定用途标签，密文前缀': ', authenticated against a purpose tag; ordinary ciphertext starts with',
  '；密码字段再经 HKDF 派生出更高等级的子密钥，前缀': '; password fields use a stronger subkey derived through HKDF, prefixed',
  '，两者互不通用。': ', and the two keys are not interchangeable.',
  '修改历史、回收站内容与备份文件同样是密文。列表默认掩码显示，只有点击该行该字段的小眼睛才会解密这一个值，没有「全部显示」。': 'History, recycle-bin contents and backup files are ciphertext too. The list is masked by default: one click on an eye reveals that single value — there is no show-all.',
  '复制密码后剪贴板会在 30 秒后自动清除；修改打开密码只重新包裹 DEK，历史密文保持有效。': 'After a password is copied the clipboard clears itself in 30 seconds; changing the open password only re-wraps the DEK, so existing ciphertext stays valid.',
  '边界：解锁期间密钥在进程内存里。请同时保证 Windows 账户口令强度并开启 BitLocker——本机加密不替代磁盘加密。': 'Limits: while unlocked the key sits in process memory. Keep a strong Windows password and BitLocker on — local encryption does not replace disk encryption.',
  '恢复密钥与忘记密码': 'Recovery key and forgotten passwords',
  '恢复密钥是第二把独立包裹 DEK 的钥匙。忘记打开密码时可以用它重设密码，数据不会丢失。': 'The recovery key is a second, independent key wrapping the same DEK. Forget the open password and you can reset it without losing data.',
  '设置 → 安全 → 恢复密钥：生成或重新生成，然后「导出恢复密钥文件」保存 .msvkey，或查看 32 位恢复码。': 'Settings → Security → Recovery key: generate or rotate it, then export the .msvkey file or read out the 32-character code.',
  '在锁屏页点「使用恢复密钥」，导入 .msvkey 文件或输入恢复码。': 'On the lock screen choose Use recovery key, then import the .msvkey file or type the code.',
  '设置一个新的打开密码，旧密码即刻失效，其余数据保持不变。': 'Choose a new open password; the old one stops working at once and nothing else changes.',
  '注意：每次重新生成，旧文件立即失效；恢复密钥等同于访问密码库的凭据，请与密码分开保管。若打开密码与恢复密钥同时丢失，数据无法找回。': 'Note: rotating the key invalidates older files immediately. A recovery key grants access to the vault, so store it apart from the password. Lose both and the data is unrecoverable.',
  '密码库、日志与备份保存在同一个数据目录。设置 → 数据 提供三种位置，选定后重启生效：': 'The vault, log and backups live in one data folder. Settings → Data offers three locations; a choice takes effect after a restart:',
  '选项': 'Option',
  '实际位置': 'Actual path',
  '适用场景': 'When to use',
  '默认。普通用户可写，不需要管理员权限。': 'Default. Writable by a normal user, no administrator rights needed.',
  '应用程序所在目录': 'Next to the application',
  '数据跟着程序走，适合拷到移动硬盘或从共享盘运行。': 'Data travels with the program — good for a USB drive or a shared folder.',
  '自定义目录': 'Custom folder',
  '放到加密盘或信息科指定的存储位置。': 'Put it on an encrypted drive or wherever IT designates.',
  '位置记录在程序目录下的配置文件 MedSafeVault.json，首次启动自动创建；若程序目录不可写（例如装在 C:\\Program Files），配置自动改存到 %APPDATA%\\MedSafeVault。': 'The location is recorded in MedSafeVault.json next to the program, created on first start; if that folder is read-only (for example C:\\Program Files) the file is kept under %APPDATA%\\MedSafeVault instead.',
  '退出程序时执行搬移：先把数据库、日志与备份复制到新目录，再对新库做完整性校验，通过后更新配置文件，最后把旧目录改名保留，不会直接删除。': 'The move runs on exit: the database, log and backups are copied to the new folder, the copy is integrity-checked, the config is updated, and the old folder is renamed rather than deleted.',
  '浏览器缓存目录 webview 不参与搬移，它会在新位置自动重建。': 'The webview browser cache is not moved; it is rebuilt in the new location.',
  '若设置了环境变量 MEDSAFE_DATA_DIR，它以环境变量为准，页面上的选项会变灰不可选。': 'If MEDSAFE_DATA_DIR is set it wins, and the options on this page are greyed out.',
  '目标目录必须为空或不含密码库文件；不允许与当前目录相互嵌套，也不建议使用盘符根目录。': 'The target must not already contain vault files, must not nest with the current folder, and should not be a drive root.',
  '备份与迁移': 'Backup and migration',
  '设置 → 数据 → 导出加密备份得到': 'Settings → Data → Export encrypted backup produces a',
  '文件，内容仍是密文，恢复时需要当初的打开密码。': 'file that stays encrypted; restoring it needs the open password in use when it was exported.',
  '恢复备份前，程序会先自动导出一份当前数据的备份（': 'Before a restore the app first writes a backup of the current data (',
  '），避免误覆盖。': ') so nothing is overwritten by mistake.',
  '换电脑：把整个数据目录拷过去，或在新机器上用备份文件恢复，再导入恢复密钥即可。': 'Moving PCs: copy the whole data folder, or restore the backup on the new machine and import the recovery key.',
  '只拷贝 vault.db 是安全的做法之一，但请连同 .msvkey 一起归档，否则忘记密码将无法重设。': 'Copying vault.db alone works, but archive the .msvkey with it — without a recovery key a forgotten password cannot be reset.',
  'Excel 导入导出': 'Excel import and export',
  '列表右上角「Excel」下拉菜单：下载模板、导入、导出当前页。': 'The Excel menu at the top right of the list: download a template, import, or export the current page.',
  '模板按当前页的列生成，第一行是列名；导入支持 xlsx / xls / csv，无需安装 Office。': 'The template follows the columns of the current page with the header in the first row; import accepts xlsx / xls / csv and needs no Office install.',
  '导入前会显示列映射与样例预览，对不上的列留空，可先小批量试导。': 'Before importing you see the column mapping and a sample preview; unmatched columns stay empty — try a small batch first.',
  '导出包含密码列的明文，请在共享盘上注意访问权限；如果只是交接，建议改用加密备份。': 'Exports contain plaintext passwords, so watch the permissions on any share; for handovers prefer the encrypted backup.',
  '行内链接按钮或右键菜单可直接连接：RDP、SecureCRT 会话、浏览器打开地址。': 'The inline link button or the row context menu connects directly: RDP, a SecureCRT session, or opening the address in a browser.',
  'RDP 会在数据目录生成带用户名与端口的临时 .rdp 文件再调用系统 mstsc；端口、地址取自该行的列值。': 'For RDP a temporary .rdp file carrying the username and port is written into the data folder and handed to the system mstsc; address and port come from that row.',
  'SecureCRT 需要在设置 → 数据中指定程序路径（通常无需管理员权限，绿色版也可）。': 'SecureCRT needs its executable path set in Settings → Data (portable installs are fine, no admin needed).',
  '连接工具本身不在软件内嵌，因此不会额外开放端口，也不会修改系统远程设置。': 'No remote tool is embedded, so the app opens no extra ports and never changes system remote settings.',
  '列表与快捷键': 'List and shortcuts',
  '说明': 'What it does',
  '打开编辑窗口；也可以点行尾的铅笔图标。': 'Opens the editor; the pencil icon at the end of the row does the same.',
  '快捷菜单：复制整行、编辑、连接、移入回收站。': 'Context menu: copy the row, edit, connect, move to the recycle bin.',
  '批量复制或批量移入回收站，顶部会出现批量操作条。': 'Bulk copy or bulk move to the recycle bin; a batch bar appears above the list.',
  '仅显示该单元格一个密码，掩码不会一次性全部展开。': 'Reveals that one cell only; masks are never expanded in bulk.',
  '撤销上一步修改；': 'Undo the last change;',
  ' 或 ': ' or',
  ' 重做。': ' redo.',
  '清空页码输入框、关闭浮层菜单。': 'Clears the page-jump box and closes open menus.',
  '页面设置抽屉里可以增删列、改列名与列类型、冻结列、调宽度、拖顺序；列很多时新增会自动滚动到新列。': 'The page settings drawer adds and removes columns, renames them, changes their type, freezes, resizes and reorders them; with many columns a new one scrolls into view.',
  '搜索框跨列模糊匹配；下方可切换每页条数并跳转到指定页码。': 'The search box matches across all columns; below the list you can change the page size and jump to a page.',
  '操作系统、厂商等列会联想本机已录入过的值，密码列永不联想、也不会出现在提示里。': 'Columns such as OS or vendor suggest values already entered on this machine; password columns never suggest and never appear in suggestions.',
  '设置 → 常规 中可切换列表等宽字体、界面字体与代码字体、界面大小（小/标准/大）、强调色与亮暗主题。': 'Settings → General switches the monospace list font, the UI and code fonts, the interface size (small/standard/large), the accent colour and the light/dark theme.',
  '环境变量': 'Environment variables',
  '环境变量只影响本机当前用户或启动脚本，不写入注册表。临时使用可在命令行里设置后再启动程序：': 'Environment variables affect only the current user or the launching script and never touch the registry. For a one-off run, set it in a command prompt and start the app:',
  '变量': 'Variable',
  '作用': 'Purpose',
  '强制指定数据目录，优先级高于设置页的选择；用于测试或多环境隔离。': 'Forces a data folder, overriding the choice in Settings; useful for testing or isolating environments.',
  '让桌面端加载本地前端开发服务器，仅用于开发调试。': 'Points the desktop app at a local front-end dev server; development only.',
  '设为 1 时启动附带 WebView2 开发者工具。': 'Set to 1 to start with WebView2 developer tools.',
  '在老旧终端上部署': 'Deploying on older terminals',
  'Windows 10 / 11：直接运行 exe，系统一般已内置 WebView2 运行时。': 'Windows 10 / 11: run the exe directly — the WebView2 runtime is normally already present.',
  'Windows 7 / 8.1：界面依赖 WebView2。Evergreen 版在 Win7 上停留在 Edge 109，早已不再获得安全更新，因此建议随程序分发「固定版本」运行时，或把该终端升级到 Win10。': 'Windows 7 / 8.1: the UI needs WebView2. The Evergreen runtime stops at Edge 109 on Windows 7 and no longer receives security updates, so ship the Fixed Version runtime with the app or upgrade the terminal to Windows 10.',
  '固定版本用法：把解压出的运行时目录放在 exe 同级，启动前设置 WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 指向它，免安装、免管理员、不写注册表。': 'Fixed Version usage: put the unpacked runtime folder next to the exe and set WEBVIEW2_BROWSER_EXECUTABLE_FOLDER before launching — no installer, no administrator rights, no registry.',
  '32 位终端需要 32 位构建产物（配套的 32 位 Python 工具链），不能直接运行 64 位 exe。': 'A 32-bit terminal needs a 32-bit build with a matching 32-bit Python toolchain; the 64-bit exe will not run there.',
  '部署约束：单文件 exe 免安装，解压到临时目录运行；数据写入用户目录；不写注册表、不安装服务、不开放端口。': 'Deployment constraints met: a single portable exe that unpacks to a temp folder, data in the user profile, no registry writes, no services, no listening ports.',
  '离线安装依赖请使用国内镜像：pip 用 pypi.tuna.tsinghua.edu.cn/simple，npm 用 registry.npmmirror.com。': 'For offline installs use domestic mirrors: pypi.tuna.tsinghua.edu.cn/simple for pip and registry.npmmirror.com for npm.',
  '常见问题': 'Frequently asked questions',
  '终端部署': 'Deployment',
  '程序目录': 'app folder',
  '双击行': 'Double-click a row',
  '右键行': 'Right-click a row',
  '小眼睛': 'Eye icon',
  '行首多选框': 'Row checkbox',
  '尚未选择': 'Not chosen',
  '设置备份密码': 'Set a backup password',
  '整个备份文件都会用这个密码加密，包括页面结构与记录条数。忘记它就无法恢复该备份，请把它与备份文件分开存放。': 'The whole backup file — layout and record counts included — is encrypted with this password. Without it the backup cannot be restored, so keep the password apart from the file.',
  '加密并导出': 'Encrypt and export',
  '备份密码': 'Backup password',
  '确认备份密码': 'Confirm backup password',
  '再次输入备份密码': 'Re-enter the backup password',
  '备份密码至少需要 8 位': 'The backup password needs at least 8 characters',
  '两次输入的备份密码不一致': 'The backup passwords do not match',
  '导入这个备份时只需要输入备份密码，不需要当初的打开密码；恢复后仍用原来的打开密码解锁。': 'Restoring this backup only needs the backup password, not the old open password; afterwards the vault still unlocks with its own open password.',
  '整个文件已用备份密码加密：\n{path}': 'The whole file is sealed with the backup password:\n{path}',
  '请输入备份密码': 'Enter the backup password',
  '备份已解锁': 'Backup unlocked',
  '可以确认内容后覆盖恢复了。': 'Review the contents, then overwrite and restore.',
  '无法解锁备份': 'Could not unlock the backup',
  '导出时设置一个备份密码，整个文件（含页面结构与记录条数）都会被它加密；导入时必须验证该密码。': 'Set a backup password on export: the entire file (structure and record counts included) is encrypted with it, and importing verifies that password first.',
  '该文件已加密：输入备份密码后才能看到内容。': 'This file is encrypted: enter the backup password to see its contents.',
  '输入导出该备份时设置的备份密码': 'Enter the backup password set when this file was exported',
  '验证并预览': 'Verify and preview',
  '文件；整个文件都由导出时设置的备份密码加密，导入时只需验证这个备份密码，不需要当初的打开密码。': 'file; the whole thing is encrypted with the backup password you set on export, so restoring only verifies that password rather than the old open password.',
  '备份密码与保险库的打开密码相互独立：忘记打开密码用恢复密钥，忘记备份密码则该备份文件无法读取。': 'The backup password is independent of the vault\'s open password: forget the open password and use the recovery key; forget the backup password and that backup file cannot be read.',
  '请为备份设置密码': 'Set a password for the backup',
  '这是加密备份，请输入导出时设置的备份密码': 'This is an encrypted backup; enter the backup password from when it was exported',
  '备份密码不正确': 'The backup password is incorrect',
  '备份内容与该密码不匹配': 'The backup does not match this password',
  '忘记打开密码：在锁屏页用恢复密钥重设，数据不受影响。两者都丢了则无法找回。': 'Forgotten open password: reset it with the recovery key on the lock screen; the data is untouched. Lose both and it cannot be recovered.',
  '自动锁定时间到：内存密钥已清除，窗口仍在但需要重新输入密码；这段时间内数据仍是密文。': 'Auto-lock fired: the memory key is gone, the window stays but asks for the password again; the data remains ciphertext throughout.',
  '文字太小或发虚：设置 → 常规 → 界面大小 选择「大」，或更换界面/列表字体。': 'Text too small or blurry: pick Large under Settings → General → Interface size, or change the UI/list font.',
  '换了 Windows 用户或机器：把数据目录整体拷到新机器的同一路径，或在新机器上恢复备份。': 'New Windows user or machine: copy the whole data folder to the same path, or restore a backup on the new machine.',
  '在浏览器里直接打开 web/dist/index.html 是演示模式，数据不落盘也不加密，请不要输入真实账号。': 'Opening web/dist/index.html in a browser is demo mode: nothing is stored or encrypted, so never type real credentials there.',
  '想改数据目录：设置 → 数据 → 数据目录，选好后退出程序，搬移会在退出时自动完成并提示结果。': 'To change the data folder: Settings → Data → Data folder, pick a location and exit — the move runs on exit and reports the result.',
  '帮助': 'Help',
  '数据目录已是该位置': 'Already this folder',
  '无需移动文件。': 'Nothing needs to move.',
  '已记录，重启后生效': 'Saved; effective after a restart',
  '退出程序时会自动搬移数据。': 'The data moves automatically when the app exits.',
  '目录未更改': 'Folder unchanged',
  '无法打开文件夹选择': 'Could not open the folder picker',
  '默认位置，普通用户可写，不需要管理员权限。': 'Default location, writable without administrator rights.',
  '数据跟着 exe 走，适合拷到移动硬盘或共享盘。': 'Data travels with the exe — good for USB drives and shares.',
  '强制指定数据目录，优先级高于本页面的设置。': 'Forces the data folder and overrides the choice on this page.',
  '密码库、日志与备份都保存在这里。修改后重启生效，退出时自动搬移文件。': 'The vault, log and backups live here. A change applies after a restart; files move when the app exits.',
  '打开目录': 'Open folder',
  '当前': 'Current',
  '例如 D:\\科室资料\\MedSafeVault数据': 'For example D:\\IT\\vault-data',
  '自定义数据目录': 'Custom data folder',
  '浏览…': 'Browse…',
  '使用此目录': 'Use this folder',
  '环境变量优先，取消该变量后才能在这里选择数据目录。': 'The environment variable wins; clear it to choose a folder here.',
  '新目录已记录，重启后生效': 'New folder queued; effective after a restart',
  '退出程序时会自动复制密码库与备份并校验，原目录改名保留，不会直接删除。': 'On exit the vault and backups are copied and verified, and the old folder is renamed rather than deleted.',
  '退出并应用': 'Exit and apply',
  '取消变更': 'Undo change',
  '占用空间': 'Space used',
  '配置文件': 'Config file',
  '配置文件记录数据目录位置，首次启动时自动创建在程序目录（{dir}）；该目录不可写时改存到 %APPDATA%\\MedSafeVault。': 'The config file records the data folder. It is created next to the program on first start ({dir}); if that folder is read-only it is stored under %APPDATA%\\MedSafeVault instead.',
  '配置文件所在目录不可写，数据目录设置无法保存。': 'The config folder is not writable, so a new data folder cannot be saved.',
  '环境变量只影响本机当前用户或启动脚本，不写入注册表。': 'Environment variables affect only this user or the launching script and never touch the registry.',
  '导出 Excel': 'Export Excel',
  '将「{page}」的 {n} 条记录导出为 .xlsx 文件。': 'Export {n} records from “{page}” to an .xlsx file.',
  '导出': 'Export',
  '记录条数': 'Records',
  '用密码保护工作簿': 'Protect the workbook with a password',
  '打开文件时需要输入密码，适合通过邮件或共享目录传递。': 'The file cannot be opened without this password — useful when sending it by mail or leaving it on a shared folder.',
  'Excel 密码': 'Excel password',
  '确认 Excel 密码': 'Confirm Excel password',
  '再次输入 Excel 密码': 'Re-enter the Excel password',
  'Excel 密码至少需要 8 位': 'The Excel password needs at least 8 characters',
  '两次输入的 Excel 密码不一致': 'The Excel passwords do not match',
  '密码只保护这个 Excel 文件；软件内的数据仍由保险库加密。忘记密码将无法打开该文件，请另行记下。': 'The password only protects this Excel file; the data inside the app stays encrypted by the vault. Without the password the file cannot be opened, so note it somewhere else.',
  '未设密码的导出文件包含解密后的明文字段，请存放在受控位置。': 'Without a password the exported file contains decrypted plain text, so keep it in a controlled location.',
  '解锁 Excel': 'Unlock Excel',
  '「{file}」设置了打开密码，验证后即可预览并导入。': '“{file}” is protected by an opening password; verify it to preview and import.',
  '预览文件': 'Preview file',
  'Excel 打开密码': 'Excel opening password',
  '输入打开这个工作簿时设置的密码': 'Opening password of this workbook',
  '密码只在本机内存中用于解密这个文件，不会被保存。': 'The password is only used in local memory to decrypt this file and is not saved.',
  'Excel 打开密码不正确': 'The Excel opening password is incorrect',
  '{n} 条记录已写入（已设置打开密码）\n{path}': '{n} records written (opening password set)\n{path}',
  '导出时可勾选「用密码保护工作簿」，Excel 打开时会要求输入这个密码；导入带打开密码的 .xlsx / .xls 文件时会先弹窗要求验证，解密只在内存中进行。': 'On export you can tick “Protect the workbook with a password”: Excel then asks for it when opening. Importing a protected .xlsx / .xls prompts for that password first, and decryption happens in memory only.',
}

const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

let currentLocale: Locale = 'zh'

export function getLocale(): Locale {
  return currentLocale
}

/** Translate a Chinese source string outside React (utils, errors, mock). */
export function translate(
  source: string,
  vars?: Record<string, string | number>,
): string {
  let value = currentLocale === 'zh' ? source : EN[source]
  if (value == null) return source
  if (currentLocale !== 'zh' && value.includes('|')) {
    const [one, many] = value.split('|')
    const count = typeof vars?.n === 'number' ? vars.n : null
    value = count === 1 ? one : (many ?? one)
  }
  if (vars) {
    value = value.replace(/\{(\w+)\}/g, (match, name: string) => {
      const replacement = vars[name]
      if (replacement == null) return match
      if (name === 'n' && currentLocale === 'en' && typeof replacement === 'number') {
        return String(replacement)
      }
      return String(replacement)
    })
  }
  return value
}

/**
 * History titles, undo summaries and backend errors are produced in Chinese and
 * older rows keep that text, so recognised shapes are rebuilt from a template
 * here instead of being stored twice.
 */
const SERVER_PATTERNS: [RegExp, string][] = [
  [/^修改页面「(?<from>[^」]*)」→「(?<to>[^」]*)」$/, '修改页面「{from}」→「{to}」'],
  [/^新建页面「(?<name>[^」]*)」$/, '新建页面「{name}」'],
  [/^修改页面「(?<name>[^」]*)」$/, '修改页面「{name}」'],
  [/^删除页面「(?<name>[^」]*)」$/, '删除页面「{name}」'],
  [
    /^彻底删除页面「(?<name>[^」]*)」及 (?<n>\d+) 条记录$/,
    '彻底删除页面「{name}」及 {n} 条记录',
  ],
  [/^恢复页面「(?<name>[^」]*)」$/, '恢复页面「{name}」'],
  [/^新增记录「(?<name>[^」]*)」$/, '新增记录「{name}」'],
  [/^修改记录「(?<name>[^」]*)」$/, '修改记录「{name}」'],
  [/^删除记录「(?<name>[^」]*)」$/, '删除记录「{name}」'],
  [/^恢复记录「(?<name>[^」]*)」$/, '恢复记录「{name}」'],
  [/^彻底删除记录「(?<name>[^」]*)」$/, '彻底删除记录「{name}」'],
  [
    /^从 Excel 导入 (?<n>\d+) 条记录到「(?<name>[^」]*)」$/,
    '从 Excel 导入 {n} 条记录到「{name}」',
  ],
  [
    /^清空回收站（(?<pages>\d+) 个页面，(?<records>\d+) 条记录）$/,
    '清空回收站（{pages} 个页面，{records} 条记录）',
  ],
  [/^已撤回：(?<title>.*)$/, '已撤回：{title}'],
  [/^已恢复：(?<title>.*)$/, '已恢复：{title}'],
  [/^「(?<name>[^」]*)」不能为空$/, '「{name}」不能为空'],
  [/^列名称「(?<name>[^」]*)」重复$/, '列名称「{name}」重复'],
  [/^已启动 SecureCRT：(?<target>.*)$/, '已启动 SecureCRT：{target}'],
  [/^已启动远程桌面：(?<target>.*)$/, '已启动远程桌面：{target}'],
  [/^已在浏览器中打开 (?<address>.*)$/, '已在浏览器中打开 {address}'],
  [/^(?<n>\d+) 列：(?<rest>.*)$/, '{n} 列：{rest}'],
  [/^(?<n>\d+) 条记录$/, '{n} 条记录'],
]

export function translateServerText(text: string | null | undefined): string {
  if (!text) return ''
  if (currentLocale === 'zh') return text
  const exact = translate(text)
  if (exact !== text) return exact
  for (const [pattern, key] of SERVER_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.groups) continue
    const vars: Record<string, string> = {}
    for (const [name, value] of Object.entries(match.groups)) {
      vars[name] = typeof value === 'string' ? translateServerText(value) : ''
    }
    const translated = translate(key, vars)
    if (translated !== key) return translated
  }
  return text
}

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* storage may be unavailable */
  }
  const languages =
    typeof navigator !== 'undefined' && navigator.languages?.length
      ? navigator.languages
      : typeof navigator !== 'undefined' && navigator.language
        ? [navigator.language]
        : []
  return languages.some((lang) => lang.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

function applyDocumentLocale(locale: Locale) {
  currentLocale = locale
  try {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  } catch {
    /* no document */
  }
}

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (source: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const detected = detectLocale()
    applyDocumentLocale(detected)
    return detected
  })

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    applyDocumentLocale(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage may be unavailable */
    }
  }, [])

  useEffect(() => {
    applyDocumentLocale(locale)
  }, [locale])

  const t = useCallback(
    (source: string, vars?: Record<string, string | number>) => translate(source, vars),
    [locale],
  )

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}

export function formatMonthYear(date: Date): string {
  if (currentLocale === 'zh') {
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
  }
  return `${EN_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

export function formatDayLabel(date: Date): string {
  if (currentLocale === 'en') {
    return `${EN_MONTHS[date.getMonth()]} ${date.getDate()}`
  }
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
