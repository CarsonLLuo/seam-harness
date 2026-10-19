// Seam v0 命令行。
//   bun src/cli.ts run [--provider anthropic|deepseek] [--model <id>] [--workspace <dir>] [--max-turns <n>] [--lang en|zh] "<task>"
//   bun src/cli.ts replay <log.jsonl | sessionId> [--raw]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { loadProjectEnv } from "./env";
import { readLog } from "./log";
import { resolveModel, type ProviderName } from "./models";
import { formatEvent } from "./replay";
import { defaultLogDir, runSession, type Approver } from "./session";

const USAGE = `Usage:
  bun src/cli.ts run [--provider anthropic|deepseek] [--model <id>] [--workspace <dir>] [--max-turns <n>] [--lang en|zh] "<task>"
  bun src/cli.ts replay <log.jsonl | sessionId> [--raw]`;

const askInTerminal: Approver = async (req) => {
  const { intent, ...rest } = req.args;
  console.log(
    [
      "",
      `  ? The model requests ${req.name} with ${JSON.stringify(rest)}`,
      `    It says: ${intent ?? "(no intent given)"}`,
      "    This is a request from the model. The harness stopped it and is handing the decision to you.",
    ].join("\n"),
  );
  if (!process.stdin.isTTY) {
    console.log("    Not running in an interactive terminal, so the request is denied.");
    return { approved: false, reason: "The user is not available to approve this, so it was denied." };
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("    Approve? [y/N] ")).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
};

async function run(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      provider: { type: "string", default: "anthropic" },
      model: { type: "string" },
      workspace: { type: "string", default: process.cwd() },
      "max-turns": { type: "string" },
      lang: { type: "string", default: "en" },
    },
  });
  const task = positionals.join(" ").trim();
  if (!task) throw new Error(`Missing task.\n${USAGE}`);
  const { model, apiKey } = resolveModel(values.provider as ProviderName, values.model);
  const result = await runSession({
    task,
    workspace: values.workspace!,
    model,
    apiKey,
    approve: askInTerminal,
    maxTurns: values["max-turns"] ? Number(values["max-turns"]) : undefined,
    lang: values.lang === "zh" ? "zh" : "en",
    onEvent: (e) => {
      const line = formatEvent(e);
      if (line) console.log(line);
    },
  });
  console.log(`\nAnswer:\n${result.finalText || "(no text)"}`);
  console.log(`\nLog: ${result.logPath}`);
  process.exitCode = result.reason === "completed" ? 0 : 1;
}

function replay(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { raw: { type: "boolean", default: false } },
  });
  const target = positionals[0];
  if (!target) throw new Error(`Missing log file.\n${USAGE}`);
  const path = existsSync(target) ? target : join(defaultLogDir(), `${target}.jsonl`);
  for (const e of readLog(path)) {
    const line = formatEvent(e, { raw: values.raw });
    if (line) console.log(line);
  }
}

loadProjectEnv();

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "run") await run(rest);
  else if (command === "replay") replay(rest);
  else console.log(USAGE);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
