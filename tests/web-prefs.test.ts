import { expect, test } from "bun:test";
import { initialModelChoice } from "../src/web/model-choice";
import { resolveTheme } from "../src/web/theme";

const providers = [
  { name: "anthropic" as const, models: ["claude-haiku-5-5", "claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" },
  { name: "deepseek" as const, models: ["deepseek-flash", "deepseek-v4-pro"], defaultModel: "deepseek-v4-pro" },
];

test("the last chosen model is reused when it is still available", () => {
  expect(initialModelChoice(providers, "deepseek/deepseek-flash")).toEqual({ provider: "deepseek", model: "deepseek-flash" });
});

test("falls back to the first provider's default model", () => {
  expect(initialModelChoice(providers, null)).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
  expect(initialModelChoice(providers, "deepseek/removed-model")).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
  expect(initialModelChoice([], null)).toBeNull();
});

test("theme preference resolves against the system setting", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});
