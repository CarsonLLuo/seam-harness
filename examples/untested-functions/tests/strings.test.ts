import { expect, test } from "bun:test";
import { slugify } from "../src/strings";

test("slugify", () => expect(slugify(" Hello, World! ")).toBe("hello-world"));
