// M0 验证原型：在不需要 API Key 的前提下，用本地模拟的 Anthropic 服务器验证 pi 的两个关键钩子。
//   1. onPayload 拿到的请求，与服务器实际收到的请求一致
//   2. beforeToolCall 可以挂起等待外部决定；拒绝后模型收到拒绝结果，循环继续
// 运行：bun spikes/m0/pi-hooks.ts            （默认挂起 3 秒）
//       HOLD_MS=180000 bun spikes/m0/pi-hooks.ts  （挂起 3 分钟）
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, Type } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepStrictEqual } from "node:assert";

const HOLD_MS = Number(process.env.HOLD_MS ?? 3000);

// ---- 模拟的 Anthropic Messages API：第 1 次返回 tool_use，第 2 次返回文字 ----
const received: unknown[] = [];
const receivedBeta: (string | null)[] = [];

function sse(events: object[]): string {
  return events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

function messageStart(id: string) {
  return {
    type: "message_start",
    message: {
      id, type: "message", role: "assistant", model: "mock", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
    },
  };
}

const toolUseTurn = sse([
  messageStart("msg_1"),
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "write_note", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ text: "hello", intent: "save a note" }) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: "message_stop" },
]);

const textTurn = sse([
  messageStart("msg_2"),
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK, I did not write the note." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 8 } },
  { type: "message_stop" },
]);

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  async fetch(req) {
    receivedBeta.push(req.headers.get("anthropic-beta"));
    received.push(await req.json());
    const body = received.length === 1 ? toolUseTurn : textTurn;
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  },
});

// ---- pi：模型指向本地服务器，streamFn 包一层以挂上 onPayload ----
const models = createModels();
models.setProvider(anthropicProvider());
const base = models.getModel("anthropic", "claude-sonnet-5-5");
if (!base) throw new Error("model not found");
const model = { ...base, baseUrl: `http://localhost:${server.port}` };

const payloads: unknown[] = [];
// 经 pi-ai 的 fetch 选项抓到的真实 HTTP 请求体
const fetched: unknown[] = [];
const recordingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === "string") fetched.push(JSON.parse(init.body));
  return fetch(input, init);
}) as typeof fetch;

const writeNote = {
  name: "write_note",
  label: "Write note",
  description: "Write a note to disk.",
  parameters: Type.Object({
    text: Type.String(),
    intent: Type.String({ description: "Why you are calling this tool." }),
  }),
  async execute() {
    throw new Error("should never run: the call is blocked");
  },
};

const t0 = Date.now();
let heldMs = 0;

const agent = new Agent({
  initialState: { systemPrompt: "You are a test agent.", model, tools: [writeNote] },
  toolExecution: "sequential",
  streamFn: (m, ctx, opts) =>
    models.streamSimple(m, ctx, {
      ...opts,
      apiKey: "test-key",
      fetch: recordingFetch,
      onPayload: (payload) => {
        payloads.push(structuredClone(payload));
        return undefined;
      },
    }),
  beforeToolCall: async ({ toolCall }) => {
    const start = Date.now();
    await Bun.sleep(HOLD_MS); // 模拟界面上等待用户决定
    heldMs = Date.now() - start;
    return { block: true, reason: `User denied ${toolCall.name}.` };
  },
});

const eventTypes: string[] = [];
agent.subscribe((e) => {
  eventTypes.push(e.type);
});

await agent.prompt("Please save a note that says hello.");
server.stop(true);

// ---- 检查 ----
const results: [string, boolean, string?][] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    results.push([name, true]);
  } catch (err) {
    results.push([name, false, (err as Error).message.split("\n")[0]]);
  }
}

check("服务器收到 2 次请求", () => deepStrictEqual(received.length, 2));
check("onPayload 记录了 2 次", () => deepStrictEqual(payloads.length, 2));
// onPayload 里的 betas 由 Anthropic SDK 转成 anthropic-beta 请求头，不在请求体里
for (const i of [0, 1]) {
  check(`第 ${i + 1} 次 onPayload 去掉 betas 后与实际请求体一致`, () => {
    const { betas: _betas, ...rest } = payloads[i] as any;
    deepStrictEqual(rest, received[i]);
  });
  check(`第 ${i + 1} 次 onPayload 的 betas 与 anthropic-beta 请求头一致`, () =>
    deepStrictEqual(((payloads[i] as any).betas ?? []).join(","), receivedBeta[i]));
  check(`第 ${i + 1} 次 fetch 抓到的请求体与实际请求体完全一致`, () => deepStrictEqual(fetched[i], received[i]));
}
check(`beforeToolCall 挂起了约 ${HOLD_MS} ms`, () => {
  if (heldMs < HOLD_MS) throw new Error(`only held ${heldMs} ms`);
});
check("第 2 次请求带有拒绝结果，且标为错误", () => {
  const msgs = (received[1] as any).messages as any[];
  const blocks = msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  const result = blocks.find((b) => b.type === "tool_result");
  if (!result) throw new Error("no tool_result block");
  if (!JSON.stringify(result).includes("User denied write_note.")) throw new Error("reason missing");
  if (result.is_error !== true) throw new Error(`is_error = ${result.is_error}`);
});
check("拒绝之后循环继续，得到最终回答", () => {
  const last = agent.state.messages.at(-1) as any;
  const text = last?.content?.find((c: any) => c.type === "text")?.text;
  deepStrictEqual(text, "OK, I did not write the note.");
});

for (const [name, ok, why] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${why ? `  (${why})` : ""}`);
console.log(`\n运行时：Bun ${Bun.version}，总耗时 ${Date.now() - t0} ms`);
console.log(`事件序列：${[...new Set(eventTypes)].join(", ")}`);
console.log(`\n第 1 次请求的顶层字段：${Object.keys(received[0] as object).join(", ")}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
