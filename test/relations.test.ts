import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readFrontmatter, readSchema, setFrontmatterKey } from "../src/core";
import { applyRelationPlan, planRelations, type RelationPage, type RelationPlan } from "../src/relations";

const raw = JSON.parse(readFileSync(join(process.env.NOTEWEAVE_ROOT!, "example-vault/.kb/schema.json"), "utf8"));
const schema = readSchema(JSON.stringify(raw));
function page(name: string, cls = "model", fields = ""): RelationPage {
  const dir = cls === "concept" ? "concepts" : `entities/${cls === "organization" ? "organizations" : cls === "person" ? "people" : "models"}`;
  return { path: `bank/${dir}/${name}.md`, text: `---\ntype: ${cls === "concept" ? "concept" : "entity"}\n` +
    (cls === "concept" ? "" : `class: ${cls}\n`) + `title: ${name}\n${fields}` +
    '# Keep this formatting.\nparams-total: "7.00B"\nsources: [{id: p, resource: "x.md"}]\n---\n' +
    '# Body\n\n## 断言\n\n```yaml\n- attribute: uses\n  value: concept\n  scope: {mode: test}\n```\n' };
}
const fixtures = () => [page("model"), page("base"), page("other"), page("lab", "organization"), page("concept", "concept")];
function edit(pages: RelationPage[], name: string, key: string, value: string | string[]): RelationPage[] {
  return pages.map((p) => p.path.endsWith(`/${name}.md`) ? { ...p, text: setFrontmatterKey(p.text, key, value)! } : p);
}
function applied(pages: RelationPage[], plan: RelationPlan): RelationPage[] {
  assert.deepEqual(plan.issues, []);
  return pages.map((p) => ({ ...p, text: plan.patches.find((q) => q.path === p.path)?.after ?? p.text }));
}
function value(pages: RelationPage[], name: string, key: string): unknown {
  return readFrontmatter(pages.find((p) => p.path.endsWith(`/${name}.md`))!.text).data![key];
}

test("initial sync derives explicit inverses and preserves every unrelated byte", () => {
  const pages = edit(fixtures(), "model", "developed_by", "[[lab]]");
  const first = planRelations(schema, pages);
  assert.equal(first.patches.length, 1);
  const after = applied(pages, first);
  assert.deepEqual(value(after, "lab", "developed"), ["[[model]]"]);
  assert.equal(after[0].text, pages[0].text);
  assert.equal(after[3].text.replace('developed:\n  - "[[model]]"\n', ""), pages[3].text);
  assert.deepEqual(planRelations(schema, after, first.state).patches, []);
});

test("both ends support add/remove, including deleting a whole property", () => {
  let pages = fixtures();
  let state = planRelations(schema, pages).state;
  pages = edit(pages, "lab", "developed", ["[[model]]", "[[base]]"]);
  let plan = planRelations(schema, pages, state);
  pages = applied(pages, plan); state = plan.state;
  assert.deepEqual(value(pages, "model", "developed_by"), ["[[lab]]"]);
  assert.deepEqual(value(pages, "base", "developed_by"), ["[[lab]]"]);
  pages = edit(pages, "lab", "developed", ["[[base]]"]);
  plan = planRelations(schema, pages, state);
  pages = applied(pages, plan); state = plan.state;
  assert.deepEqual(value(pages, "model", "developed_by"), []);
  pages = pages.map((p) => p.path.endsWith("/base.md") ? { ...p, text: p.text.replace('developed_by:\n  - "[[lab]]"\n', "") } : p);
  plan = planRelations(schema, pages, state);
  pages = applied(pages, plan);
  assert.deepEqual(value(pages, "lab", "developed"), []);
});

test("restart keeps removals instead of resurrecting a stale reverse link", () => {
  let pages = edit(fixtures(), "model", "initialized_from", "[[base]]");
  const first = planRelations(schema, pages);
  pages = applied(pages, first);
  const persisted = JSON.parse(JSON.stringify(first.state));
  pages = edit(pages, "model", "initialized_from", "none");
  const restart = planRelations(schema, pages, persisted);
  pages = applied(pages, restart);
  assert.equal(value(pages, "model", "initialized_from"), "none");
  assert.deepEqual(value(pages, "base", "derived_models"), []);
});

test("single-valued replacement updates old and new targets without mixing predicates", () => {
  let pages = edit(edit(fixtures(), "model", "initialized_from", "[[base]]"), "model", "part_of", "[[base]]");
  const first = planRelations(schema, pages);
  pages = edit(applied(pages, first), "model", "initialized_from", "[[other]]");
  const plan = planRelations(schema, pages, first.state);
  pages = applied(pages, plan);
  assert.deepEqual(value(pages, "base", "derived_models"), []);
  assert.deepEqual(value(pages, "base", "parts"), ["[[model]]"]);
  assert.deepEqual(value(pages, "other", "derived_models"), ["[[model]]"]);
});

test("conflicting edits from both ends never pick a single-valued winner", () => {
  const initial = fixtures();
  const state = planRelations(schema, initial).state;
  const pages = edit(edit(initial, "model", "initialized_from", "[[base]]"), "other", "derived_models", ["[[model]]"]);
  const plan = planRelations(schema, pages, state);
  assert.ok(plan.issues.some((i) => i.code === "relation-conflict"));
  assert.deepEqual(plan.patches, []);
});

test("invalid endpoint types, unknown links, mixed special values and duplicate names stop writes", () => {
  for (const pages of [
    edit(fixtures(), "model", "developed_by", "[[concept]]"),
    edit(fixtures(), "lab", "developed", "[[concept]]"),
    edit(fixtures(), "model", "part_of", "[[lab]]"),
    edit(fixtures(), "model", "developed_by", "[[missing]]"),
    edit(fixtures(), "model", "developed_by", ["[[lab]]", "none"]),
    [...fixtures(), page("model", "organization")],
    [...fixtures(), { path: "bank/concepts/broken.md", text: "---\ntype: [\n---\n" }],
  ]) {
    const plan = planRelations(schema, pages);
    assert.ok(plan.issues.length > 0);
    assert.deepEqual(plan.patches, []);
  }
});

test("same-class constraint is retained when editing inverse fields", () => {
  const plan = planRelations(schema, edit(fixtures(), "lab", "parts", "[[model]]"));
  assert.ok(plan.issues.some((i) => i.code === "fm-object"));
  assert.deepEqual(plan.patches, []);
});

test("renames normalize checkpoints and links even before the native link updater finishes", () => {
  let pages = edit(fixtures(), "model", "developed_by", "[[lab]]");
  const initial = planRelations(schema, pages);
  pages = applied(pages, initial).map((p) => ({ ...p, path: p.path.replace("/lab.md", "/renamed-lab.md") }));
  const plan = planRelations(schema, pages, initial.state, new Map([["lab", "renamed-lab"]]));
  pages = applied(pages, plan);
  assert.deepEqual(value(pages, "model", "developed_by"), ["[[renamed-lab]]"]);
  assert.ok(plan.state.edges.every((e) => !e.includes("lab")));
  assert.deepEqual(planRelations(schema, pages, plan.state).patches, []);
});

test("deleting either endpoint removes its synchronized references", () => {
  const original = edit(fixtures(), "model", "developed_by", "[[lab]]");
  const initial = planRelations(schema, original);
  for (const [deleted, survivor, key] of [["model", "lab", "developed"], ["lab", "model", "developed_by"]]) {
    let pages = applied(original, initial).filter((p) => !p.path.endsWith(`/${deleted}.md`));
    const plan = planRelations(schema, pages, initial.state);
    pages = applied(pages, plan);
    assert.deepEqual(value(pages, survivor, key), []);
  }
});

test("native rename paths resolve to slugs; wrong folder references never resolve by basename alone", () => {
  for (const target of ["../organizations/lab", "bank/entities/organizations/lab.md", "../organizations/lab|Lab"]) {
    const pages = edit(fixtures(), "model", "developed_by", `[[${target}]]`);
    const after = applied(pages, planRelations(schema, pages));
    assert.deepEqual(value(after, "model", "developed_by"), ["[[lab]]"]);
    assert.deepEqual(value(after, "lab", "developed"), ["[[model]]"]);
  }
  const bad = planRelations(schema, edit(fixtures(), "model", "developed_by", "[[../wrong/lab]]"));
  assert.ok(bad.issues.some((i) => i.code === "fm-page-ref"));
  assert.deepEqual(bad.patches, []);
});

test("schema maps names and both cardinalities explicitly; labels never determine pairing", () => {
  const edited = structuredClone(raw);
  edited.predicates.developed_by.inverse_key = "products";
  edited.predicates.developed_by.inverse = "任意中文标签";
  edited.predicates.developed_by.inverse_multi = false;
  const custom = readSchema(JSON.stringify(edited));
  const pages = edit(edit(fixtures(), "model", "developed_by", "[[lab]]"), "base", "developed_by", "[[lab]]");
  assert.ok(planRelations(custom, pages).issues.some((i) => i.code === "relation-conflict" && i.key === "products"));
  edited.predicates.developed_by.inverse_key = "part_of";
  assert.throws(() => readSchema(JSON.stringify(edited)), /反向/);
  assert.throws(() => readSchema(JSON.stringify(raw).replace('"version":3', '"version":3,"version":3')), /重复/);
  const invalid = structuredClone(raw);
  invalid.predicates.developed_by.subject[0].class = ["unregistered"];
  assert.throws(() => readSchema(JSON.stringify(invalid)), /类别/);
});

test("scope/valid claims never produce an unscoped frontmatter relation", () => {
  assert.deepEqual(planRelations(schema, fixtures()).patches, []);
});

test("concurrent file edits are not overwritten or checkpointed; a retry converges", async () => {
  const pages = edit(fixtures(), "model", "developed_by", "[[lab]]");
  const plan = planRelations(schema, pages);
  let checkpoint = false;
  await assert.rejects(applyRelationPlan(plan, {
    update: async (_path, transform) => { transform(plan.patches[0].before + "Concurrent text\n"); },
    checkpoint: async () => { checkpoint = true; },
  }), /发生修改/);
  assert.equal(checkpoint, false);
  const after = new Map(pages.map((p) => [p.path, p.text]));
  await applyRelationPlan(plan, {
    update: async (path, transform) => { after.set(path, transform(after.get(path)!)); },
    checkpoint: async () => { checkpoint = true; },
  });
  assert.equal(checkpoint, true);
  assert.deepEqual(planRelations(schema, [...after].map(([path, text]) => ({ path, text })), plan.state).patches, []);
});

test("a partially applied removal can retry using the old checkpoint", async () => {
  let pages = edit(edit(fixtures(), "model", "developed_by", "[[lab]]"), "base", "developed_by", "[[lab]]");
  const initial = planRelations(schema, pages);
  pages = edit(applied(pages, initial), "lab", "developed", []);
  const plan = planRelations(schema, pages, initial.state);
  assert.equal(plan.patches.length, 2);
  const partial = pages.map((p) => ({ ...p, text: p.path === plan.patches[0].path ? plan.patches[0].after : p.text }));
  const retry = planRelations(schema, partial, initial.state);
  const done = applied(partial, retry);
  assert.deepEqual(value(done, "model", "developed_by"), []);
  assert.deepEqual(value(done, "base", "developed_by"), []);
});
