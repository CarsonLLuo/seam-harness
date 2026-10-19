import { expect, test } from "bun:test";
import { PiEventConverter, type EventType, type Source } from "../src/events";
import { reconstruct } from "../src/replay";
import type { SeamEvent } from "../src/events";

function collect() {
  const records: { type: EventType; source: Source; data: any }[] = [];
  const converter = new PiEventConverter((type, source, data) => records.push({ type, source, data }));
  return { records, converter };
}

test("maps pi events to Seam events with the right source", () => {
  const { records, converter } = collect();
  const assistant = {
    role: "assistant",
    content: [{ type: "toolCall", id: "c1", name: "read_file", arguments: { path: "a.txt", intent: "check a" } }],
    stopReason: "toolUse",
    usage: { input: 1, output: 2 },
    model: "m",
    responseId: "r1",
  };
  const events: any[] = [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: { role: "user", content: "hi" } },
    { type: "message_end", message: { role: "user", content: "hi" } },
    { type: "message_update", message: assistant, assistantMessageEvent: { type: "text_delta", delta: "x" } },
    { type: "message_end", message: assistant },
    { type: "tool_execution_start", toolCallId: "c1", toolName: "read_file", args: { path: "a.txt", intent: "check a" } },
    { type: "tool_execution_end", toolCallId: "c1", toolName: "read_file", result: {}, isError: false },
    {
      type: "message_end",
      message: { role: "toolResult", toolCallId: "c1", toolName: "read_file", content: [{ type: "text", text: "one" }], isError: false, durationMs: 3 },
    },
    { type: "turn_end", message: assistant, toolResults: [] },
    { type: "agent_end", messages: [] },
  ];
  for (const e of events) converter.handle(e);

  expect(records.map((r) => [r.type, r.source])).toEqual([
    ["turn_start", "harness"],
    ["user_message", "user"],
    ["assistant_message", "model"],
    ["tool_call", "model"],
    ["tool_result", "harness"],
    ["turn_end", "harness"],
  ]);
  expect(records[3]!.data).toEqual({ toolCallId: "c1", name: "read_file", args: { path: "a.txt", intent: "check a" }, intent: "check a" });
  expect(records[4]!.data).toMatchObject({ toolCallId: "c1", isError: false, durationMs: 3 });
});

test("a tool call without intent is recorded as missing, not invented", () => {
  const { records, converter } = collect();
  converter.handle({ type: "tool_execution_start", toolCallId: "c2", toolName: "search", args: { pattern: "x" } } as any);
  expect(records[0]!.data.intent).toBeUndefined();
});

test("reconstruct groups requests, calls, permissions and results by turn", () => {
  let seq = 0;
  const ev = (turn: number, type: string, source: string, data: unknown) =>
    ({ v: 1, seq: ++seq, ts: 0, sessionId: "s", turn, type, source, data }) as SeamEvent;
  const session = reconstruct([
    ev(0, "session_start", "harness", { task: "t" }),
    ev(1, "turn_start", "harness", {}),
    ev(1, "user_message", "user", { content: "t" }),
    ev(1, "http_request", "harness", { url: "u", method: "POST", headers: {}, body: { n: 1 } }),
    ev(1, "assistant_message", "model", { content: [], stopReason: "toolUse" }),
    ev(1, "tool_call", "model", { toolCallId: "c1", name: "write_file", args: {}, intent: "save" }),
    ev(1, "permission", "harness", { toolCallId: "c1", name: "write_file", decision: "deny", by: "user", reason: "no" }),
    ev(1, "tool_result", "harness", { toolCallId: "c1", name: "write_file", content: [], isError: true }),
    ev(1, "turn_end", "harness", {}),
    ev(2, "turn_start", "harness", {}),
    ev(2, "http_request", "harness", { url: "u", method: "POST", headers: {}, body: { n: 2 } }),
    ev(2, "assistant_message", "model", { content: [{ type: "text", text: "done" }], stopReason: "stop" }),
    ev(2, "session_end", "harness", { reason: "completed", durationMs: 1 }),
  ]);

  expect(session.turns.map((t) => t.turn)).toEqual([1, 2]);
  expect(session.turns[0]!.requests[0]!.body).toEqual({ n: 1 });
  expect(session.turns[0]!.toolCalls[0]!.permission?.decision).toBe("deny");
  expect(session.turns[0]!.toolCalls[0]!.result?.isError).toBe(true);
  expect(session.turns[1]!.assistant?.stopReason).toBe("stop");
  expect(session.end?.reason).toBe("completed");
});
