// 只靠事件日志重建会话：每一轮的请求、模型响应、工具调用及其权限决定和结果。
import type { EventPayloads, SeamEvent } from "./events";

export interface ReplayToolCall {
  call: EventPayloads["tool_call"];
  permission?: EventPayloads["permission"];
  result?: EventPayloads["tool_result"];
}

export interface ReplayTurn {
  turn: number;
  /** 这一轮开头的用户消息（第一轮是任务，之后是追问）；模型接着工具结果继续时没有 */
  user?: EventPayloads["user_message"];
  /** 本轮真实发出的请求；遇到重试时可能有多次 */
  requests: EventPayloads["http_request"][];
  assistant?: EventPayloads["assistant_message"];
  toolCalls: ReplayToolCall[];
  /** 如果一次运行在这一轮结束，这里是结束信息 */
  end?: EventPayloads["session_end"];
}

export interface ReplaySession {
  sessionId: string;
  start?: EventPayloads["session_start"];
  userMessages: EventPayloads["user_message"][];
  turns: ReplayTurn[];
  end?: EventPayloads["session_end"];
}

export function reconstruct(events: SeamEvent[]): ReplaySession {
  const session: ReplaySession = { sessionId: events[0]?.sessionId ?? "", userMessages: [], turns: [] };
  const turns = new Map<number, ReplayTurn>();
  const calls = new Map<string, ReplayToolCall>();
  const turnOf = (n: number) => {
    let t = turns.get(n);
    if (!t) {
      t = { turn: n, requests: [], toolCalls: [] };
      turns.set(n, t);
      session.turns.push(t);
    }
    return t;
  };

  for (const e of events) {
    switch (e.type) {
      case "session_start":
        session.start = e.data;
        break;
      case "user_message":
        session.userMessages.push(e.data);
        turnOf(e.turn).user = e.data;
        break;
      case "turn_start":
        turnOf(e.turn);
        break;
      case "http_request":
        turnOf(e.turn).requests.push(e.data);
        break;
      case "assistant_message":
        turnOf(e.turn).assistant = e.data;
        break;
      case "tool_call": {
        const c: ReplayToolCall = { call: e.data };
        calls.set(e.data.toolCallId, c);
        turnOf(e.turn).toolCalls.push(c);
        break;
      }
      case "permission": {
        const c = calls.get(e.data.toolCallId);
        if (c) c.permission = e.data;
        break;
      }
      case "tool_result": {
        const c = calls.get(e.data.toolCallId);
        if (c) c.result = e.data;
        break;
      }
      case "session_end":
        session.end = e.data;
        if (e.turn > 0) turnOf(e.turn).end = e.data;
        break;
    }
  }
  return session;
}

// ---- 命令行显示：实时运行和回放共用 ----

function textOf(content: unknown[] | undefined): string {
  return (content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text as string)
    .join("\n");
}

function oneLine(s: string, max = 160): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function argsSummary(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => k !== "intent")
    .map(([k, v]) => `${k}=${oneLine(typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v), 60)}`)
    .join(", ");
}

/** 把一条事件格式化成命令行输出；不需要显示的事件返回 undefined */
export function formatEvent(e: SeamEvent, opts: { raw?: boolean } = {}): string | undefined {
  switch (e.type) {
    case "session_start": {
      const m = e.data.model;
      return [
        `Session ${e.sessionId}`,
        `  model:     ${m.provider}/${m.id} @ ${new URL(m.baseUrl).host}`,
        `  workspace: ${e.data.workspace}`,
        `  task:      ${e.data.task}`,
      ].join("\n");
    }
    case "turn_start":
      return `\n── Turn ${e.turn} ──`;
    case "http_request": {
      const body = e.data.body as { messages?: unknown[]; tools?: unknown[] } | undefined;
      const summary = `  → request  ${e.data.method} ${e.data.url}  (${body?.messages?.length ?? "?"} messages, ${body?.tools?.length ?? 0} tools)`;
      return opts.raw ? `${summary}\n${JSON.stringify(e.data, null, 2)}` : summary;
    }
    case "http_response":
      return e.data.status === 200 ? undefined : `  ← HTTP ${e.data.status}`;
    case "assistant_message": {
      const lines = [];
      const text = textOf(e.data.content);
      if (text) lines.push(`  ◆ model    ${oneLine(text, 300)}`);
      if (e.data.errorMessage) lines.push(`  ✖ error    ${oneLine(e.data.errorMessage, 300)}`);
      const u = e.data.usage as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined;
      // 输入 token 包括缓存命中和缓存写入的部分，否则开启提示缓存后会显得极小
      const input = u ? (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : "?";
      const cache = u?.cacheRead || u?.cacheWrite ? ` (cache read ${u.cacheRead ?? 0}, write ${u.cacheWrite ?? 0})` : "";
      lines.push(`             stop=${e.data.stopReason}  tokens in=${input}${cache} out=${u?.output ?? "?"}`);
      return lines.join("\n");
    }
    case "tool_call":
      return [
        `  • ${e.data.name}(${argsSummary(e.data.args)})`,
        `      intent (model's own account): ${e.data.intent ?? "(missing)"}`,
      ].join("\n");
    case "permission":
      return `      permission: ${e.data.decision} (${e.data.by})${e.data.reason ? ` — ${e.data.reason}` : ""}`;
    case "tool_result": {
      const first = oneLine(textOf(e.data.content).split("\n")[0] ?? "", 160);
      return `      result${e.data.isError ? " (error)" : ""}: ${first}`;
    }
    case "session_end":
      return `\nEnd: ${e.data.reason} in ${(e.data.durationMs / 1000).toFixed(1)} s${e.data.errorMessage ? ` — ${e.data.errorMessage}` : ""}`;
    default:
      return undefined;
  }
}
