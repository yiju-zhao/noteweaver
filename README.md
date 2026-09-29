# Noteweave

An Obsidian plugin for schema-driven knowledge bases: directory-bound page types,
frontmatter checks and templates, bidirectional relations, and read-only evidence
properties. Each vault supplies its own `.kb/config.json`, schema and policies.

## Install

1. With an account that can access this private repository, download the plugin
   from a [release](https://github.com/CARI-DAAL/noteweave/releases). GitHub CLI users can run:

   ```sh
   gh auth login
   gh release download 0.5.0 --repo CARI-DAAL/noteweave --dir noteweave-release \
     --pattern main.js --pattern manifest.json --pattern styles.css
   ```
2. Put the three files in `<vault>/.obsidian/plugins/kb-types/`.
3. Add `.kb/config.json` and a compatible `.kb/schema.json`. To try the plugin, use the included
   [example vault](example-vault/) and its synthetic notes.
4. Reload Obsidian and enable **Noteweave** under Community plugins. Set `actor`
   in the plugin settings, for example `human:demo`.

Updates replace those three release files. Keep `data.json`: it holds your actor
and the relation synchronization checkpoint. Your schema lives outside the plugin
directory and is not replaced by an update.

The plugin is distributed through GitHub Releases; it has not been submitted to
the Obsidian Community directory. Node.js is only needed for development and the
optional validation bundle, not for installing the plugin in Obsidian.

## Use

- Create an empty note in a schema-bound directory to receive its frontmatter
  template. Existing content is preserved.
- Use **按 schema 设置属性值** to choose a vocabulary property and its allowed values.
- Use **检查全库 frontmatter** to inspect findings, or click the status bar to see
  findings for the current note.
- Edit either side of a declared relation. The plugin synchronizes its inverse,
  including removals, renames, and deletions. Conflicting relations pause writes
  and appear in the findings panel. **同步全库双向关系** runs reconciliation explicitly.
- `generated`, `verified`, and `sources` are displayed read-only in Properties.
  Evidence links resolve to exact `source`/`record` card paths. Edit these values in
  source mode to preserve YAML formatting and numeric precision.
- A YAML block under `## 断言` is rendered as a claims table in reading view.

The current interface uses Chinese labels. This release targets knowledge bases
using the documented schema and evidence conventions; see [schema format](docs/schema.md).
It does not bundle a team's vocabulary or content. The desktop plugin runs without
Python; the optional CLI requires Python, PyYAML and Node.js.

## Compatibility

The display name and repository are **Noteweave**. The internal plugin ID remains
`kb-types`, retaining existing installations, settings and relation checkpoints.
Legacy vaults without `.kb/config.json` still load `.obsidian/kb-schema.json`.
Configured instances use `.kb/schema.json` by default; keeping both files is an error.
Migration is explicit and never overwrites a vocabulary. See [instances and skills](docs/instances.md).

- Schema format: **3**. Unsupported schema versions stop schema-dependent work.
- Obsidian minimum: **1.12.7**. Desktop behavior was tested on **1.13.7**.
- Read-only Properties display uses an isolated private Obsidian API. If unavailable,
  the plugin shows a notice and leaves the native display available.
- Mobile is not independently verified in this release.
- Frontmatter validation is not an evidence audit or an implementation of every
  rule a knowledge base may require. Keep your own content checks where needed.

## Develop

Requires Node.js 20+, npm and Python 3.9+; CLI tests also need PyYAML.

```sh
npm ci
npm test
npm run build
npm run test:cli
```

Build output goes to `dist/`; building never writes to a vault. Copy the three
plugin files to your development vault to load them. The tests use only the
synthetic example schema and fixtures in this repository.

`dist/validation.cjs` is a bundled, read-only Node.js API for downstream checks,
with no npm install required. It exports `apiVersion` (1), `schemaVersion` (3),
`readSchema`, `readFrontmatter`, `specFor`, `pageName`, `validate`,
`claimedAttributes`, and `checkRelations`. It never loads Obsidian or writes files.
Downstream consumers should pin the release and verify its checksum before use.

## Private CI consumers

Other private CARI-DAAL repositories can use the composite action in this
repository, pinned to a full commit SHA. The caller provides Node.js 20+ and Python 3.9+; the
`assets` output points to the built release files. The caller should verify those
files against its own pinned release checksums. GitHub’s organization-only action
sharing supplies temporary read access without a personal token or stored secret.

## Release

Update the package, lockfile, manifest, and `versions.json`; run tests and build.
Push a tag matching the manifest version, for example `0.5.0`. The release workflow
builds and tests the tag and creates a draft GitHub Release with plugin files,
the validation bundle, runtime.zip (CLI and skills), and checksums. Review and publish that draft.

## License

This is a private CARI-DAAL repository. An open-source license has not been selected.
The bundled YAML dependency is covered by [third-party notices](THIRD_PARTY_NOTICES.md).

## CLI and agent skills

The same release includes `runtime.zip`: the CLI, generic `kb-query`, `kb-write` and `kb-research` skills, and the shared validation bundle. The CLI calls the same TypeScript frontmatter validator as the plugin and adds evidence, Claim, index and Git-history checks. See [instance installation](docs/instances.md).
