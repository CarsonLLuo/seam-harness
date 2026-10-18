// M0 验证原型：用真实模型跑一次带工具调用的任务，Anthropic 和 DeepSeek 各一次。
// API Key 从环境变量读取（Bun 会自动加载项目根目录的 .env）：
//   ANTHROPIC_API_KEY=...（没有时退而使用 ANTHROPIC_AUTH_TOKEN）
//   DEEPSEEK_API_KEY=...
// 使用中转站时，再设置 ANTHROPIC_BASE_URL / DEEPSEEK_BASE_URL。
// 缺哪个 Key 就跳过哪家。运行：bun spikes/m0/real-models.ts
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels, Type } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const targets = [
  {
    provider: "anthropic",
    modelId: "claude-haiku-5-5",
    key: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
  },
  {
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    key: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  },
];

const models = createModels();
models.setProvider(anthropicProvider());
models.setProvider(deepseekProvider());

// 一个小工作区：答案只能靠读文件得到
const workspace = await mkdtemp(join(tmpdir(), "seam-m0-"));
await writeFile(join(workspace, "a.txt"), "Meeting notes: discuss the budget.\n");
await writeFile(join(workspace, "b.txt"), "Shopping list: milk, banana, bread.\n");
await writeFile(join(workspace, "c.txt"), "Reminder: call the dentist.\n");

const intent = Type.String({ description: "One short sentence: why you are calling this tool." });

const tools: AgentTool<any>[] = [
  {
    name: "list_files",
    label: "List files",
    description: "List the files in the workspace.",
    parameters: Type.Object({ intent }),
    async execute() {
      const names = await readdir(workspace);
      return { content: [{ type: "text" as const, text: names.join("\n") }], details: undefined };
    },
  },
  {
    name: "read_file",
    label: "Read file",
    description: "Read a text file in the workspace by its name.",
    parameters: Type.Object({ path: Type.String(), intent }),
    async execute(_id, params) {
      const { path } = params as { path: string };
      const text = await readFile(join(workspace, path), "utf8");
      return { content: [{ type: "text" as const, text }], details: undefined };
    },
  },
];

let failed = false;

for (const t of targets) {
  if (!t.key) {
    console.log(`SKIP  ${t.provider}：没有设置 API Key`);
    continue;
  }
  const found = models.getModel(t.provider, t.modelId);
  if (!found) throw new Error(`model not found: ${t.provider}/${t.modelId}`);
  const model = t.baseUrl ? { ...found, baseUrl: t.baseUrl } : found;

  let llmCalls = 0;
  const toolCalls: { name: string; intent?: string }[] = [];

  const agent = new Agent({
    initialState: {
      systemPrompt: "You can only learn about the workspace by calling tools. Always fill in `intent`.",
      model,
      tools,
    },
    toolExecution: "sequential",
    streamFn: (m, ctx, opts) =>
      models.streamSimple(m, ctx, {
        ...opts,
        apiKey: t.key,
        onPayload: () => {
          llmCalls++;
          return undefined;
        },
      }),
    beforeToolCall: async ({ toolCall, args }) => {
      toolCalls.push({ name: toolCall.name, intent: (args as { intent?: string }).intent });
      return undefined;
    },
  });

  try {
    await agent.prompt("Which file in the workspace mentions a banana? Answer with the file name.");
    const last = agent.state.messages.at(-1) as any;
    const answer = last?.content?.find((c: any) => c.type === "text")?.text ?? "";
    const ok = toolCalls.length > 0 && answer.includes("b.txt") && toolCalls.every((c) => c.intent);
    failed ||= !ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${t.provider}/${t.modelId} @ ${new URL(model.baseUrl).host}：${llmCalls} 次模型请求，${toolCalls.length} 次工具调用`);
    for (const c of toolCalls) console.log(`        ${c.name}  intent: ${c.intent ?? "（缺失）"}`);
    console.log(`        回答：${answer.trim().slice(0, 200)}`);
    if (last?.errorMessage) console.log(`        错误（${last.stopReason}）：${String(last.errorMessage).slice(0, 300)}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL  ${t.provider}/${t.modelId}：${(err as Error).message}`);
  }
}

process.exit(failed ? 1 : 0);
