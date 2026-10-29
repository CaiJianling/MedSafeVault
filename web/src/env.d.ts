export {}

declare global {
  interface Window {
    pywebview?: {
      api: Record<string, (...args: unknown[]) => Promise<unknown>>
    }
    __msvNativeMessage?: (title: string, message: string) => void
    /** Called by the backend when the window X is clicked. */
    __msvClosePrompt?: () => void
  }
}
