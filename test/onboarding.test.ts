import test from "node:test";
import assert from "node:assert/strict";
import { initialFiles } from "../src/initialize";
import { planOnboarding } from "../src/onboarding";

test("blank vault onboarding previews a conforming scaffold without writes or page content", () => {
  const result = planOnboarding({ vaultName: "research" }, new Map(), new Map());
  assert.equal(result.code, 0);
  assert.equal(result.data.state, "blank");
  assert.equal(result.data.initialization.code, 0);
  assert.ok(result.data.initialization.files.includes(".noteweaver/config.json"));
  assert.equal(result.data.inventory.totalNotes, 0);
  assert.deepEqual(result.changes, []);
});

test("existing vault inventory reports exact bindings, metadata gaps, duplicates and original paths", () => {
  const markdown = new Map([
    ["Welcome.md", "# PRIVATE ORIGINAL BODY"],
    ["projects/idea.md", "---\ntitle: Original idea\ntype: concept\n---\nOriginal text"],
    ["pages/concepts/idea.md", "---\ntitle: Managed idea\n---\nText"],
    ["pages/concepts/nested/draft.md", "# Not recursively bound"],
    ["pages/concepts/index.md", "# Navigation"],
    ["evidence/sources/demo/paper.pdf.md", "---\ntype: source\n---\nOriginal evidence"],
  ]);
  const before = [...markdown];
  const occupied = new Set([...markdown.keys(), "attachments/figure.png"]);
  const result = planOnboarding({ vaultName: "research" }, new Map(), markdown, occupied);
  const inventory = result.data.inventory;
  assert.equal(result.code, 1); // The existing index needs an explicit preservation plan.
  assert.deepEqual(result.data.conflicts, ["existing file differs: pages/concepts/index.md"]);
  assert.equal(result.data.state, "existing");
  assert.equal(inventory.unmanagedNotes, 2);
  assert.equal(inventory.knowledgeNotes, 2);
  const note = (path: string) => inventory.notes.find((n: any) => n.path === path);
  assert.equal(note("Welcome.md").needsSlug, true);
  assert.equal(note("Welcome.md").frontmatterError, "missing frontmatter");
  assert.equal(note("projects/idea.md").declaredType, "concept");
  assert.equal(note("projects/idea.md").binding, null);
  assert.deepEqual(note("pages/concepts/idea.md").binding, { type: "concept", class: null, required: [] });
  assert.deepEqual(note("pages/concepts/idea.md").missingProperties, ["type", "description", "generated"]);
  assert.equal(note("pages/concepts/nested/draft.md").binding, null);
  assert.equal(note("pages/concepts/index.md").role, "navigation");
  assert.equal(note("evidence/sources/demo/paper.pdf.md").role, "evidence");
  assert.deepEqual(inventory.duplicateNames, [{ name: "idea", paths: ["pages/concepts/idea.md", "projects/idea.md"] }]);
  assert.deepEqual(inventory.otherFiles, ["attachments/figure.png"]);
  assert.deepEqual(inventory.directories.find((d: any) => d.path === ""), { path: "", notes: 1, otherFiles: 0 });
  assert.equal(JSON.stringify(result).includes("PRIVATE ORIGINAL BODY"), false);
  assert.deepEqual([...markdown], before);
  assert.deepEqual(result.changes, []);
});

test("an attachment-only vault is existing, and malformed YAML remains inspectable", () => {
  assert.equal(planOnboarding({ vaultName: "research" }, new Map(), new Map(), new Set(["figure.png"])).data.state, "existing");
  const result = planOnboarding({ vaultName: "research" }, new Map(), new Map([["broken.md", "---\ntitle: [\n---\n# Broken"]]));
  assert.match(result.data.inventory.notes[0].frontmatterError, /does not parse/);
  assert.deepEqual(result.changes, []);
});

test("initialized vault onboarding reads custom paths and vocabulary without resetting edited templates", () => {
  const initial = initialFiles({ name: "Existing vault", paths: { bank: "notes", schema: "rules/vocabulary.json" } });
  const schema = JSON.parse(initial.files["rules/vocabulary.json"]);
  schema.base_required.push("owner");
  const observed = new Map(Object.entries(initial.files));
  observed.set("rules/vocabulary.json", JSON.stringify(schema));
  observed.set(".noteweaver/policies/pages.md", "Custom policy, preserve these bytes");
  const before = [...observed];
  const result = planOnboarding({ vaultName: "research" }, observed, new Map([["notes/concepts/idea.md", "# Existing idea"]]));
  assert.equal(result.code, 0);
  assert.equal(result.data.state, "initialized");
  assert.equal(result.data.config.name, "Existing vault");
  assert.equal(result.data.initialization, null);
  assert.ok(result.data.inventory.notes[0].missingProperties.includes("owner"));
  assert.deepEqual([...observed], before);
  assert.deepEqual(result.changes, []);
});

test("legacy markers and occupied targets produce reviewable conflicts without writes", () => {
  for (const marker of [".kb", ".noteweave", ".obsidian/kb-schema.json"]) {
    const result = planOnboarding({ vaultName: "research" }, new Map(), new Map(), new Set([marker]));
    assert.equal(result.code, 1);
    assert.equal(result.data.state, "legacy");
    assert.match(result.data.conflicts[0], /migrate existing/);
    assert.deepEqual(result.changes, []);
  }
  const observed = new Map([["pages/index.md", "User index"]]);
  const result = planOnboarding({ vaultName: "research" }, observed, new Map(), new Set(["pages/index.md"]));
  assert.equal(result.code, 1);
  assert.deepEqual(result.data.conflicts, ["existing file differs: pages/index.md"]);
  assert.deepEqual([...observed], [["pages/index.md", "User index"]]);
  assert.deepEqual(result.changes, []);
});

test("incomplete instances fail explicitly instead of proposing a replacement schema", () => {
  assert.throws(() => planOnboarding({ vaultName: "research" }, new Map([[".noteweaver/config.json", "{\"version\":1}"]]), new Map()), /missing instance schema/);
  assert.throws(() => planOnboarding({ vaultName: "research" }, new Map([[".noteweaver/config.json", "broken"]]), new Map()));
});

test("a present false boolean satisfies a required frontmatter property in the inventory", () => {
  const initial = initialFiles({ vaultName: "research" });
  const schema = JSON.parse(initial.files[".noteweaver/schema.json"]);
  schema.attributes.reviewed = {
    label: "Reviewed", value: "boolean", place: "frontmatter", multi: false,
    subject: [{ type: "concept" }], object: [], unit: "", meaning: "Review completed",
    not_for: "Human identity", statement: "{subject} reviewed {value}",
    jev: { what: "Reviewed", not_for: "Human identity", examples: [] },
  };
  schema.jev.attribute.order.unshift("reviewed");
  schema.directories["pages/concepts"].required = ["reviewed"];
  const observed = new Map(Object.entries(initial.files));
  observed.set(".noteweaver/schema.json", JSON.stringify(schema));
  const result = planOnboarding({ vaultName: "research" }, observed, new Map([["pages/concepts/idea.md", "---\nreviewed: false\n---\n# Idea"]]));
  assert.equal(result.code, 0);
  assert.equal(result.data.inventory.notes[0].missingProperties.includes("reviewed"), false);
});
