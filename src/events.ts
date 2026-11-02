// Seam 事件日志 schema v1。
// 日志是解释层和界面唯一的数据来源：它由 Seam 自己定义，不直接序列化 pi 的对象，
// 以后升级或更换 pi，只需要改本文件里的转换层。
import type { AgentEvent } from "@earendil-works/pi-agent-core";

export const SCHEMA_VERSION = 1;

/**
 * 谁对这条记录的内容负责：
 * - harness：harness 观察到的客观事实（发出的请求、执行结果、权限决定）
 * - model：模型的输出，包括它对自己行为的说明（如 intent），属于模型自述
 * - user：用户的输入
 */
export type Source = "harness" | "model" | "user";

export interface EventPayloads {
  session_start: {
    task: string;
    workspace: string;
    model: { provider: string; id: string; baseUrl: string };
    systemPrompt: string;
    tools: string[];
    /** 界面语言；M2.5 之前的日志没有这个字段 */
    lang?: "en" | "zh";
    /** 工作区根目录的说明文件（SEAM.md），由 harness 读取并放进系统提示词 */
    workspaceNote?: { path: string; content: string; truncated: boolean };
  };
  /** 用户在发这条消息前放进工作区的文件（拖进对话区，复制到 uploads/）。记在 user_message 之前 */
  files_added: { files: { path: string; /** 原始文件名 */ name: string; bytes: number }[] };
  user_message: { content: unknown };
  turn_start: Record<string, never>;
  /** 真实发出的 HTTP 请求，鉴权相关的请求头已去掉 */
  http_request: { url: string; method: string; headers: Record<string, string>; body: unknown };
  http_response: { url: string; status: number };
  assistant_message: {
    content: unknown[];
    stopReason: string;
    usage: unknown;
    model: string;
    responseId?: string;
    errorMessage?: string;
  };
  tool_call: { toolCallId: string; name: string; args: Record<string, unknown>; intent?: string };
  permission: {
    toolCallId: string;
    name: string;
    decision: "allow" | "deny";
    /** auto：harness 自动决定；user：用户决定；timeout / aborted：等待中失去条件 */
    by: "auto" | "user" | "timeout" | "aborted";
    reason?: string;
    /** 结构化的原因，界面据此本地化解释，不解析 reason 字符串 */
    code?: "outside_workspace" | "plan_required" | "plan_denied" | "not_executed" | "timeout" | "aborted";
    /** 越界或被拒绝的路径 */
    path?: string;
  };
  tool_result: {
    toolCallId: string;
    name: string;
    content: unknown[];
    details?: unknown;
    isError: boolean;
    durationMs?: number;
  };
  turn_end: Record<string, never>;
  /** 一次运行结束。会话可以继续追问，所以一个日志里可能有多条 */
  session_end: { reason: "completed" | "error" | "aborted" | "max_turns"; durationMs: number; errorMessage?: string };
}

export type EventType = keyof EventPayloads;

export type SeamEvent = {
  [K in EventType]: {
    v: typeof SCHEMA_VERSION;
    seq: number;
    ts: number;
    sessionId: string;
    turn: number;
    type: K;
    source: Source;
    data: EventPayloads[K];
  };
}[EventType];

export type RecordFn = <K extends EventType>(type: K, source: Source, data: EventPayloads[K]) => void;

/**
 * 把 pi 的事件转换成 Seam 事件。
 * 流式增量（message_update、tool_execution_update）不记录，只记录完整的消息和结果。
 */
export class PiEventConverter {
  constructor(private readonly record: RecordFn) {}

  handle(event: AgentEvent): void {
    switch (event.type) {
      case "turn_start":
        this.record("turn_start", "harness", {});
        return;
      case "turn_end":
        this.record("turn_end", "harness", {});
        return;
      case "tool_execution_start": {
        const args = (event.args ?? {}) as Record<string, unknown>;
        const intent = typeof args.intent === "string" ? args.intent : undefined;
        this.record("tool_call", "model", { toolCallId: event.toolCallId, name: event.toolName, args, intent });
        return;
      }
      case "message_end":
        this.handleMessage(event.message);
        return;
    }
  }

  private handleMessage(message: unknown): void {
    const m = message as { role?: string } & Record<string, any>;
    if (m.role === "user") {
      this.record("user_message", "user", { content: m.content });
    } else if (m.role === "assistant") {
      this.record("assistant_message", "model", {
        content: m.content,
        stopReason: m.stopReason,
        usage: m.usage,
        model: m.model,
        responseId: m.responseId,
        errorMessage: m.errorMessage,
      });
    } else if (m.role === "toolResult") {
      // 记录的是发回给模型的那条结果消息，包括被拦下时的拒绝理由
      this.record("tool_result", "harness", {
        toolCallId: m.toolCallId,
        name: m.toolName,
        content: m.content,
        details: m.details,
        isError: m.isError,
        durationMs: m.durationMs,
      });
    }
  }
}
