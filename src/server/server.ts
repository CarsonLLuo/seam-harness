// Seam 的本地 Web 服务：会话 API + 事件推送（SSE）。
// 这个服务能让 agent 读文件、跑命令，所以必须防止别的网页借浏览器向它发请求：
//   - 只监听 127.0.0.1
//   - 启动时生成随机令牌；打开带令牌的链接后写入 SameSite=Strict 的 Cookie，所有 API 都要校验
//   - 校验 Host 请求头（防 DNS 重绑定），写操作再校验 Origin 请求头
import type { Api, Model } from "@earendil-works/pi-ai";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import type { SeamEvent } from "../events";
import { readLog } from "../log";
import type { ProviderName } from "../models";
import { listWorkspaceFiles } from "../tools";
import {
  resumeSession,
  startSession,
  type ApprovalAnswer,
  type ApprovalRequest,
  type Approver,
  type Lang,
  type Session,
  type SessionOptions,
} from "../session";
import type { FolderPicker } from "./folder-picker";

export interface ServerOptions {
  port: number;
  token: string;
  logDir: string;
  /** 删除的会话移到这里；服务启动时彻底删除放了超过 30 天的 */
  trashDir: string;
  /** 新建任务时工作区输入框的默认值 */
  defaultWorkspace: string;
  resolveModel: (provider: ProviderName, modelId?: string) => { model: Model<Api>; apiKey: string };
  /** 已配置 API Key 的供应商，以及它们可选的模型 */
  availableProviders: () => ProviderInfo[];
  /** 弹出系统的“选择文件夹”对话框；不传则不提供这个功能 */
  pickFolder?: FolderPicker;
  /** 前端页面（Bun 的 HTML 导入）；测试时可以不传 */
  app?: unknown;
  development?: boolean;
  /** 等待用户确认的超时时间；默认 10 分钟，测试可以调短 */
  approvalTimeoutMs?: number;
}

export interface ProviderInfo {
  name: ProviderName;
  models: string[];
  defaultModel: string;
}

export interface SessionSummary {
  id: string;
  task: string;
  provider: string;
  model: string;
  startedAt: number;
  status: "running" | "completed" | "error" | "aborted" | "max_turns" | "unknown";
}

/** 事件流里的消息。连接不会在运行结束时断开，以便接收后续追问产生的事件 */
export type StreamMessage =
  | { kind: "event"; event: SeamEvent }
  | { kind: "delta"; turn: number; text: string }
  | { kind: "status"; running: boolean }
  /** 一个等用户决定的请求；重连时会重新补发 */
  | { kind: "approval"; request: ApprovalRequest }
  | { kind: "approval_resolved"; toolCallId: string };

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (answer: ApprovalAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 服务端打开过的会话：事件缓存 + 订阅者 + 可选的 agent + 待确认的请求 */
interface Entry {
  events: SeamEvent[];
  subscribers: Set<(m: StreamMessage) => void>;
  session?: Session;
  lang: Lang;
  pending: Map<string, PendingApproval>;
}

const COOKIE = "seam_token";
const RECENT_WORKSPACES = 8;
const MAX_LISTED_FILES = 2000; // 阅读覆盖图最多列出的文件数
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const PICK_PROMPT: Record<Lang, string> = {
  en: "Choose the workspace folder for the agent",
  zh: "选择 agent 的工作区文件夹",
};

const TIMEOUT_REASON: Record<Lang, string> = {
  en: "The user did not respond within 10 minutes, so the request was denied. Continue without it.",
  zh: "用户 10 分钟内没有回应，请求已被拒绝。请在不使用它的情况下继续。",
};

const ABORTED_REASON: Record<Lang, string> = {
  en: "The run was stopped before the user responded.",
  zh: "用户还没有回应，这次运行就被停止了。",
};

const DENIED_REASON: Record<Lang, string> = {
  en: "The user denied this request.",
  zh: "用户拒绝了这个请求。",
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (status: number, error: string) => json({ error }, status);

/** 彻底删除回收站里放了超过 30 天的日志。移进回收站时把修改时间设为删除时间，这里按它计算 */
export function purgeTrash(trashDir: string, now = Date.now()): void {
  if (!existsSync(trashDir)) return;
  for (const f of readdirSync(trashDir)) {
    if (!f.endsWith(".jsonl")) continue;
    const p = join(trashDir, f);
    if (now - statSync(p).mtimeMs > TRASH_RETENTION_MS) rmSync(p, { force: true });
  }
}

export function createServer(opts: ServerOptions) {
  const entries = new Map<string, Entry>();
  purgeTrash(opts.trashDir);

  // ---- 安全校验 ----
  const allowedHosts = () => [`127.0.0.1:${server.port}`, `localhost:${server.port}`];

  function guard(req: Request): Response | undefined {
    if (!allowedHosts().includes(req.headers.get("host") ?? "")) return fail(403, "Unexpected Host header.");
    const token = cookieValue(req, COOKIE);
    if (!token || !safeEqual(token, opts.token)) return fail(401, "Missing or invalid token.");
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (!origin || !allowedHosts().some((h) => origin === `http://${h}`)) return fail(403, "Unexpected Origin.");
    }
    return undefined;
  }

  const api =
    (handler: (req: Request & { params: Record<string, string> }) => Response | Promise<Response>) =>
    (req: Request & { params: Record<string, string> }) =>
      guard(req) ?? handler(req);

  // ---- 会话 ----
  function logPath(id: string): string | undefined {
    if (!/^[\w.-]+$/.test(id)) return undefined; // 防止路径穿越
    const p = join(opts.logDir, `${id}.jsonl`);
    return existsSync(p) ? p : undefined;
  }

  /** 取得会话的缓存；第一次访问已结束的会话时从日志加载 */
  function entryOf(id: string): Entry | undefined {
    const existing = entries.get(id);
    if (existing) return existing;
    const path = logPath(id);
    if (!path) return undefined;
    const events = readLog(path);
    const start = events.find((e) => e.type === "session_start");
    const lang = start?.type === "session_start" ? (start.data.lang ?? "en") : "en";
    const entry: Entry = { events, subscribers: new Set(), lang, pending: new Map() };
    entries.set(id, entry);
    return entry;
  }

  const publish = (entry: Entry, m: StreamMessage) => entry.subscribers.forEach((fn) => fn(m));

  /** 实时推送用的回调：事件进缓存并推给订阅者，文字增量只推送 */
  function liveCallbacks(entry: Entry): Pick<SessionOptions, "onEvent" | "onDelta"> {
    return {
      onEvent: (event) => {
        entry.events.push(event);
        publish(entry, { kind: "event", event });
      },
      onDelta: (d) => publish(entry, { kind: "delta", ...d }),
    };
  }

  /** 挂起一个请求，通过 SSE 推给界面；超时、停止或用户决定时收尾 */
  function webApprover(entry: Entry): Approver {
    return (req, signal) =>
      new Promise<ApprovalAnswer>((resolve) => {
        const lang = entry.lang;
        const finish = (answer: ApprovalAnswer) => {
          const pending = entry.pending.get(req.toolCallId);
          if (!pending) return; // 已经被别的路径处理过
          clearTimeout(pending.timer);
          signal?.removeEventListener("abort", onAbort);
          entry.pending.delete(req.toolCallId);
          publish(entry, { kind: "approval_resolved", toolCallId: req.toolCallId });
          resolve(answer);
        };
        const onAbort = () => finish({ approved: false, reason: ABORTED_REASON[lang], by: "aborted" });
        if (signal?.aborted) {
          resolve({ approved: false, reason: ABORTED_REASON[lang], by: "aborted" });
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(
          () => finish({ approved: false, reason: TIMEOUT_REASON[lang], by: "timeout" }),
          opts.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
        );
        entry.pending.set(req.toolCallId, { request: req, resolve: finish, timer });
        publish(entry, { kind: "approval", request: req });
      });
  }

  /** 运行结束时清理还挂着的请求，避免 Promise 永远悬着 */
  function clearPending(entry: Entry) {
    for (const pending of [...entry.pending.values()]) {
      pending.resolve({ approved: false, reason: ABORTED_REASON[entry.lang], by: "aborted" });
    }
  }

  function track(entry: Entry, run: Promise<unknown>) {
    publish(entry, { kind: "status", running: true });
    run.catch(() => undefined).finally(() => {
      clearPending(entry);
      publish(entry, { kind: "status", running: false });
    });
  }

  function summarize(id: string, events: SeamEvent[]): SessionSummary | undefined {
    const start = events.find((e) => e.type === "session_start");
    if (start?.type !== "session_start") return undefined;
    const end = events.findLast((e) => e.type === "session_end");
    return {
      id,
      task: start.data.task,
      provider: start.data.model.provider,
      model: start.data.model.id,
      startedAt: start.ts,
      status: entries.get(id)?.session?.isRunning()
        ? "running"
        : end?.type === "session_end"
          ? end.data.reason
          : "unknown",
    };
  }

  function listSessions(): SessionSummary[] {
    if (!existsSync(opts.logDir)) return [];
    return readdirSync(opts.logDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const id = f.slice(0, -".jsonl".length);
        try {
          return summarize(id, entries.get(id)?.events ?? readLog(join(opts.logDir, f)));
        } catch {
          return undefined; // 损坏的日志不影响列表
        }
      })
      .filter((s): s is SessionSummary => s !== undefined)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /** 最近用过的工作区：从日志里按时间倒序取，去重，只保留仍然存在的文件夹 */
  function recentWorkspaces(): string[] {
    const seen = new Set<string>();
    for (const s of listSessions()) {
      const events = entries.get(s.id)?.events ?? readLog(join(opts.logDir, `${s.id}.jsonl`));
      const start = events.find((e) => e.type === "session_start");
      const ws = start?.type === "session_start" ? start.data.workspace : undefined;
      if (ws && !seen.has(ws) && existsSync(ws)) seen.add(ws);
      if (seen.size >= RECENT_WORKSPACES) break;
    }
    return [...seen];
  }

  /** 会话工作区里的文件列表，给阅读覆盖图用；文件太多时截断 */
  async function workspaceFiles(id: string): Promise<Response> {
    const e = entryOf(id);
    if (!e) return fail(404, "Session not found.");
    const start = e.events.find((ev) => ev.type === "session_start");
    const ws = start?.type === "session_start" ? start.data.workspace : undefined;
    if (!ws || !existsSync(ws)) return fail(404, "The workspace folder no longer exists.");
    return json(await listWorkspaceFiles(ws, MAX_LISTED_FILES));
  }

  async function pickFolder(req: Request): Promise<Response> {
    if (!opts.pickFolder) return fail(501, "Choosing a folder is not available here.");
    const body = (await req.json().catch(() => ({}))) as { lang?: Lang; current?: string };
    try {
      const path = await opts.pickFolder({ prompt: PICK_PROMPT[body.lang === "zh" ? "zh" : "en"], defaultPath: body.current });
      return json(path ? { path } : { cancelled: true });
    } catch (err) {
      return fail(500, (err as Error).message);
    }
  }

  async function createSession(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as {
      task?: string;
      provider?: ProviderName;
      model?: string;
      workspace?: string;
      lang?: Lang;
    };
    const task = body.task?.trim();
    if (!task) return fail(400, "Task is empty.");
    const workspace = body.workspace?.trim() || opts.defaultWorkspace;
    if (!existsSync(workspace) || !statSync(workspace).isDirectory()) return fail(400, "Workspace is not a folder.");
    const lang: Lang = body.lang === "zh" ? "zh" : "en";

    let resolved;
    try {
      resolved = opts.resolveModel(body.provider ?? "anthropic", body.model || undefined);
    } catch (err) {
      return fail(400, (err as Error).message);
    }

    // session_start 在 startSession 内部就会写入，所以先准备好缓存，再登记 sessionId
    const entry: Entry = { events: [], subscribers: new Set(), lang, pending: new Map() };
    const handle = startSession({
      task,
      workspace,
      ...resolved,
      lang,
      logDir: opts.logDir,
      approve: webApprover(entry),
      ...liveCallbacks(entry),
    });
    entry.session = handle;
    entries.set(handle.sessionId, entry);
    track(entry, handle.done);
    return json({ sessionId: handle.sessionId });
  }

  async function sendMessage(id: string, req: Request): Promise<Response> {
    const entry = entryOf(id);
    if (!entry) return fail(404, "Session not found.");
    if (entry.session?.isRunning()) return fail(409, "The session is still running.");
    const body = (await req.json().catch(() => ({}))) as { text?: string };
    const text = body.text?.trim();
    if (!text) return fail(400, "Message is empty.");

    if (!entry.session) {
      // 服务重启后第一次追问：从日志恢复对话历史
      const start = entry.events.find((e) => e.type === "session_start");
      if (start?.type !== "session_start") return fail(400, "The log has no session_start event.");
      let resolved;
      try {
        resolved = opts.resolveModel(start.data.model.provider as ProviderName, start.data.model.id);
      } catch (err) {
        return fail(400, (err as Error).message);
      }
      const lang = start.data.lang ?? "en";
      entry.session = resumeSession(logPath(id)!, {
        ...resolved,
        lang,
        approve: webApprover(entry),
        ...liveCallbacks(entry),
      });
    }
    track(entry, entry.session.send(text));
    return json({ ok: true });
  }

  /** 用户对挂起请求的决定：批准（计划可带修改后的步骤）或拒绝（可带理由） */
  async function respondApproval(id: string, toolCallId: string, req: Request): Promise<Response> {
    const entry = entryOf(id);
    if (!entry) return fail(404, "Session not found.");
    const pending = entry.pending.get(toolCallId);
    if (!pending) return fail(404, "No pending approval.");
    const body = (await req.json().catch(() => ({}))) as { decision?: string; reason?: string; steps?: unknown };

    if (body.decision === "deny") {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      pending.resolve({ approved: false, reason: reason || DENIED_REASON[entry.lang], by: "user" });
      return json({ ok: true });
    }
    if (body.decision !== "allow") return fail(400, "Decision must be allow or deny.");

    if (pending.request.preview?.kind === "plan") {
      const steps = Array.isArray(body.steps)
        ? body.steps.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
        : undefined;
      if (steps && steps.length === 0) return fail(400, "A plan needs at least one step.");
      pending.resolve(steps ? { approved: true, steps } : true);
    } else {
      pending.resolve(true);
    }
    return json({ ok: true });
  }

  /** 删除会话：把日志移到回收站，不真删。运行中的会话（包括等待确认的）不能删 */
  function deleteSession(id: string): Response {
    const path = logPath(id);
    if (!path) return fail(404, "Session not found.");
    if (entries.get(id)?.session?.isRunning()) return fail(409, "The session is still running.");
    mkdirSync(opts.trashDir, { recursive: true });
    const target = join(opts.trashDir, `${id}.jsonl`);
    renameSync(path, target);
    const now = new Date();
    utimesSync(target, now, now);
    entries.delete(id);
    return json({ ok: true });
  }

  /** SSE：先补发已有事件和当前状态，之后持续推送 */
  function stream(id: string): Response {
    const entry = entryOf(id);
    if (!entry) return fail(404, "Session not found.");

    let unsubscribe = () => {};
    const body = new ReadableStream<string>({
      start(controller) {
        const send = (m: StreamMessage) => {
          try {
            controller.enqueue(`data: ${JSON.stringify(m)}\n\n`);
          } catch {
            unsubscribe();
          }
        };
        entry.events.forEach((event) => send({ kind: "event", event }));
        send({ kind: "status", running: entry.session?.isRunning() ?? false });
        // 重连时补发还挂着的请求，用户刷新页面不会丢掉确认框
        entry.pending.forEach((p) => send({ kind: "approval", request: p.request }));
        entry.subscribers.add(send);
        unsubscribe = () => entry.subscribers.delete(send);
      },
      cancel() {
        unsubscribe();
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  // ---- 入口：校验令牌后写 Cookie，再跳转到界面 ----
  function entry(req: Request): Response {
    if (!allowedHosts().includes(req.headers.get("host") ?? "")) return fail(403, "Unexpected Host header.");
    const token = new URL(req.url).searchParams.get("token");
    if (token && safeEqual(token, opts.token)) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/app",
          "set-cookie": `${COOKIE}=${opts.token}; HttpOnly; SameSite=Strict; Path=/`,
        },
      });
    }
    const existing = cookieValue(req, COOKIE);
    if (existing && safeEqual(existing, opts.token)) return Response.redirect("/app", 302);
    return new Response("Open Seam with the link printed in the terminal.", { status: 401 });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    idleTimeout: 0, // SSE 连接可能长时间没有数据
    development: opts.development ?? false,
    routes: {
      "/": entry,
      "/app": (opts.app as Response | undefined) ?? new Response("The web UI is not bundled.", { status: 404 }),
      "/api/config": {
        GET: api(() =>
          json({
            defaultWorkspace: opts.defaultWorkspace,
            providers: opts.availableProviders(),
            canPickFolder: Boolean(opts.pickFolder),
          }),
        ),
      },
      "/api/workspaces": { GET: api(() => json(recentWorkspaces())) },
      "/api/pick-folder": { POST: api(pickFolder) },
      "/api/sessions": {
        GET: api(() => json(listSessions())),
        POST: api(createSession),
      },
      "/api/sessions/:id": { DELETE: api((req) => deleteSession(req.params.id!)) },
      "/api/sessions/:id/events": {
        GET: api((req) => {
          const e = entryOf(req.params.id!);
          return e ? json(e.events) : fail(404, "Session not found.");
        }),
      },
      "/api/sessions/:id/files": { GET: api((req) => workspaceFiles(req.params.id!)) },
      "/api/sessions/:id/stream": { GET: api((req) => stream(req.params.id!)) },
      "/api/sessions/:id/messages": { POST: api((req) => sendMessage(req.params.id!, req)) },
      "/api/sessions/:id/approvals/:toolCallId": {
        POST: api((req) => respondApproval(req.params.id!, req.params.toolCallId!, req)),
      },
      "/api/sessions/:id/stop": {
        POST: api((req) => {
          const session = entries.get(req.params.id!)?.session;
          if (!session?.isRunning()) return fail(404, "Session is not running.");
          session.abort();
          return json({ ok: true });
        }),
      },
    },
    fetch: () => fail(404, "Not found."),
  });

  return server;
}
