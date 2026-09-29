// Unit tests against the self-contained, synthetic example schema. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyTemplate, claimedAttributes, claimRows, claimsBlock, iconCss, nextValue, pageName, readFrontmatter, setFrontmatterKey,
  readSchema, specFor, validate, valueChoices, type KbSchema, type PageInfo,
} from "../src/core";

const VAULT = join(process.env.KB_TYPES_ROOT!, "example-vault");
const schemaText = readFileSync(join(VAULT, ".kb/schema.json"), "utf8");
const schema: KbSchema = readSchema(schemaText);
const models = schema.directories["bank/entities/models"];

const PAGES: Record<string, PageInfo> = {
  "alpha-lab": { type: "entity", class: "organization" },
  "alpha-family": { type: "entity", class: "model" },
  "masked-diffusion": { type: "concept" },
};
const lookup = (n: string) => PAGES[n];

test("v3 vocabulary edits reach directory keys, templates and choices without an export", () => {
  const raw = JSON.parse(schemaText);
  raw.attributes.license.label = "许可测试";
  raw.enums.license["test-license"] = "测试许可";
  raw.directories["bank/entities/models"].required.push("layers");
  const edited = readSchema(JSON.stringify(raw));
  const model = edited.directories["bank/entities/models"];
  assert.equal(edited.vocabulary.license, "许可测试");
  assert.equal(model.keys.license.label, "许可测试");
  assert.ok(valueChoices(edited, model, "license", [])!.includes("test-license"));
  assert.equal(model.template.layers, "");
  assert.deepEqual(model.keys.part_of.targets, [{ type: "entity", class: ["model"] }]);
  assert.equal(model.keys.tpf.place, "claim");
});

function page(extra: string): string {
  return `---\ntype: entity\nclass: model\ntitle: Alpha 7B\ndescription: 测试用模型。\n` +
    `generated: {by: test/1, at: 2026-09-25T10:00:00+00:00}\n${extra}---\n# Alpha 7B\n`;
}
const REQUIRED = 'developed_by: "[[alpha-lab]]"\ninstance_of: "[[masked-diffusion]]"\ninitialized_from: none\n' +
  "released: 2025-02\nlicense: mit\nparams-total: 7.0B\n";

function codes(text: string, spec = models): string[] {
  const { data, error } = readFrontmatter(text);
  return validate(schema, spec, data, error, lookup, claimedAttributes(text)).map((f) => `${f.severity}:${f.code}`).sort();
}

test("directories bind by path; index and log files are not pages", () => {
  assert.equal(specFor(schema, "bank/entities/models/alpha-7b.md"), models);
  assert.equal(specFor(schema, "bank/entities/models/index.md"), undefined);
  assert.equal(specFor(schema, "bank/log.md"), undefined);
  assert.equal(specFor(schema, "evidence/sources/x.org/a.md"), undefined);
  assert.equal(pageName("bank/concepts/block-diffusion.md"), "block-diffusion");
});

test("a complete page passes", () => {
  assert.deepEqual(codes(page(REQUIRED)), []);
});

test("missing required keys are errors", () => {
  assert.deepEqual(codes(page("")), Array(6).fill("error:fm-required"));
});

test("a required key carried by a claim that is not retracted counts as written", () => {
  const claim = (extra: string) => page(REQUIRED.replace("params-total: 7.0B\n", "")) +
    "\n## 断言\n\n```yaml\n- id: alpha-7b--params-total\n  attribute: params-total\n  value: unknown\n" +
    `  valid: {at: 2026-09}\n${extra}\`\`\`\n`;
  assert.deepEqual(codes(claim("")), []);
  assert.deepEqual(codes(claim("  retracted: {reason: wrong row, by: human:t, at: 2026-09-26T10:00:00+00:00}\n")),
    ["error:fm-required"]);
});

test("wrong value types, enums and wikilink targets are errors with kb's codes", () => {
  const bad = (from: string, to: string) => codes(page(REQUIRED.replace(from, to)));
  assert.deepEqual(bad("params-total: 7.0B", "params-total: about 7B"), ["error:fm-value"]);
  assert.deepEqual(bad("released: 2025-02", "released: 2025-13"), ["error:fm-value"]);
  assert.deepEqual(bad("license: mit", "license: MIT"), ["error:fm-value"]);
  assert.deepEqual(bad('"[[alpha-lab]]"', "alpha-lab"), ["error:fm-value"]);
  assert.deepEqual(bad('"[[alpha-lab]]"', '"[[ghost-lab]]"'), ["error:fm-page-ref"]);
  assert.deepEqual(bad('"[[alpha-lab]]"', '"[[masked-diffusion]]"'), ["error:fm-object"]);
  assert.deepEqual(bad("initialized_from: none", 'initialized_from:\n  - "[[alpha-family]]"\n  - none'),
                   ["error:fm-value"]);
  assert.deepEqual(bad("license: mit", "license: unknown"), []);
  assert.deepEqual(bad("license: mit", "license:"), ["error:fm-value"]);
});

test("keys the class cannot carry, and scoped attributes, are flagged", () => {
  assert.deepEqual(codes(page(REQUIRED + "founded: 2020\n")), ["error:fm-subject"]);
  assert.deepEqual(codes(page(REQUIRED + "tpf: 4\n")), ["error:fm-place"]);
  assert.deepEqual(codes(page(REQUIRED + "part_of: \"[[alpha-family]]\"\nnotes: free\n")), []);
});

test("base keys, directory binding and broken frontmatter", () => {
  assert.deepEqual(codes(page(REQUIRED).replace("title: Alpha 7B\n", "")), ["error:frontmatter-required"]);
  assert.deepEqual(codes(page(REQUIRED).replace("class: model", "class: software")), ["error:page-location"]);
  assert.deepEqual(codes("# no frontmatter\n"), ["error:frontmatter"]);
  assert.deepEqual(codes("---\na: 1\na: 2\n---\n"), ["error:frontmatter"]);
});

test("the template fills an empty file and keeps what a Bases button pre-filled", () => {
  const gen = { by: "human:demo", at: "2026-09-26T10:00:00+08:00" };
  const t = applyTemplate("", models, gen)!;
  assert.match(t, /^---\ntype: entity\nclass: model\ntitle:\ndescription:\ngenerated: \{by: "human:demo", at: 2026-09-26T10:00:00\+08:00\}\ndeveloped_by:\n/);
  assert.match(t, /\nparams-total:\nsources: \[\]\n---\n$/);
  assert.equal(readFrontmatter(t).error, undefined);
  const fromBases = applyTemplate("---\ntype: entity\nclass: model\ntitle: \"A: B\"\n---\n", models, gen)!;
  assert.match(fromBases, /\ntitle: "A: B"\n/);
  assert.equal(applyTemplate("---\ntype: entity\ntitle: x\ndescription: y\n---\n", models, gen), null);
  assert.equal(applyTemplate("---\ntype: entity\n---\nbody text\n", models, gen), null);
  assert.equal(applyTemplate("hello", models, gen), null);
  const concept = applyTemplate("", schema.directories["bank/concepts"], gen)!;
  assert.doesNotMatch(concept, /class:/);
});

test("setting a key edits only its own lines", () => {
  const text = page(REQUIRED + "part_of:\n  - \"[[alpha-family]]\"\nsources:\n  - id: p\n    resource: x.md\n");
  const out = setFrontmatterKey(text, "license", "apache-2.0")!;
  assert.equal(out, text.replace("license: mit", "license: apache-2.0"));
  const list = setFrontmatterKey(text, "part_of", ["[[a]]", "[[b]]"])!;
  assert.match(list, /\npart_of:\n  - "\[\[a\]\]"\n  - "\[\[b\]\]"\nsources:\n  - id: p\n/);
  const added = setFrontmatterKey(text, "layers", "32")!;
  assert.match(added, /\nlayers: 32\nsources:\n/);
  assert.match(added, /generated: \{by: test\/1, at: 2026-09-25T10:00:00\+00:00\}/);
  assert.equal(setFrontmatterKey("no frontmatter", "a", "b"), null);
});

test("field edits handle quoted keys, blank lines in lists and neighboring comments", () => {
  const original = '---\ntitle: Test\n"part_of":\n  - "[[a]]"\n\n  - "[[b]]"\n# source comment\nsources: [{id: p}]\n---\nBody\n';
  const after = setFrontmatterKey(original, "part_of", ["[[c]]"])!;
  assert.equal(after, '---\ntitle: Test\npart_of:\n  - "[[c]]"\n# source comment\nsources: [{id: p}]\n---\nBody\n');
  assert.equal(readFrontmatter(after).error, undefined);
  const empty = '---\ntitle: Test\npart_of:\nsources: []\n---';
  assert.equal(setFrontmatterKey(empty, "part_of", []), empty.replace('part_of:\n', 'part_of: []\n'));
  assert.equal(setFrontmatterKey('---\nx: a\nx: b\n---\n', 'x', 'c'), null);
  assert.equal(setFrontmatterKey('---\npart_of: &parent "[[a]]"\nother: *parent\n---\n', 'part_of', '[[b]]'), null);
});

test("choices come from the registry's enum and from pages of the allowed classes", () => {
  const pages = Object.entries(PAGES).map(([name, info]) => ({ name, info }));
  const lic = valueChoices(schema, models, "license", pages)!;
  assert.ok(lic.includes("mit") && lic.includes("proprietary") && lic.includes("unknown"));
  assert.deepEqual(valueChoices(schema, models, "developed_by", pages), ["[[alpha-lab]]", "unknown", "none"]);
  assert.equal(valueChoices(schema, models, "params-total", pages), null);
  assert.equal(valueChoices(schema, models, "tpf", pages), null);
  const dev = models.keys.developed_by, lic2 = models.keys.license;
  assert.equal(nextValue(schema, lic2, "mit", "apache-2.0"), "apache-2.0");
  assert.equal(nextValue(schema, dev, "", "[[a]]"), "[[a]]");
  assert.deepEqual(nextValue(schema, dev, "[[a]]", "[[b]]"), ["[[a]]", "[[b]]"]);
  assert.deepEqual(nextValue(schema, dev, ["[[a]]", "[[b]]"], "[[a]]"), ["[[a]]", "[[b]]"]);
  assert.equal(nextValue(schema, dev, "unknown", "[[a]]"), "[[a]]");
  assert.equal(nextValue(schema, dev, ["[[a]]"], "none"), "none");
});

const CLAIMS = page("") + "\n```yaml\n- not: claims\n```\n\n## 断言\n\n```yaml\n" +
  "- id: a--tpf\n  attribute: tpf\n  value: 0.8000\n  unit: token/forward\n  scope: {decoding: static, count: full-block}\n" +
  "  basis: derived\n  method: static-tpf-derivation\n  evidence:\n    - {source: cfg, at: \"L1-L3\"}\n" +
  "  verified:\n    - {by: human:demo, at: 2026-09-25T10:00:00+08:00}\n" +
  "- id: a--params\n  attribute: params-total\n  value: {low: 265B, mid: 847B, high: 2.7T, p: 0.9}\n  unit: parameter\n" +
  "  basis: estimated\n  retracted: {reason: typo, by: human:demo, at: 2026-09-25T10:00:00+08:00, replaced_by: a--p2}\n" +
  "```\n";

test("the claims block is the first yaml fence under ## 断言, read literally", () => {
  const block = claimsBlock(CLAIMS)!;
  const lines = CLAIMS.split("\n");
  assert.equal(lines[block.fenceLine], "```yaml");
  assert.equal(lines[block.fenceLine - 2], "## 断言");
  const { rows, error } = claimRows(schema, block.yaml);
  assert.equal(error, undefined);
  assert.equal(rows[0].value, "0.8000 token/forward");
  assert.equal(rows[0].label, schema.vocabulary.tpf);
  assert.equal(rows[0].scope, "decoding=static，count=full-block");
  assert.equal(rows[0].basis, "derived（static-tpf-derivation）");
  assert.equal(rows[0].evidence, "cfg L1-L3");
  assert.equal(rows[0].verified, "human:demo");
  assert.equal(rows[1].value, "265B – 2.7T，中值 847B，p=0.9 parameter");
  assert.match(rows[1].state, /^已撤回：typo（由 a--p2 取代）$/);
  assert.equal(claimsBlock(page("")), null);
  assert.match(claimsBlock(page("") + "## 断言\n\ntext\n")!.error!, /yaml/);
  assert.match(claimRows(schema, "- a: [").error!, /解析失败/);
});

test("icon CSS covers every bound directory and skips unknown icons", () => {
  const css = iconCss(schema, (icon) => (icon === "brain" ? "<svg/>" : null));
  assert.match(css, /data-path\^="bank\/entities\/models\/"/);
  assert.match(css, /data-path="bank\/entities\/models"/);
  assert.equal(css.split("-webkit-mask:").length - 1, 1);
});
