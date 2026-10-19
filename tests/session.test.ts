// 端到端：用本地模拟的 Anthropic 服务器跑一次会话，再只靠日志重建它。
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLog } from "../src/log";
import { reconstruct } from "../src/replay";
import { runSession } from "../src/session";
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
        return { approved: false, reason: "Not now." };
      },
    });

    expect(result.reason).toBe("completed");
    expect(result.finalText).toBe("a.txt mentions banana.");
    expect(approvals).toEqual(["write_file"]); // 读取不需要确认
    expect(existsSync(join(ws, "b.txt"))).toBe(false);

    const session = reconstruct(readLog(result.logPath));
    expect(session.start?.task).toBe("Which file mentions banana?");
    expect(session.turns).toHaveLength(3);

    // 日志里的请求与服务器实际收到的完全一致
    expect(session.turns.map((t) => t.requests.map((r) => r.body))).toEqual(mock.received.map((b) => [b]));
    // 鉴权信息不进日志
    const headers = session.turns[0]!.requests[0]!.headers;
    expect(headers["x-api-key"] ?? headers["authorization"]).toBe("[redacted]");
    expect(JSON.stringify(readLog(result.logPath))).not.toContain("test-key");

    const [read, write] = [session.turns[0]!.toolCalls[0]!, session.turns[1]!.toolCalls[0]!];
    expect(read.call.intent).toBe("look for banana");
    expect(read.permission).toMatchObject({ decision: "allow", by: "auto" });
    expect(read.result?.isError).toBe(false);
    expect(JSON.stringify(read.result?.content)).toContain("1| banana");

    expect(write.permission).toMatchObject({ decision: "deny", by: "user", reason: "Not now." });
    expect(write.result?.isError).toBe(true);

    expect(session.turns[2]!.assistant?.stopReason).toBe("stop");
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
