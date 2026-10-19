// 本地 Web 服务：安全校验、会话 API 和事件流。模型用本地模拟的 Anthropic 服务器。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server/server";
import { eventsAtStep, replaySteps } from "../src/web/replay-steps";
import type { SeamEvent } from "../src/events";
import { startMockAnthropic } from "./mock-anthropic";

const TOKEN = "test-token-123";
let ws: string;
let logDir: string;
let mock: ReturnType<typeof startMockAnthropic>;
let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "seam-ws-"));
  logDir = mkdtempSync(join(tmpdir(), "seam-logs-"));
  writeFileSync(join(ws, "a.txt"), "banana\n");
  mock = startMockAnthropic([
    { toolUse: { id: "t1", name: "read_file", input: { path: "a.txt", intent: "look for banana" } } },
    { toolUse: { id: "t2", name: "write_file", input: { path: "b.txt", content: "x", intent: "save" } } },
    { text: "a.txt mentions banana." },
  ]);
  server = createServer({
    port: 0,
    token: TOKEN,
    logDir,
    defaultWorkspace: ws,
    resolveModel: () => ({ model: mock.model, apiKey: "test-key" }),
    availableProviders: () => [{ name: "anthropic", models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" }],
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  mock.stop();
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { cookie: `seam_token=${TOKEN}`, origin: base, ...(init.headers ?? {}) },
});

const postJson = (path: string, body: object) =>
  fetch(`${base}${path}`, authed({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/** 读事件流，直到收到第 runs 次“空闲”状态为止（流本身不会关闭） */
async function readStream(id: string, runs = 1) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/sessions/${id}/stream`, authed({ signal: controller.signal }));
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const messages: any[] = [];
  let buffer = "";
  let ended = 0;
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop()!;
    for (const chunk of chunks) {
      if (!chunk.startsWith("data: ")) continue;
      const m = JSON.parse(chunk.slice(6));
      messages.push(m);
      if (m.kind === "event" && m.event.type === "session_end") ended++;
      // 收到足够多次运行结束后的“空闲”状态就停止读取
      if (m.kind === "status" && !m.running && ended >= runs) finished = true;
    }
  }
  controller.abort();
  return messages;
}

describe("security", () => {
  test("the entry link sets an HttpOnly, SameSite=Strict cookie only with the right token", async () => {
    const ok = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
    const bad = await fetch(`${base}/?token=wrong`, { redirect: "manual" });
    expect(bad.status).toBe(401);
  });

  test("API calls without the cookie are rejected", async () => {
    expect((await fetch(`${base}/api/sessions`)).status).toBe(401);
    expect((await fetch(`${base}/api/sessions`, { headers: { cookie: "seam_token=wrong" } })).status).toBe(401);
  });

  test("writes from another origin are rejected even with the cookie", async () => {
    const res = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { cookie: `seam_token=${TOKEN}`, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ task: "x" }),
    });
    expect(res.status).toBe(403);
  });

  test("an unexpected Host header is rejected", async () => {
    const res = await fetch(`${base}/api/sessions`, authed({ headers: { host: "evil.example" } }));
    expect(res.status).toBe(403);
  });

  test("session ids cannot escape the log folder", async () => {
    const res = await fetch(`${base}/api/sessions/..%2F..%2Fetc/events`, authed());
    expect(res.status).toBe(404);
  });
});

describe("sessions", () => {
  test("start a task, stream it to the end, then list and reload it", async () => {
    const start = await postJson("/api/sessions", { task: "Find banana", lang: "zh" });
    expect(start.status).toBe(200);
    const { sessionId } = (await start.json()) as { sessionId: string };

    const messages = await readStream(sessionId);
    expect(messages.at(-1)).toEqual({ kind: "status", running: false });
    const events = messages.filter((m) => m.kind === "event").map((m) => m.event as SeamEvent);
    expect(events[0]!.type).toBe("session_start");
    expect(events.at(-1)!.type).toBe("session_end");

    // 没有批准的计划，写文件被 harness 拦下，理由用界面语言交给模型
    const denied = events.find((e) => e.type === "permission" && e.data.decision === "deny");
    expect(denied?.type === "permission" && denied.data.code).toBe("plan_required");
    expect(denied?.type === "permission" && denied.data.reason).toContain("计划");

    // 系统提示词使用中文
    const first = events[0]!;
    expect(first.type === "session_start" && first.data.systemPrompt).toContain("工作区根目录");

    const list = (await (await fetch(`${base}/api/sessions`, authed())).json()) as { id: string; status: string }[];
    expect(list.find((s) => s.id === sessionId)?.status).toBe("completed");

    // 结束后从日志重新读取，内容与实时推送的一致
    const reloaded = (await (await fetch(`${base}/api/sessions/${sessionId}/events`, authed())).json()) as SeamEvent[];
    expect(reloaded).toEqual(events);
  });

  test("a new session can use a specific model", async () => {
    const asked: (string | undefined)[] = [];
    const replies = startMockAnthropic([{ text: "ok" }]);
    const srv = createServer({
      port: 0,
      token: TOKEN,
      logDir,
      defaultWorkspace: ws,
      resolveModel: (_provider, modelId) => {
        asked.push(modelId);
        if (modelId === "no-such-model") throw new Error("Model not found");
        return { model: replies.model, apiKey: "test-key" };
      },
      availableProviders: () => [{ name: "anthropic", models: ["claude-haiku-5-5"], defaultModel: "claude-haiku-5-5" }],
    });
    const url = `http://127.0.0.1:${srv.port}`;
    const post = (body: object) =>
      fetch(`${url}/api/sessions`, {
        method: "POST",
        headers: { cookie: `seam_token=${TOKEN}`, origin: url, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      expect((await post({ task: "x", provider: "anthropic", model: "claude-haiku-5-5" })).status).toBe(200);
      expect((await post({ task: "x", provider: "anthropic", model: "no-such-model" })).status).toBe(400);
      expect(asked).toEqual(["claude-haiku-5-5", "no-such-model"]);
    } finally {
      srv.stop(true);
      replies.stop();
    }
  });

  test("rejects an empty task and a missing workspace", async () => {
    expect((await postJson("/api/sessions", { task: "  " })).status).toBe(400);
    expect((await postJson("/api/sessions", { task: "x", workspace: "/no/such/folder" })).status).toBe(400);
  });

  test("follow-up messages continue the session, also after a server restart", async () => {
    const replies = startMockAnthropic([{ text: "one" }, { text: "two" }, { text: "three" }]);
    const make = () =>
      createServer({
        port: 0,
        token: TOKEN,
        logDir,
        defaultWorkspace: ws,
        resolveModel: () => ({ model: replies.model, apiKey: "test-key" }),
        availableProviders: () => [{ name: "anthropic", models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" }],
      });
    let srv = make();
    const url = () => `http://127.0.0.1:${srv.port}`;
    const post = (path: string, body: object) =>
      fetch(`${url()}${path}`, {
        method: "POST",
        headers: { cookie: `seam_token=${TOKEN}`, origin: url(), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const events = async (id: string) =>
      (await (await fetch(`${url()}/api/sessions/${id}/events`, { headers: { cookie: `seam_token=${TOKEN}` } })).json()) as SeamEvent[];
    const waitForRuns = async (id: string, n: number) => {
      for (let i = 0; i < 100; i++) {
        if ((await events(id)).filter((e) => e.type === "session_end").length >= n) return;
        await Bun.sleep(20);
      }
      throw new Error("timed out");
    };

    try {
      const { sessionId } = (await (await post("/api/sessions", { task: "first" })).json()) as { sessionId: string };
      await waitForRuns(sessionId, 1);

      expect((await post(`/api/sessions/${sessionId}/messages`, { text: "second" })).status).toBe(200);
      // 运行中再发会被拒绝
      expect((await post(`/api/sessions/${sessionId}/messages`, { text: "too early" })).status).toBe(409);
      await waitForRuns(sessionId, 2);

      // 重启服务：新实例只能从日志恢复
      srv.stop(true);
      srv = make();
      expect((await post(`/api/sessions/${sessionId}/messages`, { text: "third" })).status).toBe(200);
      await waitForRuns(sessionId, 3);

      const all = await events(sessionId);
      const answers = all.flatMap((e) =>
        e.type === "assistant_message" ? (e.data.content as { text?: string }[]).map((c) => c.text) : [],
      );
      expect(answers).toEqual(["one", "two", "three"]);
      expect(JSON.stringify(replies.received[2])).toContain("two"); // 恢复后带着前文
    } finally {
      srv.stop(true);
      replies.stop();
    }
  });

  test("the web interface approves a plan and a write through the stream", async () => {
    const replies = startMockAnthropic([
      { toolUse: { id: "p1", name: "propose_plan", input: { steps: ["保存 b.txt"], intent: "先说明计划" } } },
      { toolUse: { id: "w1", name: "write_file", input: { path: "b.txt", content: "hi from test", intent: "保存" } } },
      { text: "已保存。" },
    ]);
    const srv = createServer({
      port: 0,
      token: TOKEN,
      logDir,
      defaultWorkspace: ws,
      resolveModel: () => ({ model: replies.model, apiKey: "test-key" }),
      availableProviders: () => [{ name: "anthropic", models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" }],
    });
    const url = `http://127.0.0.1:${srv.port}`;
    const post = (path: string, body: object) =>
      fetch(`${url}${path}`, {
        method: "POST",
        headers: { cookie: `seam_token=${TOKEN}`, origin: url, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      const start = await post("/api/sessions", { task: "把结果写进 b.txt", provider: "anthropic", lang: "zh" });
      const { sessionId } = (await start.json()) as { sessionId: string };

      const controller = new AbortController();
      const res = await fetch(`${url}/api/sessions/${sessionId}/stream`, {
        headers: { cookie: `seam_token=${TOKEN}` },
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const approvals: { kind: string; toolCallId: string }[] = [];
      let ended = false;
      while (!ended) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop()!;
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          const m = JSON.parse(chunk.slice(6));
          if (m.kind === "approval") {
            approvals.push({ kind: m.request.preview.kind, toolCallId: m.request.toolCallId });
            const body =
              m.request.preview.kind === "plan"
                ? { decision: "allow", steps: ["保存 b.txt（用户修改）"] }
                : { decision: "allow" };
            const answer = await post(`/api/sessions/${sessionId}/approvals/${m.request.toolCallId}`, body);
            expect(answer.status).toBe(200);
          }
          if (m.kind === "status" && !m.running) ended = true;
        }
      }
      controller.abort();

      expect(approvals.map((a) => a.kind)).toEqual(["plan", "write_file"]);
      expect(await Bun.file(join(ws, "b.txt")).text()).toBe("hi from test");

      const events = (await (
        await fetch(`${url}/api/sessions/${sessionId}/events`, { headers: { cookie: `seam_token=${TOKEN}` } })
      ).json()) as SeamEvent[];
      // 修改后的计划进入日志，也就进入了下一次请求
      expect(JSON.stringify(events)).toContain("保存 b.txt（用户修改）");
      const planResult = events.find((e) => e.type === "tool_result" && e.data.name === "propose_plan");
      expect(planResult?.type === "tool_result" && planResult.data.details).toMatchObject({
        steps: ["保存 b.txt（用户修改）"],
        edited: true,
      });

      // 已经处理过的请求不能再次提交
      const again = await post(`/api/sessions/${sessionId}/approvals/${approvals[0]!.toolCallId}`, { decision: "deny" });
      expect(again.status).toBe(404);
    } finally {
      srv.stop(true);
      replies.stop();
      rmSync(join(ws, "b.txt"), { force: true });
    }
  });
  test("a pending approval times out", async () => {
    const replies = startMockAnthropic([
      { toolUse: { id: "p1", name: "propose_plan", input: { steps: ["写 b.txt"], intent: "plan" } } },
      { text: "我先不动手。" },
    ]);
    const srv = createServer({
      port: 0,
      token: TOKEN,
      logDir,
      defaultWorkspace: ws,
      resolveModel: () => ({ model: replies.model, apiKey: "test-key" }),
      availableProviders: () => [{ name: "anthropic", models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" }],
      approvalTimeoutMs: 50,
    });
    const url = `http://127.0.0.1:${srv.port}`;
    const events = async (id: string) =>
      (await (
        await fetch(`${url}/api/sessions/${id}/events`, { headers: { cookie: `seam_token=${TOKEN}` } })
      ).json()) as SeamEvent[];
    try {
      const res = await fetch(`${url}/api/sessions`, {
        method: "POST",
        headers: { cookie: `seam_token=${TOKEN}`, origin: url, "content-type": "application/json" },
        body: JSON.stringify({ task: "timeout", provider: "anthropic", lang: "zh" }),
      });
      const { sessionId } = (await res.json()) as { sessionId: string };
      let all: SeamEvent[] = [];
      for (let i = 0; i < 200; i++) {
        all = await events(sessionId);
        if (all.some((e) => e.type === "session_end")) break;
        await Bun.sleep(20);
      }
      const denied = all.find(
        (e) => e.type === "permission" && e.data.name === "propose_plan" && e.data.decision === "deny",
      );
      expect(denied?.type === "permission" && denied.data.by).toBe("timeout");
      expect(denied?.type === "permission" && denied.data.reason).toContain("10 分钟");
      expect(all.find((e) => e.type === "session_end")).toBeDefined();
    } finally {
      srv.stop(true);
      replies.stop();
    }
  });
});

describe("replay steps", () => {
  test("silent events do not become steps, and each step shows events up to it", () => {
    const ev = (type: string) => ({ type }) as SeamEvent;
    const events = [ev("session_start"), ev("turn_start"), ev("http_request"), ev("http_response"), ev("turn_end"), ev("session_end")];
    const steps = replaySteps(events);
    expect(steps).toEqual([0, 1, 2, 5]);
    expect(eventsAtStep(events, steps, 2).map((e) => e.type)).toEqual(["session_start", "turn_start", "http_request"]);
    expect(eventsAtStep(events, steps, 99)).toHaveLength(6);
  });
});

describe("workspaces", () => {
  test("recent workspaces come from session logs, newest first, without duplicates", async () => {
    const res = await fetch(`${base}/api/workspaces`, authed());
    const list = (await res.json()) as string[];
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list).size).toBe(list.length);
  });

  test("the folder picker returns the chosen path, or nothing when cancelled", async () => {
    const picks: (string | null)[] = ["/tmp/chosen", null];
    const prompts: string[] = [];
    const srv = createServer({
      port: 0,
      token: TOKEN,
      logDir,
      defaultWorkspace: ws,
      resolveModel: () => ({ model: mock.model, apiKey: "test-key" }),
      availableProviders: () => [{ name: "anthropic", models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" }],
      pickFolder: async ({ prompt }) => {
        prompts.push(prompt);
        return picks.shift() ?? null;
      },
    });
    const url = `http://127.0.0.1:${srv.port}`;
    const pick = (headers: Record<string, string> = {}) =>
      fetch(`${url}/api/pick-folder`, {
        method: "POST",
        headers: { cookie: `seam_token=${TOKEN}`, origin: url, "content-type": "application/json", ...headers },
        body: JSON.stringify({ lang: "zh", current: ws }),
      });
    try {
      const config = (await (await fetch(`${url}/api/config`, { headers: { cookie: `seam_token=${TOKEN}` } })).json()) as {
        canPickFolder: boolean;
      };
      expect(config.canPickFolder).toBe(true);
      expect(await (await pick()).json()).toEqual({ path: "/tmp/chosen" });
      expect(await (await pick()).json()).toEqual({ cancelled: true });
      expect(prompts[0]).toContain("工作区"); // 对话框标题使用界面语言
      // 其他网页不能替用户弹出对话框
      expect((await pick({ origin: "https://evil.example" })).status).toBe(403);
    } finally {
      srv.stop(true);
    }
  });

  test("without a folder picker the endpoint says it is unavailable", async () => {
    const res = await fetch(`${base}/api/pick-folder`, authed({ method: "POST" }));
    expect(res.status).toBe(501);
  });
});
