import type { ResolvedLocale } from '../i18n';
import { api } from '../api/http';

/**
 * 把前端实际生效语言同步到后端 config.server.locale（后端据此切换工具文本/描述语言）。
 * 幂等：后端 locale 已一致时不写入。后端不可达时静默失败（不影响前端语言切换）。
 */
export async function syncBackendLocale(locale: ResolvedLocale): Promise<void> {
  try {
    const cfg = await api.getAppConfig();
    if (cfg.server.locale !== locale) {
      await api.updateAppConfig({ server: { ...cfg.server, locale } });
    }
  } catch {
    // 后端不可达：静默，前端语言切换不受影响
  }
}
