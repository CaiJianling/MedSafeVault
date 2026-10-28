export {}

declare global {
  interface Window {
    pywebview?: {
      api: Record<string, (...args: unknown[]) => Promise<unknown>>
    }
    __msvNativeMessage?: (title: string, message: string) => void
  }
}
