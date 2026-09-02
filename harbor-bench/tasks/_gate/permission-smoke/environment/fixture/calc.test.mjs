import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "./calc.mjs";

test("add() returns the sum of its arguments", () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-1, 1), 0);
});
