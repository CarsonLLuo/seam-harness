import { expect, test } from "bun:test";
import { initialSelection, NEW_VIEW } from "../src/web/startup";

const sessions = ["newest", "older"]; // 已按时间倒序

test("reopens the last session when it still exists", () => {
  expect(initialSelection("older", sessions)).toBe("older");
});

test("stays on the new-session page if that is where the user left off", () => {
  expect(initialSelection(NEW_VIEW, sessions)).toBeNull();
});

test("falls back to the most recent session on first launch or when the saved one is gone", () => {
  expect(initialSelection(null, sessions)).toBe("newest");
  expect(initialSelection("deleted", sessions)).toBe("newest");
});

test("shows the new-session page when there are no sessions", () => {
  expect(initialSelection(null, [])).toBeNull();
});
