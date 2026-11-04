// 用户自己把文件放进工作区：拖进对话区的文件复制到 uploads/。只收文本、PDF 和 Word（.docx）。
// 这是用户的操作，不经过权限确认；发送消息时记一条 files_added（source: user），说明文件是谁放进来的。
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { docKind, looksLike, MAX_DOC_BYTES } from "./documents";
import type { EventPayloads } from "./events";
import { resolveInWorkspace } from "./tools";

export const UPLOAD_DIR = "uploads";
export const MAX_UPLOAD_BYTES = 1024 * 1024;

export type AddedFile = EventPayloads["files_added"]["files"][number];

export interface UploadResult {
  /** clashedWith：重名时被占用的文件名（只把空白换成 - 不算重名） */
  added: (AddedFile & { clashedWith?: string })[];
  rejected: { name: string; bytes: number; code: "too_large" | "not_text" }[];
}

/** 只接受 UTF-8 文本：不能有 NUL 字节，且能严格解码 */
function isText(data: Uint8Array): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

/** 只留文件名本身；空白换成 -，因为消息里的 @path 以空白结束 */
export function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop()!.trim().replace(/\s+/g, "-");
  return base === "" || base === "." || base === ".." ? "file" : base;
}

/** 重名时加后缀：name.md → name-2.md → name-3.md，不覆盖已有文件 */
function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}

export function saveUploads(workspace: string, files: { name: string; data: Uint8Array }[]): UploadResult {
  const dir = resolveInWorkspace(workspace, UPLOAD_DIR);
  const root = resolveInWorkspace(workspace, ".");
  const result: UploadResult = { added: [], rejected: [] };
  for (const f of files) {
    const bytes = f.data.byteLength;
    // 只收文本、PDF 和 Word；PDF / Word 按扩展名认，再看文件头，提取留给 read_file
    const kind = docKind(f.name);
    if (bytes > (kind ? MAX_DOC_BYTES : MAX_UPLOAD_BYTES)) {
      result.rejected.push({ name: f.name, bytes, code: "too_large" });
      continue;
    }
    if (kind ? !looksLike(kind, f.data) : !isText(f.data)) {
      result.rejected.push({ name: f.name, bytes, code: "not_text" });
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const wanted = safeName(f.name);
    const saved = freeName(dir, wanted);
    const target = join(dir, saved);
    writeFileSync(target, f.data, { flag: "wx" });
    result.added.push({ path: relative(root, target), name: f.name, bytes, ...(saved !== wanted ? { clashedWith: wanted } : {}) });
  }
  return result;
}

/** 核对前端说“这次添加了”的文件：必须在工作区里、确实存在；大小以磁盘为准 */
export function checkAddedFiles(workspace: string, input: unknown): AddedFile[] {
  if (!Array.isArray(input)) return [];
  const root = resolveInWorkspace(workspace, ".");
  const out: AddedFile[] = [];
  for (const item of input as { path?: unknown; name?: unknown }[]) {
    if (typeof item?.path !== "string") continue;
    let abs: string;
    try {
      abs = resolveInWorkspace(workspace, item.path);
    } catch {
      continue;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    const path = relative(root, abs);
    if (out.some((f) => f.path === path)) continue;
    out.push({ path, name: typeof item.name === "string" ? item.name : path, bytes: statSync(abs).size });
  }
  return out;
}
