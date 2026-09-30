# Noteweaver

Noteweaver manages and generates schema-driven knowledge banks on native Obsidian.
A shared TypeScript kernel validates pages, claims, evidence and relations and
plans changes. The Obsidian adapter applies daily edits; an explicit offline
adapter runs the same rules in CI. Each vault owns its vocabulary and policies.

One release contains an **Obsidian plugin** and an **Agent plugin** with nine
skills: query, write, research, initialization, arXiv discovery, browser research,
Obsidian Bases, archify and explainer. Knowledge banks keep a release lock and
replaceable tool installations.

## Install and initialize

Install from a published [release](https://github.com/yiju-zhao/noteweaver/releases),
or build the release assets with the development commands below.
Place the release assets in `./release`, verify `SHA256SUMS`, and put
`tools.lock.json` in `<vault>/.noteweaver/`. Run the verified installer:

```sh
python3 ./release/installer.py install --metadata /absolute/vault/.noteweaver --assets ./release --bootstrap
```

For a local build, use `./dist` in place of `./release`.

`--bootstrap` permits installing tools before an instance descriptor exists; it
does not create knowledge content. Open the vault in Obsidian, enable Noteweaver,
and use the bundled `noteweaver-init` skill to preview and apply initialization.
Existing instances omit `--bootstrap`. The installer preserves the plugin's
`data.json`, schema, policies and knowledge. A lock pins every release asset by
SHA-256 and records the source commit.

The Agent package installs at `<repository>/.agents/plugins/noteweaver/`. Register
that folder in the host's local marketplace. It includes portable `plugin.json`,
Codex and Claude compatibility manifests, compiled helpers and the pinned archify
runtime. For hosts without plugins, `--mode skills` additionally installs the
same skills into `.agents/skills/`; enable one discovery mode per host.
See [installation and migration](docs/instances.md) for marketplace setup,
dependencies, instance binding, explicit migration and rollback.

## Use

```sh
obsidian vault=my-vault command id=noteweaver:check
obsidian vault=my-vault eval 'code=(async()=>JSON.stringify(await app.plugins.plugins["noteweaver"].runAutomation({operation:"check",vault:"/absolute/vault"})))()'
node /absolute/vault/.noteweaver/runtime/cli/cli.cjs --root /absolute/vault --offline check --json
```

Agents await `runAutomation` and inspect its JSON `code`; command process success
alone does not establish success. See the [automation reference](skills/noteweaver-query/references/obsidian-cli.md).
Failed desktop connections never switch to filesystem writes.

Native Properties support directory-bound types, inverse relations and evidence
links. Claims render in reading view. Schemas are format version 3; see
[schema format](docs/schema.md). The starter template defines a minimal vocabulary
for seven kinds. A structure check does not verify the truth of cited facts.

## Develop and release

```sh
npm ci
npm test
npm run build
npm run test:cli
python3 -m unittest discover -s test -p 'test_*.py'
python3 -m unittest discover -s skills/noteweaver-arxiv/tests
node scripts/release-lock.mjs
```

Development and the offline runner require Node.js 20+; the browser helper requires
Node.js 24+. Building downloads a hash-pinned archify archive and requires unzip.
Python 3.9+ runs the installer and arXiv helper. Obsidian minimum is 1.12.7; full
automation is a desktop feature. The regular property display remains available
without the desktop automation adapter.

The build creates `runtime.zip` (programs), `agent-plugin.zip` (skills and tools),
`installer.py`, the Obsidian assets and `SHA256SUMS`. CI tests the same release
artifacts. A tagged release also includes a source-pinned `tools.lock.json`.
Third-party attributions are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
