import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
const [path, page, from, len] = process.argv.slice(2);
const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path!)));
const pages = (await extractText(pdf, { mergePages: false })).text as string[];
console.log(pages[Number(page) - 1]!.slice(Number(from), Number(from) + Number(len)));
