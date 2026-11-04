// PDF 和 Word（.docx）的正文提取，给 read_file 用。只提取文字，不做 OCR。
import { extname } from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export type DocKind = "pdf" | "docx";

/** PDF 和 Word 文件比文本文件大得多，单独设上限 */
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

export function docKind(path: string): DocKind | undefined {
  const ext = extname(path).toLowerCase();
  return ext === ".pdf" ? "pdf" : ext === ".docx" ? "docx" : undefined;
}

/** 按文件头确认真的是 PDF / .docx（.docx 是 zip 包） */
export function looksLike(kind: DocKind, data: Uint8Array): boolean {
  const head = String.fromCharCode(...data.subarray(0, 5));
  return kind === "pdf" ? head === "%PDF-" : head.startsWith("PK\x03\x04");
}

/** 每页一段文字；扫描件（所有页都没有文字）报错，说明原因 */
export async function pdfPages(data: Uint8Array, path: string): Promise<string[]> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(data, { verbosity: 0 });
    pages = (await extractText(pdf, { mergePages: false })).text as string[];
  } catch (err) {
    throw new Error(`Could not read "${path}" as a PDF: ${(err as Error).message}`);
  }
  if (pages.every((p) => p.trim() === "")) {
    throw new Error(
      `"${path}" has no text layer (it is probably a scanned document). ` +
        "Seam cannot read scanned PDFs yet; ask the user for a version with selectable text.",
    );
  }
  return pages;
}

/** 正文按段落拆成行，去掉空行；Word 没有固定页码，所以按行编号 */
export async function docxLines(data: Uint8Array, path: string): Promise<string[]> {
  let raw: string;
  try {
    raw = (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value;
  } catch (err) {
    throw new Error(`Could not read "${path}" as a Word document: ${(err as Error).message}`);
  }
  return raw.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
}
