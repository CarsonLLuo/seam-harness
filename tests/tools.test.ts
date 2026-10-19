import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTools, resolveInWorkspace } from "../src/tools";

let ws: string;
let outside: string;
const tool = (name: string) => createTools(ws).find((t) => t.name === name)!;
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text).join("");

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "seam-ws-"));
  outside = mkdtempSync(join(tmpdir(), "seam-outside-"));
  writeFileSync(join(ws, "a.txt"), "one\ntwo\nthree\n");
  mkdirSync(join(ws, "src"));
  writeFileSync(join(ws, "src", "math.ts"), "export function add() {}\nexport function sub() {}\n");
  mkdirSync(join(ws, "node_modules"));
  writeFileSync(join(ws, "node_modules", "dep.ts"), "export function add() {}\n");
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(outside, join(ws, "escape"));
});

afterAll(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("workspace boundary", () => {
  test("allows paths inside the workspace", () => {
    expect(resolveInWorkspace(ws, "src/math.ts")).toEndWith(join("src", "math.ts"));
    expect(resolveInWorkspace(ws, "new/file.txt")).toEndWith(join("new", "file.txt"));
  });

  test.each(["../x.txt", "/etc/passwd", "escape/secret.txt"])("rejects %s with an explanation", (p) => {
    expect(() => resolveInWorkspace(ws, p)).toThrow(/outside the workspace/);
  });

  test("tools refuse to read outside the workspace", async () => {
    await expect(tool("read_file").execute("t", { path: "escape/secret.txt", intent: "x" })).rejects.toThrow(
      /outside the workspace/,
    );
  });
});

describe("read_file", () => {
  test("returns numbered lines and the range read", async () => {
    const r = await tool("read_file").execute("t", { path: "a.txt", offset: 2, limit: 1, intent: "x" });
    expect(textOf(r)).toBe("a.txt (lines 2-2 of 3)\n2| two");
    expect(r.details).toEqual({ path: "a.txt", from: 2, to: 2, total: 3 });
  });
});

describe("search", () => {
  test("finds matches and skips node_modules", async () => {
    const r = await tool("search").execute("t", { pattern: "export function \\w+", intent: "x" });
    expect(textOf(r)).toContain("src/math.ts:1: export function add() {}");
    expect(textOf(r)).toContain("src/math.ts:2: export function sub() {}");
    expect(textOf(r)).not.toContain("node_modules");
    expect((r.details as { matches: number }).matches).toBe(2);
  });
});

describe("write_file", () => {
  test("creates files and parent directories", async () => {
    const r = await tool("write_file").execute("t", { path: "out/b.txt", content: "hi", intent: "x" });
    expect(r.details).toEqual({ path: join("out", "b.txt"), bytes: 2, created: true });
    expect(await Bun.file(join(ws, "out", "b.txt")).text()).toBe("hi");
  });
});

describe("run_command", () => {
  test("runs in the workspace and reports the exit code", async () => {
    const r = await tool("run_command").execute("t", { command: "cat a.txt; exit 3", intent: "x" });
    expect(textOf(r)).toStartWith("Exit code 3\none\ntwo\nthree");
    expect((r.details as { exitCode: number }).exitCode).toBe(3);
  });
});
