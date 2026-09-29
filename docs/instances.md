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
    "setup": ".agents/skills/setup.sh",
    "kb": "example-vault/.kb/runtime/cli/kb --root example-vault"
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
`kb review` lists documents, not the number of decisions contained in them.

## Install CLI and skills

Download the same release's `runtime.zip` and verify its release SHA-256 before
extracting into `.kb/runtime/`. Install Python 3.9+, PyYAML and Node.js 20+ for the
CLI; installed JavaScript is already bundled, so npm installation is unnecessary.
Run `.kb/runtime/cli/kb --root <vault> info` to verify the selected instance.
Ignore `.kb/runtime/` and downloaded archives in the vault repository; commit the
release version and hashes in that repository's lock file.

Expose each installed skill with a relative symlink under the agent's discovery
directory, commonly `.agents/skills/`. Claude Code can use `.claude/skills/` links
to the same entries. Maintain generic skill source in this repository's `skills/`,
and change instance policy in the vault. Tool-specific or third-party skills stay
with their own owners; `research_skills` names the available integrations.

`kb-query/scripts/context.py` resolves its bound installed instance (or explicit
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

The CLI normally rejects changes to committed evidence. A vault may explicitly
pin a reviewed deletion receipt in `cleanup_receipts` with its repository-relative
path and SHA-256. Receipts must be under the configured review directory, match the
exact base commit, be new in that diff, contain an explicit authorization and
reasons, and list hashes of paired card/original deletions. Referenced or unlisted
files remain protected. A receipt does not authorize subsequent cleanups; updating
this instance policy is a human decision.
