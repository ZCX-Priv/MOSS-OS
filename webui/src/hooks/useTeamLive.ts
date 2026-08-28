// webui/src/hooks/useTeamLive.ts
// 对话流专家团卡片的实时数据 hook：按 teamId 拉取团队详情，
// 并订阅 WS agenteam.team.changed（teamId 匹配时重拉）。
// 拉取失败返回 null，由调用方回落到工具参数中的静态计划渲染。

import { useEffect, useState } from 'react';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { AgentTeam } from '../types/api';

export function useTeamLive(teamId: string | null): AgentTeam | null {
  const [team, setTeam] = useState<AgentTeam | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let alive = true;

    const load = () => {
      api
        .getAgentTeam(teamId)
        .then((t) => {
          if (alive) setTeam(t);
        })
        .catch(() => {
          // 拉取失败保持现状（可能是团队已删除）：清空让调用方回落静态计划
          if (alive) setTeam(null);
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
