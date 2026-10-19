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
    availableProviders: () => ["anthropic"],
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
    const start = await fetch(
      `${base}/api/sessions`,
      authed({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "Find banana", lang: "zh" }) }),
    );
    expect(start.status).toBe(200);
    const { sessionId } = (await start.json()) as { sessionId: string };

    // SSE：读到 end 为止
    const res = await fetch(`${base}/api/sessions/${sessionId}/stream`, authed());
    const text = await res.text();
    const messages = text
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)));
    expect(messages.at(-1)).toEqual({ kind: "end" });
    const events = messages.filter((m) => m.kind === "event").map((m) => m.event as SeamEvent);
    expect(events[0]!.type).toBe("session_start");
    expect(events.at(-1)!.type).toBe("session_end");

    // 写文件被自动拒绝，理由用界面语言交给模型
    const denied = events.find((e) => e.type === "permission" && e.data.decision === "deny");
    expect(denied?.type === "permission" && denied.data.reason).toContain("写文件");

    // 系统提示词使用中文
    const first = events[0]!;
    expect(first.type === "session_start" && first.data.systemPrompt).toContain("工作区根目录");

    const list = (await (await fetch(`${base}/api/sessions`, authed())).json()) as { id: string; status: string }[];
    expect(list.find((s) => s.id === sessionId)?.status).toBe("completed");

    // 结束后从日志重新读取，内容与实时推送的一致
    const reloaded = (await (await fetch(`${base}/api/sessions/${sessionId}/events`, authed())).json()) as SeamEvent[];
    expect(reloaded).toEqual(events);
  });

  test("rejects an empty task and a missing workspace", async () => {
    const post = (body: object) =>
      fetch(`${base}/api/sessions`, authed({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await post({ task: "  " })).status).toBe(400);
    expect((await post({ task: "x", workspace: "/no/such/folder" })).status).toBe(400);
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
