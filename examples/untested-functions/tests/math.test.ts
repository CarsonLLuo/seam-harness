import { expect, test } from "bun:test";
import { add, divide, subtract } from "../src/math";

test("add", () => expect(add(1, 2)).toBe(3));
test("subtract", () => expect(subtract(3, 1)).toBe(2));
test("divide", () => expect(divide(6, 3)).toBe(2));
