// M4.5：拖进对话区的文件复制到 uploads/，输入框的 @ 补全，以及 files_added 事件。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SeamEvent } from "../src/events";
import { reconstruct } from "../src/replay";
import { createServer } from "../src/server/server";
import { checkAddedFiles, MAX_UPLOAD_BYTES, saveUploads } from "../src/uploads";
import { matchFiles, mentionAt, splitMentions } from "../src/web/file-mention";
import { startMockAnthropic } from "./mock-anthropic";

const enc = (s: string) => new TextEncoder().encode(s);

describe("copying files into uploads/", () => {
  let ws: string;
  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), "seam-up-"));
  });
  afterAll(() => rmSync(ws, { recursive: true, force: true }));

  test("text files are copied; a name clash gets a suffix and the existing file is kept", () => {
    const first = saveUploads(ws, [{ name: "ben.md", data: enc("first") }]);
    expect(first.added).toEqual([{ path: "uploads/ben.md", name: "ben.md", bytes: 5 }]);
    const second = saveUploads(ws, [{ name: "ben.md", data: enc("second") }]);
    expect(second.added[0]).toMatchObject({ path: "uploads/ben-2.md", clashedWith: "ben.md" });
    expect(readFileSync(join(ws, "uploads/ben.md"), "utf8")).toBe("first");
    expect(readFileSync(join(ws, "uploads/ben-2.md"), "utf8")).toBe("second");
  });

  test("spaces and folders in the name are dropped, because @path ends at a space", () => {
    const res = saveUploads(ws, [{ name: "../my notes.txt", data: enc("x") }]);
    expect(res.added[0]).toEqual({ path: "uploads/my-notes.txt", name: "../my notes.txt", bytes: 1 });
  });

  test("binary and oversized files are rejected and not written", () => {
    const res = saveUploads(ws, [
      { name: "report.pdf", data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]) },
      { name: "big.txt", data: new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0x61) },
    ]);
    expect(res.added).toEqual([]);
    expect(res.rejected.map((r) => [r.name, r.code])).toEqual([
      ["report.pdf", "not_text"],
      ["big.txt", "too_large"],
    ]);
    expect(existsSync(join(ws, "uploads/report.pdf"))).toBe(false);
  });

  test("files the browser says were added are checked against the workspace", () => {
    const outside = mkdtempSync(join(tmpdir(), "seam-out-"));
    writeFileSync(join(outside, "secret.txt"), "x");
    const checked = checkAddedFiles(ws, [
      { path: "uploads/ben.md", name: "ben.md" },
      { path: "uploads/ben.md", name: "ben.md" },
      { path: "uploads/missing.md", name: "missing.md" },
      { path: join(outside, "secret.txt"), name: "secret.txt" },
      "not an object",
    ]);
    expect(checked).toEqual([{ path: "uploads/ben.md", name: "ben.md", bytes: 5 }]);
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("@ mentions", () => {
  test("the @ word before the caret is found, but not inside an email address", () => {
    expect(mentionAt("read @inter", 11)).toEqual({ start: 5, query: "inter" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail a@b.com", 12)).toBeUndefined();
    expect(mentionAt("read @a.md and", 14)).toBeUndefined();
  });

  test("file name prefix matches rank first, then name matches, then folder matches", () => {
    const files = ["notes/analysis.md", "interviews/anna.md", "drafts/meaning.md", "anna/x.txt", "other.md"];
    // 同一级里路径短的在前
    expect(matchFiles(files, "an").map((m) => m.path)).toEqual([
      "notes/analysis.md",
      "interviews/anna.md",
      "drafts/meaning.md",
      "anna/x.txt",
    ]);
    expect(matchFiles(files, "NNA")[0]).toEqual({ path: "interviews/anna.md", name: "anna.md", dir: "interviews/", at: 1 });
  });

  test("a sent message is split so each @path can be marked", () => {
    expect(splitMentions("sum up @a.md and @b/c.md, a@b.com")).toEqual([
      { text: "sum up ", mention: false },
      { text: "@a.md", mention: true },
      { text: " and ", mention: false },
      { text: "@b/c.md,", mention: true },
      { text: " a@b.com", mention: false },
    ]);
  });
});

describe("through the web service", () => {
  const TOKEN = "files-token";
  const SECRET = "Anna worries about losing hallway chats.";
  let ws: string;
  let logDir: string;
  let mock: ReturnType<typeof startMockAnthropic>;
  let server: ReturnType<typeof createServer>;
  let base: string;

  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), "seam-ws-"));
    logDir = mkdtempSync(join(tmpdir(), "seam-logs-"));
    mkdirSync(join(ws, "notes"));
    writeFileSync(join(ws, "notes/plan.md"), "plan\n");
    mock = startMockAnthropic([
      { toolUse: { id: "t1", name: "read_file", input: { path: "uploads/anna.md", step: 0, intent: "read it" } } },
      { text: "Anna worries about hallway chats." },
    ]);
    server = createServer({
      port: 0,
      token: TOKEN,
      logDir,
      trashDir: join(logDir, "trash"),
      defaultWorkspace: ws,
      resolveModel: () => ({ model: mock.model, apiKey: "test-key" }),
      availableProviders: () => [{ name: "anthropic", models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" }],
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    mock.stop();
    rmSync(ws, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const authed = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { cookie: `seam_token=${TOKEN}`, origin: base, ...(init.headers ?? {}) },
  });

  async function waitForEnd(id: string): Promise<SeamEvent[]> {
    for (;;) {
      const events = (await (await fetch(`${base}/api/sessions/${id}/events`, authed())).json()) as SeamEvent[];
      if (events.some((e) => e.type === "session_end")) return events;
      await Bun.sleep(20);
    }
  }

  test("files are listed by workspace path, for the new-session page", async () => {
    const res = await fetch(`${base}/api/workspace-files?workspace=${encodeURIComponent(ws)}`, authed());
    expect(((await res.json()) as { files: string[] }).files).toEqual(["notes/plan.md"]);
    const bad = await fetch(`${base}/api/workspace-files?workspace=${encodeURIComponent(join(ws, "nope"))}`, authed());
    expect(bad.status).toBe(400);
  });

  test("uploads need the token", async () => {
    const form = new FormData();
    form.append("workspace", ws);
    const res = await fetch(`${base}/api/uploads`, { method: "POST", body: form, headers: { origin: base } });
    expect(res.status).toBe(401);
  });

  test("a dropped file is logged as added by the user, and the message carries only its path", async () => {
    const form = new FormData();
    form.append("workspace", ws);
    form.append("files", new File([SECRET], "anna.md"));
    form.append("files", new File([new Uint8Array([0, 1, 2])], "report.pdf"));
    const up = (await (await fetch(`${base}/api/uploads`, authed({ method: "POST", body: form }))).json()) as any;
    expect(up.added.map((a: any) => a.path)).toEqual(["uploads/anna.md"]);
    expect(up.rejected.map((r: any) => r.code)).toEqual(["not_text"]);

    const task = "What does @uploads/anna.md worry about?";
    const res = await fetch(
      `${base}/api/sessions`,
      authed({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, files: [{ path: "uploads/anna.md", name: "anna.md", bytes: 1 }, { path: "../escape.md", name: "x" }] }),
      }),
    );
    const { sessionId } = (await res.json()) as { sessionId: string };
    const events = await waitForEnd(sessionId);

    // 先记谁放了哪些文件，再记用户消息；大小以磁盘为准，越界的路径被丢掉
    expect(events.slice(0, 4).map((e) => e.type)).toEqual(["session_start", "files_added", "turn_start", "user_message"]);
    const added = events.find((e) => e.type === "files_added")!;
    expect(added.source).toBe("user");
    expect(added.data).toEqual({ files: [{ path: "uploads/anna.md", name: "anna.md", bytes: SECRET.length }] });

    // 消息里只有路径；文件内容只在 agent 自己 read_file 之后才进入请求
    const user = events.find((e) => e.type === "user_message")!;
    expect(JSON.stringify(user.data)).toContain("@uploads/anna.md");
    expect(JSON.stringify(user.data)).not.toContain(SECRET);
    expect(JSON.stringify(mock.received[0])).not.toContain(SECRET);
    expect(JSON.stringify(mock.received[1])).toContain(SECRET);

    // 界面按轮次显示：添加的文件挂在这条用户消息上
    const turn = reconstruct(events).turns.find((t) => t.user);
    expect(turn?.filesAdded?.map((f) => f.path)).toEqual(["uploads/anna.md"]);
  });
});
