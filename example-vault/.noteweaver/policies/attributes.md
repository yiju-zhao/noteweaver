---
type: registry
title: "Synthetic vocabulary"
---

<!-- kb:predicates:start -->
| 谓词 | 中文 | 主语 | 宾语 | 值数 | 反向字段 | 反向值数 | 陈述模板 | 含义 | 不用于 |
|---|---|---|---|---|---|---|---|---|---|
| `developed_by` | 开发方 | entity（model） | entity（organization、person） | 多值 | `developed`（开发了） | 多值 | {subject} developed_by {value} | Synthetic developed_by | Other fields |
| `part_of` | 属于 | entity | 同一 class 的 entity | 多值 | `parts`（组成） | 多值 | {subject} part_of {value} | Synthetic part_of | Other fields |
| `instance_of` | 是一种 | entity | concept | 多值 | `instances`（实例） | 多值 | {subject} instance_of {value} | Synthetic instance_of | Other fields |
| `initialized_from` | 初始化自 | entity（model） | entity（model） | 单值 | `derived_models`（派生模型） | 多值 | {subject} initialized_from {value} | Synthetic initialized_from | Other fields |
<!-- kb:predicates:end -->
<!-- kb:jev-predicate:start -->
```yaml
vocabulary: predicate
primitive: choice
question:
  en: "Select the applicable predicate"
  focus_en: "Use only the supplied evidence"
escape_value: none
values:
  developed_by:
    what: "developed_by"
    not_for: "Other entries"
    examples: []
  part_of:
    what: "part_of"
    not_for: "Other entries"
    examples: []
  instance_of:
    what: "instance_of"
    not_for: "Other entries"
    examples: []
  initialized_from:
    what: "initialized_from"
    not_for: "Other entries"
    examples: []
  none:
    what: "No matching entry"
    not_for: "Other entries"
    examples: []
```
<!-- kb:jev-predicate:end -->
<!-- kb:attributes:start -->
| 属性 | 中文 | 主语 | 值类型 | 值数 | 陈述模板 | 含义 | 不用于 |
|---|---|---|---|---|---|---|---|
| `license` | 许可证 | entity（model） | 受控枚举，见下表 | 单值 | {subject} license {value} | Synthetic license | Other fields |
| `layers` | 层数 | entity（model） | 数量，`layer` | 单值 | {subject} layers {value} | Synthetic layers | Other fields |
| `params-total` | 总参数量 | entity（model） | 数量，`parameter` | 单值 | {subject} params-total {value} | Synthetic params-total | Other fields |
| `released` | 发布时间 | entity（model） | 时间 | 单值 | {subject} released {value} | Synthetic released | Other fields |
| `founded` | 成立时间 | entity（organization） | 时间 | 单值 | {subject} founded {value} | Synthetic founded | Other fields |
| `tpf` | 每次前向 token 数 | entity（model） | 数量，`token/forward` | 单值 | {subject} tpf {value} | Synthetic tpf | Other fields |
<!-- kb:attributes:end -->
<!-- kb:jev-attribute:start -->
```yaml
vocabulary: attribute
primitive: choice
question:
  en: "Select the applicable attribute"
  focus_en: "Use only the supplied evidence"
escape_value: none
values:
  license:
    what: "license"
    not_for: "Other entries"
    examples: []
  layers:
    what: "layers"
    not_for: "Other entries"
    examples: []
  params-total:
    what: "params-total"
    not_for: "Other entries"
    examples: []
  released:
    what: "released"
    not_for: "Other entries"
    examples: []
  founded:
    what: "founded"
    not_for: "Other entries"
    examples: []
  tpf:
    what: "tpf"
    not_for: "Other entries"
    examples: []
  none:
    what: "No matching entry"
    not_for: "Other entries"
    examples: []
```
<!-- kb:jev-attribute:end -->
<!-- kb:enums:start -->
`license`

| 取值 | 含义 |
|---|---|
| `mit` | MIT |
| `apache-2.0` | Apache-2.0 |
| `proprietary` | Proprietary |
<!-- kb:enums:end -->
<!-- kb:scope-keys:start -->
| 键 | 中文 | 值类型 | 说明 |
|---|---|---|---|
<!-- kb:scope-keys:end -->
<!-- kb:claim-only:start -->
| 只写断言的属性 | 原因 |
|---|---|
| `tpf` | Scoped measurement |
<!-- kb:claim-only:end -->
<!-- kb:required:start -->
| 类型 | 必填 |
|---|---|
| entity（model） | `developed_by` `instance_of` `initialized_from` `released` `license` `params-total` |
| entity（organization） | `founded` |
<!-- kb:required:end -->
