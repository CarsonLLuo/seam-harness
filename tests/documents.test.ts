// M4.6：read_file 读取 PDF（按页）和 Word（按行），拖拽添加接受这两种文件。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SeamEvent } from "../src/events";
import { readCoverage } from "../src/insight";
import { createTools } from "../src/tools";
import { saveUploads } from "../src/uploads";
import { makePdf } from "./pdf-fixture";

let ws: string;
const tool = (name: string) => createTools(ws).find((t) => t.name === name)!;
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text).join("");
const pages = Array.from({ length: 7 }, (_, i) => (i === 2 ? "" : `Page ${i + 1} says the sample size was ${100 + i}.`));

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "seam-doc-"));
  writeFileSync(join(ws, "paper.pdf"), makePdf(pages));
  writeFileSync(join(ws, "scan.pdf"), makePdf(["", ""]));
  writeFileSync(join(ws, "broken.pdf"), "%PDF-1.4 this is not really a PDF");
  copyFileSync(join(import.meta.dir, "fixtures/sample.docx"), join(ws, "notes.docx"));
});

afterAll(() => rmSync(ws, { recursive: true, force: true }));

describe("read_file on a PDF", () => {
  test("reads 5 pages by default, marks pages without text, and reports the page range", async () => {
    const r = await tool("read_file").execute("t", { path: "paper.pdf", intent: "x" });
    const out = textOf(r);
    expect(out).toStartWith("paper.pdf (pages 1-5 of 7)\n--- page 1 ---\nPage 1 says the sample size was 100.");
    expect(out).toContain("--- page 3 ---\n(no text on this page)");
    expect(out).not.toContain("page 6");
    expect(r.details).toEqual({ path: "paper.pdf", from: 1, to: 5, total: 7, unit: "page" });
  });

  test("offset and limit count pages", async () => {
    const r = await tool("read_file").execute("t", { path: "paper.pdf", offset: 6, limit: 1, intent: "x" });
    expect(textOf(r)).toBe("paper.pdf (pages 6-6 of 7)\n--- page 6 ---\nPage 6 says the sample size was 105.");
  });

  test("a scanned PDF explains that it has no text layer", async () => {
    await expect(tool("read_file").execute("t", { path: "scan.pdf", intent: "x" })).rejects.toThrow(/no text layer/);
  });

  test("a damaged PDF says it could not be read as a PDF", async () => {
    await expect(tool("read_file").execute("t", { path: "broken.pdf", intent: "x" })).rejects.toThrow(/Could not read "broken.pdf" as a PDF/);
  });

  test("search skips PDF and Word files", async () => {
    const r = await tool("search").execute("t", { pattern: "sample size", intent: "x" });
    expect((r.details as { matches: number; filesScanned: number }).matches).toBe(0);
  });
});

describe("read_file on a Word document", () => {
  test("returns paragraphs as numbered lines without blank lines", async () => {
    const r = await tool("read_file").execute("t", { path: "notes.docx", intent: "x" });
    expect(textOf(r)).toBe(
      "notes.docx (lines 1-3 of 3)\n1| Seam Word fixture\n2| The sample size was 120 students.\n3| Second paragraph about autonomy.",
    );
    expect(r.details).toEqual({ path: "notes.docx", from: 1, to: 3, total: 3 });
  });
});

describe("reading coverage", () => {
  test("PDF coverage counts pages", () => {
    const result = (from: number, to: number) =>
      ({ type: "tool_result", data: { name: "read_file", isError: false, details: { path: "paper.pdf", from, to, total: 7, unit: "page" } } }) as SeamEvent;
    expect(readCoverage([result(1, 5), result(6, 7)]).files["paper.pdf"]).toEqual({ ranges: [[1, 7]], total: 7, full: true, unit: "page" });
  });
});

describe("copying documents into uploads/", () => {
  test("PDF and Word files are accepted; a file that only has the extension is not", () => {
    const res = saveUploads(ws, [
      { name: "paper.pdf", data: makePdf(["hi"]) },
      { name: "notes.docx", data: new Uint8Array(readFileSync(join(import.meta.dir, "fixtures/sample.docx"))) },
      { name: "fake.pdf", data: new TextEncoder().encode("plain text") },
    ]);
    expect(res.added.map((a) => a.path)).toEqual(["uploads/paper.pdf", "uploads/notes.docx"]);
    expect(res.rejected.map((r) => [r.name, r.code])).toEqual([["fake.pdf", "not_text"]]);
  });
});
