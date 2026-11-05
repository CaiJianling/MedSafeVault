import { Button } from '@heroui/react'
import { History, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, type AuditEvent } from '../lib/api'
import { Chip, Section, Spinner } from './primitives'

const LABELS: Record<string, { text: string; tone?: 'mint' | 'danger' | 'amber' }> = {
  login: { text: '登录', tone: 'mint' },
  'login-failed': { text: '登录失败', tone: 'danger' },
  logout: { text: '退出' },
  upload: { text: '上传暂存' },
  release: { text: '发布版本', tone: 'mint' },
  'release-edit': { text: '修改版本' },
  'release-delete': { text: '下架版本', tone: 'amber' },
  password: { text: '改口令', tone: 'amber' },
  'upload-cancel': { text: '取消上传' },
}

export function AuditCard({ signal }: { signal: number }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const result = await api.audit()
      setEvents(result.events)
      setError('')
    } catch (error) {
      setError(errorMessage(error, '读不到操作记录'))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, signal])

  return (
    <Section
      title="最近操作"
      description="谁在什么时候登录、发布或下架了哪个版本。只在服务进程内存里，重启后清空。"
      action={
        <Button variant="ghost" size="sm" onPress={() => void load()} isDisabled={busy}>
          {busy ? <Spinner className="mr-1.5" /> : <RefreshCw className="mr-1.5 size-3.5" />}
          刷新
        </Button>
      }
    >
      {error ? <div className="adm-note adm-note-danger mb-2.5">{error}</div> : null}
      {events.length === 0 && !error ? (
        <div className="adm-note">
          <History className="mt-0.5 size-3.5 shrink-0" />
          <span>这一次服务启动后还没有操作记录。</span>
        </div>
      ) : (
        <ul className="adm-scroll-y max-h-[18rem] space-y-1.5 pr-1">
          {events.map((event, index) => {
            const meta = LABELS[event.action] || { text: event.action }
            return (
              <li
                key={`${event.time}-${index}`}
                className="rounded-lg border border-line bg-[var(--msv-surface)] px-2.5 py-2"
              >
                {/* 两行放：第一行是时间/动作/来源，第二行整行给说明，长说明就不会和 IP 挤在一起 */}
                <div className="flex items-center gap-2">
                  <span className="adm-mono shrink-0">{event.time}</span>
                  <Chip tone={meta.tone}>{meta.text}</Chip>
                  <span className="adm-mono ml-auto shrink-0 text-ice-600">{event.ip}</span>
                </div>
                <p className="mt-1 break-words text-[0.75rem] leading-relaxed text-ice-400">
                  {event.detail}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
