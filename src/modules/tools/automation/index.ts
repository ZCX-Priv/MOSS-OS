// tools/automation/index.ts
// automation 工具 execute 逻辑：自动化定时任务的模型级管理
// （create/update/delete/list/get/trigger/pause/resume/history），
// 通过 ToolContext.services 解析 automation.service（AutomationService）操作持久化任务。
// 静态导出形式（无需 env）。元数据见同目录 tool.json。

import { t } from '../../../core/i18n';
import type { ToolContext, ToolResult } from '../types';
import { errorResult } from '../types';
import type { AutomationService } from '../../automation';

/** update 可修改的字段白名单（不含 id/action） */
const UPDATABLE_FIELDS = [
  'title',
  'description',
  'icon',
  'scheduleType',
  'cron',
  'runAt',
  'prompt',
  'cwd',
  'agentId',
  'enabled',
  'paused',
] as const;

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const svc = ctx.services.tryResolve<AutomationService>('automation.service');
    if (!svc) {
      return errorResult(t('tools.automationServiceUnavailable'));
    }

    const p = params as {
      action: 'create' | 'update' | 'delete' | 'list' | 'get' | 'trigger' | 'pause' | 'resume' | 'history';
      id?: string;
      title?: string;
      description?: string;
      icon?: string;
      scheduleType?: 'cron' | 'once';
      cron?: string;
      runAt?: string;
      prompt?: string;
      cwd?: string;
      agentId?: string;
      enabled?: boolean;
      paused?: boolean;
    };

    switch (p.action) {
      case 'create': {
        if (!p.title || typeof p.title !== 'string' || p.title.trim() === '') {
          return errorResult(t('tools.automationTitleRequired'));
        }
        if (!p.prompt || typeof p.prompt !== 'string' || p.prompt.trim() === '') {
          return errorResult(t('tools.automationPromptRequired'));
        }
        if (!p.cwd || typeof p.cwd !== 'string' || p.cwd.trim() === '') {
          return errorResult(t('tools.automationCwdRequired'));
        }
        try {
          const item = svc.create({
            title: p.title,
            prompt: p.prompt,
            cwd: p.cwd,
            description: p.description,
            icon: p.icon,
            agentId: p.agentId,
            scheduleType: p.scheduleType,
            cron: p.cron,
            runAt: p.runAt,
          });
          return {
            content: [{ type: 'text', text: `${t('tools.automationCreated')}:\n${JSON.stringify(item, null, 2)}` }],
            metadata: { action: 'create', id: item.id },
          };
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      }

      case 'update': {
        if (!p.id) {
          return errorResult(t('tools.automationIdRequired'));
        }
        // 仅透传显式提供的可修改字段
        const patch: Record<string, unknown> = {};
        for (const key of UPDATABLE_FIELDS) {
          if (p[key] !== undefined) {
            patch[key] = p[key];
          }
        }
        if (Object.keys(patch).length === 0) {
          return errorResult(t('tools.automationIdRequired'));
        }
        try {
          const item = svc.update(p.id, patch);
          if (!item) {
            return errorResult(t('tools.automationNotFound', { id: p.id }));
          }
          return {
            content: [{ type: 'text', text: `${t('tools.automationUpdated')}:\n${JSON.stringify(item, null, 2)}` }],
            metadata: { action: 'update', id: item.id },
          };
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      }

      case 'delete': {
        if (!p.id) {
          return errorResult(t('tools.automationIdRequired'));
        }
        const deleted = svc.remove(p.id);
        if (!deleted) {
          return errorResult(t('tools.automationNotFound', { id: p.id }));
        }
        return {
          content: [{ type: 'text', text: t('tools.automationDeleted', { id: p.id }) }],
          metadata: { action: 'delete', id: p.id },
        };
      }

      case 'list': {
        const items = svc.list();
        const text = items.length === 0
          ? t('tools.automationEmpty')
          : `${t('tools.automationListHeader', { count: items.length })}:\n${JSON.stringify(items, null, 2)}`;
        return {
          content: [{ type: 'text', text }],
          metadata: { action: 'list', count: items.length },
        };
      }

      case 'get': {
        if (!p.id) {
          return errorResult(t('tools.automationIdRequired'));
        }
        const item = svc.get(p.id);
        if (!item) {
          return errorResult(t('tools.automationNotFound', { id: p.id }));
        }
        const history = svc.getHistory(p.id);
        return {
          content: [{ type: 'text', text: `${t('tools.automationGetHeader')}:\n${JSON.stringify({ ...item, history }, null, 2)}` }],
          metadata: { action: 'get', id: p.id, historyCount: history.length },
        };
      }

      case 'trigger': {
        if (!p.id) {
          return errorResult(t('tools.automationIdRequired'));
        }
        try {
          const { runId } = svc.trigger(p.id);
          return {
            content: [{ type: 'text', text: t('tools.automationTriggered', { runId }) }],
            metadata: { action: 'trigger', id: p.id, runId },
          };
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      }

      case 'pause': {
        if (!p.id) {
          return errorResult(t('tools.automationIdRequired'));
        }
        const ok = svc.pause(p.id);
        if (!ok) {
          return errorResult(t('tools.automationNotFound', { id: p.id }));
        }
        return {
          content: [{ type: 'text', text: t('tools.automationPaused', { id: p.id }) }],
          metadata: { action: 'pause', id: p.id },
        };
      }

      case 'resume': {
        if (!p.id) {
          return errorResult(t('tools.automationIdRequired'));
        }
        const ok = svc.resume(p.id);
        if (!ok) {
          return errorResult(t('tools.automationNotFound', { id: p.id }));
        }
        return {
          content: [{ type: 'text', text: t('tools.automationResumed', { id: p.id }) }],
          metadata: { action: 'resume', id: p.id },
        };
      }

      case 'history': {
        if (!p.id) {
          return errorResult(t('tools.automationIdRequired'));
        }
        const item = svc.get(p.id);
        if (!item) {
          return errorResult(t('tools.automationNotFound', { id: p.id }));
        }
        const history = svc.getHistory(p.id);
        return {
          content: [{ type: 'text', text: `${t('tools.automationHistoryHeader', { count: history.length })}:\n${JSON.stringify(history, null, 2)}` }],
          metadata: { action: 'history', id: p.id, count: history.length },
        };
      }

      default:
        return errorResult(t('tools.automationUnknownAction', { action: String(p.action) }));
    }
  },
};
