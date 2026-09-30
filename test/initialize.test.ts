import test from "node:test";
import assert from "node:assert/strict";
import { initialFiles, planInitialization } from "../src/initialize";
import { MemoryStore, Repo } from "../src/bank/model";
import { execute } from "../src/bank/operations";
function checked(options = {}) {
  const initial = initialFiles(options);
  const result = planInitialization(options, new Map());
  assert.equal(result.code, 0);
  const files = new Map(result.changes.map(p => [p.path, { text: p.after, bytes: Buffer.byteLength(p.after), hash: "" }]));
  const store = new MemoryStore(files, new Set([...files.keys(), ...initial.directories]));
  const repo = new Repo({ vault: "", config: initial.config, paths: initial.config.paths }, store);
  const check = execute(repo, { operation: "check" });
  assert.equal(check.code, 0, JSON.stringify(check.data.findings));
  return { initial, result };
}
test("empty vault initializer generates a conforming knowledge bank and is idempotent", () => {
  const { result } = checked();
  const observed = new Map(result.changes.map(p => [p.path, p.after]));
  assert.deepEqual(planInitialization({}, observed).changes, []);
});
test("custom directories and independent instance names remain conforming", () => {
  checked({ name: "Independent notebook", vaultName: "science", paths: {
    bank: "notes", evidence: "materials", schema: "rules/vocabulary.json", policies: "rules/policies", review: "decisions" } });
});
test("adoption and legacy migration conflicts produce no writes", () => {
  const { files } = initialFiles();
  const observed = new Map([[".noteweaver/schema.json", "human schema"]]);
  const result = planInitialization({}, observed);
  assert.equal(result.code, 1); assert.deepEqual(result.changes, []);
  for (const old of [".kb", ".noteweave", ".obsidian/kb-schema.json"])
    assert.equal(planInitialization({}, new Map(), new Set([old])).code, 1);
  assert.equal(planInitialization({}, new Map(), new Set(Object.keys(files))).code, 1);
});
test("unsafe paths and overlapping content roots are rejected before creating plans", () => {
  assert.throws(() => initialFiles({ paths: { bank: "../outside" } }), /invalid/);
  assert.throws(() => initialFiles({ paths: { evidence: "bank/materials" } }), /overlapping/);
});

test("file-directory and descriptor-schema collisions are caught in preview", () => {
  assert.throws(() => initialFiles({paths:{schema:".noteweaver/config.json"}}), /descriptor/);
  assert.throws(() => initialFiles({paths:{schema:"bank"}}), /directory/);
  assert.equal(planInitialization({},new Map(),new Set(),new Set(["evidence"])).code,1);
});
