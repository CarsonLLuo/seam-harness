// Seam 的 4 个工具。每个工具的参数里都有必填的 intent：模型对“为什么调用”的自述。
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

/** 需要用户确认才能执行的工具；其余工具自动放行 */
export const TOOLS_NEEDING_APPROVAL = new Set(["write_file", "run_command"]);

const READ_LIMIT = 400; // read_file 默认一次最多读取的行数
const MAX_FILE_BYTES = 1_000_000;
const MAX_SEARCH_MATCHES = 200;
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;
const SKIP_DIRS = new Set([".git", "node_modules"]);

const intent = Type.String({
  description: "One short sentence explaining why you are calling this tool. Shown to the user.",
});

/**
 * 把工具参数里的路径解析成工作区内的绝对路径。越界时抛出带解释的错误，模型会收到这条错误。
 */
export function resolveInWorkspace(workspace: string, path: string): string {
  const root = realpathSync(workspace);
  const target = resolve(root, path);
  // 已存在的路径要解析符号链接，防止通过链接跳出工作区
  const real = existsSync(target) ? realpathSync(target) : target;
  if (real !== root && !real.startsWith(root + sep)) {
    throw new Error(
      `Path "${path}" is outside the workspace. You can only access files inside ${root}. ` +
        "This limit is enforced by the harness, not by the model.",
    );
  }
  return real;
}

function text(t: string) {
  return [{ type: "text" as const, text: t }];
}

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  return s.length > max ? { text: `${s.slice(0, max)}\n…[truncated]`, truncated: true } : { text: s, truncated: false };
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

export function createTools(workspace: string): AgentTool<any>[] {
  const root = realpathSync(workspace);
  const rel = (abs: string) => relative(root, abs) || ".";

  const readFileTool: AgentTool<any> = {
    name: "read_file",
    label: "Read file",
    description:
      `Read a text file in the workspace. Returns numbered lines, at most ${READ_LIMIT} at a time; ` +
      "use offset to read further. You only know what you have actually read.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the workspace root." }),
      offset: Type.Optional(Type.Integer({ minimum: 1, description: "First line to read (1-based). Default 1." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, description: `Number of lines. Default ${READ_LIMIT}.` })),
      intent,
    }),
    async execute(_id, params) {
      const { path, offset = 1, limit = READ_LIMIT } = params as { path: string; offset?: number; limit?: number };
      const abs = resolveInWorkspace(root, path);
      if ((await stat(abs)).size > MAX_FILE_BYTES) throw new Error(`File "${path}" is larger than 1 MB.`);
      const lines = (await readFile(abs, "utf8")).split("\n");
      if (lines.at(-1) === "") lines.pop();
      const total = lines.length;
      const from = Math.min(offset, total + 1);
      const to = Math.min(from + limit - 1, total);
      const body = lines.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join("\n");
      const header = total === 0 ? `${rel(abs)} is empty.` : `${rel(abs)} (lines ${from}-${to} of ${total})`;
      return { content: text(`${header}\n${body}`), details: { path: rel(abs), from, to, total } };
    },
  };

  const writeFileTool: AgentTool<any> = {
    name: "write_file",
    label: "Write file",
    description: "Create or overwrite a text file in the workspace. Requires the user's approval.",
    parameters: Type.Object({
      path: Type.String({ description: "Path relative to the workspace root." }),
      content: Type.String({ description: "The full new content of the file." }),
      intent,
    }),
    async execute(_id, params) {
      const { path, content } = params as { path: string; content: string };
      const abs = resolveInWorkspace(root, path);
      const created = !existsSync(abs);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
      const bytes = Buffer.byteLength(content);
      return {
        content: text(`${created ? "Created" : "Overwrote"} ${rel(abs)} (${bytes} bytes).`),
        details: { path: rel(abs), bytes, created },
      };
    },
  };

  const searchTool: AgentTool<any> = {
    name: "search",
    label: "Search",
    description:
      "Search text files in the workspace with a JavaScript regular expression. " +
      `Returns matching lines as path:line: text, at most ${MAX_SEARCH_MATCHES} matches. Skips .git and node_modules.`,
    parameters: Type.Object({
      pattern: Type.String({ description: "JavaScript regular expression, e.g. 'export function \\w+'." }),
      path: Type.Optional(Type.String({ description: "Directory to search, relative to the workspace root. Default '.'." })),
      intent,
    }),
    async execute(_id, params) {
      const { pattern, path = "." } = params as { pattern: string; path?: string };
      const re = new RegExp(pattern);
      const dir = resolveInWorkspace(root, path);
      const matches: string[] = [];
      let filesScanned = 0;
      for await (const file of walk(dir)) {
        if ((await stat(file)).size > MAX_FILE_BYTES) continue;
        const content = await readFile(file, "utf8");
        if (content.includes("\0")) continue; // 跳过二进制文件
        filesScanned++;
        content.split("\n").forEach((line, i) => {
          if (matches.length < MAX_SEARCH_MATCHES && re.test(line)) matches.push(`${rel(file)}:${i + 1}: ${line}`);
        });
        if (matches.length >= MAX_SEARCH_MATCHES) break;
      }
      const truncated = matches.length >= MAX_SEARCH_MATCHES;
      const summary = `${matches.length} match(es) in ${filesScanned} file(s) scanned${truncated ? " (stopped at limit)" : ""}.`;
      return {
        content: text(`${summary}\n${matches.join("\n")}`),
        details: { pattern, path: rel(dir), matches: matches.length, filesScanned, truncated },
      };
    },
  };

  const runCommandTool: AgentTool<any> = {
    name: "run_command",
    label: "Run command",
    description:
      `Run a shell command with the workspace root as the working directory. Times out after ${COMMAND_TIMEOUT_MS / 1000} s. ` +
      "Requires the user's approval.",
    parameters: Type.Object({
      command: Type.String({ description: "The shell command to run." }),
      intent,
    }),
    async execute(_id, params, signal) {
      const { command } = params as { command: string };
      const proc = Bun.spawn(["sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe", signal });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, COMMAND_TIMEOUT_MS);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timer);
      const out = truncate(`${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`, MAX_OUTPUT_CHARS);
      const status = timedOut ? "Timed out" : `Exit code ${exitCode}`;
      return {
        content: text(`${status}\n${out.text}`),
        details: { command, exitCode, timedOut, truncated: out.truncated },
      };
    },
  };

  return [readFileTool, writeFileTool, searchTool, runCommandTool];
}
