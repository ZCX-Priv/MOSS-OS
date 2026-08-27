// webui/src/hooks/useAgentTeams.ts
// 专家团数据 hook：团队列表 + 选中团队详情 + 消息流。
// WS agenteam.team.changed 实时推送触发刷新 + running 团队轮询兜底。

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type {
  AgentTeam,
  AgentTeamSummary,
  TeamMessage,
} from '../types/api';

const POLL_INTERVAL_MS = 4000;

export function useAgentTeams() {
  const [teams, setTeams] = useState<AgentTeamSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentTeam | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const lastMessageTs = useRef<number>(0);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const refreshList = useCallback(async () => {
    try {
      const res = await api.listAgentTeams();
      setTeams(res.teams ?? []);
      return res.teams ?? [];
    } catch {
      return [];
    }
  }, []);

  const refreshDetail = useCallback(async (teamId: string | null) => {
    if (!teamId) {
      setDetail(null);
      setMessages([]);
      return;
    }
    try {
      const team = await api.getAgentTeam(teamId);
      setDetail(team);
      const msgRes = await api.getAgentTeamMessages(teamId);
      setMessages(msgRes.messages ?? []);
      if (msgRes.messages?.length) {
        lastMessageTs.current = msgRes.messages[msgRes.messages.length - 1].ts;
      }
    } catch {
      setDetail(null);
    }
  }, []);

  const select = useCallback(
    (teamId: string | null) => {
      setSelectedId(teamId);
      lastMessageTs.current = 0;
      setMessages([]);
      void refreshDetail(teamId);
    },
    [refreshDetail],
  );

  // 初始加载 + WS 订阅
  useEffect(() => {
    void refreshList();

    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'agenteam.team.changed' && msg.payload) {
        const payload = msg.payload as { teamId?: string };
        void refreshList();
        if (payload.teamId && payload.teamId === selectedIdRef.current) {
          void refreshDetail(payload.teamId);
        }
      }
    });

    return () => {
      unsub();
    };
  }, [refreshList, refreshDetail]);

  // running/staged 团队轮询兜底（WS 丢失时仍可见进度）
  useEffect(() => {
    const timer = setInterval(() => {
      const active = teams.some((t) => t.phase === 'running' || t.phase === 'staged');
      if (active) void refreshList();
      const current = selectedIdRef.current;
      if (current) {
        const sel = teams.find((t) => t.id === current);
        if (sel && (sel.phase === 'running' || sel.phase === 'staged')) {
          void refreshDetail(current);
        }
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [teams, refreshList, refreshDetail]);

  return {
    teams,
    selectedId,
    detail,
    messages,
    loading,
    select,
    refreshList,
    refreshDetail,
  };
}
