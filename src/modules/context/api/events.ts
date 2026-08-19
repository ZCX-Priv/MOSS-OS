// src/modules/context/api/events.ts
// 上下文引擎 WS 事件类型常量（前后端共享语义；payload 结构见 types.ts）。

/** 每轮请求后推送：token 构成 + 窗口占用 + 缓存命中率 */
export const CONTEXT_STATS_EVENT = 'context-stats-updated';
/** 压缩开始（前端可显示进行中状态） */
export const COMPACTION_STARTED_EVENT = 'compaction-started';
/** 压缩完成（前端消息流插入压缩卡片） */
export const COMPACTION_COMPLETED_EVENT = 'compaction-completed';
/** 工具调用自愈通知（修复明细） */
export const CONTEXT_HEALED_EVENT = 'context-healed';
/** 降级告警（压缩失败/兜底裁剪触发） */
export const CONTEXT_DEGRADED_EVENT = 'context-degraded';
