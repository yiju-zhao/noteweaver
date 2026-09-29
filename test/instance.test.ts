import { test } from "node:test";
import assert from "node:assert/strict";
import { instanceSchemaPath, readInstanceConfig } from "../src/instance";
const resolve = (files: Record<string, string>) => instanceSchemaPath(async p => files[p], async p => p in files);
test("instance schema is selected without a fixed vault name", async () => {
  assert.equal(await resolve({".kb/config.json": JSON.stringify({version:1,paths:{schema:".kb/custom.json"}}), ".kb/custom.json":"{}"}), ".kb/custom.json");
});
test("legacy vaults remain readable and competing schemas are rejected", async () => {
  assert.equal(await resolve({".obsidian/kb-schema.json":"{}"}), ".obsidian/kb-schema.json");
  await assert.rejects(resolve({".kb/config.json":'{"version":1}',".obsidian/kb-schema.json":"{}"}), /Two schema/);
  await assert.rejects(resolve({".kb/schema.json":"{}"}), /config/);
});
test("invalid versions and paths do not select arbitrary files", () => {
  for (const path of ["../other.json", "/tmp/schema.json", "https://x", "a\\b", 2]) assert.throws(() => readInstanceConfig(JSON.stringify({version:1,paths:{schema:path}})));
  assert.throws(() => readInstanceConfig('{"version":2}'));
});
