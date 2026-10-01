import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readFrontmatter, readSchema, splitFrontmatter } from "../src/core";
import { planSourceBacklinks, readSourceLines } from "../src/source-backlinks";

const cardPath = "evidence/sources/example.org/paper.html.md";
const card = '---\ntype: source\ntitle: "Paper"\npublisher: Example\ngrade: official\ncaptured_at: 2026-09-01T00:00:00Z\nsha256: abc\nextracted_by: defuddle/0.19.4\n---\nText at its original absolute line.\n![](missing.png)\n';
function schema(enabled = true) {
  const raw = JSON.parse(readFileSync(join(process.env.NOTEWEAVER_ROOT!, "example-vault/.noteweaver/schema.json"), "utf8"));
  raw.formats.sources = "wikilink";
  if (enabled) raw.formats.sources_inverse = "cited_by";
  return readSchema(JSON.stringify(raw));
}
function page(name = "alpha", source = cardPath) {
  return { path: `bank/concepts/${name}.md`, text: `---\ntype: concept\nsources: ["[[${source}|paper]]"]\n---\nBody\n` };
}

test("source frontmatter has clickable inverse links without moving evidence lines", () => {
  const plan = planSourceBacklinks(schema(), [page()], [{ path: cardPath, text: card }]);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.patches.length, 1);
  const after = plan.patches[0].after;
  assert.deepEqual(readFrontmatter(after).data?.cited_by, ["[[bank/concepts/alpha.md]]"]);
  assert.deepEqual(splitFrontmatter(after).body, splitFrontmatter(card).body);
  assert.equal(splitFrontmatter(after).bodyLine, splitFrontmatter(card).bodyLine);
  const { cited_by, ...metadata } = readFrontmatter(after).data!;
  assert.deepEqual(metadata, readFrontmatter(card).data);
  assert.deepEqual(planSourceBacklinks(schema(), [page()], [{ path: cardPath, text: after }]).patches, []);
});

test("backlinks follow citation additions, removals, renames and duplicate registrations", () => {
  const first = planSourceBacklinks(schema(), [page("zeta"), page("alpha"), page("alpha")], [{ path: cardPath, text: card }]);
  const current = first.patches[0].after;
  assert.deepEqual(readFrontmatter(current).data?.cited_by, ["[[bank/concepts/alpha.md]]", "[[bank/concepts/zeta.md]]"]);
  const renamed = planSourceBacklinks(schema(), [page("renamed")], [{ path: cardPath, text: current }]);
  assert.deepEqual(readFrontmatter(renamed.patches[0].after).data?.cited_by, ["[[bank/concepts/renamed.md]]"]);
  const removed = planSourceBacklinks(schema(), [], [{ path: cardPath, text: renamed.patches[0].after }]);
  assert.deepEqual(readFrontmatter(removed.patches[0].after).data?.cited_by, []);
  assert.equal(splitFrontmatter(removed.patches[0].after).bodyLine, splitFrontmatter(card).bodyLine);
});

test("inverse references are opt-in, exact-path based, and include record cards", () => {
  assert.deepEqual(planSourceBacklinks(schema(false), [page()], [{ path: cardPath, text: card }]).patches, []);
  const recordPath = "evidence/records/2026-09/paper.html.md";
  const record = card.replace("type: source", "type: record");
  const plan = planSourceBacklinks(schema(), [page("alpha", recordPath)], [{ path: cardPath, text: card }, { path: recordPath, text: record }]);
  assert.equal(plan.patches.length, 1);
  assert.equal(plan.patches[0].path, recordPath);
});

test("malformed citations stop all inverse writes; indexes and examples do not create backlinks", () => {
  const bad = page(); bad.text = bad.text.replace("|paper", "|Invalid ID");
  const plan = planSourceBacklinks(schema(), [page(), bad], [{ path: cardPath, text: card }]);
  assert.equal(plan.issues.length, 1);
  assert.deepEqual(plan.patches, []);
  const ignored = { ...page(), path: "bank/concepts/index.md" };
  assert.deepEqual(planSourceBacklinks(schema(), [ignored], [{ path: cardPath, text: card }]).patches, []);
});

test("native rename serialization is restored to the checkpoint's evidence lines", () => {
  const before = planSourceBacklinks(schema(), [page()], [{ path: cardPath, text: card }]).patches[0].after;
  // Obsidian's actual rename writer expands flow YAML and changes native links.
  const native = card.replace('---\nText', 'cited_by:\n  - "[[bank/concepts/renamed]]"\n---\nText');
  assert.notEqual(splitFrontmatter(native).bodyLine, splitFrontmatter(before).bodyLine);
  const checkpoint = readSourceLines({ [cardPath]: splitFrontmatter(before).bodyLine });
  const plan = planSourceBacklinks(schema(), [page("renamed")], [{ path: cardPath, text: native }], "evidence", new Map(Object.entries(checkpoint)));
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.patches.length, 1);
  const after = plan.patches[0].after;
  assert.equal(splitFrontmatter(after).bodyLine, splitFrontmatter(before).bodyLine);
  assert.equal(splitFrontmatter(after).body, splitFrontmatter(before).body);
  assert.deepEqual(readFrontmatter(after).data?.cited_by, ["[[bank/concepts/renamed.md]]"]);
});
