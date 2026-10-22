import test from "node:test";
import assert from "node:assert/strict";
import { initialFiles, planInitialization, type InitOptions } from "../src/initialize";
import { MemoryStore, Repo } from "../src/bank/model";
import { execute } from "../src/bank/operations";
function checked(options: InitOptions = { vaultName: "research" }) {
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
  assert.deepEqual(planInitialization({ vaultName: "research" }, observed).changes, []);
});
test("new instances use the vault name and pages, with clonable empty evidence directories", () => {
  const { initial } = checked({ vaultName: "daal-atlas", repositoryRoot: ".." });
  assert.equal(initial.config.name, "daal-atlas");
  assert.equal(initial.config.vault_name, "daal-atlas");
  assert.equal(initial.config.paths.bank, "pages");
  assert.equal(initial.config.paths.evidence, "evidence");
  assert.ok(initial.files["pages/index.md"]);
  assert.equal(initial.files["evidence/sources/.gitkeep"], "");
  assert.equal(initial.files["evidence/records/.gitkeep"], "");
  assert.equal(Object.keys(initial.files).some(p => p.startsWith("bank/")), false);
  assert.throws(() => initialFiles(), /requires a name or vaultName/);
  assert.throws(() => initialFiles({ name: " " }), /requires a name or vaultName/);
});
test("custom directories and independent instance names remain conforming", () => {
  checked({ name: "Independent notebook", vaultName: "science", paths: {
    bank: "notes", evidence: "materials", schema: "rules/vocabulary.json", policies: "rules/policies", review: "decisions" } });
});
test("explicit bank paths remain supported and policies follow the actual evidence root", () => {
  const { initial } = checked({ vaultName: "legacy", paths: { bank: "bank", evidence: "materials" } });
  assert.ok(initial.files["bank/concepts/index.md"]);
  assert.match(initial.files[".noteweaver/policies/evidence.md"], /materials\/sources/);
  assert.match(initial.files[".noteweaver/policies/evidence.md"], /materials\/records/);
});
test("adoption and legacy migration conflicts produce no writes", () => {
  const { files } = initialFiles({ vaultName: "research" });
  const observed = new Map([[".noteweaver/schema.json", "human schema"]]);
  const result = planInitialization({ vaultName: "research" }, observed);
  assert.equal(result.code, 1); assert.deepEqual(result.changes, []);
  for (const old of [".kb", ".noteweave", ".obsidian/kb-schema.json"])
    assert.equal(planInitialization({ vaultName: "research" }, new Map(), new Set([old])).code, 1);
  assert.equal(planInitialization({ vaultName: "research" }, new Map(), new Set(Object.keys(files))).code, 1);
});
test("unsafe paths and overlapping content roots are rejected before creating plans", () => {
  assert.throws(() => initialFiles({ vaultName: "research", paths: { bank: "../outside" } }), /invalid/);
  assert.throws(() => initialFiles({ vaultName: "research", paths: { evidence: "pages/materials" } }), /overlapping/);
});

test("file-directory and descriptor-schema collisions are caught in preview", () => {
  assert.throws(() => initialFiles({vaultName:"research",paths:{schema:".noteweaver/config.json"}}), /descriptor/);
  assert.throws(() => initialFiles({vaultName:"research",paths:{schema:"pages"}}), /directory/);
  assert.equal(planInitialization({ vaultName: "research" },new Map(),new Set(),new Set(["evidence"])).code,1);
});
