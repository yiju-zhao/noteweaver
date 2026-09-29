import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges } from "../src/bank/write";
import { setFrontmatterLines } from "../src/core";
import { parseArgs } from "../src/cli";
test("live write plan checks all expected contents before changing any file", async () => {
  const files = new Map([
    ["a", "old"],
    ["b", "human edit"],
  ]);
  let writes = 0;
  await assert.rejects(
    applyChanges(
      {
        read: async (p) => files.get(p) ?? null,
        write: async () => {
          writes++;
        },
      },
      [
        { path: "a", before: "old", after: "new" },
        { path: "b", before: "old", after: "new" },
      ],
    ),
    /changed since planning/,
  );
  assert.equal(writes, 0);
});
test("write failure stops the remaining writes and reports failure", async () => {
  const written: string[] = [];
  await assert.rejects(
    applyChanges(
      {
        read: async () => null,
        write: async (p) => {
          if (p.path === "b") throw Error("file changed");
          written.push(p.path);
        },
      },
      ["a", "b", "c"].map((path) => ({ path, before: null, after: "new" })),
    ),
    /file changed/,
  );
  assert.deepEqual(written, ["a"]);
});
test("updating generated preserves precise and nested YAML bytes", () => {
  const text =
    '---\nquantity: "1.20000000000000001" # exact\nnested: {p: 0.9500}\ngenerated:\n  by: old/1\n  at: 2026-01-01T00:00:00Z\n---\nBody\n';
  const result = setFrontmatterLines(text, "generated", [
    "generated: {by: kb/lift, at: 2026-09-29T00:00:00Z}",
  ]);
  assert.equal(
    result,
    '---\nquantity: "1.20000000000000001" # exact\nnested: {p: 0.9500}\ngenerated: {by: kb/lift, at: 2026-09-29T00:00:00Z}\n---\nBody\n',
  );
});
test("offline mode is explicit and request options are retained", () => {
  const live = parseArgs([
    "--root",
    "/vault",
    "check",
    "--json",
    "--base",
    "HEAD~1",
  ]);
  assert.equal(live.offline, false);
  assert.equal(live.request.base, "HEAD~1");
  assert.equal(
    parseArgs(["index", "--offline", "--check"]).request.check,
    true,
  );
  assert.throws(() => parseArgs(["index", "--unexpected"]), /unknown option/);
});
