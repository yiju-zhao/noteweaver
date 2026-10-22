# Instances and installation

A Noteweaver instance is discovered through `<vault>/.noteweaver/config.json`.
The kernel, desktop adapter, offline runner and skill context share the same path
parser. All content paths are relative to the vault and must stay inside it:

```json
{
  "version": 1,
  "name": "research-notebook",
  "vault_name": "research-notebook",
  "repository_root": "..",
  "paths": {
    "schema": ".noteweaver/schema.json",
    "bank": "pages",
    "evidence": "evidence",
    "policies": ".noteweaver/policies",
    "review": ".noteweaver/review"
  },
  "require_obsidian": true,
  "commands": { "setup": ".agents/skills/setup.sh" }
}
```

New repositories use `<repository>/<repository-name>/` as the vault, with
`pages/`, `evidence/`, `.noteweaver/` and `.obsidian/` inside it. The vault name
matches the repository directory name; the display name defaults to that name.
`repository_root` is `..` for this child vault, or `.` when the repository itself
is the selected vault. `paths.bank` remains the configuration key for the knowledge
page root; new initialization explicitly writes `pages`. Older descriptors that
omit this key still resolve it to `bank`, preserving their existing content.
The descriptor may also declare `commands.research_setup` and
`research_skills`. Commands are repository-relative and belong to that instance.
The context helper returns absolute top-level `paths` and vault-relative
`config.paths`. The instance owns schema, policies, review records and release pin;
installed tools are replaceable.

## Agent plugin

The installer reads the complete release manifest and installs all nine skills,
compiled helpers, licenses and pinned archify runtime into
`.agents/plugins/noteweaver`. Its `noteweaver-instance.json` binds the installation
to this vault; that local file is not in the release. Cached copies retain the
binding. An explicit `--vault` overrides it. An unbound reusable plugin discovers
only a unique instance in the current project. Cache directory names are never a
substitute for explicit instance selection. Ambiguous or invalid instances fail.

For Codex, declare `.agents/plugins/marketplace.json` in the consuming repository:

```json
{
  "name": "noteweaver-local",
  "plugins": [{
    "name": "noteweaver",
    "source": { "source": "local", "path": "./.agents/plugins/noteweaver" },
    "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
    "category": "Productivity"
  }]
}
```

Register the repository with `codex plugin marketplace add /absolute/repository`
and install `codex plugin add noteweaver@noteweaver-local`. Refresh the host or start
a new session after changes. Claude Code can register the same folder through its
`.claude-plugin/marketplace.json` source catalog and project-scoped plugin settings;
the generated package includes `.claude-plugin/plugin.json`.

The local source path is relative to the marketplace root. Host installation is
separate from unpacking verified release files. The consuming repository should
commit registration and locks, and ignore the installed plugin/cache. Avoid
simultaneously discovering local `.agents/skills` copies and the native plugin.
For another agent host use installer `--mode skills`, then configure its discovery
of `.agents/skills/`. Mode changes require explicitly removing the previous
host's discovery entries; the installer will not silently delete a custom skill.

Run `bash <installed-plugin>/scripts/setup-tools.sh` to verify tool prerequisites,
or add `--research` to install and smoke-test the pinned browser CLI. The browser
runtime is downloaded by npm with the packaged lockfile; its Node.js requirement
is separate from the kernel. The browser wrapper keeps sockets in a user-scoped
temporary directory; browser credentials and profiles are never part of releases.

## Initialization and adoption

Use the bundled [noteweaver-init skill](../skills/noteweaver-init/SKILL.md) for the
agent workflow from a blank vault or an existing collection. It inventories the
vault, establishes scope and a file-by-file plan, initializes required structure,
adopts notes in recoverable batches and verifies the selected scope.

With Noteweaver enabled in the running vault, first inspect without writing:

```javascript
await app.plugins.plugins.noteweaver.runAutomation({
  operation: "onboard", vault: "/absolute/research-notebook/research-notebook",
  initialize: { repositoryRoot: ".." }
});
```

`onboard` needs no instance descriptor and always returns `changes: []`.
`data.state` is `blank`, `existing`, `initialized` or `legacy`. `data.inventory`
lists visible Markdown files with their existing title/type/class, role, exact
directory binding, missing frontmatter properties, parsing and naming issues;
it also reports directory counts, duplicate candidate basenames and other visible
files. No note body or invented classification is returned. Code 0 means the
inspection succeeded, not that those notes conform or their facts were verified.

For a new instance, `data.initialization` contains the initialization preview
(`code`, `conflicts`, `directories`, `files`). For an initialized instance it is
null: the report uses the existing descriptor and schema, preserving local paths,
vocabulary and edited policies instead of comparing them with starter templates.
`initialize` proposes settings only for new instances. Legacy markers and creation
conflicts return code 1; malformed descriptors or schemas return code 2.

For an existing vault, follow the [adoption workflow](../skills/noteweaver-init/references/adoption.md)
before editing notes. The plan accounts for adopted, retained, excluded and pending
files; checks only cover the configured content roots. A valid empty scaffold is
not proof that existing notes were converted.

For a new instance, preview structure creation using the chosen settings:

```javascript
await app.plugins.plugins.noteweaver.runAutomation({
  operation: "init", vault: "/absolute/research-notebook/research-notebook", dryRun: true,
  initialize: { repositoryRoot: ".." }
});
```

`initialize.paths` customizes directory names and `initialize.schema` supplies a
complete schema. The desktop adapter supplies the running vault name and, when
`repositoryRoot` is omitted, infers `.` or `..` from Git (falling back to `.` when
no Git repository is found). New child vault names must match their repository
directory; initialize the correctly named vault after opening it in Obsidian.
Pure kernel callers must supply `name` or `vaultName`; there is no generic display
name fallback. Omit `dryRun` to apply an authorized plan through Obsidian. The
kernel produces config, schema, starter policies, indexes, log and `.gitkeep`
files in evidence/sources and evidence/records so the empty structure survives a
Git clone. Existing files
with different contents produce conflicts and no writes; matching files are
retained. Repeating initialization is idempotent until the instance customizes a
starter file, at which point initialization reports the difference instead of
resetting it. Ordinary updates use the normal editing operations.

Run `check` afterwards. The newly created policies belong to the instance and
must describe its actual collection scope. Empty Git history is reported as a
warning: structural validity does not imply append-only history was checked.

Layout changes follow the [layout refactor workflow](../skills/noteweaver-init/references/layout.md).
The runtime has no `refactor` operation: changing paths in an init request reports
conflicts rather than moving content. Agents plan and apply directory moves,
configuration, links and installation bindings, then compare evidence hashes by
old-to-new path mapping. Current Git checks use current configured paths and do
not establish historical preservation across a root rename. Repository-level
README, Agent contracts, setup, CI, hooks and consumer tests are also outside the
init generator's output.

## Migrate Noteweave and older instances

Back up the instance and record the hashes of schema, evidence, review receipts
and plugin `data.json`. Use the running Obsidian adapter to rename `.kb` or
`.noteweave` to `.noteweaver`, then update descriptor paths and live references.
Old metadata alongside new metadata is rejected; do not keep two configurations.
Immutable evidence, receipts and published historical versions retain their bytes.

Disable the old `noteweave` (or older `kb-types`) plugin in Obsidian. Move its
entire settings directory to `.obsidian/plugins/noteweaver`, preserving `data.json`.
If the target already has separate settings, resolve that conflict before moving.
Install the new verified release, reload the community plugin list and enable
`noteweaver`. Update saved view types, custom hotkeys, command prefixes, hooks and
CI references. Never run the two identities simultaneously. There is no old-name
runtime alias.

Move any custom edits in the prior local skills to their upstream source before
removing old discovery entries. Generic source now belongs to Noteweaver. Update
personal links or retire them when native plugin discovery replaces them. The
installer refuses to overwrite an unmanaged plugin folder; move a reviewed old
copy aside first. It checks all assets and bundle hashes before writing and
restores earlier replacements after an I/O failure.

For rollback, disable the new plugin, restore the recorded previous identity,
metadata paths and descriptor, restore the previous release lock and its matching
installer, and reinstall that release. Preserve the current `data.json`; compare
with the saved snapshot if either version changed its state format. Restore host
registration from the same migration snapshot. Do not mix a new identity with an
old manifest.

## Automation and checks

Protocol version 1 returns `{apiVersion,code,data,changes}`. `onboard` is a read-only
desktop operation; the offline runner continues to require an existing instance.
Code 0 is success,
1 is findings/conflicts, and 2 is execution failure. `init`, `index`, `schema`,
`lift` and `sources` use planned writes with original-content checks. Across files
this is not a transaction: an external concurrent edit stops remaining writes;
inspect completed changes and rerun. The installer replacement transaction is
separate from vault content editing.

Daily operations run through native Obsidian command/eval. CI explicitly invokes
`node <metadata>/runtime/cli/cli.cjs --root <vault> --offline check --json`.
The runtime exports the same kernel for consumer regressions. Read-only `info`
returns absolute instance paths; `review` lists documents with status open, not a
count of individual decisions. One-time approved evidence cleanup receipts remain
instance-owned and must match their recorded base commit and SHA-256.
