import { Button } from '@heroui/react'
import { Check, Copy, Radar, Server } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage, type Info } from '../lib/api'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'
import { Chip, Field, Section, Spinner } from './primitives'

function AddressRow({ value, tag }: { value: string; tag?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-[var(--msv-surface)] px-2.5 py-1.5 font-mono text-[0.75rem] text-ice-200">
        {value}
      </code>
      {tag ? <Chip>{tag}</Chip> : null}
      <Button
        variant="ghost"
        size="sm"
        aria-label="复制地址"
        className="size-8 min-w-8 rounded-lg text-ice-500 data-[hovered=true]:bg-[var(--msv-tint-strong)] data-[hovered=true]:text-ice-200"
        onPress={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            })
            .catch(() => toast.danger('浏览器不允许复制，请手动选中地址'))
        }}
      >
        {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
      </Button>
    </div>
  )
}

/** 「提供给更新服务的地址」：桌面端设置里要填的就是这一串。 */
export function AddressCard({
  info,
  count,
  latest,
}: {
  info: Info | null
  count: number
  latest: string
}) {
  const origin = `${window.location.origin}/`
  const probed = (info?.addresses || []).map((value) => value.replace(/\/$/, ''))
  const [current, setCurrent] = useState(info?.app_version || '')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  async function selfTest() {
    setBusy(true)
    setResult('')
    try {
      const payload = await api.checkAsClient(current.trim())
      const update = payload.update
      setResult(
        payload.has_update && update
          ? `有新版：${payload.latest}（${(update.size / 1024 / 1024).toFixed(1)} MB，` +
            `sha256 ${update.sha256.slice(0, 12)}…）`
          : `已是最新（服务端最新 ${payload.latest || '没有版本'}${payload.message ? `：${payload.message}` : ''}）`,
      )
    } catch (error) {
      setResult(errorMessage(error, '自测失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="更新服务地址"
      description="桌面端「设置 → 关于 → 更新服务地址」里填下面任意一条即可；填本机 IP 那条，别的科室电脑才连得上。"
      action={
        <div className="flex items-center gap-2">
          <Chip tone="mint">{count} 个版本</Chip>
          <Chip>最新 {latest || "无"}</Chip>
        </div>
      }
    >
      <div className="space-y-2">
        <AddressRow value={origin} tag="当前页面" />
        {probed.map((value) => (
          <AddressRow key={value} value={`${value}/`} tag="服务器探测" />
        ))}
        {!probed.length ? (
          <p className="text-[0.71875rem] leading-relaxed text-ice-600">
            服务器没能确定自己的内网 IP（单机或容器环境常见）。请用「当前页面」这一条，
            或把里面的主机名换成这台机器的实际 IP。
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="按桌面端的方式自测" hint="等价于客户端启动时发的检查请求。">
          <input
            className="msv-input font-mono"
            value={current}
            placeholder="当前版本号，例如 2.0.0"
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>
        <Button variant="secondary" size="md" onPress={() => void selfTest()} isDisabled={busy}>
          {busy ? <Spinner className="mr-1.5" /> : <Radar className="mr-1.5 size-4" />}
          检查一次
        </Button>
      </div>
      {result ? (
        <div className={cn('adm-note mt-3', 'adm-note-mint')}>
          <Server className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{result}</span>
        </div>
      ) : null}

      <p className="mt-3 text-[0.6875rem] leading-relaxed text-ice-600">
        客户端接口：
        <code className="ml-1 font-mono text-ice-400">/api/version?current=版本号</code>
        <code className="mx-1 font-mono text-ice-400">/api/releases</code>
        <code className="mr-1 font-mono text-ice-400">/download/版本号</code>
        ；这些接口不需要登录，桌面端每次启动都会访问。
      </p>
    </Section>
  )
}
