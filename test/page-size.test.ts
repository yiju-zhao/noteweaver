import test from "node:test";
import assert from "node:assert/strict";
import { initialFiles } from "../src/initialize";
import { MemoryStore, Repo } from "../src/bank/model";
import { execute } from "../src/bank/operations";

function sizeFindings(body: string) {
  const initial = initialFiles();
  const path = "bank/analyses/long-page.md";
  const text = "---\ntype: analysis\ntitle: Long page\ndescription: A long analysis\n" +
    "generated: {by: test/1, at: 2026-10-13T00:00:00Z}\n---\n" + body;
  const files = new Map(Object.entries({ ...initial.files, [path]: text })
    .map(([path, text]) => [path, { text, bytes: Buffer.byteLength(text), hash: "" }]));
  const repo = new Repo({ vault: "", config: initial.config, paths: initial.config.paths }, new MemoryStore(files));
  const result = execute(repo, { operation: "check" });
  assert.deepEqual(result.changes, []);
  return result.data.findings.filter((f: any) => f.code === "page-size");
}

test("page-size reports UTF-8 bytes and the largest H2 section's file lines", () => {
  const large = "## 长章节\n" + "知".repeat(12000) + "\n";
  const body = "# Long page\n\n## Short\nsmall\n" + large + "## End\nend\n";
  const [finding] = sizeFindings(body);
  assert.equal(finding.severity, "warning");
  assert.equal(finding.path, "bank/analyses/long-page.md");
  assert.equal(finding.line, 11);
  assert.match(finding.message, new RegExp(`body is ${Buffer.byteLength(body)} bytes`));
  assert.match(finding.message, new RegExp(`largest section .*长章节.*L11-L12.*${Buffer.byteLength(large)} bytes`));
  assert.match(finding.message, /smaller subsections/);
});

test("page-size ignores fenced example headings and keeps all section bytes", () => {
  const section = "## Real\n```md\n## Fake\n" + "a".repeat(33000) + "\n```\n";
  const [finding] = sizeFindings("# Long page\n" + section + "## End\nend");
  assert.equal(finding.line, 8);
  assert.match(finding.message, new RegExp(`largest section .*Real.*L8-L12.*${Buffer.byteLength(section)} bytes`));
  assert.doesNotMatch(finding.message, /Fake/);
});

test("page-size preserves the strict body threshold and supports an unsectioned page", () => {
  assert.deepEqual(sizeFindings("a".repeat(32768)), []);
  const [finding] = sizeFindings("a".repeat(32769));
  assert.equal(finding.line, 7);
  assert.match(finding.message, /body is 32769 bytes/);
  assert.match(finding.message, /no H2 sections/);
});

test("a long page of small sections recommends section reads without requiring a split", () => {
  const body = [1, 2, 3].map(n => `## Section ${n}\n${"x".repeat(12000)}\n`).join("");
  const [finding] = sizeFindings(body);
  assert.match(finding.message, /read (?:it )?by section/);
  assert.doesNotMatch(finding.message, /smaller subsections/);
});

test("a large preamble is located before the first H2 heading", () => {
  const preamble = "# Long page\n" + "x".repeat(33000) + "\n";
  const [finding] = sizeFindings(preamble + "## Short\nsmall\n");
  assert.equal(finding.line, 7);
  assert.match(finding.message, new RegExp(`largest section "preamble" L7-L8 is ${Buffer.byteLength(preamble)} bytes`));
});
