// src/modules/update/index.ts
// 更新检查模组：定时检查 npm registry 版本，通过事件总线广播更新通知。
// 清单来自 module.json，由 ExtensionManager 注入 manifest。

import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const PACKAGE_NAME = 'moss';

class UpdateModule implements Module {
  manifest!: ModuleManifest; // 由管理器注入

  private ctx!: ModuleContext;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentVersion = '0.0.0';

  async initialize(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.currentVersion = this.readCurrentVersion();

    const cfg = ctx.config.getAppConfig().update;
    if (!cfg.autoCheck) {
      ctx.logger.info('Update module: autoCheck disabled');
      return;
    }

    ctx.logger.info('Update module initialized', {
      currentVersion: this.currentVersion,
      channel: cfg.channel,
      checkIntervalHours: cfg.checkIntervalHours,
    });

    // 启动时延迟检查（避免阻塞启动）
    setTimeout(() => {
      this.checkForUpdate().catch(err => {
        ctx.logger.debug('Update check failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 5000);

    // 定时检查
    const intervalMs = cfg.checkIntervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      this.checkForUpdate().catch(() => {});
    }, intervalMs);
  }

  async destroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private readCurrentVersion(): string {
    try {
      const pkgPath = join(this.ctx.env.packageRoot, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private async checkForUpdate(): Promise<void> {
    try {
      const resp = await fetch(`${NPM_REGISTRY_URL}/${PACKAGE_NAME}/latest`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        this.ctx.logger.debug('Update check: npm registry returned non-ok', { status: resp.status });
        return;
      }
      const data = (await resp.json()) as { version?: string };
      const latest = data.version;
      if (!latest) return;

      if (isNewerVersion(latest, this.currentVersion)) {
        this.ctx.logger.info(`Update available: ${this.currentVersion} -> ${latest}`);
        await this.ctx.eventBus.broadcast('update:available', {
          current: this.currentVersion,
          latest,
          package: PACKAGE_NAME,
        });

        // 通知前端（通过 Server 模组转发 WS）
        const server = this.ctx.services.tryResolve<{ broadcastWS: (msg: unknown) => void }>('server.instance');
        server?.broadcastWS({
          type: 'update:available',
          payload: { current: this.currentVersion, latest },
        });
      } else {
        this.ctx.logger.debug('Update check: up to date', { version: this.currentVersion });
      }
    } catch (err) {
      this.ctx.logger.debug('Update check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * 简单的语义化版本比较：latest > current 返回 true。
 * 仅支持 X.Y.Z 格式。
 */
function isNewerVersion(latest: string, current: string): boolean {
  const parseVersion = (v: string): [number, number, number] => {
    const parts = v.split('.').map(n => parseInt(n, 10));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [la, lb, lc] = parseVersion(latest);
  const [ca, cb, cc] = parseVersion(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

export default (manifest: ModuleManifest): Module => {
  const m = new UpdateModule();
  m.manifest = manifest;
  return m;
};
