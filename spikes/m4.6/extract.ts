// M4.6 验证脚本：看 unpdf / mammoth 在 Bun 下提取出的文本长什么样。
// 用法：bun spikes/m4.6/extract.ts <文件> [...]
import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

for (const path of process.argv.slice(2)) {
  const data = new Uint8Array(readFileSync(path));
  const t0 = performance.now();
  let pages: string[];
  if (path.endsWith(".docx")) {
    pages = [(await mammoth.extractRawText({ buffer: Buffer.from(data) })).value];
  } else {
    const pdf = await getDocumentProxy(data);
    pages = (await extractText(pdf, { mergePages: false })).text as string[];
  }
  const ms = Math.round(performance.now() - t0);
  const all = pages.join("\n");
  const lines = all.split("\n");
  console.log(`\n=== ${path.split("/").pop()} ===`);
  console.log(`pages ${pages.length}, chars ${all.length}, lines ${lines.length}, ${ms} ms`);
  console.log(`empty pages ${pages.filter((p) => p.trim() === "").length}`);
  console.log(`lines ending in hyphen ${lines.filter((l) => /[a-z]-$/.test(l)).length}`);
  console.log(`ligatures ${(all.match(/[ﬀ-ﬆ]/g) ?? []).length}, soft hyphens ${(all.match(/­/g) ?? []).length}`);
  console.log(`longest line ${Math.max(...lines.map((l) => l.length))}, median line ${lines.map((l) => l.length).sort((a, b) => a - b)[lines.length >> 1]}`);
  console.log("--- page 1 (first 700 chars) ---");
  console.log(pages[0]!.slice(0, 700));
}
