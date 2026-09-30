import test from "node:test";
import assert from "node:assert/strict";
import { nativeSource, nativeSources } from "../src/sources";
import { readSchema } from "../src/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("native evidence links preserve full card paths and local IDs", () => {
  for (const path of ["evidence/sources/example.org/paper.pdf.md", "evidence/sources/other.org/readme.md.md", "evidence/records/2026-09/run.tsv.md"])
    assert.deepEqual(nativeSource(`[[${path}|paper-1]]`), { path, id: "paper-1" });
});

test("native evidence links reject ambiguous, escaped, external and fragment targets", () => {
  for (const value of ["[[paper]]", "[[paper.md]]", "[[paper.md|Bad ID]]", "[[paper.md|id|extra]]",
    "[[../paper.md|id]]", "[[/evidence/paper.md|id]]", "[[evidence//paper.md|id]]",
    "[[evidence/./paper.md|id]]", "[[evidence/paper.pdf|id]]", "[[evidence/paper.md#L2|id]]",
    "[[evidence/paper.md?x|id]]", "[[https://x/paper.md|id]]", "[[file:///paper.md|id]]",
    "[[evidence/%2e%2e/paper.md|id]]", "[[evidence\\paper.md|id]]", null, { id: "x" }])
    assert.equal(nativeSource(value), undefined, String(value));
});

test("native lists keep the native widget, including empty and invalid editable links", () => {
  assert.equal(nativeSources([]), true);
  assert.equal(nativeSources(["[[paper.md|paper]]"]), true);
  assert.equal(nativeSources(["unfinished input"]), true);
  assert.equal(nativeSources([{ id: "paper", resource: "x.md" }]), false);
  assert.equal(nativeSources(null), false);
});

test("schema declares the source format explicitly and rejects unknown formats", () => {
  const raw = JSON.parse(readFileSync(join(process.env.KB_TYPES_ROOT!, "example-vault/.kb/schema.json"), "utf8"));
  raw.formats.sources = "wikilink";
  assert.equal(readSchema(JSON.stringify(raw)).formats.sources, "wikilink");
  raw.formats.sources = "unknown-format";
  assert.throws(() => readSchema(JSON.stringify(raw)), /formats.sources/);
});
