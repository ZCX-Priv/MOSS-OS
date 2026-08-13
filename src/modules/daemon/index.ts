// src/modules/daemon/index.ts
// 守护进程模组：运行时维护 PID 文件、监听信号优雅退出。
// 注意：实际的 detach/fork 在 CLI 命令中完成；此模组负责运行时的 PID 文件维护。
// 清单来自 module.json，由 ExtensionManager 注入 manifest。

import { t } from '../../core/i18n';
import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { writePidFile, removePidFile } from '../../utils/pid';
import type { ServerInstanceLike } from '../contracts';

class DaemonModule implements Module {
  manifest!: ModuleManifest; // 由管理器注入

  private ctx!: ModuleContext;
  private shutdownHandlersRegistered = false;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    const cfg = ctx.config.getAppConfig();
    if (!cfg.daemon.enabled) {
      ctx.logger.info(t('daemon.disabledByConfig'));
      return;
    }

    // 等待 server 启动后写入带端口的 PID 文件
    // server 模组在 daemon 之前初始化，这里直接 resolve
    const server = ctx.services.tryResolve<ServerInstanceLike>('server.instance');
    const port = server?.port ?? cfg.server.port;

    writePidFile(ctx.env.pidFile, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      port,
    });

    ctx.logger.info(t('daemon.initialized'), {
      pid: process.pid,
      port,
      pidFile: ctx.env.pidFile,
    });

    // 注册优雅退出处理（仅一次）
    if (!this.shutdownHandlersRegistered) {
      this.registerShutdownHandlers();
      this.shutdownHandlersRegistered = true;
    }
  }

  async destroy(): Promise<void> {
    removePidFile(this.ctx.env.pidFile);
    this.ctx.logger.info(t('daemon.stopped'));
  }

  private registerShutdownHandlers(): void {
    const handle = async (signal: string) => {
      this.ctx.logger.info(t('daemon.receivedSignal', { signal }));
      // 通知其他模组
      await this.ctx.eventBus.broadcast('kernel:shutdown', { signal });
      // 清理 PID 文件
      removePidFile(this.ctx.env.pidFile);
      // 给一点时间让其他清理完成
      setTimeout(() => process.exit(0), 500);
    };

    process.on('SIGINT', () => handle('SIGINT'));
    process.on('SIGTERM', () => handle('SIGTERM'));
    // Windows 没有 SIGTERM/SIGHUP，但有 SIGBREAK
    if (this.ctx.env.isWindows) {
      process.on('SIGBREAK', () => handle('SIGBREAK'));
    } else {
      process.on('SIGHUP', () => handle('SIGHUP'));
    }
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new DaemonModule();
  m.manifest = manifest;
  return m;
};
