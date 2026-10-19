// Seam 的本地 Web 服务：会话 API + 事件推送（SSE）。
// 这个服务能让 agent 读文件、跑命令，所以必须防止别的网页借浏览器向它发请求：
//   - 只监听 127.0.0.1
//   - 启动时生成随机令牌；打开带令牌的链接后写入 SameSite=Strict 的 Cookie，所有 API 都要校验
//   - 校验 Host 请求头（防 DNS 重绑定），写操作再校验 Origin 请求头
import type { Api, Model } from "@earendil-works/pi-ai";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SeamEvent } from "../events";
import { readLog } from "../log";
import type { ProviderName } from "../models";
import { startSession, type Lang, type SessionHandle } from "../session";

export interface ServerOptions {
  port: number;
  token: string;
  logDir: string;
  /** 新建任务时工作区输入框的默认值 */
  defaultWorkspace: string;
  resolveModel: (provider: ProviderName) => { model: Model<Api>; apiKey: string };
  availableProviders: () => ProviderName[];
  /** 前端页面（Bun 的 HTML 导入）；测试时可以不传 */
  app?: unknown;
  development?: boolean;
}

export interface SessionSummary {
  id: string;
  task: string;
  provider: string;
  model: string;
  startedAt: number;
  status: "running" | "completed" | "error" | "aborted" | "max_turns" | "unknown";
}

type StreamMessage = { kind: "event"; event: SeamEvent } | { kind: "delta"; turn: number; text: string } | { kind: "end" };

interface LiveSession {
  handle: SessionHandle;
  events: SeamEvent[];
  subscribers: Set<(m: StreamMessage) => void>;
}

const COOKIE = "seam_token";

const DENY_REASON: Record<Lang, string> = {
  en: "This version of the interface cannot ask the user for approval yet, so writing files and running commands are denied. Continue without them.",
  zh: "当前版本的界面还不能向用户请求批准，所以写文件和执行命令都会被拒绝。请在不使用它们的情况下继续。",
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

export function createServer(opts: ServerOptions) {
  const live = new Map<string, LiveSession>();

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

  function summarize(id: string, events: SeamEvent[]): SessionSummary | undefined {
    const start = events.find((e) => e.type === "session_start");
    if (!start || start.type !== "session_start") return undefined;
    const end = events.findLast((e) => e.type === "session_end");
    return {
      id,
      task: start.data.task,
      provider: start.data.model.provider,
      model: start.data.model.id,
      startedAt: start.ts,
      status: live.has(id) ? "running" : end?.type === "session_end" ? end.data.reason : "unknown",
    };
  }

  function listSessions(): SessionSummary[] {
    if (!existsSync(opts.logDir)) return [];
    return readdirSync(opts.logDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const id = f.slice(0, -".jsonl".length);
        try {
          return summarize(id, readLog(join(opts.logDir, f)));
        } catch {
          return undefined; // 损坏的日志不影响列表
        }
      })
      .filter((s): s is SessionSummary => s !== undefined)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async function createSession(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as {
      task?: string;
      provider?: ProviderName;
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
      resolved = opts.resolveModel(body.provider ?? "anthropic");
    } catch (err) {
      return fail(400, (err as Error).message);
    }

    const session: LiveSession = { handle: undefined as unknown as SessionHandle, events: [], subscribers: new Set() };
    const publish = (m: StreamMessage) => session.subscribers.forEach((fn) => fn(m));
    session.handle = startSession({
      task,
      workspace,
      ...resolved,
      lang,
      logDir: opts.logDir,
      // M2 还没有确认框：写入和执行命令一律拒绝，并把理由交给模型
      approve: async () => ({ approved: false, reason: DENY_REASON[lang] }),
      onEvent: (event) => {
        session.events.push(event);
        publish({ kind: "event", event });
      },
      onDelta: (d) => publish({ kind: "delta", ...d }),
    });
    live.set(session.handle.sessionId, session);
    session.handle.done
      .catch(() => undefined)
      .finally(() => {
        publish({ kind: "end" });
        live.delete(session.handle.sessionId);
      });
    return json({ sessionId: session.handle.sessionId });
  }

  /** SSE：先补发已有事件，运行中的会话再持续推送，结束时发 end */
  function stream(id: string): Response {
    const running = live.get(id);
    const path = logPath(id);
    if (!running && !path) return fail(404, "Session not found.");

    let unsubscribe = () => {};
    const body = new ReadableStream<string>({
      start(controller) {
        const send = (m: StreamMessage) => {
          try {
            controller.enqueue(`data: ${JSON.stringify(m)}\n\n`);
            if (m.kind === "end") controller.close();
          } catch {
            unsubscribe();
          }
        };
        if (running) {
          running.events.forEach((event) => send({ kind: "event", event }));
          running.subscribers.add(send);
          unsubscribe = () => running.subscribers.delete(send);
        } else {
          readLog(path!).forEach((event) => send({ kind: "event", event }));
          send({ kind: "end" });
        }
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
          json({ defaultWorkspace: opts.defaultWorkspace, providers: opts.availableProviders() }),
        ),
      },
      "/api/sessions": {
        GET: api(() => json(listSessions())),
        POST: api(createSession),
      },
      "/api/sessions/:id/events": {
        GET: api((req) => {
          const path = logPath(req.params.id!);
          return path ? json(readLog(path)) : fail(404, "Session not found.");
        }),
      },
      "/api/sessions/:id/stream": { GET: api((req) => stream(req.params.id!)) },
      "/api/sessions/:id/stop": {
        POST: api((req) => {
          const running = live.get(req.params.id!);
          if (!running) return fail(404, "Session is not running.");
          running.handle.abort();
          return json({ ok: true });
        }),
      },
    },
    fetch: () => fail(404, "Not found."),
  });

  return server;
}
