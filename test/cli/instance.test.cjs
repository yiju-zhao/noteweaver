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
test("runner refuses daily operations without --offline before reading or writing a vault", (t) => {
  const f = fixture(t);
  const p = path.join(f.vault, "bank/index.md");
  const before = fs.readFileSync(p, "utf8");
  for (const operation of ["check", "index", "schema", "lift", "sources"]) {
    const r = spawnSync(process.execPath, [path.join(root, "dist/cli.cjs"), "--root", f.vault, operation], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /daily operations use Obsidian CLI/);
  }
  assert.equal(fs.readFileSync(p, "utf8"), before);
});

function evidenceFixture(t) {
  const f = fixture(t),
    model = path.join(f.vault, 'bank/entities/models/alpha-model.md'),
    schema = path.join(f.vault, '.kb/schema.json');
  const raw = JSON.parse(fs.readFileSync(schema, 'utf8'));
  raw.formats.sources = 'wikilink';
  fs.writeFileSync(schema, JSON.stringify(raw));
  const cards = [
    ['sources/example.org/readme.md', 'type: source\ntitle: Example source\npublisher: Example\ngrade: official\ncaptured_at: 2026-09-29T12:00:00Z'],
    ['records/2026-09/readme.md', 'type: record\ntitle: Example record\nby: process:test\nobserved_at: 2026-09-29T12:00:00Z'],
  ];
  const crypto = require('node:crypto');
  for (const [rel, metadata] of cards) {
    const target = path.join(f.vault, 'evidence', rel), original = 'A precise result: 7.00.\n';
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, original);
    fs.writeFileSync(target + '.md', `---\n${metadata}\nsha256: ${crypto.createHash('sha256').update(original).digest('hex')}\n---\n`);
  }
  const before = fs.readFileSync(model, 'utf8').replace('sources: []',
    'sources:\n  - id: paper\n    resource: ../../../evidence/sources/example.org/readme.md.md\n  - id: run\n    resource: ../../../evidence/records/2026-09/readme.md.md') +
    '\nResult.[^paper][^run]\n\n## 断言\n\n```yaml\n- id: alpha-model--tpf\n  attribute: tpf\n  value: "7.00"\n  unit: token/forward\n  basis: direct\n  evidence:\n    - {source: run, at: L1}\n```\n\n' +
    '[^paper]: [Paper](../../../evidence/sources/example.org/readme.md.md)\n' +
    '[^run]: [Run](../../../evidence/records/2026-09/readme.md.md)\n';
  fs.writeFileSync(model, before);
  fs.appendFileSync(path.join(f.vault, 'bank/log.md'), '\n* Update: add synthetic evidence citations.\n');
  return { ...f, model, before };
}

test('native migration previews, preserves claims/precision/cards and is idempotent', (t) => {
  const f = evidenceFixture(t);
  let r = f.cli('sources', '--dry-run', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).pages, 1);
  assert.equal(fs.readFileSync(f.model, 'utf8'), f.before);
  const card = path.join(f.vault, 'evidence/sources/example.org/readme.md.md'), cardBefore = fs.readFileSync(card);
  r = f.cli('sources', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = fs.readFileSync(f.model, 'utf8');
  assert.match(after, /sources:\n  - "\[\[evidence\/sources\/example.org\/readme.md.md\|paper\]\]"/);
  assert.match(after, /\[\[evidence\/records\/2026-09\/readme.md.md\|run\]\]/);
  assert.equal(after.split('\n---\n')[1], f.before.split('\n---\n')[1]);
  assert.match(after, /params-total: "7.00B"/);
  assert.deepEqual(fs.readFileSync(card), cardBefore);
  r = f.cli('check', '--json');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).warnings, 0);
  assert.equal(JSON.parse(f.cli('sources', '--json').stdout).pages, 0);
  assert.equal(fs.readFileSync(f.model, 'utf8'), after);
});

test('migration rejects bad citations and unknown source metadata before writing', (t) => {
  const f = evidenceFixture(t);
  fs.writeFileSync(f.model, f.before.replace('source: run', 'source: absent'));
  let r = f.cli('sources', '--json');
  assert.equal(r.status, 1, r.stderr);
  assert.ok(JSON.parse(r.stdout).errors.some((x) => x.code === 'claim-evidence'));
  assert.match(fs.readFileSync(f.model, 'utf8'), /  - id: paper/);
  const unknown = f.before.replace('  - id: paper', '  - id: paper\n    extra: keep-me');
  fs.writeFileSync(f.model, unknown);
  r = f.cli('sources', '--json');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /extra metadata/);
  assert.equal(fs.readFileSync(f.model, 'utf8'), unknown);
});

test('native source validation guards IDs, targets, footnotes, claims and orphan cards', (t) => {
  const f = evidenceFixture(t);
  assert.equal(f.cli('sources').status, 0);
  const migrated = fs.readFileSync(f.model, 'utf8');
  for (const [old, next, code] of [
    ['|paper]]', '|run]]', 'sources'],
    ['|paper]]', ']]', 'sources'],
    ['evidence/sources/example.org/readme.md.md|paper', 'evidence/sources/example.org/readme.md|paper', 'source-resource'],
    ['evidence/sources/example.org/readme.md.md|paper', 'bank/entities/models/alpha-model.md|paper', 'source-resource'],
    ['evidence/sources/example.org/readme.md.md|paper', 'evidence/sources/missing.org/readme.md.md|paper', 'source-resource'],
    ['source: run', 'source: absent', 'claim-evidence'],
    ['at: L1', 'at: L99', 'claim-evidence'],
    ['[^paper]: [Paper](../../../evidence/sources/example.org/readme.md.md)', '[^paper]: [Paper](../../../evidence/records/2026-09/readme.md.md)', 'footnote'],
  ]) {
    fs.writeFileSync(f.model, migrated.replace(old, next));
    const r = f.cli('check', '--json');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(JSON.parse(r.stdout).findings.some((x) => x.code === code), r.stdout);
  }
  fs.writeFileSync(f.model, f.before);
  let r = f.cli('check', '--json');
  assert.ok(JSON.parse(r.stdout).findings.some((x) => x.code === 'sources' && /native/.test(x.message)));
  fs.writeFileSync(f.model, migrated.replace(/  - "\[\[evidence\/sources[^\n]+\n/, '').replace('Result.[^paper][^run]', 'Result.[^run]').replace(/\[\^paper\]:[^\n]+\n/, ''));
  r = f.cli('check', '--json');
  assert.ok(JSON.parse(r.stdout).findings.some((x) => x.code === 'evidence-unreferenced'), r.stdout);
});

test('directly installed context is self-contained and stays bound through a global link', (t) => {
  const f = fixture(t), other = fixture(t);
  const config = JSON.parse(fs.readFileSync(f.config));
  config.repository_root = '..';
  fs.writeFileSync(f.config, JSON.stringify(config));
  const skill = path.join(f.tmp, '.agents/skills/noteweave-query');
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'dist/skill-context.cjs'), path.join(skill, 'scripts/context.cjs'));
  const personal = path.join(other.tmp, 'personal-query');
  fs.symlinkSync(skill, personal, 'dir');
  const run = (...args) => spawnSync(process.execPath, [path.join(personal, 'scripts/context.cjs'), ...args],
    { cwd: other.vault, encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).vault, fs.realpathSync(f.vault));
  assert.equal(fs.existsSync(path.join(f.vault, '.kb/runtime')), false);
  result = run('--vault', other.vault);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).vault, fs.realpathSync(other.vault));
  // An invalid bound instance must not fall back to the valid working directory.
  fs.writeFileSync(f.config, '{"version":999}');
  result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported/);
});

test('direct context refuses ambiguous installations and enforces the Obsidian prerequisite', (t) => {
  const f = fixture(t);
  const skill = path.join(f.tmp, '.agents/skills/noteweave-query/scripts');
  fs.mkdirSync(skill, { recursive: true });
  fs.copyFileSync(path.join(root, 'dist/skill-context.cjs'), path.join(skill, 'context.cjs'));
  const bin = path.join(f.tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'obsidian'), '#!/bin/sh\nprintf "/another/vault\\n"\n', { mode: 0o755 });
  const config = JSON.parse(fs.readFileSync(f.config));
  config.require_obsidian = true;
  fs.writeFileSync(f.config, JSON.stringify(config));
  const run = () => spawnSync(process.execPath, [path.join(skill, 'context.cjs')],
    { cwd: f.vault, encoding: 'utf8', env: { ...process.env, PATH: bin } });
  let result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Open Obsidian/);
  fs.cpSync(f.vault, path.join(f.tmp, 'second-vault'), { recursive: true });
  result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /select one vault/);
});
