// 运行一次 agent 会话：把 pi 的循环、Seam 的工具、权限闸门和事件日志接在一起。
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiEventConverter, type SeamEvent } from "./events";
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

/** 已启动的会话：sessionId 立即可用，done 在会话结束时完成 */
export interface SessionHandle {
  sessionId: string;
  logPath: string;
  done: Promise<SessionResult>;
  abort: () => void;
}

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
  const tools = createTools(workspace);
  const prompt = systemPrompt(workspace, opts.lang ?? "en");
  const maxTurns = opts.maxTurns ?? 30;
  const started = Date.now();

  log.record("session_start", "harness", {
    task: opts.task,
    workspace,
    model: { provider: opts.model.provider, id: opts.model.id, baseUrl: opts.model.baseUrl },
    systemPrompt: prompt,
    tools: tools.map((t) => t.name),
  });

  const recordingFetch = createRecordingFetch(log.record);
  let hitMaxTurns = false;

  const agent = new Agent({
    initialState: { systemPrompt: prompt, model: opts.model, tools },
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
    // 达到最大轮数时，本轮工具执行完就结束，不再发起新的模型请求
    afterToolCall: async () => {
      if (log.turn < maxTurns) return undefined;
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

  const done = agent.prompt(opts.task).then(() => finish());
  return { sessionId, logPath: log.path, done, abort: () => agent.abort() };

  function finish(): SessionResult {
    const last = agent.state.messages.findLast((m: any) => m.role === "assistant") as any;
    const finalText = (last?.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    const reason = hitMaxTurns
      ? "max_turns"
      : last?.stopReason === "error"
        ? "error"
        : last?.stopReason === "aborted"
          ? "aborted"
          : "completed";
    log.record("session_end", "harness", {
      reason,
      durationMs: Date.now() - started,
      errorMessage: last?.errorMessage,
    });

    return { sessionId, logPath: log.path, finalText, reason };
  }
}
