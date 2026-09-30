// src/modules/agenteam/tools.ts
// 单一 agent 工具：mode 区分 subagent（一次性子代理）与 agenteam（专家团编排），
// action 区分 agenteam 的具体操作。注册到 ToolRegistry（agenteam 模块 initialize 时），
// 随系统提示词暴露给主会话模型。
// 语义参考多智能体编排范式适配 MOSS（captain = ctx.sessionId）。

import { ServiceNames } from '../../core/types';
import type { ServiceRegistry, Logger } from '../../core/types';
import type { Tool, ToolResult, ToolContext } from '../tools/types';
import { textResult, errorResult } from '../tools/types';
import type { ToolRegistry } from '../contracts';
import type { AgentRegistry } from './index';
import type { TeamOrchestrator } from './orchestrator';
import type { MemberSpec, TaskSpec, TeamTask, TaskKind } from './types';
import { TASK_KINDS } from './types';

/** agenteam 模式的操作枚举（与此前团队编排工具能力一一对应，不新增能力） */
const AGENTEAM_ACTIONS = [
  'create',
  'edit_plan',
  'approve',
  'add_member',
  'remove_member',
  'create_task',
  'update_task',
  'reassign_task',
  'claim_task',
  'send_message',
  'status',
  'resume',
  'delete',
] as const;

type AgenteamAction = (typeof AGENTEAM_ACTIONS)[number];

/** 工具使用协议（中文注入 description，英文注入 descriptionEn；指导 captain 编排行为） */
const USAGE_PROTOCOL_ZH = `通过单一 "agent" 工具完成多智能体编排，由 mode 选择模式。

mode="subagent"：运行一次性子代理（template + task）。发出即忘；子代理在自己的会话中运行并返回最终报告。适用于无需持久团队的单项委派任务。
mode="agenteam"：你（当前会话）成为持久多智能体团队的队长。流程：action="create"（规划成员 + 任务 DAG；approval=true 时等待用户在专家团面板审核）→ 用户批准（action="approve"）→ 队长收到通知，调度器自动把任务派发给成员（每个成员以自己的 agentId 配置作为独立 agent 会话运行）→ 每个任务完成/失败后队长收到成员报告轮次并决定下一步（action="create_task" / "reassign_task" / "send_message"，或仅确认）→ 所有任务到达终态后队长产出面向用户的最终总结，并保存为团队总结。质量门禁：review/requirements 任务仅在 verdict=pass 时完成；失败自动生成修复后续任务；普通任务自动重试至多 2 次。成员也可以给你发消息（to=captain）——请回复决策。

agenteam 可用 action：create | edit_plan | approve | add_member | remove_member | create_task | update_task | reassign_task | claim_task | send_message | status | resume | delete。
仅在用户明确确认后才调用 action="approve" 与 action="delete"。`;

/** 英文版使用协议（en locale 下随 descriptionEn 暴露） */
const USAGE_PROTOCOL_EN = `Multi-agent orchestration via a single "agent" tool, selected by mode.

mode="subagent": run a one-off subagent (template + task). Fire-and-forget; the subagent runs in its own session and returns its final report. Use for single delegated tasks that don't need a persistent team.
mode="agenteam": you (the current session) become the captain of a persistent multi-agent team. Workflow: action="create" (plan members + task DAG; approval=true waits for user review in the Agenteam panel) → user approves (action="approve") → the captain gets notified and the scheduler auto-dispatches tasks to members (each member runs as its own agent session with its agentId config) → after each task completes/fails the captain receives a member report turn and decides the next step (action="create_task" / "reassign_task" / "send_message", or simply acknowledge) → when all tasks reach terminal states the captain produces a final user-facing summary that is saved as the team summary. Quality gates: review/requirements tasks complete only with verdict=pass; failures auto-generate repair follow-ups; plain tasks auto-retry up to 2 attempts. Members can also message you (to=captain) — respond with decisions.

agenteam actions: create | edit_plan | approve | add_member | remove_member | create_task | update_task | reassign_task | claim_task | send_message | status | resume | delete.
Call action="approve" and action="delete" only after explicit user confirmation.`;

// ============================================================================
// 参数结构（扁平：mode + action 分派）
// ============================================================================

interface AgentToolParams {
  mode?: 'subagent' | 'agenteam';
  action?: string;
  /** subagent：模板 agent id（如 agent_explorer） */
  template?: string;
  /** subagent：完整自包含的任务描述（子代理只看得到它） */
  task?: string;
  cwd?: string;

  // --- agenteam create ---
  name?: string;
  description?: string;
  members?: Array<{ name?: string; role?: string; agentId?: string; inlinePrompt?: string; executionPrompt?: string }>;
  tasks?: Array<{ subject?: string; description?: string; kind?: string; dependencies?: string[]; assignee?: string }>;
  approval?: boolean;

  // --- agenteam 通用定位 ---
  teamId?: string;

  // --- edit_plan ---
  addMembers?: Array<{ name?: string; role?: string; agentId?: string; inlinePrompt?: string; executionPrompt?: string }>;
  removeMembers?: string[];
  addTasks?: Array<{ subject?: string; description?: string; kind?: string; dependencies?: string[]; assignee?: string }>;
  removeTasks?: string[];
  newDescription?: string;

  // --- add_member ---
  member?: { name?: string; role?: string; agentId?: string; inlinePrompt?: string; executionPrompt?: string };
  // --- remove_member ---
  memberName?: string;

  // --- create_task ---
  newTask?: { subject?: string; description?: string; kind?: string; dependencies?: string[]; assignee?: string };

  // --- update_task ---
  taskId?: string;
  attemptId?: string;
  patch?: {
    status?: string;
    output?: string;
    verdict?: string;
    findings?: Array<{ id?: string; severity?: string; file?: string; line?: number; problem?: string; requiredFix?: string }>;
    acceptanceResults?: Array<{ criterion?: string; status?: string; evidence?: string }>;
    commandsRun?: Array<{ command?: string; status?: string; exitCode?: number; evidence?: string }>;
  };

  // --- reassign_task ---
  assignee?: string;

  // --- send_message ---
  to?: string;
  content?: string;
}

// ============================================================================
// 工具实现辅助
// ============================================================================

function resolveRegistry(services: ServiceRegistry): AgentRegistry | null {
  return services.tryResolve<AgentRegistry>('agenteam.registry');
}

/** 校验成员规格（agentId 存在性 + inlinePrompt 兜底） */
function normalizeMembers(
  raw: AgentToolParams['members'],
  registry: AgentRegistry | null,
): MemberSpec[] {
  if (!raw || raw.length === 0) throw new Error('members：至少需要一个成员');
  return raw.map((m, i) => {
    const name = (m.name ?? '').trim();
    if (!name) throw new Error(`members[${i}].name 为必填项`);
    if (!m.agentId && !m.inlinePrompt) {
      throw new Error(`成员 "${name}"：agentId 或 inlinePrompt 为必填项`);
    }
    if (m.agentId && registry && !registry.get(m.agentId)) {
      throw new Error(`成员 "${name}"：注册表中未找到 agentId "${m.agentId}"`);
    }
    return {
      name,
      role: m.role,
      agentId: m.agentId,
      inlinePrompt: m.inlinePrompt,
      executionPrompt: m.executionPrompt,
    };
  });
}

function normalizeTasks(raw: AgentToolParams['tasks']): TaskSpec[] {
  if (!raw || raw.length === 0) throw new Error('tasks：至少需要一个任务');
  return raw.map((t, i) => {
    const subject = (t.subject ?? '').trim();
    if (!subject) throw new Error(`tasks[${i}].subject 为必填项`);
    const kind = t.kind && (TASK_KINDS as readonly string[]).includes(t.kind) ? (t.kind as TaskKind) : undefined;
    return {
      subject,
      description: t.description,
      kind,
      dependencies: t.dependencies ?? [],
      assignee: t.assignee,
    };
  });
}

function normalizeKind(kind: string | undefined): TaskKind | undefined {
  return kind && (TASK_KINDS as readonly string[]).includes(kind) ? (kind as TaskKind) : undefined;
}

/** updateTask patch 规范化（枚举字符串 → 具体类型；无效值丢弃） */
function normalizeTaskPatch(patch: AgentToolParams['patch']): Partial<
  Pick<TeamTask, 'status' | 'output' | 'verdict' | 'findings' | 'acceptanceResults' | 'commandsRun'>
> {
  if (!patch) return {};
  const out: Partial<Pick<TeamTask, 'status' | 'output' | 'verdict' | 'findings' | 'acceptanceResults' | 'commandsRun'>> = {};
  const STATUSES = ['pending', 'claimed', 'in_progress', 'completed', 'failed', 'cancelled'];
  const VERDICTS = ['pass', 'needs_revision', 'reject'];
  const SEVERITIES = ['low', 'medium', 'high', 'blocker'];
  if (patch.status && STATUSES.includes(patch.status)) {
    out.status = patch.status as TeamTask['status'];
  }
  if (typeof patch.output === 'string') out.output = patch.output;
  if (patch.verdict && VERDICTS.includes(patch.verdict)) {
    out.verdict = patch.verdict as TeamTask['verdict'];
  }
  if (Array.isArray(patch.findings)) {
    out.findings = patch.findings
      .filter((f) => f?.id && f.problem && f.requiredFix && f.severity && SEVERITIES.includes(f.severity))
      .map((f) => ({
        id: f.id as string,
        severity: f.severity as 'low' | 'medium' | 'high' | 'blocker',
        file: f.file,
        line: f.line,
        problem: f.problem as string,
        requiredFix: f.requiredFix as string,
      }));
  }
  if (Array.isArray(patch.acceptanceResults)) {
    out.acceptanceResults = patch.acceptanceResults
      .filter((r) => r?.criterion && (r.status === 'passed' || r.status === 'failed'))
      .map((r) => ({ criterion: r.criterion as string, status: r.status as 'passed' | 'failed', evidence: r.evidence }));
  }
  if (Array.isArray(patch.commandsRun)) {
    out.commandsRun = patch.commandsRun
      .filter((c) => c?.command && (c.status === 'passed' || c.status === 'failed'))
      .map((c) => ({ command: c.command as string, status: c.status as 'passed' | 'failed', exitCode: c.exitCode, evidence: c.evidence }));
  }
  return out;
}

function formatTeamStatus(team: {
  id: string; name: string; phase: string; tasks: TeamTask[]; members: Array<{ name: string; status: string; role?: string }>; summary?: string;
}): string {
  const lines: string[] = [];
  lines.push(`团队 ${team.id}「${team.name}」phase=${team.phase}`);
  const members = team.members
    .map((m) => `  - ${m.name}${m.role ? ` (${m.role})` : ''}: ${m.status}`)
    .join('\n');
  lines.push(`成员：\n${members}`);
  const tasks = team.tasks
    .map(
      (t) =>
        `  - [${t.id}] ${t.subject} status=${t.status}${t.assignee ? ` assignee=${t.assignee}` : ''}${t.dependencies.length > 0 ? ` deps=[${t.dependencies.join(',')}]` : ''}${t.kind && t.kind !== 'work' ? ` kind=${t.kind}` : ''}`,
    )
    .join('\n');
  lines.push(`任务：\n${tasks}`);
  if (team.summary) lines.push(`总结：\n${team.summary}`);
  return lines.join('\n');
}

// ============================================================================
// 分支实现
// ============================================================================

/** mode=subagent：一次性子代理（模板 agentId + 专属 session，同步返回结果） */
async function runSubagentMode(
  orch: TeamOrchestrator,
  p: AgentToolParams,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const template = (p.template ?? '').trim();
    const task = (p.task ?? '').trim();
    if (!template || !task) return errorResult('subagent 模式：template 与 task 为必填项');
    const registry = resolveRegistry(ctx.services);
    if (registry && !registry.get(template)) {
      return errorResult(`注册表中未找到模板 "${template}"`);
    }
    const output = await orch.runSubagent({
      template,
      task,
      cwd: p.cwd || ctx.cwd,
    });
    return textResult(
      `子代理已完成 (finishReason=${output.finishReason}, session=${output.sessionId}):\n\n${output.result}`,
      output.finishReason === 'error',
    );
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

/** mode=agenteam：按 action 分派（与此前团队编排工具逐条对应） */
async function runAgenteamMode(
  orch: TeamOrchestrator,
  p: AgentToolParams,
  ctx: ToolContext,
): Promise<ToolResult> {
  const action = p.action as AgenteamAction | undefined;
  if (!action || !(AGENTEAM_ACTIONS as readonly string[]).includes(action)) {
    return errorResult(`agenteam 模式：action 必须为以下之一：${AGENTEAM_ACTIONS.join(', ')}`);
  }
  try {
    switch (action) {
      case 'create': {
        if (!p.name?.trim()) return errorResult('create：name 为必填项');
        const registry = resolveRegistry(ctx.services);
        const team = orch.createTeam({
          name: p.name,
          description: p.description,
          cwd: p.cwd || ctx.cwd,
          captainSessionId: ctx.sessionId,
          members: normalizeMembers(p.members, registry),
          tasks: normalizeTasks(p.tasks),
          approval: p.approval !== false,
        });
        return textResult(
          `团队已创建：id=${team.id} phase=${team.phase}。${
            team.phase === 'staged'
              ? '计划正在专家团面板等待用户批准，请提示用户前往审核并批准。'
              : '团队已开始运行，调度器会自动派发任务。'
          }`,
        );
      }

      case 'edit_plan': {
        const team = orch.get(p.teamId ?? '');
        if (!team) return errorResult('未找到该团队');
        if (team.phase !== 'staged') return errorResult(`团队当前阶段为 ${team.phase}，非 staged`);
        const registry = resolveRegistry(ctx.services);
        if (p.newDescription) team.description = p.newDescription;
        for (const name of p.removeMembers ?? []) {
          team.members = team.members.filter((m) => m.name !== name);
        }
        if (p.addMembers?.length) {
          for (const m of normalizeMembers(p.addMembers, registry)) {
            if (team.members.some((x) => x.name === m.name)) throw new Error(`成员 "${m.name}" 已存在`);
            team.members.push({
              id: `m${team.members.length + 1}`,
              name: m.name,
              role: m.role,
              agentId: m.agentId,
              inlinePrompt: m.inlinePrompt,
              sessionId: '',
              executionPrompt: m.executionPrompt,
              joinedAt: Date.now(),
              status: 'idle',
            });
          }
        }
        for (const id of p.removeTasks ?? []) {
          team.tasks = team.tasks.filter((t) => t.id !== id);
        }
        for (const t of p.addTasks ?? []) {
          if (!t.subject?.trim()) continue;
          team.taskSeq += 1;
          const now = Date.now();
          team.tasks.push({
            id: `t${team.taskSeq}`,
            subject: t.subject,
            description: t.description,
            status: 'pending',
            assignee: t.assignee,
            dependencies: t.dependencies ?? [],
            kind: normalizeKind(t.kind),
            createdAt: now,
            updatedAt: now,
          });
        }
        orch.saveTeam(team);
        return textResult(`计划已更新。成员：${team.members.map((m) => m.name).join(', ')}；任务：${team.tasks.map((t) => t.id).join(', ')}`);
      }

      case 'approve': {
        if (!p.teamId) return errorResult('approve：teamId 为必填项');
        const team = orch.approvePlan(p.teamId);
        return textResult(`团队已批准并开始运行。phase=${team.phase}`);
      }

      case 'add_member': {
        if (!p.teamId) return errorResult('add_member：teamId 为必填项');
        const registry = resolveRegistry(ctx.services);
        const m = p.member;
        if (!m?.name) return errorResult('add_member：member.name 为必填项');
        if (!m.agentId && !m.inlinePrompt) return errorResult('add_member：member.agentId 或 member.inlinePrompt 为必填项');
        if (m.agentId && registry && !registry.get(m.agentId)) {
          return errorResult(`注册表中未找到 agentId "${m.agentId}"`);
        }
        const team = orch.addMember(p.teamId, {
          name: m.name,
          role: m.role,
          agentId: m.agentId,
          inlinePrompt: m.inlinePrompt,
        });
        return textResult(`已添加成员 "${m.name}"。当前成员：${team.members.map((x) => x.name).join(', ')}`);
      }

      case 'remove_member': {
        if (!p.teamId || !p.memberName) return errorResult('remove_member：teamId 与 memberName 为必填项');
        const team = orch.removeMember(p.teamId, p.memberName);
        return textResult(`已移除成员 "${p.memberName}"。当前成员：${team.members.filter((m) => m.status !== 'removed').map((x) => x.name).join(', ')}`);
      }

      case 'create_task': {
        if (!p.teamId) return errorResult('create_task：teamId 为必填项');
        const t = p.newTask;
        if (!t?.subject) return errorResult('create_task：newTask.subject 为必填项');
        const team = orch.createTask(p.teamId, {
          subject: t.subject,
          description: t.description,
          kind: normalizeKind(t.kind),
          dependencies: t.dependencies,
          assignee: t.assignee,
        });
        const created = team.tasks[team.tasks.length - 1];
        return textResult(`已创建任务：[${created.id}] ${created.subject}`);
      }

      case 'update_task': {
        if (!p.teamId || !p.taskId) return errorResult('update_task：teamId 与 taskId 为必填项');
        const patch = normalizeTaskPatch(p.patch);
        const team = orch.updateTask(p.teamId, p.taskId, patch, p.attemptId);
        return textResult(`任务已更新。团队 phase=${team.phase}`);
      }

      case 'reassign_task': {
        if (!p.teamId || !p.taskId) return errorResult('reassign_task：teamId 与 taskId 为必填项');
        orch.reassignTask(p.teamId, p.taskId, p.assignee);
        return textResult(`任务 ${p.taskId} 已${p.assignee ? `重新指派给 ${p.assignee}` : '取消指派'}。`);
      }

      case 'claim_task': {
        if (!p.teamId || !p.taskId) return errorResult('claim_task：teamId 与 taskId 为必填项');
        // 手动认领：成员视角从 captain 会话不可得，等价于置 in_progress 由调度器接管
        const team = orch.get(p.teamId);
        if (!team) return errorResult('未找到该团队');
        const task = team.tasks.find((t) => t.id === p.taskId);
        if (!task) return errorResult(`未找到任务 "${p.taskId}"`);
        if (task.status !== 'pending') return errorResult(`任务状态为 ${task.status}，非 pending`);
        const updated = orch.updateTask(p.teamId, p.taskId, { status: 'in_progress' });
        return textResult(`任务已认领。phase=${updated.phase}`);
      }

      case 'send_message': {
        if (!p.teamId || !p.to || !p.content) return errorResult('send_message：teamId、to 与 content 为必填项');
        orch.sendMessage(p.teamId, 'captain', p.to, p.content);
        return textResult(`消息已发送给 ${p.to}。`);
      }

      case 'status': {
        if (!p.teamId) {
          const summaries = orch.summaries();
          if (summaries.length === 0) return textResult('暂无团队。');
          return textResult(summaries.map((s) => `团队 ${s.id}「${s.name}」phase=${s.phase} 任务=${s.taskCompleted}/${s.taskTotal}`).join('\n'));
        }
        const team = orch.get(p.teamId);
        if (!team) return errorResult(`未找到团队 "${p.teamId}"`);
        return textResult(formatTeamStatus(team));
      }

      case 'resume': {
        if (!p.teamId) return errorResult('resume：teamId 为必填项');
        const team = orch.resume(p.teamId);
        return textResult(`团队已恢复运行。phase=${team.phase}`);
      }

      case 'delete': {
        if (!p.teamId) return errorResult('delete：teamId 为必填项');
        const ok = orch.deleteTeam(p.teamId);
        return ok ? textResult('团队已删除。') : errorResult('未找到该团队');
      }
    }
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

// ============================================================================
// 工具定义
// ============================================================================

function createAgentTool(orch: TeamOrchestrator): Tool {
  return {
    name: 'agent',
    icon: 'bot',
    description: `统一 agent 工具。mode="subagent" 运行一次性子代理（template + task）；mode="agenteam" 编排持久多智能体团队（action 选择具体操作）。${USAGE_PROTOCOL_ZH}`,
    descriptionEn: `Unified agent tool. mode="subagent" runs a one-off subagent (template + task). mode="agenteam" orchestrates a persistent multi-agent team (action selects the operation). ${USAGE_PROTOCOL_EN}`,
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['subagent', 'agenteam'], description: '执行模式："subagent"（一次性委派运行）或 "agenteam"（持久多智能体团队编排）', description_en: 'Execution mode: "subagent" (one-off delegated run) or "agenteam" (persistent team orchestration)' },
        action: { type: 'string', enum: [...AGENTEAM_ACTIONS], description: `agenteam 操作（mode="agenteam" 时必填）：${AGENTEAM_ACTIONS.join(' | ')}`, description_en: `agenteam operation (required when mode="agenteam"): ${AGENTEAM_ACTIONS.join(' | ')}` },

        // subagent
        template: { type: 'string', description: 'subagent 模式：注册表 agent id，如 agent_explorer / agent_planner / agent_coder / agent_reviewer', description_en: 'subagent mode: registry agent id, e.g. agent_explorer / agent_planner / agent_coder / agent_reviewer' },
        task: { type: 'string', description: 'subagent 模式：完整自包含的任务描述（子代理只能看到这段内容）', description_en: 'subagent mode: complete self-contained task description (the subagent sees only this)' },

        // agenteam create
        name: { type: 'string', description: 'create：团队名称', description_en: 'create: team name' },
        description: { type: 'string', description: 'create：团队目标/用途', description_en: 'create: team goal/purpose' },
        members: {
          type: 'array',
          description: 'create：团队成员',
          description_en: 'create: team members',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '团队内唯一的成员名', description_en: 'Unique member name in team' },
              role: { type: 'string', description: '角色，如 researcher/engineer/reviewer', description_en: 'Role, e.g. researcher/engineer/reviewer' },
              agentId: { type: 'string', description: '注册表 agent id（优先使用）', description_en: 'Registry agent id (preferred)' },
              inlinePrompt: { type: 'string', description: '动态成员的内联 system prompt（无注册表条目时使用）', description_en: 'Inline system prompt for dynamic member (no registry entry)' },
              executionPrompt: { type: 'string', description: '附加到该成员任务票据上的额外提示词', description_en: 'Extra prompt appended to this member task tickets' },
            },
            required: ['name'],
          },
        },
        tasks: {
          type: 'array',
          description: 'create：任务 DAG；每个任务可声明 dependencies（任务 id 即数组顺序 1..N，如 t1、t2……）',
          description_en: 'create: task DAG; each task may list dependencies (ids are the array order 1..N, i.e. t1, t2, ...)',
          items: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: '任务标题', description_en: 'Task title' },
              description: { type: 'string', description: '需要完成的内容', description_en: 'What needs to be done' },
              kind: { type: 'string', description: '质量门禁类型：requirements/implementation/verification/review/repair/integration/work', description_en: 'Quality-gate kind: requirements/implementation/verification/review/repair/integration/work', enum: [...TASK_KINDS] },
              dependencies: { type: 'array', items: { type: 'string' }, description: '必须先完成的任务 id（t1、t2……）', description_en: 'Task ids that must complete first (t1, t2...)' },
              assignee: { type: 'string', description: '成员名；省略表示任意成员可认领', description_en: 'Member name; omit for any-member claim' },
            },
            required: ['subject'],
          },
        },
        approval: { type: 'boolean', description: 'create：true（默认）= 计划暂存并等待用户在专家团面板批准；false = 立即开始', description_en: 'create: true (default) = staged plan awaiting user approval in the Agenteam panel; false = start immediately' },

        // agenteam 通用
        teamId: { type: 'string', description: 'agenteam：目标团队 id（多数 action 需要）', description_en: 'agenteam: target team id (most actions)' },
        cwd: { type: 'string', description: '工作目录（默认当前会话 cwd）', description_en: 'Working directory (defaults to current session cwd)' },

        // edit_plan
        addMembers: { type: 'array', description: 'edit_plan：要添加的成员', description_en: 'edit_plan: members to add', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, agentId: { type: 'string' }, inlinePrompt: { type: 'string' } }, required: ['name'] } },
        removeMembers: { type: 'array', items: { type: 'string' }, description: 'edit_plan：要移除的成员名', description_en: 'edit_plan: member names to remove' },
        addTasks: { type: 'array', description: 'edit_plan：要添加的任务', description_en: 'edit_plan: tasks to add', items: { type: 'object', properties: { subject: { type: 'string' }, description: { type: 'string' }, kind: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' } }, assignee: { type: 'string' } }, required: ['subject'] } },
        removeTasks: { type: 'array', items: { type: 'string' }, description: 'edit_plan：要移除的任务 id', description_en: 'edit_plan: task ids to remove' },
        newDescription: { type: 'string', description: 'edit_plan：替换团队描述', description_en: 'edit_plan: replace team description' },

        // add_member / remove_member
        member: { type: 'object', description: 'add_member：成员规格', description_en: 'add_member: member spec', properties: { name: { type: 'string' }, role: { type: 'string' }, agentId: { type: 'string' }, inlinePrompt: { type: 'string' } }, required: ['name'] },
        memberName: { type: 'string', description: 'remove_member：成员名', description_en: 'remove_member: member name' },

        // create_task
        newTask: { type: 'object', description: 'create_task：任务规格（支持 dependencies，可构建/扩展任务 DAG）', description_en: 'create_task: task spec (supports dependencies, forming/extending the DAG)', properties: { subject: { type: 'string' }, description: { type: 'string' }, kind: { type: 'string', enum: [...TASK_KINDS] }, dependencies: { type: 'array', items: { type: 'string' } }, assignee: { type: 'string' } }, required: ['subject'] },

        // update_task
        taskId: { type: 'string', description: 'update_task/reassign_task/claim_task：任务 id（t1、t2……）', description_en: 'update_task/reassign_task/claim_task: task id (t1, t2...)' },
        attemptId: { type: 'string', description: 'update_task：派发票据中的 attempt id（用于拒绝过期报告）', description_en: 'update_task: the attempt id from the dispatch ticket (rejects stale reports)' },
        patch: {
          type: 'object',
          description: 'update_task：要修补的字段',
          description_en: 'update_task: fields to patch',
          properties: {
            status: { type: 'string', enum: ['pending', 'claimed', 'in_progress', 'completed', 'failed', 'cancelled'] },
            output: { type: 'string' },
            verdict: { type: 'string', enum: ['pass', 'needs_revision', 'reject'] },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'] },
                  file: { type: 'string' },
                  line: { type: 'number' },
                  problem: { type: 'string' },
                  requiredFix: { type: 'string' },
                },
                required: ['id', 'severity', 'problem', 'requiredFix'],
              },
            },
            acceptanceResults: {
              type: 'array',
              items: {
                type: 'object',
                properties: { criterion: { type: 'string' }, status: { type: 'string', enum: ['passed', 'failed'] }, evidence: { type: 'string' } },
                required: ['criterion', 'status'],
              },
            },
            commandsRun: {
              type: 'array',
              items: {
                type: 'object',
                properties: { command: { type: 'string' }, status: { type: 'string', enum: ['passed', 'failed'] }, exitCode: { type: 'number' }, evidence: { type: 'string' } },
                required: ['command', 'status'],
              },
            },
          },
        },

        // reassign_task
        assignee: { type: 'string', description: 'reassign_task：成员名（省略即取消指派）', description_en: 'reassign_task: member name (unassign when omitted)' },

        // send_message
        to: { type: 'string', description: 'send_message：收件人（成员名或 captain）', description_en: 'send_message: recipient (member name or captain)' },
        content: { type: 'string', description: 'send_message：消息正文', description_en: 'send_message: message body' },
      },
      required: ['mode'],
    },
    annotations: { readOnlyHint: false },
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const p = params as AgentToolParams;
      if (p.mode === 'subagent') return runSubagentMode(orch, p, ctx);
      if (p.mode === 'agenteam') return runAgenteamMode(orch, p, ctx);
      return errorResult('mode 必须为 "subagent" 或 "agenteam"');
    },
  };
}

// ============================================================================
// 注册入口
// ============================================================================

/**
 * 注册单一 agent 工具到 ToolRegistry。
 * 由 agenteam 模块 initialize 调用（此时 agent 引擎已就绪）。
 */
export function registerAgentTools(
  services: ServiceRegistry,
  orchestrator: TeamOrchestrator,
  logger: Logger,
): void {
  const registry = services.tryResolve<ToolRegistry>(ServiceNames.TOOL_REGISTRY);
  if (!registry) {
    logger.warn('agenteam: tool registry unavailable, agent tool not registered');
    return;
  }
  try {
    registry.register(createAgentTool(orchestrator));
  } catch (err) {
    logger.warn('agenteam: tool register failed', {
      tool: 'agent',
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  logger.info('agenteam: agent tool registered');
}