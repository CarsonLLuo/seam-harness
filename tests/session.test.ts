// 端到端：用本地模拟的 Anthropic 服务器跑一次会话，再只靠日志重建它。
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLog } from "../src/log";
import { reconstruct } from "../src/replay";
import { resumeSession, runSession, startSession } from "../src/session";
import { startMockAnthropic } from "./mock-anthropic";

let ws: string;
let logDir: string;

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "seam-ws-"));
  logDir = mkdtempSync(join(tmpdir(), "seam-logs-"));
  writeFileSync(join(ws, "a.txt"), "banana\n");
});

afterAll(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

test("a session can be fully rebuilt from its log", async () => {
  const mock = startMockAnthropic([
    { toolUse: { id: "t1", name: "read_file", input: { path: "a.txt", intent: "look for banana" } } },
    { toolUse: { id: "p1", name: "propose_plan", input: { steps: ["Write a note to b.txt"], intent: "plan the change" } } },
    { toolUse: { id: "t2", name: "write_file", input: { path: "b.txt", content: "x", intent: "save a note" } } },
    { text: "a.txt mentions banana." },
  ]);
  const approvals: string[] = [];
  try {
    const result = await runSession({
      task: "Which file mentions banana?",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async (req) => {
        approvals.push(req.name);
        return req.name === "propose_plan" ? { approved: true } : { approved: false, reason: "Not now." };
      },
    });

    expect(result.reason).toBe("completed");
    expect(result.finalText).toBe("a.txt mentions banana.");
    expect(approvals).toEqual(["propose_plan", "write_file"]); // 读取不需要确认
    expect(existsSync(join(ws, "b.txt"))).toBe(false);

    const events = readLog(result.logPath);
    const session = reconstruct(events);
    expect(session.start?.task).toBe("Which file mentions banana?");
    expect(session.start?.tools).toContain("propose_plan");
    expect(session.start?.systemPrompt).toContain("propose_plan");
    expect(session.turns).toHaveLength(4);

    // 日志里的请求与服务器实际收到的完全一致
    expect(session.turns.map((t) => t.requests.map((r) => r.body))).toEqual(mock.received.map((b) => [b]));
    // 鉴权信息不进日志
    const headers = session.turns[0]!.requests[0]!.headers;
    expect(headers["x-api-key"] ?? headers["authorization"]).toBe("[redacted]");
    expect(JSON.stringify(events)).not.toContain("test-key");

    const [read, plan, write] = [
      session.turns[0]!.toolCalls[0]!,
      session.turns[1]!.toolCalls[0]!,
      session.turns[2]!.toolCalls[0]!,
    ];
    expect(read.call.intent).toBe("look for banana");
    expect(read.permission).toMatchObject({ decision: "allow", by: "auto" });
    expect(read.result?.isError).toBe(false);
    expect(JSON.stringify(read.result?.content)).toContain("1| banana");

    expect(plan.permission).toMatchObject({ decision: "allow", by: "user" });
    expect(plan.result?.details).toMatchObject({ steps: ["Write a note to b.txt"], edited: false });

    expect(write.permission).toMatchObject({ decision: "deny", by: "user", reason: "Not now." });
    expect(write.result?.isError).toBe(true);

    expect(session.turns[3]!.assistant?.stopReason).toBe("stop");
    expect(session.end?.reason).toBe("completed");
  } finally {
    mock.stop();
  }
});

test("stops after the maximum number of turns", async () => {
  const loop = { toolUse: { id: "t", name: "read_file", input: { path: "a.txt", intent: "again" } } };
  const mock = startMockAnthropic([loop, { ...loop }, { ...loop }, { ...loop }]);
  try {
    const result = await runSession({
      task: "loop",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      maxTurns: 2,
      approve: async () => true,
    });
    expect(result.reason).toBe("max_turns");
    expect(result.finalText).toBe(""); // 被截断时没有最终回答，不能把工具输出当成回答
    expect(reconstruct(readLog(result.logPath)).turns).toHaveLength(2);
  } finally {
    mock.stop();
  }
});

test("a session can be continued with follow-up messages, and resumed from its log", async () => {
  const mock = startMockAnthropic([{ text: "first answer" }, { text: "second answer" }, { text: "third answer" }]);
  try {
    const session = startSession({
      task: "first question",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async () => true,
    });
    expect((await session.done).finalText).toBe("first answer");

    const second = await session.send("second question");
    expect(second.finalText).toBe("second answer");
    expect(second.logPath).toBe(session.logPath);

    // 第二次请求带着完整的前文。pi 会在每条用户消息后插入一条只带 output_config 的 system 消息，这里不计入
    const roles = (body: unknown) =>
      (body as { messages: { role: string }[] }).messages.map((m) => m.role).filter((r) => r !== "system");
    expect(roles(mock.received[1])).toEqual(["user", "assistant", "user"]);

    // 模拟服务重启：只凭日志恢复，再追问一次
    const resumed = resumeSession(session.logPath, { model: mock.model, apiKey: "test-key", approve: async () => true });
    const third = await resumed.send("third question");
    expect(third.finalText).toBe("third answer");
    expect(roles(mock.received[2])).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(JSON.stringify(mock.received[2])).toContain("second answer");

    const events = readLog(session.logPath);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1)); // 序号连续
    expect(events.filter((e) => e.type === "session_end")).toHaveLength(3);
    const view = reconstruct(events);
    expect(view.turns.map((t) => t.turn)).toEqual([1, 2, 3]);
    expect(view.userMessages).toHaveLength(3);
  } finally {
    mock.stop();
  }
});

test("sending while a run is in progress is rejected", async () => {
  const mock = startMockAnthropic([{ text: "done" }]);
  try {
    const session = startSession({
      task: "q",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async () => true,
    });
    await expect(session.send("too early")).rejects.toThrow(/already running/);
    await session.done;
  } finally {
    mock.stop();
  }
});

test("blocks paths outside the workspace before asking the user", async () => {
  const mock = startMockAnthropic([
    { toolUse: { id: "t1", name: "read_file", input: { path: "../outside.txt", intent: "peek outside" } } },
    { text: "I could not read it." },
  ]);
  const approvals: string[] = [];
  try {
    const result = await runSession({
      task: "read outside",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async (req) => {
        approvals.push(req.name);
        return true;
      },
    });
    expect(result.reason).toBe("completed");
    expect(approvals).toEqual([]); // 越界在请求批准之前就被拦下

    const events = readLog(result.logPath);
    const permission = events.find((e) => e.type === "permission" && e.data.decision === "deny");
    expect(permission?.type === "permission" && permission.data).toMatchObject({
      code: "outside_workspace",
      path: "../outside.txt",
      by: "auto",
    });
    const call = reconstruct(events).turns[0]!.toolCalls[0]!;
    expect(call.permission?.code).toBe("outside_workspace");
    expect(call.result?.isError).toBe(true);
    expect(JSON.stringify(call.result?.content)).toContain("outside the workspace");
  } finally {
    mock.stop();
  }
});

test("requires an approved plan before writing files", async () => {
  const mock = startMockAnthropic([
    { toolUse: { id: "t1", name: "write_file", input: { path: "nope.txt", content: "x", intent: "save" } } },
    { text: "I need a plan first." },
  ]);
  const approvals: string[] = [];
  try {
    const result = await runSession({
      task: "write without a plan",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async (req) => {
        approvals.push(req.name);
        return true;
      },
    });
    expect(approvals).toEqual([]);
    expect(existsSync(join(ws, "nope.txt"))).toBe(false);
    const call = reconstruct(readLog(result.logPath)).turns[0]!.toolCalls[0]!;
    expect(call.permission).toMatchObject({ decision: "deny", by: "auto", code: "plan_required" });
  } finally {
    mock.stop();
  }
});

test("a denied plan keeps later writes blocked", async () => {
  const mock = startMockAnthropic([
    { toolUse: { id: "p1", name: "propose_plan", input: { steps: ["write a file"], intent: "plan" } } },
    { toolUse: { id: "w1", name: "write_file", input: { path: "denied-plan.txt", content: "x", intent: "write" } } },
    { text: "ok" },
  ]);
  try {
    const result = await runSession({
      task: "plan denied",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async () => ({ approved: false, reason: "Not this plan." }),
    });
    const events = readLog(result.logPath);
    const planDenied = events.find(
      (e) => e.type === "permission" && e.data.name === "propose_plan" && e.data.decision === "deny",
    );
    expect(planDenied?.type === "permission" && planDenied.data.code).toBe("plan_denied");
    const writeDenied = events.find(
      (e) => e.type === "permission" && e.data.name === "write_file" && e.data.decision === "deny",
    );
    expect(writeDenied?.type === "permission" && writeDenied.data.code).toBe("plan_required");
    expect(existsSync(join(ws, "denied-plan.txt"))).toBe(false);
  } finally {
    mock.stop();
  }
});

test("the edited plan is returned to the model and reaches the next request", async () => {
  const mock = startMockAnthropic([
    { toolUse: { id: "p1", name: "propose_plan", input: { steps: ["Read a.txt", "Write b.txt"], intent: "plan" } } },
    { toolUse: { id: "w1", name: "write_file", input: { path: "edited.txt", content: "hello", intent: "write" } } },
    { text: "done" },
  ]);
  try {
    const result = await runSession({
      task: "write a file",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async (req) =>
        req.name === "propose_plan"
          ? { approved: true, steps: ["Read a.txt", "Write b.txt carefully"] }
          : true,
    });
    expect(result.reason).toBe("completed");
    expect(existsSync(join(ws, "edited.txt"))).toBe(true);
    // 修改后的计划作为工具结果进入下一次请求
    expect(JSON.stringify(mock.received[1])).toContain("Write b.txt carefully");

    const planCall = reconstruct(readLog(result.logPath)).turns[0]!.toolCalls[0]!;
    expect(planCall.result?.details).toMatchObject({
      steps: ["Read a.txt", "Write b.txt carefully"],
      originalSteps: ["Read a.txt", "Write b.txt"],
      edited: true,
    });
  } finally {
    rmSync(join(ws, "edited.txt"), { force: true });
    mock.stop();
  }
});

test("loads SEAM.md into the system prompt and logs it", async () => {
  const note = "Use tabs, not spaces.\n";
  writeFileSync(join(ws, "SEAM.md"), note);
  const mock = startMockAnthropic([{ text: "ok" }]);
  try {
    const result = await runSession({
      task: "respect the workspace notes",
      workspace: ws,
      model: mock.model,
      apiKey: "test-key",
      logDir,
      approve: async () => true,
    });
    const start = reconstruct(readLog(result.logPath)).start!;
    expect(start.workspaceNote).toMatchObject({ path: "SEAM.md", content: note, truncated: false });
    expect(start.systemPrompt).toContain(note.trim());
  } finally {
    rmSync(join(ws, "SEAM.md"), { force: true });
    mock.stop();
  }
});

test("resumes an interrupted run by closing its open tool calls", async () => {
  // 先跑一个正常会话，再把日志截断在 tool_call 之后，模拟进程中途退出
  const first = startMockAnthropic([
    { toolUse: { id: "t1", name: "read_file", input: { path: "a.txt", intent: "read" } } },
    { text: "done before crash" },
  ]);
  let truncatedPath = "";
  try {
    const run = await runSession({
      task: "read a.txt",
      workspace: ws,
      model: first.model,
      apiKey: "test-key",
      logDir,
      approve: async () => true,
    });
    const events = readLog(run.logPath);
    const cut = events.findIndex((e) => e.type === "tool_call") + 1;
    truncatedPath = join(logDir, `interrupted-${crypto.randomUUID()}.jsonl`);
    writeFileSync(truncatedPath, events.slice(0, cut).map((e) => `${JSON.stringify(e)}\n`).join(""));
  } finally {
    first.stop();
  }
  expect(truncatedPath).not.toBe("");

  const second = startMockAnthropic([{ text: "continued" }]);
  try {
    const resumed = resumeSession(truncatedPath, { model: second.model, apiKey: "test-key", approve: async () => true });
    const events = readLog(truncatedPath);
    const permission = events.find((e) => e.type === "permission" && e.data.code === "not_executed");
    const result = events.find(
      (e) => e.type === "tool_result" && (e.data.details as { code?: string } | undefined)?.code === "not_executed",
    );
    expect(permission).toBeDefined();
    expect(result?.type === "tool_result" && result.data.isError).toBe(true);
    expect(events.at(-1)?.type).toBe("session_end");

    const out = await resumed.send("continue");
    expect(out.finalText).toBe("continued");
    // 恢复后的请求是合法的：assistant 的 tool_use 后面跟着合成的 tool_result
    // （在 Anthropic 的协议里 tool_result 是一条 user 消息）
    const body = second.received[0] as { messages: { role: string; content: unknown }[] };
    expect(body.messages.map((m) => m.role).filter((r) => r !== "system")).toEqual([
      "user",
      "assistant",
      "user",
      "user",
    ]);
    expect(JSON.stringify(body)).toContain("service restarted");
    expect(JSON.stringify(body)).toContain("tool_result");
  } finally {
    second.stop();
  }
});
