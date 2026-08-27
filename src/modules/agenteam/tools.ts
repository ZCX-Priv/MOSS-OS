// src/modules/agenteam/tools.ts
// captain 工具集：agent_teams_*（团队编排）+ subagent_run（临时子代理）。
// 注册到 ToolRegistry（agenteam 模块 initialize 时），随系统提示词暴露给主会话模型。
// 语义参考 Max/dsh-agent-teams-main/src/tools.ts 适配 MOSS（captain = ctx.sessionId）。

import { ServiceNames } from '../../core/types';
import type { ServiceRegistry, Logger } from '../../core/types';
import type { Tool, ToolResult, ToolContext } from '../tools/types';
import { textResult, errorResult } from '../tools/types';
import type { ToolRegistry } from '../contracts';
import type { AgentRegistry } from './index';
import type { TeamOrchestrator } from './orchestrator';
import type { MemberSpec, TaskSpec, TeamTask, TaskKind } from './types';
import { TASK_KINDS } from './types';

/** 工具使用协议（注入描述，指导 captain 编排行为） */
const USAGE_PROTOCOL = `AgentTeams multi-agent orchestration. You (the current session) become the captain when you create a team. Workflow: agent_teams_create (plan members + task DAG; approval=true waits for user review in the "专家团" panel) → user approves → the captain gets notified and the scheduler auto-dispatches tasks to members (each member runs as its own agent session with its agentId config) → after each task completes/fails the captain receives a member report turn and decides the next step (adjust tasks / reassign / message members, or simply acknowledge) → when all tasks reach terminal states the captain produces a final user-facing summary that is saved as the team summary. Quality gates: review/requirements tasks complete only with verdict=pass; failures auto-generate repair follow-ups; plain tasks auto-retry up to 2 attempts. Members can also message you (to=captain) — respond with decisions. Use subagent_run for one-off delegated work without a persistent team (templates: agent_explorer / agent_planner / agent_coder / agent_reviewer).`;

// ============================================================================
// 参数结构
// ============================================================================

interface CreateTeamParams {
  name?: string;
  description?: string;
  members?: Array<{ name?: string; role?: string; agentId?: string; inlinePrompt?: string; executionPrompt?: string }>;
  tasks?: Array<{ subject?: string; description?: string; kind?: string; dependencies?: string[]; assignee?: string }>;
  approval?: boolean;
  cwd?: string;
  permissionMode?: 'ask' | 'auto' | 'skip';
}

interface MemberOnlyParams {
  teamId?: string;
  member?: { name?: string; role?: string; agentId?: string; inlinePrompt?: string; executionPrompt?: string };
}

interface MemberNameParams {
  teamId?: string;
  memberName?: string;
}

interface TaskParams {
  teamId?: string;
  task?: { subject?: string; description?: string; kind?: string; dependencies?: string[]; assignee?: string };
}

interface UpdateTaskParams {
  teamId?: string;
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
}

interface ReassignTaskParams {
  teamId?: string;
  taskId?: string;
  assignee?: string;
}

interface ClaimTaskParams {
  teamId?: string;
  taskId?: string;
}

interface SendMessageParams {
  teamId?: string;
  to?: string;
  content?: string;
}

interface TeamIdParams {
  teamId?: string;
}

interface SubagentRunParams {
  template?: string;
  task?: string;
  cwd?: string;
}

// ============================================================================
// 工具实现辅助
// ============================================================================

function resolveRegistry(services: ServiceRegistry): AgentRegistry | null {
  return services.tryResolve<AgentRegistry>('agenteam.registry');
}

/** 校验成员规格（agentId 存在性 + inlinePrompt 兜底） */
function normalizeMembers(
  raw: CreateTeamParams['members'],
  registry: AgentRegistry | null,
): MemberSpec[] {
  if (!raw || raw.length === 0) throw new Error('members: at least one member required');
  return raw.map((m, i) => {
    const name = (m.name ?? '').trim();
    if (!name) throw new Error(`members[${i}].name required`);
    if (!m.agentId && !m.inlinePrompt) {
      throw new Error(`member "${name}": agentId or inlinePrompt required`);
    }
    if (m.agentId && registry && !registry.get(m.agentId)) {
      throw new Error(`member "${name}": agentId "${m.agentId}" not found in registry`);
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

function normalizeTasks(raw: CreateTeamParams['tasks']): TaskSpec[] {
  if (!raw || raw.length === 0) throw new Error('tasks: at least one task required');
  return raw.map((t, i) => {
    const subject = (t.subject ?? '').trim();
    if (!subject) throw new Error(`tasks[${i}].subject required`);
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

/** updateTask patch 规范化（枚举字符串 → 具体类型；无效值丢弃） */
function normalizeTaskPatch(patch: UpdateTaskParams['patch']): Partial<
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
  lines.push(`team ${team.id} "${team.name}" phase=${team.phase}`);
  const members = team.members
    .map((m) => `  - ${m.name}${m.role ? ` (${m.role})` : ''}: ${m.status}`)
    .join('\n');
  lines.push(`members:\n${members}`);
  const tasks = team.tasks
    .map(
      (t) =>
        `  - [${t.id}] ${t.subject} status=${t.status}${t.assignee ? ` assignee=${t.assignee}` : ''}${t.dependencies.length > 0 ? ` deps=[${t.dependencies.join(',')}]` : ''}${t.kind && t.kind !== 'work' ? ` kind=${t.kind}` : ''}`,
    )
    .join('\n');
  lines.push(`tasks:\n${tasks}`);
  if (team.summary) lines.push(`summary:\n${team.summary}`);
  return lines.join('\n');
}

// ============================================================================
// 工具定义
// ============================================================================

function createTeamsTools(orch: TeamOrchestrator): Tool[] {
  const tools: Tool[] = [];

  // agent_teams_create -----------------------------------------------------
  tools.push({
    name: 'agent_teams_create',
    description: `Create a multi-agent team. You become the captain. Define members (each bound to a registry agentId like agent_explorer/agent_planner/agent_coder/agent_reviewer or a custom agent, or inlinePrompt for dynamic members) and a task DAG (tasks with dependencies). ${USAGE_PROTOCOL}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name' },
        description: { type: 'string', description: 'Team goal/purpose' },
        members: {
          type: 'array',
          description: 'Team members',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Unique member name in team' },
              role: { type: 'string', description: 'Role, e.g. researcher/engineer/reviewer' },
              agentId: { type: 'string', description: 'Registry agent id (preferred)' },
              inlinePrompt: { type: 'string', description: 'Inline system prompt for dynamic member (no registry entry)' },
              executionPrompt: { type: 'string', description: 'Extra prompt appended to this member task tickets' },
            },
            required: ['name'],
          },
        },
        tasks: {
          type: 'array',
          description: 'Task DAG; each task may list dependencies (ids are the array order 1..N, i.e. t1, t2, ...)',
          items: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Task title' },
              description: { type: 'string', description: 'What needs to be done' },
              kind: { type: 'string', description: 'Quality-gate kind: requirements/implementation/verification/review/repair/integration/work', enum: [...TASK_KINDS] },
              dependencies: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first (t1, t2...)' },
              assignee: { type: 'string', description: 'Member name; omit for any-member claim' },
            },
            required: ['subject'],
          },
        },
        approval: { type: 'boolean', description: 'true (default) = staged plan awaiting user approval in the Expert Team panel; false = start immediately' },
        cwd: { type: 'string', description: 'Working directory (defaults to current session cwd)' },
      },
      required: ['name', 'members', 'tasks'],
    },
    annotations: { readOnlyHint: false },
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      try {
        const p = params as CreateTeamParams;
        const registry = resolveRegistry(ctx.services);
        const team = orch.createTeam({
          name: p.name ?? '',
          description: p.description,
          cwd: p.cwd || ctx.cwd,
          permissionMode: p.permissionMode,
          captainSessionId: ctx.sessionId,
          members: normalizeMembers(p.members, registry),
          tasks: normalizeTasks(p.tasks),
          approval: p.approval !== false,
        });
        return textResult(
          `Team created: id=${team.id} phase=${team.phase}. ${
            team.phase === 'staged'
              ? 'Plan is awaiting user approval in the Expert Team (专家团) panel. Tell the user to review and approve it there.'
              : 'Team is running; scheduler will dispatch tasks automatically.'
          }`,
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_edit_plan ---------------------------------------------------
  tools.push({
    name: 'agent_teams_edit_plan',
    description: 'Atomically edit a staged team plan (members/tasks) before approval. Only valid while phase=staged.',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        addMembers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              agentId: { type: 'string' },
              inlinePrompt: { type: 'string' },
            },
            required: ['name'],
          },
        },
        removeMembers: { type: 'array', items: { type: 'string' } },
        addTasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              description: { type: 'string' },
              kind: { type: 'string' },
              dependencies: { type: 'array', items: { type: 'string' } },
              assignee: { type: 'string' },
            },
            required: ['subject'],
          },
        },
        removeTasks: { type: 'array', items: { type: 'string' } },
        newDescription: { type: 'string' },
      },
      required: ['teamId'],
    },
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      try {
        const p = params as CreateTeamParams & { teamId?: string; addMembers?: MemberSpec[]; removeMembers?: string[]; addTasks?: TaskSpec[]; removeTasks?: string[]; newDescription?: string };
        const team = orch.get(p.teamId ?? '');
        if (!team) return errorResult(`team not found`);
        if (team.phase !== 'staged') return errorResult(`team phase is ${team.phase}, not staged`);
        const registry = resolveRegistry(ctx.services);
        if (p.newDescription) team.description = p.newDescription;
        for (const name of p.removeMembers ?? []) {
          team.members = team.members.filter((m) => m.name !== name);
        }
        for (const m of normalizeMembers(p.addMembers, registry)) {
          if (team.members.some((x) => x.name === m.name)) throw new Error(`member "${m.name}" already exists`);
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
        for (const id of p.removeTasks ?? []) {
          team.tasks = team.tasks.filter((t) => t.id !== id);
        }
        for (const t of p.addTasks ?? []) {
          team.taskSeq += 1;
          const now = Date.now();
          team.tasks.push({
            id: `t${team.taskSeq}`,
            subject: t.subject,
            description: t.description,
            status: 'pending',
            assignee: t.assignee,
            dependencies: t.dependencies ?? [],
            kind: t.kind,
            createdAt: now,
            updatedAt: now,
          });
        }
        // 保存编辑后的计划
        orch.saveTeam(team);
        return textResult(`Plan updated. Members: ${team.members.map((m) => m.name).join(', ')}; Tasks: ${team.tasks.map((t) => t.id).join(', ')}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_approve -----------------------------------------------------
  tools.push({
    name: 'agent_teams_approve',
    description: 'Approve a staged team plan (usually done by the user in the Expert Team panel; model may call only after explicit user confirmation).',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
    annotations: { requireConfirmation: true },
    async execute(params): Promise<ToolResult> {
      try {
        const team = orch.approvePlan((params as TeamIdParams).teamId ?? '');
        return textResult(`Team approved and running. phase=${team.phase}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_add_member --------------------------------------------------
  tools.push({
    name: 'agent_teams_add_member',
    description: 'Add a member to a running team.',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        member: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
            agentId: { type: 'string' },
            inlinePrompt: { type: 'string' },
          },
          required: ['name'],
        },
      },
      required: ['teamId', 'member'],
    },
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      try {
        const p = params as MemberOnlyParams;
        const registry = resolveRegistry(ctx.services);
        const m = p.member;
        if (!m?.name) return errorResult('member.name required');
        if (!m.agentId && !m.inlinePrompt) return errorResult('member: agentId or inlinePrompt required');
        if (m.agentId && registry && !registry.get(m.agentId)) {
          return errorResult(`agentId "${m.agentId}" not found in registry`);
        }
        const team = orch.addMember(p.teamId ?? '', {
          name: m.name,
          role: m.role,
          agentId: m.agentId,
          inlinePrompt: m.inlinePrompt,
        });
        return textResult(`Member "${m.name}" added. Members: ${team.members.map((x) => x.name).join(', ')}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_remove_member -----------------------------------------------
  tools.push({
    name: 'agent_teams_remove_member',
    description: 'Remove a member from a team; their open tasks return to pending.',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, memberName: { type: 'string' } },
      required: ['teamId', 'memberName'],
    },
    async execute(params): Promise<ToolResult> {
      try {
        const p = params as MemberNameParams;
        const team = orch.removeMember(p.teamId ?? '', p.memberName ?? '');
        return textResult(`Member "${p.memberName}" removed. Members: ${team.members.filter((m) => m.status !== 'removed').map((x) => x.name).join(', ')}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_create_task --------------------------------------------------
  tools.push({
    name: 'agent_teams_create_task',
    description: 'Create a new task in a team (with optional dependencies, forming/extending the DAG).',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        task: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            description: { type: 'string' },
            kind: { type: 'string', enum: [...TASK_KINDS] },
            dependencies: { type: 'array', items: { type: 'string' } },
            assignee: { type: 'string' },
          },
          required: ['subject'],
        },
      },
      required: ['teamId', 'task'],
    },
    async execute(params): Promise<ToolResult> {
      try {
        const p = params as TaskParams;
        const t = p.task;
        if (!t?.subject) return errorResult('task.subject required');
        const kind = t.kind && (TASK_KINDS as readonly string[]).includes(t.kind) ? (t.kind as TaskKind) : undefined;
        const team = orch.createTask(p.teamId ?? '', {
          subject: t.subject,
          description: t.description,
          kind,
          dependencies: t.dependencies,
          assignee: t.assignee,
        });
        const created = team.tasks[team.tasks.length - 1];
        return textResult(`Task created: [${created.id}] ${created.subject}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_update_task --------------------------------------------------
  tools.push({
    name: 'agent_teams_update_task',
    description: 'Update a task (status/output/verdict/findings...). Requires attemptId for in-flight tasks to reject stale reports.',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        taskId: { type: 'string' },
        attemptId: { type: 'string', description: 'The attempt id from the dispatch ticket' },
        patch: {
          type: 'object',
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
      },
      required: ['teamId', 'taskId', 'patch'],
    },
    async execute(params): Promise<ToolResult> {
      try {
        const p = params as UpdateTaskParams;
        const patch = normalizeTaskPatch(p.patch);
        const team = orch.updateTask(p.teamId ?? '', p.taskId ?? '', patch, p.attemptId);
        return textResult(`Task updated. Team phase=${team.phase}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_reassign_task ------------------------------------------------
  tools.push({
    name: 'agent_teams_reassign_task',
    description: 'Reassign a task to another member (or unassign) and reset it to pending.',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, taskId: { type: 'string' }, assignee: { type: 'string' } },
      required: ['teamId', 'taskId'],
    },
    async execute(params): Promise<ToolResult> {
      try {
        const p = params as ReassignTaskParams;
        orch.reassignTask(p.teamId ?? '', p.taskId ?? '', p.assignee);
        return textResult(`Task ${p.taskId} reassigned${p.assignee ? ` to ${p.assignee}` : ' (unassigned)'}.`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_claim_task ---------------------------------------------------
  tools.push({
    name: 'agent_teams_claim_task',
    description: 'Claim a pending task (mark in_progress with a fresh attemptId). Usually automatic; manual claim is for recovery.',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, taskId: { type: 'string' } },
      required: ['teamId', 'taskId'],
    },
    async execute(params): Promise<ToolResult> {
      try {
        const p = params as ClaimTaskParams;
        // 手动认领：成员视角从 captain 会话不可得，等价于置 in_progress 由调度器接管
        const team = orch.get(p.teamId ?? '');
        if (!team) return errorResult('team not found');
        const task = team.tasks.find((t) => t.id === p.taskId);
        if (!task) return errorResult(`task "${p.taskId}" not found`);
        if (task.status !== 'pending') return errorResult(`task status is ${task.status}, not pending`);
        const updated = orch.updateTask(p.teamId ?? '', p.taskId ?? '', { status: 'in_progress' });
        return textResult(`Task claimed. phase=${updated.phase}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_send_message -------------------------------------------------
  tools.push({
    name: 'agent_teams_send_message',
    description: 'Send a message to a team member (or captain). Visible in the Expert Team message feed.',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, to: { type: 'string' }, content: { type: 'string' } },
      required: ['teamId', 'to', 'content'],
    },
    async execute(params): Promise<ToolResult> {
      try {
        const p = params as SendMessageParams;
        if (!p.to || !p.content) return errorResult('to and content required');
        orch.sendMessage(p.teamId ?? '', 'captain', p.to, p.content);
        return textResult(`Message sent to ${p.to}.`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_status -------------------------------------------------------
  tools.push({
    name: 'agent_teams_status',
    description: 'Query team status (members, tasks, dependencies, summary). Omit teamId to list all teams.',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
    },
    async execute(params): Promise<ToolResult> {
      const p = params as TeamIdParams;
      if (!p.teamId) {
        const summaries = orch.summaries();
        if (summaries.length === 0) return textResult('No teams.');
        return textResult(summaries.map((s) => `${s.id} "${s.name}" phase=${s.phase} tasks=${s.taskCompleted}/${s.taskTotal}`).join('\n'));
      }
      const team = orch.get(p.teamId);
      if (!team) return errorResult(`team "${p.teamId}" not found`);
      return textResult(formatTeamStatus(team));
    },
  });

  // agent_teams_resume --------------------------------------------------------
  tools.push({
    name: 'agent_teams_resume',
    description: 'Resume a halted team (cancelled tasks return to pending and scheduling restarts).',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
    async execute(params): Promise<ToolResult> {
      try {
        const team = orch.resume((params as TeamIdParams).teamId ?? '');
        return textResult(`Team resumed. phase=${team.phase}`);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // agent_teams_delete -------------------------------------------------------
  tools.push({
    name: 'agent_teams_delete',
    description: 'Delete a team (aborts in-flight member runs). Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
    annotations: { destructiveHint: true },
    async execute(params): Promise<ToolResult> {
      try {
        const ok = orch.deleteTeam((params as TeamIdParams).teamId ?? '');
        return ok ? textResult('Team deleted.') : errorResult('team not found');
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // subagent_run -------------------------------------------------------------
  tools.push({
    name: 'subagent_run',
    description: `Run a one-off subagent from a template (agent_explorer/agent_planner/agent_coder/agent_reviewer or any registry agent id). Fire-and-forget: the subagent runs in its own session and returns its final report. Use for single delegated tasks that don't need a persistent team. ${USAGE_PROTOCOL}`,
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Registry agent id, e.g. agent_explorer' },
        task: { type: 'string', description: 'Complete self-contained task description (the subagent sees only this)' },
        cwd: { type: 'string', description: 'Working directory (defaults to current session cwd)' },
      },
      required: ['template', 'task'],
    },
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      try {
        const p = params as SubagentRunParams;
        if (!p.template || !p.task) return errorResult('template and task required');
        const registry = resolveRegistry(ctx.services);
        if (registry && !registry.get(p.template)) {
          return errorResult(`template "${p.template}" not found in registry`);
        }
        const output = await orch.runSubagent({
          template: p.template,
          task: p.task,
          cwd: p.cwd || ctx.cwd,
        });
        return textResult(
          `Subagent finished (finishReason=${output.finishReason}, session=${output.sessionId}):\n\n${output.result}`,
          output.finishReason === 'error',
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  });

  return tools;
}

// ============================================================================
// 注册入口
// ============================================================================

/**
 * 注册 agent_teams_* / subagent_run 工具到 ToolRegistry。
 * 由 agenteam 模块 initialize 调用（此时 agent 引擎已就绪）。
 */
export function registerAgentTeamTools(
  services: ServiceRegistry,
  orchestrator: TeamOrchestrator,
  logger: Logger,
): void {
  const registry = services.tryResolve<ToolRegistry>(ServiceNames.TOOL_REGISTRY);
  if (!registry) {
    logger.warn('agenteam: tool registry unavailable, captain tools not registered');
    return;
  }
  const tools = createTeamsTools(orchestrator);
  for (const tool of tools) {
    try {
      registry.register(tool);
    } catch (err) {
      logger.warn('agenteam: tool register failed', {
        tool: tool.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info('agenteam: captain tools registered', { count: tools.length });
}
