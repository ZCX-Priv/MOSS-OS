// webui/src/hooks/useTeamLive.ts
// 对话流专家团卡片的实时数据 hook：按 teamId 拉取团队详情，
// 并订阅 WS agenteam.team.changed（teamId 匹配时重拉）。
// 拉取失败返回 null，由调用方回落到工具参数中的静态计划渲染。

import { useEffect, useState } from 'react';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { Agenteam } from '../types/api';

/**
 * 团队详情会话级缓存（teamId → Agenteam）：
 * 再次进入同一会话时专家团卡首帧即最终状态（useState 初值命中缓存），
 * 不再先渲染工具参数里的静态计划 + spinner、拉到实时数据后才切换（消除「先简后全」）。
 */
const teamCache = new Map<string, Agenteam>();

export function useTeamLive(teamId: string | null): Agenteam | null {
  const [team, setTeam] = useState<Agenteam | null>(() =>
    teamId ? teamCache.get(teamId) ?? null : null,
  );

  useEffect(() => {
    if (!teamId) {
      setTeam(null);
      return;
    }
    let alive = true;

    // 命中缓存：立即同步回到缓存值（组件不重挂时也可能带旧值/静态计划，这里对齐）
    setTeam(teamCache.get(teamId) ?? null);

    const load = () => {
      api
        .getAgenteam(teamId)
        .then((t) => {
          if (alive) {
            teamCache.set(teamId, t);
            setTeam(t);
          }
        })
        .catch(() => {
          // 拉取失败保持现状（可能是团队已删除）：回落缓存值，无缓存才置空让调用方用静态计划
          if (alive) setTeam(teamCache.get(teamId) ?? null);
        });
    };
    load();

    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'agenteam.team.changed' && msg.payload) {
        const payload = msg.payload as { teamId?: string };
        if (payload.teamId === teamId) load();
      }
    });

    return () => {
      alive = false;
      unsub();
    };
  }, [teamId]);

  return team;
}
