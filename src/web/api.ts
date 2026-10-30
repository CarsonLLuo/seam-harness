// 前端调用本地服务的接口。令牌在 HttpOnly Cookie 里，同源请求会自动带上。
import type { ProviderInfo, SessionSummary, StreamMessage } from "../server/server";
import type { ApprovalRequest } from "../session";
import type { Lang } from "./i18n/i18n";

export type { ApprovalRequest, ProviderInfo, SessionSummary, StreamMessage };

/** 用户对挂起请求的决定 */
export interface ApprovalDecision {
  decision: "allow" | "deny";
  reason?: string;
  /** 计划被批准时，用户修改后的步骤 */
  steps?: string[];
}

export interface Config {
  defaultWorkspace: string;
  providers: ProviderInfo[];
  /** 服务端能否弹出系统的“选择文件夹”对话框（目前只有 macOS） */
  canPickFolder: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const getConfig = () => request<Config>("/api/config");
export const listSessions = () => request<SessionSummary[]>("/api/sessions");

export const listWorkspaces = () => request<string[]>("/api/workspaces");

/** 弹出系统对话框选择文件夹；用户取消时返回 null */
export const pickFolder = async (input: { lang: Lang; current: string }) => {
  const res = await post<{ path?: string; cancelled?: true }>("/api/pick-folder", input);
  return res.path ?? null;
};

export const startTask = (input: { task: string; provider: string; model: string; workspace: string; lang: Lang }) =>
  post<{ sessionId: string }>("/api/sessions", input);

export const sendMessage = (id: string, text: string) => post<{ ok: true }>(`/api/sessions/${id}/messages`, { text });

/** 删除会话：服务端把日志移到回收站，30 天后彻底删除 */
export const deleteSession = (id: string) => request<{ ok: true }>(`/api/sessions/${id}`, { method: "DELETE" });

export const stopSession = (id: string) => post<{ ok: true }>(`/api/sessions/${id}/stop`);

/** 会话工作区里的文件（相对路径）；工作区不存在时报 404 */
export const listFiles = (id: string) => request<{ files: string[]; truncated: boolean }>(`/api/sessions/${id}/files`);

export const respondApproval = (id: string, toolCallId: string, body: ApprovalDecision) =>
  post<{ ok: true }>(`/api/sessions/${id}/approvals/${toolCallId}`, body);

/** 订阅会话的事件流：先收到已有事件和当前状态，之后持续推送。返回取消订阅的函数 */
export function subscribe(id: string, onMessage: (m: StreamMessage) => void): () => void {
  const source = new EventSource(`/api/sessions/${id}/stream`);
  source.onmessage = (e) => onMessage(JSON.parse(e.data) as StreamMessage);
  return () => source.close();
}
