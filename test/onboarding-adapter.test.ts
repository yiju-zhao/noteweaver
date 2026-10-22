import test from "node:test";
import assert from "node:assert/strict";
import type { App } from "obsidian";
import Noteweaver from "../src/main";
import { initialFiles } from "../src/initialize";
import { ObsidianBank } from "../src/bank/obsidian";
import { memoryApp } from "./fixtures/obsidian";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("desktop onboard works without config and preserves every file without dryRun", async () => {
  const app = memoryApp([["Welcome.md", "# Original body"], ["photo.png", "original bytes"]]);
  const before = [...app.vault.adapter.files];
  const result = await new ObsidianBank(app as unknown as App).run({ operation: "onboard", vault: "/synthetic/fixture" });
  assert.equal(result.code, 0);
  assert.equal(result.data.state, "existing");
  assert.equal(result.data.inventory.totalNotes, 1);
  assert.deepEqual(result.data.inventory.otherFiles, ["photo.png"]);
  assert.deepEqual(result.changes, []);
  assert.deepEqual([...app.vault.adapter.files], before);
  assert.deepEqual(app.vault.adapter.writes, []);
});

test("desktop onboard uses an initialized instance's custom schema path and edited policies", async () => {
  const initial = initialFiles({ vaultName: "fixture", name: "Local instance", paths: { bank: "knowledge", schema: "rules/terms.json" } });
  initial.files[".noteweaver/policies/pages.md"] = "Locally maintained policy";
  const app = memoryApp([...Object.entries(initial.files), ["knowledge/concepts/idea.md", "# My idea"]]);
  const before = [...app.vault.adapter.files];
  const result = await new ObsidianBank(app as unknown as App).run({
    operation: "onboard", initialize: { name: "Proposed replacement", schema: { version: -1 } },
  });
  assert.equal(result.code, 0);
  assert.equal(result.data.config.name, "Local instance");
  assert.equal(result.data.config.paths.schema, "rules/terms.json");
  assert.equal(result.data.initialization, null);
  assert.deepEqual(result.data.inventory.notes.find((n: any) => n.path === "knowledge/concepts/idea.md").binding,
    { type: "concept", class: null, required: [] });
  assert.deepEqual([...app.vault.adapter.files], before);
  assert.deepEqual(app.vault.adapter.writes, []);
});

test("desktop onboard reports a file blocking a required directory without creating a scaffold", async () => {
  const app = memoryApp([["pages", "Original conflicting file"]]);
  const result = await new ObsidianBank(app as unknown as App).run({ operation: "onboard" });
  assert.equal(result.code, 1);
  assert.ok(result.data.conflicts.includes("file blocks directory: pages"));
  assert.deepEqual([...app.vault.adapter.files], [["pages", "Original conflicting file"]]);
  assert.deepEqual(app.vault.adapter.writes, []);
});

test("desktop onboard fails safely on wrong vault, invalid schema or concurrent requests", async () => {
  const initial = initialFiles({ vaultName: "fixture" });
  initial.files[".noteweaver/schema.json"] = "invalid schema";
  const app = memoryApp(Object.entries(initial.files));
  const bank = new ObsidianBank(app as unknown as App);
  assert.equal((await bank.run({ operation: "onboard", vault: "/wrong/vault" })).code, 2);
  const pending = bank.run({ operation: "onboard" });
  const concurrent = await bank.run({ operation: "onboard" });
  assert.equal(concurrent.code, 2);
  assert.match(concurrent.data.error, /another Noteweaver operation/);
  assert.equal((await pending).code, 2);
  assert.deepEqual(app.vault.adapter.writes, []);
});

test("plugin previews never trigger relation writes, while applied initialization still synchronizes", async () => {
  const app = memoryApp([["Welcome.md", "# Keep this original"]]);
  const plugin = new Noteweaver(app as unknown as App, { id: "noteweaver", name: "Noteweaver", version: "0.12.0", minAppVersion: "1.12.7", description: "", author: "fixture" });
  let synchronizations = 0;
  plugin.syncRelations = async () => { synchronizations++; };
  const preview = await plugin.runAutomation({ operation: "init", dryRun: true });
  assert.equal(preview.code, 0);
  assert.ok(preview.changes.length > 0);
  assert.deepEqual(app.vault.adapter.writes, []);
  assert.equal(synchronizations, 0);
  assert.equal((await plugin.runAutomation({ operation: "onboard" })).code, 0);
  assert.equal(synchronizations, 0);
  const applied = await plugin.runAutomation({ operation: "init" });
  assert.equal(applied.code, 0);
  assert.equal(synchronizations, 1);
  assert.equal(app.vault.adapter.files.get("Welcome.md"), "# Keep this original");
  assert.ok(app.vault.adapter.files.has(".noteweaver/config.json"));
  assert.ok(app.vault.adapter.files.has("pages/index.md"));
  assert.ok(app.vault.adapter.files.has("evidence/sources/.gitkeep"));
  assert.equal(JSON.parse(app.vault.adapter.files.get(".noteweaver/config.json")!).name, "fixture");
});

test("new child vaults must have their repository's name before any initialization writes", async () => {
  const app = memoryApp();
  app.vault.adapter.getBasePath = () => "/repos/daal-atlas/knowledge";
  app.vault.getName = () => "knowledge";
  for (const operation of ["onboard", "init"] as const) {
    const result = await new ObsidianBank(app as unknown as App).run({ operation, initialize: { repositoryRoot: ".." } });
    assert.equal(result.code, 2);
    assert.match(result.data.error, /vault name must match repository directory 'daal-atlas'/);
    assert.deepEqual(app.vault.adapter.writes, []);
  }
  app.vault.adapter.getBasePath = () => "/repos/daal-atlas/daal-atlas";
  app.vault.getName = () => "daal-atlas";
  const result = await new ObsidianBank(app as unknown as App).run({ operation: "onboard", initialize: { repositoryRoot: ".." } });
  assert.equal(result.code, 0);
  assert.equal(result.data.config.name, "daal-atlas");
  assert.equal(result.data.config.vault_name, "daal-atlas");
  assert.equal(result.data.config.paths.bank, "pages");
});

test("onboarding retains already initialized generic vault names and legacy bank paths", async () => {
  const initial = initialFiles({ vaultName: "knowledge", paths: { bank: "bank" }, repositoryRoot: ".." });
  const app = memoryApp(Object.entries(initial.files));
  app.vault.adapter.getBasePath = () => "/repos/daal-atlas/knowledge";
  app.vault.getName = () => "knowledge";
  const result = await new ObsidianBank(app as unknown as App).run({ operation: "onboard" });
  assert.equal(result.code, 0);
  assert.equal(result.data.config.vault_name, "knowledge");
  assert.equal(result.data.config.paths.bank, "bank");
  assert.deepEqual(app.vault.adapter.writes, []);
});

test("desktop initialization infers a parent Git repository and rejects a generic vault name", async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "noteweaver-layout-"));
  const repository = path.join(temporary, "daal-atlas");
  try {
    mkdirSync(path.join(repository, "knowledge"), { recursive: true });
    mkdirSync(path.join(repository, "daal-atlas"));
    execFileSync("git", ["init", "-q", repository]);
    const app = memoryApp();
    app.vault.adapter.getBasePath = () => path.join(repository, "knowledge");
    app.vault.getName = () => "knowledge";
    const wrong = await new ObsidianBank(app as unknown as App).run({ operation: "init", dryRun: true });
    assert.equal(wrong.code, 2);
    assert.match(wrong.data.error, /vault name must match repository/);
    app.vault.adapter.getBasePath = () => path.join(repository, "daal-atlas");
    app.vault.getName = () => "daal-atlas";
    const result = await new ObsidianBank(app as unknown as App).run({ operation: "onboard" });
    assert.equal(result.code, 0);
    assert.equal(result.data.config.repository_root, "..");
    assert.equal(result.data.config.name, "daal-atlas");
    assert.deepEqual(app.vault.adapter.writes, []);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
