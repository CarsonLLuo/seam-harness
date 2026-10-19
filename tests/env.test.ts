import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectEnv, parseEnv } from "../src/env";

describe("parseEnv", () => {
  test("handles comments, blank lines, export prefixes, quotes and '=' inside values", () => {
    const parsed = parseEnv(
      [
        "# comment",
        "",
        "A=1",
        "export B=https://relay.example/v1",
        'C="quoted value"',
        "D='single'",
        "E=",
        "F=a=b=c",
        "not a valid line",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      A: "1",
      B: "https://relay.example/v1",
      C: "quoted value",
      D: "single",
      E: "",
      F: "a=b=c",
    });
  });
});

describe("loadProjectEnv", () => {
  const dir = mkdtempSync(join(tmpdir(), "seam-env-"));
  const file = join(dir, ".env");
  const keys = ["SEAM_TEST_OVERRIDE", "SEAM_TEST_EMPTY", "SEAM_TEST_NEW"];

  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  test(".env values override variables that are already set", () => {
    process.env.SEAM_TEST_OVERRIDE = "from-shell";
    writeFileSync(file, "SEAM_TEST_OVERRIDE=from-file\nSEAM_TEST_NEW=added\n");
    expect(loadProjectEnv(file)).toEqual(["SEAM_TEST_OVERRIDE", "SEAM_TEST_NEW"]);
    expect(process.env.SEAM_TEST_OVERRIDE).toBe("from-file");
    expect(process.env.SEAM_TEST_NEW).toBe("added");
  });

  test("empty values in .env do not clear existing variables", () => {
    process.env.SEAM_TEST_EMPTY = "from-shell";
    writeFileSync(file, "SEAM_TEST_EMPTY=\n");
    expect(loadProjectEnv(file)).toEqual([]);
    expect(process.env.SEAM_TEST_EMPTY).toBe("from-shell");
  });

  test("a missing file is ignored", () => {
    rmSync(file, { force: true });
    expect(loadProjectEnv(file)).toEqual([]);
  });
});
