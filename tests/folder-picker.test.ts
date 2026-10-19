import { expect, test } from "bun:test";
import { osascriptArgs } from "../src/server/folder-picker";

test("prompts and paths are escaped for AppleScript", () => {
  const args = osascriptArgs({ prompt: 'Pick "a" folder \\ now', defaultPath: "/tmp" });
  expect(args[3]).toBe('POSIX path of (choose folder with prompt "Pick \\"a\\" folder \\\\ now" default location (POSIX file "/tmp"))');
});

test("a default location that does not exist is left out", () => {
  expect(osascriptArgs({ prompt: "x", defaultPath: "/no/such/folder" })[3]).toBe('POSIX path of (choose folder with prompt "x")');
});
