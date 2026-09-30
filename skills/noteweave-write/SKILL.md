---
name: noteweave-write
description: 收录材料、创建或修改 Noteweave 知识页，处理弃用、删除、合并、改名和人工核验。按目标知识库的 schema 与政策执行；只读查询使用 noteweave-query。
---
# 写入知识

先运行同一运行包的查询上下文脚本：`node <本 skill 目录>/../noteweave-query/scripts/context.cjs`；可传 `--vault <目标 vault 绝对路径>`。它定位实例并检查该实例要求的 Obsidian 前置条件。失败时按提示处理；多个知识库时使用用户指定的目标，不猜默认库。

读取返回的配置：`paths` 相对 vault，`commands` 相对 repository。现行规则从 `paths.policies` 按需读取，词表以 `paths.schema` 为准。Obsidian 命令的首参数使用返回配置中的 `vault_name`，定位文件用 `path=<相对 vault 路径>`。配置和待审记录通过文件系统读取，知识通过实例规定的入口读取。

先运行实例的 `commands.setup`，阅读政策入口 `README.md` 和本次操作对应的规则。遵守已有用户授权；需要人的归类、冲突裁决或删除决定时，先完成核查并提供具体方案。未解决的问题写到 `paths.review`，不自行替用户裁决。

## 收录与修改

1. 按 `evidence.md` 查重、存原件和证据卡，记录版本、获取时间、发布方、等级与原件哈希。材料更新时另存快照，已有证据保持原字节。
2. 按 `kinds.md` 判别内容单元，按 resource、页面名、title 和 aliases 查重。对应对象已有页面时归到该页。
3. 按 `attributes.md` 决定 frontmatter 或 Claim 的放置。值与现有同属性同范围内容冲突时交给人；已有 Claim 的不可变字段按 `claims.md` 处理。
4. 按实例 schema 与 evidence.md 登记来源和正文脚注。`formats.sources: wikilink` 时，sources 为完整卡片路径的原生链接列表，链接别名保留页内 ID；脚注和 Claim 的 source 使用同一 ID。改动页写本次 generated，保持数量的原始字符串、尾零及引号；嵌套 YAML 和精确数值通过源码编辑，避免属性面板重写。
5. 运行 Noteweave 的 `index` 请求，按 `navigation.md` 更新日志，再运行 `check` 请求。错误清零，逐项处理警告；输出包含修改页面、证据和仍待人决定的事项。

## 改名、删除、合并

先按 `refs` 请求 核对全部入链并遵守实例审批政策。已获授权的改名或移动通过运行中的 Obsidian 执行，以更新正文与 frontmatter 链接；再修正 Claim 的页面引用。获准删除时使用 Obsidian 回收站。合并保留 Claim 身份并迁移来源；别名、重定向和日志以 `pages.md` 为准。完成后更新索引并重跑检查。

## 人工核验

只有用户明确说已核对，才记录 human 身份和时间；整页与单条 Claim 的核验分别记到对应位置。缺少核验人身份时询问，不能把 agent 自检登记为人工核验。

## Schema

现有词表不能表达已授权内容时，按实例政策提出增补。确认后修改唯一 schema，并使用 `schema` 请求 刷新只读文档，完成实例要求的检查后一起提交；生成区不手改。

调用 Noteweave 前读取 [Obsidian CLI 入口](../noteweave-query/references/obsidian-cli.md)。agent 使用原生 `eval` 传入 operation 和绝对 vault 路径，解析返回的 code 与 data；连接失败停止处理，不回退直接写盘。原生 `command id=...` 适合交互调用，提交检查必须等待结果。
