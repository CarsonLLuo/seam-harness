// 输入框里的 @ 补全：找出光标前正在输入的 @ 词，按文件名匹配工作区文件。
// 消息里只插入路径，不插入内容；agent 仍然要用 read_file 读取。

/** 光标前正在输入的 @ 词；@ 必须在开头或空白之后，避免把邮箱地址当成引用 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | undefined {
  const m = /(^|\s)@(\S*)$/.exec(text.slice(0, caret));
  return m ? { start: m.index + m[1]!.length, query: m[2]! } : undefined;
}

export interface FileMatch {
  path: string;
  name: string;
  dir: string;
  /** 匹配在文件名里的起点；只匹配到目录时为 -1 */
  at: number;
}

/** 文件名开头匹配的排最前，其次是文件名包含，最后是只有目录包含；同级按路径长短排 */
export function matchFiles(files: string[], query: string): FileMatch[] {
  const q = query.toLowerCase();
  const scored: { m: FileMatch; score: number }[] = [];
  for (const path of files) {
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    const at = name.toLowerCase().indexOf(q);
    const score = at === 0 ? 0 : at > 0 ? 1 : path.toLowerCase().includes(q) ? 2 : -1;
    if (score >= 0) scored.push({ m: { path, name, dir: slash >= 0 ? path.slice(0, slash + 1) : "", at }, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.m.path.length - b.m.path.length || a.m.path.localeCompare(b.m.path))
    .map((s) => s.m);
}

/** 用户消息里的 @path，按出现顺序切开，方便界面单独标出来 */
export function splitMentions(text: string): { text: string; mention: boolean }[] {
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/(^|\s)(@\S+)/g)) {
    const start = m.index! + m[1]!.length;
    if (start > last) parts.push({ text: text.slice(last, start), mention: false });
    parts.push({ text: m[2]!, mention: true });
    last = start + m[2]!.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts;
}
