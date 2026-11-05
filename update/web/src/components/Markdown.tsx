/**
 * 更新说明是 Markdown（标题、列表、加粗、代码、链接…），由信息科在发布表单里写。
 * 这里负责「详情」面板的预览视图，让操作者看到桌面端用户实际看到的样子；
 * 原文视图仍然保留（ReleaseTable 里的「显示原文」），复制粘贴时更直接。
 *
 * 不渲染原始 HTML（react-markdown 会丢掉），链接渲染成真的 <a>：后台跑在浏览器里，
 * 点开外链是新标签页，不会像桌面端那样把界面导航走。
 */
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--msv-accent-text)] underline decoration-[var(--msv-accent)]/60 underline-offset-2"
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
