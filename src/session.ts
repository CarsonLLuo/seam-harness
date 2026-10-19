// agent 会话：把 pi 的循环、Seam 的工具、权限闸门和事件日志接在一起。
// 一个会话可以多次发消息，每条消息触发一次运行；日志一直追加在同一个文件里。
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiEventConverter, type SeamEvent } from "./events";
import { readLog } from "./log";
import { EventLog } from "./log";
import { models } from "./models";
import { createRecordingFetch } from "./recording-fetch";
import { createTools, TOOLS_NEEDING_APPROVAL } from "./tools";

export interface ApprovalRequest {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}

/** 返回 true 表示批准；拒绝时可返回理由，会原样交给模型 */
export type Approver = (req: ApprovalRequest) => Promise<boolean | { approved: false; reason: string }>;

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
  /** 每写入一条事件就回调一次，用于实时显示 */
  onEvent?: (event: SeamEvent) => void;
  /** 模型输出文字的流式增量。只用于实时显示，不写进日志 */
  onDelta?: (delta: { turn: number; text: string }) => void;
}

export type Lang = "en" | "zh";

/** 已打开的会话 */
export interface Session {
  sessionId: string;
  logPath: string;
  /** 发一条消息并运行到结束。运行中再调用会抛错 */
  send: (text: string) => Promise<SessionResult>;
  abort: () => void;
  isRunning: () => boolean;
}

/** 新建并立即开始的会话：done 在第一次运行结束时完成 */
export interface SessionHandle extends Session {
  done: Promise<SessionResult>;
}

/** 恢复会话时需要重新提供的运行参数；工作区、系统提示词和模型名都从日志里读取 */
export type ResumeOptions = Omit<SessionOptions, "task" | "workspace" | "logDir">;

export interface SessionResult {
  sessionId: string;
  logPath: string;
  finalText: string;
  reason: "completed" | "error" | "aborted" | "max_turns";
}

export function defaultLogDir(): string {
  return process.env.SEAM_HOME ? join(process.env.SEAM_HOME, "sessions") : join(homedir(), ".seam", "sessions");
}

function systemPrompt(workspace: string, lang: Lang): string {
  const lines =
    lang === "zh"
      ? [
          "你是一个在用户本地工作区里工作的 agent。",
          `工作区根目录是 ${workspace}。你只能通过工具查看和修改这个目录里的文件。`,
          "你只知道自己实际读过的内容。不要声称看过没有读过的文件。",
          "每次调用工具都必须填写 `intent`：用一句简短的话告诉用户你为什么要这样调用。",
          "写文件和执行命令需要用户批准。如果调用被拒绝，请调整计划，不要重复尝试。",
          "`intent` 和最终回答都使用中文。完成后给出简洁的回答。",
        ]
      : [
          "You are an agent working inside a local workspace for a user.",
          `The workspace root is ${workspace}. You can only see and change files there, and only through your tools.`,
          "You only know what you have actually read. Do not claim to have looked at files you have not read.",
          "Every tool call must include `intent`: one short sentence telling the user why you are making this call.",
          "Writing files and running commands need the user's approval. If a call is denied, adapt your plan instead of retrying it.",
          "Write `intent` and your final answer in English. When you finish, give a concise answer.",
        ];
  return lines.join("\n");
}

export async function runSession(opts: SessionOptions): Promise<SessionResult> {
  return startSession(opts).done;
}

export function startSession(opts: SessionOptions): SessionHandle {
  const workspace = realpathSync(opts.workspace);
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const log = new EventLog(join(opts.logDir ?? defaultLogDir(), `${sessionId}.jsonl`), sessionId, opts.onEvent);
  const lang = opts.lang ?? "en";
  const prompt = systemPrompt(workspace, lang);
  const tools = createTools(workspace);

  log.record("session_start", "harness", {
    task: opts.task,
    workspace,
    model: { provider: opts.model.provider, id: opts.model.id, baseUrl: opts.model.baseUrl },
    systemPrompt: prompt,
    tools: tools.map((t) => t.name),
    lang,
  });

  const session = buildSession({ ...opts, log, workspace, systemPrompt: prompt, messages: [] });
  return { ...session, done: session.send(opts.task) };
}

/** 从日志恢复会话（比如服务重启之后），之后可以继续发消息 */
export function resumeSession(logPath: string, opts: ResumeOptions): Session {
  const events = readLog(logPath);
  const start = events.find((e) => e.type === "session_start");
  if (start?.type !== "session_start") throw new Error("The log has no session_start event.");
  const last = events.at(-1)!;
  const log = new EventLog(logPath, start.sessionId, opts.onEvent, { seq: last.seq, turn: last.turn });
  return buildSession({
    ...opts,
    log,
    workspace: start.data.workspace,
    systemPrompt: start.data.systemPrompt,
    messages: rebuildMessages(events, opts.model),
  });
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
  const tools = createTools(opts.workspace);
  const maxTurns = opts.maxTurns ?? 30;
  const recordingFetch = createRecordingFetch(log.record);
  let running = false;
  let runStartTurn = 0;
  let hitMaxTurns = false;

  const agent = new Agent({
    initialState: { systemPrompt: opts.systemPrompt, model: opts.model, tools, messages: opts.messages },
    toolExecution: "sequential",
    streamFn: (m, ctx, o) => models.streamSimple(m, ctx, { ...o, apiKey: opts.apiKey, fetch: recordingFetch }),
    beforeToolCall: async ({ toolCall, args }) => {
      const base = { toolCallId: toolCall.id, name: toolCall.name };
      if (!TOOLS_NEEDING_APPROVAL.has(toolCall.name)) {
        log.record("permission", "harness", { ...base, decision: "allow", by: "auto" });
        return undefined;
      }
      const answer = await opts.approve({ ...base, args: args as Record<string, unknown> });
      if (answer === true) {
        log.record("permission", "harness", { ...base, decision: "allow", by: "user" });
        return undefined;
      }
      const reason = answer === false ? `The user denied ${toolCall.name}.` : answer.reason;
      log.record("permission", "harness", { ...base, decision: "deny", by: "user", reason });
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

  async function send(text: string): Promise<SessionResult> {
    if (running) throw new Error("The session is already running.");
    running = true;
    runStartTurn = log.turn;
    hitMaxTurns = false;
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
    const reason = thrown
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
    abort: () => agent.abort(),
    isRunning: () => running,
  };
}
