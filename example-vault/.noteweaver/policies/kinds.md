---
type: registry
title: "Synthetic vocabulary"
---

<!-- kb:kinds:start -->
| Kind | 目录 | 归这里 | 不归这里（该去哪） | 例子 |
|---|---|---|---|---|
| entity | `entities/<子类>/` | Synthetic entity | Other kinds | Example entity |
| concept | `concepts/` | Synthetic concept | Other kinds | Example concept |
<!-- kb:kinds:end -->
<!-- kb:classes:start -->
| `class` | 目录 | 范围 |
|---|---|---|
| model | `models/` | Synthetic model |
| organization | `organizations/` | Synthetic organization |
| person | `people/` | Synthetic person |
<!-- kb:classes:end -->
<!-- kb:jev-kind:start -->
```yaml
vocabulary: kind
primitive: choice
question:
  en: "Select the applicable kind"
  focus_en: "Use only the supplied evidence"
escape_value: none
values:
  entity:
    what: "entity"
    not_for: "Other entries"
    examples: []
  concept:
    what: "concept"
    not_for: "Other entries"
    examples: []
  none:
    what: "No matching entry"
    not_for: "Other entries"
    examples: []
```
<!-- kb:jev-kind:end -->
<!-- kb:jev-entity-class:start -->
```yaml
vocabulary: entity-class
primitive: choice
question:
  en: "Select the applicable entity-class"
  focus_en: "Use only the supplied evidence"
escape_value: none
values:
  model:
    what: "model"
    not_for: "Other entries"
    examples: []
  organization:
    what: "organization"
    not_for: "Other entries"
    examples: []
  person:
    what: "person"
    not_for: "Other entries"
    examples: []
  none:
    what: "No matching entry"
    not_for: "Other entries"
    examples: []
```
<!-- kb:jev-entity-class:end -->
