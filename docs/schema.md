# Schema format 3

The vocabulary belongs to the vault at `.kb/schema.json`, selected by
`.kb/config.json`. Noteweave reads it and never replaces it during upgrades.
The [synthetic example](../example-vault/.kb/schema.json) includes the metadata
used by the CLI and generated rule tables. Legacy locations and migration are
explained in [instances](instances.md).

## Top-level sections

| Key | Meaning |
| --- | --- |
| `version` | Must be `3` in this release. |
| `directories` | Exact vault-relative directory paths mapped to page types, optional entity classes, icons and required properties. |
| `base_required` | Properties required on every bound page. |
| `special_values` | Literal sentinel strings such as `unknown` and `none`. |
| `attributes` | Property definitions with labels, allowed subjects, value type and placement. |
| `predicates` | Page relations with explicit inverse names and cardinalities. |
| `enums` | Named mappings of allowed values to descriptions. |
| `formats` | Regular-expression strings for `quantity`, `time` (a list), and `wikilink`; optional `sources: "wikilink"` selects native evidence properties. |
| `kinds`, `scope_keys`, `units`, `jev` | Required object sections for vocabulary metadata. The CLI requires the metadata used by rule-table rendering. |

Extra metadata can describe terms for people or other tools. The example contains synthetic metadata, with no team vocabulary or evidence.

## Directory bindings

Each binding has `type`, `class` (a string or `null`), `icon`, and `required` (a
list of property names). Bindings apply to files directly in that directory;
subdirectories need their own bindings. `index.md` and `log.md` are skipped.
Page basenames must be unambiguous for relation lookup.

## Attributes and relations

Definitions have `label`, `value`, `place`, `multi`, `subject`, and `object`.
`place` is `frontmatter` or `claim`. Supported frontmatter values are `page`,
`quantity`, `time`, `enum`, and `boolean`. Quantities provide `unit`, and enums
provide an `enum` key naming an entry in `enums`.

Subjects and objects are lists of `{ "type": "...", "class": ["..."] }`.
`class` is optional and applies only to `entity` types. A relation's object can
use `"class": "SAME"` to require the same entity class as its subject.

Predicates use `value: "page"` and `place: "frontmatter"`. Each specifies
`inverse_key`, `inverse` (display label), and `inverse_multi`. The forward name
and `multi` describe one end; these inverse fields describe the other. Inverse
properties are derived in memory, not duplicated as separate predicate entries.

Page values use quoted wikilinks such as `"[[alpha-lab]]"`. Lists represent
multiple targets. Special values cannot be mixed with actual targets.

## Evidence and claims

The evidence convention is `<evidence-root>/sources/<group>/<card>.md` or
`<evidence-root>/records/<group>/<card>.md`; `paths.evidence` defaults to `evidence`.
Set `formats.sources` to `"wikilink"` to require a native list:

```yaml
sources:
  - "[[evidence/sources/example.org/paper.pdf.md|paper]]"
```

The path is exact and vault-relative, including the card's `.md` extension;
the display alias is the page-local citation ID (`[a-z0-9]+(-[a-z0-9]+)*`).
Keep it stable: footnotes `[^paper]` and Claim `evidence: [{source: paper, at: L1}]`
reference this ID. The target must be a `source` or `record` card, and footnote
definitions must link to the same card. Duplicate IDs, fragments, URLs,
relative `..` segments and missing aliases are rejected. Backlinks are computed
by Obsidian, never persisted into immutable evidence cards.

Instances without `formats.sources` retain compatibility with legacy
`{id, resource}` entries. After setting the format, preview `obsidian vault=<name> command id=noteweave:sources-preview`
and run `obsidian vault=<name> command id=noteweave:sources` to migrate through Obsidian. Migration validates the whole
bank before writing, changes only `sources` and `generated`, rejects extra source
metadata, and is idempotent. Update the instance's change log afterwards.
As with other multi-file operations, concurrent edits stop remaining writes;
successfully applied files can be resumed safely. It does not change Claims,
footnotes, original evidence bytes or card metadata.

`generated` and `verified` are read-only nested displays. Claims use the first
YAML fence following `## 断言`; values are parsed as literal strings. These
conventions remain explicit in this release rather than being a general-purpose
schema language or configurable renderer framework.
