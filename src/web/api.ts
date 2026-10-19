// 前端调用本地服务的接口。令牌在 HttpOnly Cookie 里，同源请求会自动带上。
import type { SeamEvent } from "../events";
import type { SessionSummary } from "../server/server";
import type { Lang } from "./i18n/i18n";

export type { SessionSummary };

export interface Config {
  defaultWorkspace: string;
  providers: string[];
}

export type StreamMessage =
  | { kind: "event"; event: SeamEvent }
  | { kind: "delta"; turn: number; text: string }
  | { kind: "end" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const getConfig = () => request<Config>("/api/config");
export const listSessions = () => request<SessionSummary[]>("/api/sessions");

export const startTask = (input: { task: string; provider: string; workspace: string; lang: Lang }) =>
  request<{ sessionId: string }>("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

export const stopSession = (id: string) => request<{ ok: true }>(`/api/sessions/${id}/stop`, { method: "POST" });

/** 订阅会话的事件流：先收到已有事件，运行中的会话会继续推送，结束时收到 end。返回取消订阅的函数 */
export function subscribe(id: string, onMessage: (m: StreamMessage) => void): () => void {
  const source = new EventSource(`/api/sessions/${id}/stream`);
  source.onmessage = (e) => {
    const m = JSON.parse(e.data) as StreamMessage;
    onMessage(m);
    if (m.kind === "end") source.close();
  };
  source.onerror = () => source.close();
  return () => source.close();
}
