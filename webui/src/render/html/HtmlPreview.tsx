// render/html/HtmlPreview.tsx
// 网页（.html/.htm/.xhtml）预览：沙箱 iframe 渲染 + 源码视图切换。
// 安全：iframe sandbox 不含 allow-same-origin（不透明源），页面脚本无法访问宿主
//   应用的 DOM / localStorage / Cookie；同时保留 allow-scripts 让页面自身脚本可运行。
// 限制：srcdoc/沙箱无相对路径基准，页面引用的相对资源（css/js/图片）不会加载。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { CodeFileViewer } from '../code/CodeFileViewer';
import { PreviewModeToggle, type PreviewMode } from '../core/PreviewModeToggle';

export interface HtmlPreviewProps {
  text: string;
  path: string;
}

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock';

export function HtmlPreview({ text, path }: HtmlPreviewProps) {
  const { t } = useTranslation();
  const [showSource, setShowSource] = useState(false);

  // 「在新标签打开」按需生成 blob URL（延迟回收）：避免常驻 blob 被 StrictMode 双调用提前 revoke
  const handleOpenInNewTab = useCallback(() => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [text]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <PreviewModeToggle
          mode={showSource ? 'code' : 'preview'}
          onChange={(m: PreviewMode) => setShowSource(m === 'code')}
        />
        <button
          type="button"
          onClick={handleOpenInNewTab}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <ExternalLink className="size-3.5" />
          {t('preview.openInNewTab')}
        </button>
      </div>

      {showSource ? (
        <div className="min-h-0 flex-1">
          <CodeFileViewer text={text} path={path} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            {t('preview.htmlSandboxNotice')}
          </div>
          <iframe
            title={path}
            srcDoc={text}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            className="html-preview-frame min-h-0 flex-1 rounded border border-border"
          />
        </div>
      )}
    </div>
  );
}