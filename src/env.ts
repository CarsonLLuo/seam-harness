// 读取项目根目录的 .env，并让其中的值覆盖同名环境变量。
// Bun 自带的 .env 加载不会覆盖已有变量；而某些运行环境（比如 IDE 或桌面应用）会预先设置
// ANTHROPIC_BASE_URL 之类的变量，导致 .env 里的配置不生效。所以 Seam 自己再加载一次，以 .env 为准。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PROJECT_ENV_PATH = join(import.meta.dir, "..", ".env");

/** 解析 .env 文本：支持注释、空行、`export ` 前缀和成对的引号 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    out[m[1]!] = value;
  }
  return out;
}

/**
 * 把 .env 里的值写进 process.env，覆盖同名变量。留空的变量不覆盖，避免模板里的空占位抹掉已有配置。
 * 返回实际覆盖或新增的变量名。文件不存在时什么也不做。
 */
export function loadProjectEnv(path = PROJECT_ENV_PATH): string[] {
  if (!existsSync(path)) return [];
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
    if (value === "") continue;
    process.env[key] = value;
    applied.push(key);
  }
  return applied;
}
