// render/html/HtmlPreview.tsx
// 网页（.html/.htm/.xhtml）预览：沙箱 iframe 渲染 + 源码视图切换。
// 安全：iframe sandbox 不含 allow-same-origin（不透明源），页面脚本无法访问宿主
//   应用的 DOM / localStorage / Cookie；同时保留 allow-scripts 让页面自身脚本可运行。
// 限制：blob URL 无相对路径基准，页面引用的相对资源（css/js/图片）不会加载。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code2, ExternalLink, Eye } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { CodeFileViewer } from '../code/CodeFileViewer';

export interface HtmlPreviewProps {
  text: string;
  path: string;
}

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock';

export function HtmlPreview({ text, path }: HtmlPreviewProps) {
  const { t } = useTranslation();
  const [showSource, setShowSource] = useState(false);

  const blobUrl = useMemo(() => URL.createObjectURL(new Blob([text], { type: 'text/html' })), [text]);
  useEffect(() => () => URL.revokeObjectURL(blobUrl), [blobUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant={showSource ? 'outline' : 'default'}
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setShowSource(false)}
          >
            <Eye className="size-3.5" />
            {t('preview.htmlPreview')}
          </Button>
          <Button
            variant={showSource ? 'default' : 'outline'}
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setShowSource(true)}
          >
            <Code2 className="size-3.5" />
            {t('preview.htmlSource')}
          </Button>
        </div>
        <a
          href={blobUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <ExternalLink className="size-3.5" />
          {t('preview.openInNewTab')}
        </a>
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
            src={blobUrl}
            sandbox={SANDBOX}
            referrerPolicy="no-referrer"
            className="html-preview-frame min-h-0 flex-1 rounded border border-border"
          />
        </div>
      )}
    </div>
  );
}