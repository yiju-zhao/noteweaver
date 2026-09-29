import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceLink, evidencePath } from "../src/nested";

test("evidence paths resolve from the note directory, including record originals ending in md", () => {
  assert.equal(evidencePath("bank/entities/organizations/alpha-lab.md", "../../../evidence/sources/example.org/a.html.md"),
    "evidence/sources/example.org/a.html.md");
  assert.equal(evidencePath("bank/methods/test.md", "../../evidence/records/2026-09/report.md.md"),
    "evidence/records/2026-09/report.md.md");
});

test("resource navigation cannot escape the vault, use URL schemes or target bank pages", () => {
  for (const resource of ["https://example.org/a.md", "file:///tmp/a.md", "javascript:alert(1)",
    "/evidence/sources/example.org/a.md", "../../../../evidence/sources/example.org/a.md",
    "..\\..\\evidence\\a.md", "[[a]]", "../concepts/a.md", "../../evidence/sources/example.org/a.pdf",
    "../../evidence/sources/example.org/a.md#fragment", "../../evidence/sources/example.org/a.md?x", null, {}]) {
    assert.equal(evidencePath("bank/methods/test.md", resource), undefined, String(resource));
  }
});

test("exact card lookup supplies the title; missing cards never become guessed links", () => {
  const card = { path: "evidence/sources/example.org/a.html.md", title: "A <test> & its evidence" };
  const lookup = (path: string) => path === card.path ? card : undefined;
  assert.deepEqual(evidenceLink("bank/concepts/a.md", "../../" + card.path, lookup), card);
  assert.equal(evidenceLink("bank/concepts/a.md", "../../evidence/sources/other.org/a.html.md", lookup), undefined);
});
