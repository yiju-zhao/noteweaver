---
name: noteweave-query
description: 查询 Noteweave 知识库，核对断言出处与可信度，并带页面和证据作答。适用于已有知识的查阅；收录或修改使用 noteweave-write，外部调研使用 noteweave-research。
---
# 查询知识

先用 Node.js 运行本 skill 目录下的 `scripts/context.cjs`：`node <本 skill 目录>/scripts/context.cjs`；可传 `--vault <目标 vault 绝对路径>`。它定位实例并检查该实例要求的 Obsidian 前置条件。失败时按提示处理；多个知识库时使用用户指定的目标，不猜默认库。

读取返回的配置：`paths` 相对 vault，`commands` 相对 repository。现行规则从 `paths.policies` 按需读取，词表以 `paths.schema` 为准。Obsidian 命令的首参数使用返回配置中的 `vault_name`，定位文件用 `path=<相对 vault 路径>`。配置和待审记录通过文件系统读取，知识通过实例规定的入口读取。

1. 读取 `navigation.md` 的检索顺序与预算。按名称、别名找到对象；跨领域问题先查专题索引；否则逐层读索引的 description 选页。
2. 只加载相关页面，必要时沿关系扩展。用Noteweave 的 `refs` 请求（name 为页面名） 区分 frontmatter、正文与 Claim 入链；正反关系由 schema 定义，不能把反向字段当作独立来源。
3. 读取 `evidence.md` 与 `claims.md` 对应的引用规则。沿 sources 和脚注核对证据；Claim 有定位时只读对应文本节选。区分来源原文、推导和估计，并检查对象、版本、适用范围与生效时间。
4. 按 `pages.md`、`claims.md` 解释 verified、draft、deprecated、撤回、冲突与历史值。未核验不等于有错；只有明确的人类核验记录才称人工核验。无快照时说明证据限制。
5. 回答给出页面路径、证据和可信度；快照值带 generated 时间，Claim 带 ID、basis 与适用时间。没有答案时说明缺口；只有用户授权写入时才转交 noteweave-write。

引用范围是配置中的 bank 与 evidence。实例政策、待审材料和软件开发文档用于指导查询，不充当世界知识的证据。

调用 Noteweave 前读取 [Obsidian CLI 入口](references/obsidian-cli.md)。agent 使用原生 `eval` 传入 operation 和绝对 vault 路径，解析返回的 code 与 data；连接失败停止处理，不回退直接写盘。原生 `command id=...` 适合交互调用，提交检查必须等待结果。
