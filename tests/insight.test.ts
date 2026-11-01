// 任务地图和阅读覆盖只从日志推导：单元测试 + 一次真实运行的端到端核对。
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SeamEvent } from "../src/events";
import { coverageAtRun, listRuns, readCoverage, readRuns, taskMap } from "../src/insight";
import { readLog } from "../src/log";
import { runSession } from "../src/session";
import { startMockAnthropic } from "./mock-anthropic";

let seq = 0;
const ev = (type: string, data: unknown, source = "harness") =>
  ({ v: 1, seq: ++seq, ts: 0, sessionId: "s", turn: 1, type, source, data }) as SeamEvent;

const call = (id: string, name: string, args: Record<string, unknown>) => ev("tool_call", { toolCallId: id, name, args }, "model");
const allow = (id: string, name: string) => ev("permission", { toolCallId: id, name, decision: "allow", by: "auto" });
const deny = (id: string, name: string) => ev("permission", { toolCallId: id, name, decision: "deny", by: "user" });
const result = (id: string, name: string, details?: unknown, isError = false) =>
  ev("tool_result", { toolCallId: id, name, content: [], details, isError });
const read = (id: string, path: string, from: number, to: number, total: number) => [
  call(id, "read_file", { path, step: 0 }),
  allow(id, "read_file"),
  result(id, "read_file", { path, from, to, total }),
];
const plan = (id: string, steps: string[], edited = false) => [
  call(id, "propose_plan", { steps }),
  allow(id, "propose_plan"),
  result(id, "propose_plan", { steps, edited }),
];

test("no task map until a plan is approved", () => {
  expect(taskMap([...read("r1", "a.txt", 1, 1, 1)])).toBeUndefined();
  // 被拒绝的计划不算
  expect(
    taskMap([call("p1", "propose_plan", { steps: ["x"] }), deny("p1", "propose_plan"), result("p1", "propose_plan", undefined, true)]),
  ).toBeUndefined();
});

test("the current step follows the step the model reports on each call", () => {
  const events = [
    ...plan("p1", ["Read a", "Write b", "Check"], true),
    call("c1", "read_file", { path: "a.txt", step: 1 }),
    allow("c1", "read_file"),
    result("c1", "read_file", { path: "a.txt", from: 1, to: 1, total: 1 }),
    call("c2", "write_file", { path: "b.txt", step: 2 }),
  ];
  const map = taskMap(events)!;
  expect(map.edited).toBe(true);
  expect(map.steps.map((s) => s.status)).toEqual(["done", "current", "pending"]);
  expect(map.steps[0]!.calls).toMatchObject([{ name: "read_file", keyArg: "a.txt", outcome: "ok" }]);
  expect(map.steps[1]!.calls).toMatchObject([{ name: "write_file", outcome: "running" }]);
  expect(map.ended).toBe(false);

  // 运行结束后，当前步算完成，没走到的步骤仍然未开始
  const ended = taskMap([...events, deny("c2", "write_file"), ev("session_end", { reason: "completed", durationMs: 1 })])!;
  expect(ended.ended).toBe(true);
  expect(ended.steps.map((s) => s.status)).toEqual(["done", "done", "pending"]);
  expect(ended.steps[1]!.calls[0]!.outcome).toBe("denied");
});

test("calls the model reports as outside the plan are listed as off-plan", () => {
  const map = taskMap([
    ...plan("p1", ["Write b"]),
    call("c1", "run_command", { command: "ls", step: 0 }),
    call("c2", "write_file", { path: "b.txt", step: 5 }),
    call("c3", "search", { pattern: "x" }),
  ])!;
  expect(map.offPlan.map((c) => [c.name, c.step])).toEqual([
    ["run_command", 0],
    ["write_file", 5],
    ["search", undefined],
  ]);
  expect(map.steps[0]!.status).toBe("pending");
});

test("a follow-up message starts without a plan, since plans are approved per run", () => {
  const events = [...plan("p1", ["Write b"]), ev("session_end", { reason: "completed", durationMs: 1 })];
  expect(taskMap(events)).toBeDefined();
  expect(taskMap([...events, ev("user_message", { content: "next" }, "user"), call("c1", "read_file", { path: "a", step: 0 })])).toBeUndefined();
});

test("a newer plan replaces the older one", () => {
  const map = taskMap([...plan("p1", ["Old"]), call("c1", "read_file", { path: "a", step: 1 }), ...plan("p2", ["New 1", "New 2"])])!;
  expect(map.steps.map((s) => s.text)).toEqual(["New 1", "New 2"]);
  expect(map.steps.every((s) => s.status === "pending")).toBe(true);
});

test("read coverage merges line ranges and ignores failed reads", () => {
  const cov = readCoverage([
    ev("session_start", { task: "t", workspace: "/w", workspaceNote: { path: "SEAM.md", content: "x", truncated: false } }),
    ...read("r1", "big.txt", 1, 400, 1000),
    ...read("r2", "big.txt", 401, 800, 1000),
    ...read("r3", "small.txt", 1, 3, 3),
    ...read("r4", "empty.txt", 1, 0, 0),
    call("r5", "read_file", { path: "../secret" }),
    deny("r5", "read_file"),
    result("r5", "read_file", undefined, true),
  ]);
  expect(cov.injected).toBe("SEAM.md");
  expect(cov.files["big.txt"]).toEqual({ ranges: [[1, 800]], total: 1000, full: false });
  expect(cov.files["small.txt"]!.full).toBe(true);
  expect(cov.files["empty.txt"]!.full).toBe(true);
  expect(Object.keys(cov.files).sort()).toEqual(["big.txt", "empty.txt", "small.txt"]);
});

// ---- 端到端：真实运行写出的日志，推导结果与实际读取一致 ----

let ws: string;
let logDir: string;

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "seam-ws-"));
  logDir = mkdtempSync(join(tmpdir(), "seam-logs-"));
  writeFileSync(join(ws, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(ws, "b.txt"), "unread\n");
  writeFileSync(join(ws, "SEAM.md"), "Be brief.\n");
});

afterAll(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

test("coverage and the task map from a real run match what actually happened", async () => {
  const mock = startMockAnthropic([
    { toolUse: { id: "r1", name: "read_file", input: { path: "a.txt", limit: 2, step: 0, intent: "peek" } } },
    { toolUse: { id: "p1", name: "propose_plan", input: { steps: ["Read the rest", "Summarize"], intent: "plan" } } },
    { toolUse: { id: "r2", name: "read_file", input: { path: "a.txt", offset: 3, step: 1, intent: "finish reading" } } },
    { text: "Done." },
  ]);
  try {
    const run = await runSession({
      task: "Summarize a.txt",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async () => ({ approved: true }),
    });
    expect(run.reason).toBe("completed");
    const events = readLog(run.logPath);

    const cov = readCoverage(events);
    expect(cov.injected).toBe("SEAM.md");
    expect(cov.files).toEqual({ "a.txt": { ranges: [[1, 3]], total: 3, full: true } });
    expect(cov.files["b.txt"]).toBeUndefined();

    const map = taskMap(events)!;
    expect(map.ended).toBe(true);
    expect(map.steps.map((s) => s.status)).toEqual(["done", "pending"]);
    expect(map.steps[0]!.calls).toMatchObject([{ toolCallId: "r2", outcome: "ok" }]);
  } finally {
    mock.stop();
  }
});

test("coverage by run: cumulative up to the run, plus what that run read", () => {
  const events = [
    ev("session_start", { task: "t", workspace: "/w" }),
    ev("user_message", { content: "first" }, "user"),
    ...read("a1", "a.txt", 1, 10, 20),
    ev("user_message", { content: [{ type: "text", text: "second" }] }, "user"),
    ...read("a2", "a.txt", 11, 20, 20),
    ...read("b1", "b.txt", 1, 1, 1),
    ev("user_message", { content: "third" }, "user"),
  ];
  expect(listRuns(events)).toEqual([
    { index: 1, text: "first" },
    { index: 2, text: "second" },
    { index: 3, text: "third" },
  ]);

  const first = coverageAtRun(events, 1);
  expect(Object.keys(first.total.files)).toEqual(["a.txt"]);
  expect(first.current.files["a.txt"]!.ranges).toEqual([[1, 10]]);

  const second = coverageAtRun(events, 2);
  expect(second.total.files["a.txt"]).toEqual({ ranges: [[1, 20]], total: 20, full: true });
  expect(second.current.files["a.txt"]!.ranges).toEqual([[11, 20]]);
  expect(Object.keys(second.current.files).sort()).toEqual(["a.txt", "b.txt"]);

  // 一个文件都没读的运行：累计不变，这次为空
  const third = coverageAtRun(events, 3);
  expect(Object.keys(third.total.files).sort()).toEqual(["a.txt", "b.txt"]);
  expect(third.current.files).toEqual({});

  // 每个文件被哪几次运行读过
  expect(readRuns(events)).toEqual({ "a.txt": [1, 2], "b.txt": [2] });
});
