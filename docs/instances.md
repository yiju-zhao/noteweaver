# Instances, runtime and agent skills

Noteweave owns the reusable code and workflows. Each vault owns its schema,
editorial policies, review records and release pin. Installed runtime files are
replaceable; instance configuration and local Obsidian settings are not.

## Instance descriptor

Create `<vault>/.kb/config.json`:

```json
{
  "version": 1,
  "name": "Example",
  "vault_name": "example-vault",
  "repository_root": "..",
  "paths": {
    "schema": ".kb/schema.json",
    "bank": "bank",
    "evidence": "evidence",
    "policies": ".kb/policies",
    "review": ".kb/review"
  },
  "require_obsidian": true,
  "commands": {
    "setup": ".agents/skills/setup.sh"
  }
}
```

Paths are vault-relative and cannot escape the vault. `repository_root` is `.`
when the vault is the repository, or `..` when it is an immediate child.
Commands are repository-relative and belong to the caller; review them as local
configuration. A research workflow may add `research_setup` and `research_skills`.
The plugin reads schema/evidence paths. Skills additionally use the instance name,
commands and `require_obsidian`; the CLI remains available to CI.

Policies are Markdown files under the configured policy path, starting at
`README.md`. The three vocabulary documents use the generated markers shown in
the example. Review documents use frontmatter `status: open` for actionable items.
The `review` operation lists documents, not the number of decisions contained in them.

## Install runtime and skills

Download the same release's `runtime.zip` and verify its release SHA-256 before
extracting into `.kb/runtime/`. Install Node.js 20+ for the offline runner and context helper; installed JavaScript is already bundled, so npm installation is unnecessary.
Use `runAutomation({operation:"info",vault:"<absolute vault path>"})` through Obsidian `eval` to verify the selected instance.
Ignore `.kb/runtime/` and downloaded archives in the vault repository; commit the
release version and hashes in that repository's lock file.

Expose each installed skill with a relative symlink under the agent's discovery
directory, commonly `.agents/skills/`. Claude Code can use `.claude/skills/` links
to the same entries. Maintain generic skill source in this repository's `skills/`,
and change instance policy in the vault. Tool-specific or third-party skills stay
with their own owners; `research_skills` names the available integrations.

`kb-query/scripts/context.cjs` resolves its bound installed instance (or explicit
`--vault`) and checks the caller's Obsidian requirement. It verifies the vault path,
not only the display name. Installing the skill globally by linking the instance's
entry retains that binding when invoked from a different project.

## Migrate an existing vault

First back up its schema and settings. Move `.obsidian/kb-schema.json` to
`.kb/schema.json` without changing bytes, add the instance descriptor, then reload
Noteweave. If both schema files exist, schema-dependent operations stop until the
ambiguity is resolved. Legacy vaults without an instance descriptor continue to
use the original path. Upgrade code and runtime together; retain actor and relation
state in the installed plugin's `data.json`.

## One-time evidence cleanup

The shared core normally rejects changes to committed evidence. A vault may explicitly
pin a reviewed deletion receipt in `cleanup_receipts` with its repository-relative
path and SHA-256. Receipts must be under the configured review directory, match the
exact base commit, be new in that diff, contain an explicit authorization and
reasons, and list hashes of paired card/original deletions. Referenced or unlisted
files remain protected. A receipt does not authorize subsequent cleanups; updating
this instance policy is a human decision.

## Automation and CI

Daily operations use native `obsidian vault=<name> command id=noteweave:<id>`
or `obsidian vault=<name> eval code=<JavaScript>`. The plugin registers the
knowledge-bank actions in the command palette. `command` only accepts an ID and
does not await its callback; retrieve the latest result with `commandResult(id)`.
For agents, prefer a single `eval` calling `runAutomation(request)` and serializing
the awaited result as JSON. Pass the absolute `vault` path for instance validation.
See the [invocation reference](../skills/kb-query/references/obsidian-cli.md) for
requests, command IDs and result handling. Protocol version 1 uses `code` 0 for
success, 1 for findings/conflicts and 2 for execution failure. A failed connection
never switches to filesystem writes. No new Obsidian CLI subcommand is invented.

`index`, `schema` and `lift` compute edits with the same pure core. The plugin
checks the expected original content before writing, uses `Vault.process` for
notes and the vault adapter for hidden policy documents. Concurrent edits stop
the remaining writes; already completed edits can be inspected and rerun. This
is not a transaction across files. `check:true` and `dryRun:true` return plans without
writing. Search, read, rename and trash continue to use native Obsidian commands.

For CI, run `node <vault>/.kb/runtime/cli/cli.cjs --root <vault> --offline check --json`. This calls
the same bundled core without a desktop application. Offline writes are reserved
for explicitly selected isolated fixtures; everyday work uses the
live adapter. Git must be available for history checks. Full automation is a
desktop feature; regular plugin display does not load desktop automation modules.

The `cli/runtime.cjs` bundle exports the Node adapter and pure operations for
integration tests. It is versioned with the plugin, not a second rule implementation.
Upgrading from 0.5 replaces Python runtime files; consumers that imported `kblib`
must call the offline runner or the TypeScript bundle instead. Instance installer scripts and
consumer test harnesses may use Python independently of the Noteweave runtime.

Version 0.8 removes the daily CLI wrapper. Remove `commands.kb` and local `kb` shims, update skills and hooks to native Obsidian calls, and keep a separate explicit offline check for CI. Hooks must parse the JSON result and propagate its code; Obsidian process success alone is insufficient.

## Upgrade the plugin identity

Version 0.9 uses `noteweave` as the sole plugin ID. To upgrade an installation
from the previous ID, keep the vault open and disable the old plugin with
`obsidian vault=<name> plugin:disable id=kb-types`. Move its entire plugin directory
from `.obsidian/plugins/kb-types/` to `.obsidian/plugins/noteweave/`, preserving
`data.json` byte for byte. If both directories already contain settings, compare
them before proceeding; never overwrite an independent installation's settings.
Install the verified 0.9 release files in the new directory, refresh Obsidian's
plugin list if needed, then run `obsidian vault=<name> plugin:enable id=noteweave`.
Update any custom hotkeys or saved findings views to the new command/view prefix.
Do not enable both identities. Existing schemas and knowledge content do not change.
There is no compatibility alias for old command IDs.
