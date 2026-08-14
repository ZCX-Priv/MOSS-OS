// src/modules/file-history/index.ts
// FileHistory 模组入口：实现三层文件历史架构（Track Edit + Snapshot + JSONL）。
// 注册 FileHistoryService 到 ServiceNames.FILE_HISTORY，供 write/edit/delete/read/undo 工具消费。
//
// 依赖 tools 模组（工具在 execute 内通过 ctx.services.tryResolve 获取本服务）。
// 本模组不依赖 server 模组（前端路由在 server/routes/file-history.ts 中独立实现）。

import { t } from '../../core/i18n';
import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { FileHistoryServiceImpl } from './service';
import { DEFAULT_FILE_HISTORY_CONFIG, type FileHistoryConfig } from './types';

class FileHistoryModule implements Module {
  manifest!: ModuleManifest;
  private ctx!: ModuleContext;
  private service!: FileHistoryServiceImpl;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;

    // 从 config 读取 fileHistory 配置（容错：缺失字段用默认值）
    const config = this.readConfig(ctx);

    this.service = new FileHistoryServiceImpl(ctx.env, ctx.logger, config);

    // 启动时清理过期备份
    try {
      this.service.cleanupExpiredBackups();
    } catch (err) {
      ctx.logger.warn(t('fileHistory.cleanupFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 注册服务
    ctx.services.register(ServiceNames.FILE_HISTORY, this.service, {
      scope: 'file-history',
      registrantType: 'module',
    });

    // 监听 config 变更，重建配置（简化：不重建 service 实例，只更新内部 config）
    // 当前实现：config 变更后需重启生效。未来可扩展为热更新。
    ctx.eventBus.onAction('config:changed', () => {
      ctx.logger.debug(t('fileHistory.configChangedReloadSkipped'));
    });

    ctx.logger.info(t('fileHistory.moduleInitialized'), {
      enabled: config.enabled,
      transcriptEnabled: config.transcriptEnabled,
    });
  }

  /** 从 config 读取 fileHistory 配置（容错：缺失字段用默认值兜底） */
  private readConfig(ctx: ModuleContext): FileHistoryConfig {
    const app = ctx.config.getAppConfig();
    const fh = app.fileHistory;
    if (!fh) {
      return { ...DEFAULT_FILE_HISTORY_CONFIG };
    }
    return {
      enabled: fh.enabled ?? DEFAULT_FILE_HISTORY_CONFIG.enabled,
      maxBackupsPerFile: fh.maxBackupsPerFile ?? DEFAULT_FILE_HISTORY_CONFIG.maxBackupsPerFile,
      transcriptEnabled: fh.transcriptEnabled ?? DEFAULT_FILE_HISTORY_CONFIG.transcriptEnabled,
      backupRetentionDays: fh.backupRetentionDays ?? DEFAULT_FILE_HISTORY_CONFIG.backupRetentionDays,
    };
  }

  async destroy(): Promise<void> {
    // 内存 ledger 自然随进程退出释放，无需特殊处理
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new FileHistoryModule();
  m.manifest = manifest;
  return m;
};
