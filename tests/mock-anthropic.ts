// 测试用的本地 Anthropic Messages API：按顺序返回预先写好的响应，并记下收到的每个请求。
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

export type MockTurn =
  | { text: string }
  | { toolUse: { id: string; name: string; input: Record<string, unknown> } };

function sse(events: object[]): string {
  return events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

function render(turn: MockTurn, i: number): string {
  const start = {
    type: "message_start",
    message: {
      id: `msg_${i}`, type: "message", role: "assistant", model: "mock", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
    },
  };
  const block =
    "text" in turn
      ? [
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: turn.text } },
        ]
      : [
          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: turn.toolUse.id, name: turn.toolUse.name, input: {} } },
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(turn.toolUse.input) } },
        ];
  return sse([
    start,
    ...block,
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "text" in turn ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ]);
}

export function startMockAnthropic(turns: MockTurn[]) {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      received.push(await req.json());
      const turn = turns[received.length - 1] ?? { text: "(no more scripted turns)" };
      return new Response(render(turn, received.length), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const models = createModels();
  models.setProvider(anthropicProvider());
  const base = models.getModel("anthropic", "claude-sonnet-5-5")!;
  const model: Model<Api> = { ...base, baseUrl: `http://localhost:${server.port}` };
  return { model, received, stop: () => server.stop(true) };
}
