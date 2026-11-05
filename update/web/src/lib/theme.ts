/** 亮/暗切换：和桌面端共用 localStorage 键名与 `.dark` 类，
 *  index.html 的首屏脚本已经按同样的规则预设过，这里只负责改。 */
export type Theme = 'light' | 'dark'

const KEY = 'heroui-theme'

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(mode: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.setAttribute('data-theme', mode)
  root.style.colorScheme = mode
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#090d13' : '#eef3f9')
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* 隐私模式下写不了 localStorage，不影响本次切换 */
  }
}
