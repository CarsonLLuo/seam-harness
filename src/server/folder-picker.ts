// 在运行 Seam 的这台 Mac 上弹出系统的“选择文件夹”对话框。
// 浏览器拿不到文件夹的绝对路径，所以由本地服务调用 osascript 来选。
import { existsSync } from "node:fs";

export type FolderPicker = (opts: { prompt: string; defaultPath?: string }) => Promise<string | null>;

/** AppleScript 字符串字面量：转义反斜杠和双引号 */
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function osascriptArgs(opts: { prompt: string; defaultPath?: string }): string[] {
  const location = opts.defaultPath && existsSync(opts.defaultPath) ? ` default location (POSIX file ${quote(opts.defaultPath)})` : "";
  return [
    // 先激活 osascript 自己，让对话框出现在最前面
    "-e",
    "activate",
    "-e",
    `POSIX path of (choose folder with prompt ${quote(opts.prompt)}${location})`,
  ];
}

/** 用户取消时返回 null */
export const pickFolderWithOsascript: FolderPicker = async (opts) => {
  if (process.platform !== "darwin") throw new Error("Choosing a folder is only supported on macOS.");
  const proc = Bun.spawn(["osascript", ...osascriptArgs(opts)], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code === 0) return out.trim().replace(/\/$/, "") || "/";
  if (/-128|User canceled/i.test(err)) return null;
  throw new Error(err.trim() || `osascript exited with code ${code}`);
};
