declare module '@novnc/novnc/lib/rfb.js' {
  interface RFBOptions {
    credentials?: { username?: string; password?: string; target?: string }
    shared?: boolean
    wsProtocols?: string[]
    repeaterID?: string
  }

  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: RFBOptions)
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    viewOnly: boolean
    background: string
    focus(): void
    disconnect(): void
    sendCtrlAltDel(): void
    sendCredentials(credentials: { username?: string; password?: string }): void
    addEventListener(type: string, handler: (event: CustomEvent) => void): void
    removeEventListener(type: string, handler: (event: CustomEvent) => void): void
  }
}
