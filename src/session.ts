// agent 会话：把 pi 的循环、Seam 的工具、权限闸门和事件日志接在一起。
// 一个会话可以多次发消息，每条消息触发一次运行；日志一直追加在同一个文件里。
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiEventConverter, type EventPayloads, type SeamEvent } from "./events";
import { readLog } from "./log";
import { EventLog } from "./log";
import { models } from "./models";
import { createRecordingFetch } from "./recording-fetch";
import {
  createPlanTool,
  createTools,
  PATH_ARG,
  PLAN_TOOL_NAME,
  resolveInWorkspace,
  summarizeWrite,
  TOOLS_NEEDING_APPROVAL,
  type PlanState,
  type WritePreview,
} from "./tools";

export type Lang = "en" | "zh";

export interface WorkspaceNote {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ApprovalRequest {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  /** 模型自述：为什么调用 */
  intent?: string;
  /** harness 计算出的展示信息，不是模型自述 */
  preview?: ApprovalPreview;
}

export type ApprovalPreview = WritePreview | { kind: "run_command"; command: string } | { kind: "plan"; steps: string[] };

export type ApprovalAnswer =
  | true
  | { approved: false; reason: string; by?: "user" | "timeout" | "aborted" }
  | { approved: true; /** 用户修改后的计划步骤 */ steps?: string[] };

/** 返回 true 表示批准；拒绝时可返回理由，会原样交给模型 */
export type Approver = (req: ApprovalRequest, signal?: AbortSignal) => Promise<ApprovalAnswer>;

export interface SessionOptions {
  task: string;
  workspace: string;
  model: Model<Api>;
  apiKey: string;
  approve: Approver;
  /** 日志目录，默认 ~/.seam/sessions */
  logDir?: string;
  maxTurns?: number;
  /** 系统提示词的语言，也是 intent 和最终回答使用的语言。默认 en */
  lang?: Lang;
  /** 用户在第一条消息前放进工作区的文件（见 uploads.ts） */
  files?: AddedFiles;
  /** 每写入一条事件就回调一次，用于实时显示 */
  onEvent?: (event: SeamEvent) => void;
  /** 模型输出文字的流式增量。只用于实时显示，不写进日志 */
  onDelta?: (delta: { turn: number; text: string }) => void;
}

/** 已打开的会话 */
export type AddedFiles = EventPayloads["files_added"]["files"];

export interface Session {
  sessionId: string;
  logPath: string;
  /** 发一条消息并运行到结束；files 是用户这次放进工作区的文件。运行中再调用会抛错 */
  send: (text: string, files?: AddedFiles) => Promise<SessionResult>;
  abort: () => void;
  isRunning: () => boolean;
}

/** 新建并立即开始的会话：done 在第一次运行结束时完成 */
export interface SessionHandle extends Session {
  done: Promise<SessionResult>;
}

/** 恢复会话时需要重新提供的运行参数；工作区、系统提示词和模型名都从日志里读取 */
export type ResumeOptions = Omit<SessionOptions, "task" | "workspace" | "logDir" | "files">;

export interface SessionResult {
  sessionId: string;
  logPath: string;
  finalText: string;
  reason: "completed" | "error" | "aborted" | "max_turns";
}

export function defaultLogDir(): string {
  return process.env.SEAM_HOME ? join(process.env.SEAM_HOME, "sessions") : join(homedir(), ".seam", "sessions");
}

/** 删除的会话移到这里，默认 ~/.seam/trash */
export function defaultTrashDir(): string {
  return process.env.SEAM_HOME ? join(process.env.SEAM_HOME, "trash") : join(homedir(), ".seam", "trash");
}

const WORKSPACE_NOTE_FILE = "SEAM.md";
const WORKSPACE_NOTE_LIMIT = 32_000;

/** 工作区根目录的说明文件；不存在或读不了就当作没有 */
export function readWorkspaceNote(workspace: string): WorkspaceNote | undefined {
  const path = join(workspace, WORKSPACE_NOTE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf8");
    const truncated = raw.length > WORKSPACE_NOTE_LIMIT;
    return {
      path: WORKSPACE_NOTE_FILE,
      content: truncated ? `${raw.slice(0, WORKSPACE_NOTE_LIMIT)}\n…[truncated]` : raw,
      truncated,
    };
  } catch {
    return undefined;
  }
}

function systemPrompt(workspace: string, lang: Lang, note?: WorkspaceNote): string {
  const lines =
    lang === "zh"
      ? [
          "你是一个在用户本地工作区里工作的 agent。",
          `工作区根目录是 ${workspace}。你只能通过工具查看和修改这个目录里的文件。`,
          "你只知道自己实际读过的内容。不要声称看过没有读过的文件。",
          "用户消息里的 `@路径` 指工作区里的文件（相对工作区根目录）。消息里只有路径，没有内容；需要时用 `read_file` 读取。",
          "每次调用工具都必须填写 `intent`：用一句简短的话告诉用户你为什么要这样调用。",
          "除 `propose_plan` 外，每次调用工具都必须填写 `step`：这次调用属于已批准计划的第几步（从 1 开始）；还没有计划或不在计划里时填 0。",
          "在第一次写文件或执行命令之前，必须先调用 `propose_plan` 提出计划，等用户批准。读取文件不需要计划。",
          "用户可能会修改你的计划；以工具返回的计划为准。",
          "写文件和执行命令需要用户批准。如果调用被拒绝，请调整计划，不要重复尝试。",
          "`intent` 和最终回答都使用中文。完成后给出简洁的回答。",
        ]
      : [
          "You are an agent working inside a local workspace for a user.",
          `The workspace root is ${workspace}. You can only see and change files there, and only through your tools.`,
          "You only know what you have actually read. Do not claim to have looked at files you have not read.",
          "An `@path` in the user's message refers to a file in the workspace (relative to the root). The message holds only the path, not the content; use `read_file` when you need it.",
          "Every tool call must include `intent`: one short sentence telling the user why you are making this call.",
          "Every tool call except `propose_plan` must include `step`: the step of the approved plan it belongs to (1-based), or 0 if there is no plan yet or it is not part of the plan.",
          "Before the first write or command, call `propose_plan` and wait for the user's approval. Reading files does not need a plan.",
          "The user may edit your plan. Follow the plan returned by the tool.",
          "Writing files and running commands need the user's approval. If a call is denied, adapt your plan instead of retrying it.",
          "Write `intent` and your final answer in English. When you finish, give a concise answer.",
        ];
  if (note) {
    lines.push(
      lang === "zh"
        ? `\n工作区说明文件（${note.path}），用户希望你在工作时遵循：\n---\n${note.content}\n---`
        : `\nWorkspace notes (${note.path}) the user wants you to follow:\n---\n${note.content}\n---`,
    );
  }
  return lines.join("\n");
}

function boundaryReason(lang: Lang, path: string): string {
  return lang === "zh"
    ? `路径 "${path}" 在工作区之外，被 harness 拦截了。你只能访问工作区内的文件。`
    : `Path "${path}" is outside the workspace and was blocked by the harness. You can only access files inside the workspace.`;
}

function planRequiredReason(lang: Lang): string {
  return lang === "zh"
    ? "在写文件或执行命令之前，必须先调用 propose_plan 提出计划并获得用户批准。请先提出计划。"
    : "Before writing files or running commands, call propose_plan and get the user's approval. Propose a plan first.";
}

function planDeniedReason(lang: Lang): string {
  return lang === "zh" ? "用户拒绝了这个计划。" : "The user denied this plan.";
}

function deniedReason(lang: Lang, name: string): string {
  return lang === "zh" ? `用户拒绝了 ${name}。` : `The user denied ${name}.`;
}

function previewFor(workspace: string, name: string, args: Record<string, unknown>): ApprovalPreview | undefined {
  if (name === "write_file" && typeof args.path === "string" && typeof args.content === "string") {
    try {
      return summarizeWrite(workspace, args.path, args.content);
    } catch {
      return undefined;
    }
  }
  if (name === "run_command" && typeof args.command === "string") {
    return { kind: "run_command", command: args.command };
  }
  return undefined;
}

export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  return startSession(opts).done;
}

export function startSession(opts: SessionOptions): SessionHandle {
  const workspace = realpathSync(opts.workspace);
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const log = new EventLog(join(opts.logDir ?? defaultLogDir(), `${sessionId}.jsonl`), sessionId, opts.onEvent);
  const lang = opts.lang ?? "en";
  const note = readWorkspaceNote(workspace);
  const prompt = systemPrompt(workspace, lang, note);
  const toolNames = [...createTools(workspace).map((t) => t.name), PLAN_TOOL_NAME];

  log.record("session_start", "harness", {
    task: opts.task,
    workspace,
    model: { provider: opts.model.provider, id: opts.model.id, baseUrl: opts.model.baseUrl },
    systemPrompt: prompt,
    tools: toolNames,
    lang,
    ...(note ? { workspaceNote: note } : {}),
  });

  const session = buildSession({ ...opts, log, workspace, systemPrompt: prompt, messages: [] });
  return { ...session, done: session.send(opts.task, opts.files) };
}

/** 从日志恢复会话（比如服务重启之后），之后可以继续发消息 */
export function resumeSession(logPath: string, opts: ResumeOptions): Session {
  const events = readLog(logPath);
  const start = events.find((e) => e.type === "session_start");
  if (start?.type !== "session_start") throw new Error("The log has no session_start event.");
  const last = events.at(-1)!;
  const log = new EventLog(logPath, start.sessionId, opts.onEvent, { seq: last.seq, turn: last.turn });
  const lang = start.data.lang ?? opts.lang ?? "en";
  const reconciled = reconcileInterruptedRun(logPath, events, log, lang);
  return buildSession({
    ...opts,
    log,
    workspace: start.data.workspace,
    systemPrompt: start.data.systemPrompt,
    messages: rebuildMessages(reconciled, opts.model),
  });
}

/**
 * 进程在运行中途退出时，日志里会留下没有结果的工具调用。
 * 恢复时补上拒绝 / 结果事件，模型上下文和新请求才不会出现悬空的 tool_use。
 */
function reconcileInterruptedRun(logPath: string, events: SeamEvent[], log: EventLog, lang: Lang): SeamEvent[] {
  const lastEnd = events.findLastIndex((e) => e.type === "session_end");
  const tail = events.slice(lastEnd + 1);
  if (!tail.some((e) => e.type === "turn_start")) return events;

  const permissions = new Set(tail.flatMap((e) => (e.type === "permission" ? [e.data.toolCallId] : [])));
  const results = new Set(tail.flatMap((e) => (e.type === "tool_result" ? [e.data.toolCallId] : [])));
  const reason =
    lang === "zh" ? "服务重启时这次调用还没有执行，结果未知。" : "The service restarted before this call ran, so it was not executed.";

  for (const e of tail) {
    if (e.type !== "tool_call" || results.has(e.data.toolCallId)) continue;
    if (!permissions.has(e.data.toolCallId)) {
      log.record("permission", "harness", {
        toolCallId: e.data.toolCallId,
        name: e.data.name,
        decision: "deny",
        by: "auto",
        code: "not_executed",
        reason,
      });
    }
    log.record("tool_result", "harness", {
      toolCallId: e.data.toolCallId,
      name: e.data.name,
      content: [{ type: "text", text: reason }],
      details: { code: "not_executed" },
      isError: true,
    });
  }
  log.record("session_end", "harness", {
    reason: "aborted",
    durationMs: 0,
    errorMessage: lang === "zh" ? "服务重启，这次运行被中断。" : "The service restarted, so this run was interrupted.",
  });
  return readLog(logPath);
}

/**
 * 把日志里的事件还原成 pi 的对话历史：用户消息、模型消息和工具结果。
 * 出错或被中止的模型消息不放回去，因为它们可能带着没有结果的工具调用。
 */
export function rebuildMessages(events: SeamEvent[], model: Model<Api>): any[] {
  const messages: any[] = [];
  for (const e of events) {
    if (e.type === "user_message") {
      messages.push({ role: "user", content: e.data.content, timestamp: e.ts });
    } else if (e.type === "assistant_message") {
      if (e.data.stopReason === "error" || e.data.stopReason === "aborted") continue;
      messages.push({
        role: "assistant",
        content: e.data.content,
        api: model.api,
        provider: model.provider,
        model: e.data.model,
        responseId: e.data.responseId,
        usage: e.data.usage,
        stopReason: e.data.stopReason,
        timestamp: e.ts,
      });
    } else if (e.type === "tool_result") {
      messages.push({
        role: "toolResult",
        toolCallId: e.data.toolCallId,
        toolName: e.data.name,
        content: e.data.content,
        details: e.data.details,
        isError: e.data.isError,
        timestamp: e.ts,
      });
    }
  }
  return messages;
}

function buildSession(
  opts: ResumeOptions & { log: EventLog; workspace: string; systemPrompt: string; messages: any[] },
): Session {
  const { log } = opts;
  const lang = opts.lang ?? "en";
  let planApproved = false;
  let planState: PlanState | undefined;
  const tools = [...createTools(opts.workspace), createPlanTool(() => planState, lang)];
  const maxTurns = opts.maxTurns ?? 30;
  const recordingFetch = createRecordingFetch(log.record);
  let running = false;
  let runStartTurn = 0;
  let hitMaxTurns = false;
  let stopRequested = false;

  const agent = new Agent({
    initialState: { systemPrompt: opts.systemPrompt, model: opts.model, tools, messages: opts.messages },
    toolExecution: "sequential",
    streamFn: (m, ctx, o) => models.streamSimple(m, ctx, { ...o, apiKey: opts.apiKey, fetch: recordingFetch }),
    beforeToolCall: async ({ toolCall, args }, signal) => {
      const a = args as Record<string, unknown>;
      const base = { toolCallId: toolCall.id, name: toolCall.name };
      const intent = typeof a.intent === "string" ? a.intent : undefined;

      // 工作区边界：在问用户之前就拦掉，不给用户一个根本不可能执行的批准框
      const pathKey = PATH_ARG[toolCall.name];
      const requestedPath = pathKey && typeof a[pathKey] === "string" ? (a[pathKey] as string) : undefined;
      if (requestedPath !== undefined) {
        try {
          resolveInWorkspace(opts.workspace, requestedPath);
        } catch {
          const reason = boundaryReason(lang, requestedPath);
          log.record("permission", "harness", {
            ...base,
            decision: "deny",
            by: "auto",
            code: "outside_workspace",
            path: requestedPath,
            reason,
          });
          return { block: true, reason };
        }
      }

      // 计划：用户可以改步骤，改后的计划由工具结果交给模型
      if (toolCall.name === PLAN_TOOL_NAME) {
        const proposed = Array.isArray(a.steps)
          ? a.steps
              .filter((s): s is string => typeof s === "string" && s.trim() !== "")
              .map((s) => s.trim())
          : [];
        const answer = await opts.approve(
          { ...base, args: a, intent, preview: { kind: "plan", steps: proposed } },
          signal,
        );
        if (answer === true || answer.approved) {
          const edited =
            answer === true
              ? proposed
              : (answer.steps
                  ?.filter((s) => s.trim() !== "")
                  .map((s) => s.trim()) ?? proposed);
          planState = {
            steps: edited,
            originalSteps: proposed,
            edited: edited.length !== proposed.length || edited.some((s, i) => s !== proposed[i]),
          };
          planApproved = true;
          log.record("permission", "harness", { ...base, decision: "allow", by: "user" });
          return undefined;
        }
        const by = answer.by ?? "user";
        const reason = answer.reason || planDeniedReason(lang);
        log.record("permission", "harness", { ...base, decision: "deny", by, code: "plan_denied", reason });
        return { block: true, reason };
      }

      // 修改工作区之前必须先有批准的计划；读取不受影响
      if (TOOLS_NEEDING_APPROVAL.has(toolCall.name) && !planApproved) {
        const reason = planRequiredReason(lang);
        log.record("permission", "harness", {
          ...base,
          decision: "deny",
          by: "auto",
          code: "plan_required",
          reason,
        });
        return { block: true, reason };
      }

      // 读取类工具自动放行
      if (!TOOLS_NEEDING_APPROVAL.has(toolCall.name)) {
        log.record("permission", "harness", { ...base, decision: "allow", by: "auto" });
        return undefined;
      }

      // 写文件和执行命令：交给用户确认
      const answer = await opts.approve(
        { ...base, args: a, intent, preview: previewFor(opts.workspace, toolCall.name, a) },
        signal,
      );
      if (answer === true || answer.approved) {
        log.record("permission", "harness", { ...base, decision: "allow", by: "user" });
        return undefined;
      }
      const by = answer.by ?? "user";
      const reason = answer.reason || deniedReason(lang, toolCall.name);
      const code = by === "timeout" ? "timeout" : by === "aborted" ? "aborted" : undefined;
      log.record("permission", "harness", {
        ...base,
        decision: "deny",
        by,
        ...(code ? { code } : {}),
        reason,
      });
      return { block: true, reason };
    },
    // 一次运行达到最大轮数时，本轮工具执行完就结束，不再发起新的模型请求
    afterToolCall: async () => {
      if (log.turn - runStartTurn < maxTurns) return undefined;
      hitMaxTurns = true;
      return { terminate: true };
    },
  });

  const converter = new PiEventConverter(log.record);
  agent.subscribe((event) => {
    converter.handle(event);
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      opts.onDelta?.({ turn: log.turn, text: event.assistantMessageEvent.delta });
    }
  });

  async function send(text: string, files?: AddedFiles): Promise<SessionResult> {
    if (running) throw new Error("The session is already running.");
    running = true;
    if (files?.length) log.record("files_added", "user", { files });
    runStartTurn = log.turn;
    hitMaxTurns = false;
    stopRequested = false;
    // 计划按“一次运行”算：每条用户消息都可以要求一个新的计划
    planApproved = false;
    planState = undefined;
    const started = Date.now();
    const firstNewMessage = agent.state.messages.length;
    let thrown: Error | undefined;
    try {
      await agent.prompt(text);
    } catch (err) {
      thrown = err as Error;
    }
    // 只看这次运行产生的模型消息
    const last = agent.state.messages.slice(firstNewMessage).findLast((m: any) => m.role === "assistant") as any;
    const finalText = (last?.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    // 用户停止后，pi 可能还会用已中止的信号再发一次请求，记成 stopReason "error"，这里按停止算
    const reason = stopRequested
      ? "aborted"
      : thrown
        ? "error"
        : hitMaxTurns
          ? "max_turns"
          : last?.stopReason === "error"
            ? "error"
            : last?.stopReason === "aborted"
              ? "aborted"
              : "completed";
    // session_end 表示一次运行结束；会话可以继续追问，所以一个日志里可能有多条
    log.record("session_end", "harness", {
      reason,
      durationMs: Date.now() - started,
      errorMessage: thrown?.message ?? last?.errorMessage,
    });
    running = false;
    return { sessionId: log.sessionId, logPath: log.path, finalText, reason };
  }

  return {
    sessionId: log.sessionId,
    logPath: log.path,
    send,
    abort: () => {
      if (running) stopRequested = true;
      agent.abort();
    },
    isRunning: () => running,
  };
}
