import { test } from "node:test";
import assert from "node:assert/strict";
import { readVaultInstance, readInstanceConfig } from "../src/instance";
const resolve = (files: Record<string, string>, configDir?: string) => readVaultInstance(async p => files[p], async p => p in files, configDir);
test("desktop resolves every instance path from the same config and fills defaults", async () => {
  const paths = { schema: "rules/custom.json", bank: "notes", evidence: "attachments", policies: "rules/policies", review: "decisions" };
  const result = await resolve({ ".noteweaver/config.json": JSON.stringify({ version: 1, paths }) });
  assert.deepEqual(result.paths, paths);
  assert.deepEqual(result.config?.paths, paths);
  assert.deepEqual(readInstanceConfig('{"version":1}').paths, {
    schema: ".noteweaver/schema.json", bank: "bank", evidence: "evidence", policies: ".noteweaver/policies", review: ".noteweaver/review",
  });
});
test("legacy schema fallback honors Obsidian configDir and rejects competing schemas", async () => {
  assert.equal((await resolve({ ".obsidian/kb-schema.json": "{}" })).paths.schema, ".obsidian/kb-schema.json");
  assert.equal((await resolve({ ".settings/kb-schema.json": "{}" }, ".settings")).paths.schema, ".settings/kb-schema.json");
  await assert.rejects(resolve({ ".noteweaver/config.json": '{"version":1}', ".settings/kb-schema.json": "{}" }, ".settings"), /Two schema/);
  await assert.rejects(resolve({ ".noteweaver/schema.json": "{}" }), /config/);
  await assert.rejects(resolve({ ".noteweaver": "" }), /config/);
});
test("old and duplicate instance directories require explicit migration", async () => {
  for (const old of [".kb", ".kb/config.json", ".kb/schema.json"]) {
    await assert.rejects(resolve({ [old]: "{}" }), /Migrate/);
    await assert.rejects(resolve({ [old]: "{}", ".noteweaver/config.json": '{"version":1}' }), /keep only one/);
  }
});
test("all configured paths reject traversal, noncanonical and non-string values", () => {
  for (const field of ["schema", "policies", "review", "bank", "evidence"])
    for (const path of ["../other", "/tmp/file", "https://x", "a\\b", "a//b", "a/./b", "a/../b", "", 2, false, null])
      assert.throws(() => readInstanceConfig(JSON.stringify({ version: 1, paths: { [field]: path } })), new RegExp(field));
  for (const config of [{ version: 2 }, { version: 1, paths: [] }, { version: 1, paths: null }, { version: 1, repository_root: "../.." }, { version: 1, repository_root: null }])
    assert.throws(() => readInstanceConfig(JSON.stringify(config)));
});
