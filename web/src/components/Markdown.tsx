/**
 * Update notes are Markdown (headings, lists, bold, code, links…). They are
 * written by the 信息科 in the update admin page and rendered here inside the
 * update dialog, so the prompt looks the same on every workstation.
 *
 * Raw HTML is not rendered (react-markdown drops it), and links are shown as
 * text instead of being clickable: inside the pywebview window a real <a>
 * would navigate away from the app.
 */
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/utils'

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('md', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children }) => (
            <span className="md-link" title={href || ''}>
              {children}
            </span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
