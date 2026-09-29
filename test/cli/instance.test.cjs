const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../.."),
  api = require("../../dist/runtime.cjs");
function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "noteweave-cli-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const vault = path.join(tmp, "research-notebook");
  fs.cpSync(path.join(root, "example-vault"), vault, { recursive: true });
  const config = path.join(vault, ".kb/config.json");
  const data = JSON.parse(fs.readFileSync(config, "utf8"));
  Object.assign(data, {
    repository_root: ".",
    vault_name: "research-notebook",
  });
  fs.writeFileSync(config, JSON.stringify(data));
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@local",
      "commit",
      "-qm",
      "synthetic baseline",
    ],
  ])
    assert.equal(spawnSync("git", ["-C", vault, ...args]).status, 0);
  return {
    tmp,
    vault,
    config,
    cli: (...args) =>
      spawnSync(
        process.execPath,
        [
          path.join(root, "dist/cli.cjs"),
          "--offline",
          "--root",
          vault,
          ...args,
        ],
        { encoding: "utf8" },
      ),
  };
}
test("standalone instance passes without Python or a system directory", (t) => {
  const f = fixture(t),
    r = f.cli("check", "--json");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).errors, 0);
  assert.equal(fs.existsSync(path.join(f.vault, "system")), false);
});
test("CLI shares frontmatter validation with the plugin", (t) => {
  const f = fixture(t),
    p = path.join(f.vault, "bank/entities/models/alpha-model.md");
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replace("license: mit", "license: unavailable"),
  );
  const r = f.cli("check", "--json");
  assert.equal(r.status, 1, r.stderr);
  assert.ok(JSON.parse(r.stdout).findings.some((f) => f.code === "fm-value"));
});
test("bank paths come from the selected instance", (t) => {
  const f = fixture(t);
  fs.renameSync(path.join(f.vault, "bank"), path.join(f.vault, "notes"));
  const c = JSON.parse(fs.readFileSync(f.config));
  c.paths.bank = "notes";
  fs.writeFileSync(f.config, JSON.stringify(c));
  const p = path.join(f.vault, ".kb/schema.json"),
    s = JSON.parse(fs.readFileSync(p));
  s.directories = Object.fromEntries(
    Object.entries(s.directories).map(([k, v]) => [
      k.replace("bank/", "notes/"),
      v,
    ]),
  );
  fs.writeFileSync(p, JSON.stringify(s));
  assert.equal(f.cli("schema").status, 0);
  const r = f.cli("check", "--json");
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test("competing schemas and escaping paths fail", (t) => {
  const f = fixture(t),
    p = path.join(f.vault, ".obsidian");
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "kb-schema.json"), "{}");
  assert.match(f.cli("check").stderr, /two schema/);
  fs.unlinkSync(path.join(p, "kb-schema.json"));
  const c = JSON.parse(fs.readFileSync(f.config));
  c.paths.schema = "../schema.json";
  fs.writeFileSync(f.config, JSON.stringify(c));
  const r = f.cli("info");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invalid instance path/);
});
test("review lists only open documents", (t) => {
  const f = fixture(t),
    p = path.join(f.vault, ".kb/review");
  fs.mkdirSync(p, { recursive: true });
  for (const status of ["open", "accepted"])
    fs.writeFileSync(
      path.join(p, status + ".md"),
      `---\ntype: review\ntitle: Example ${status}\nstatus: ${status}\n---\n`,
    );
  assert.deepEqual(
    JSON.parse(f.cli("review").stdout).map((r) => r.title),
    ["Example open"],
  );
});
test("context uses an explicitly selected instance", (t) => {
  const f = fixture(t);
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `process.exitCode=require(${JSON.stringify(path.join(root, "dist/context.cjs"))}).main(['--vault',${JSON.stringify(f.vault)}],__filename)`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).config.vault_name, "research-notebook");
});
test("offline writer rejects edits made after planning and writes nothing", (t) => {
  const f = fixture(t),
    instance = api.loadInstance(f.vault),
    p = "bank/concepts/example-concept.md",
    before = fs.readFileSync(path.join(f.vault, p), "utf8");
  fs.writeFileSync(path.join(f.vault, p), before + "\nHuman edit\n");
  assert.throws(
    () =>
      api.applyOffline(instance, [
        { path: "bank/new.md", before: null, after: "new" },
        { path: p, before, after: "overwrite" },
      ]),
    /changed since planning/,
  );
  assert.equal(fs.existsSync(path.join(f.vault, "bank/new.md")), false);
  assert.match(fs.readFileSync(path.join(f.vault, p), "utf8"), /Human edit/);
});
test("live CLI uses the selected vault and never falls back to filesystem writes", (t) => {
  const f = fixture(t),
    bin = path.join(f.tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "obsidian"),
    `#!${process.execPath}\nprocess.stdout.write('=> '+JSON.stringify({apiVersion:1,code:2,data:{error:'vault mismatch'},changes:[]}));`,
    { mode: 0o755 },
  );
  const r = spawnSync(
    process.execPath,
    [path.join(root, "dist/cli.cjs"), "--root", f.vault, "index"],
    { encoding: "utf8", env: { ...process.env, PATH: bin } },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /vault mismatch/);
});
test("live CLI passes structured requests and preserves findings exit codes", (t) => {
  const f = fixture(t),
    bin = path.join(f.tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "obsidian"),
    `#!${process.execPath}\nif(process.argv[2]!=='vault=research-notebook'||!process.argv[4].includes('runAutomation')||!process.argv[4].includes(${JSON.stringify(JSON.stringify(f.vault))})) process.exit(9);process.stdout.write('=> '+JSON.stringify({apiVersion:1,code:1,data:{errors:1,warnings:0,findings:[{code:'claim-immutable'}]},changes:[]}));`,
    { mode: 0o755 },
  );
  const r = spawnSync(
    process.execPath,
    [path.join(root, "dist/cli.cjs"), "--root", f.vault, "check", "--json"],
    { encoding: "utf8", env: { ...process.env, PATH: bin } },
  );
  assert.equal(r.status, 1, r.stderr);
  assert.equal(JSON.parse(r.stdout).findings[0].code, "claim-immutable");
});
