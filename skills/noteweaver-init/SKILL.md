---
name: noteweaver-init
description: 从空目录建立 Noteweaver 知识库，接入已有 Obsidian vault，或 refactor 知识库的 vault/pages/evidence 布局。已有实例的日常内容维护使用 noteweaver-write；旧版插件身份迁移按实例迁移说明处理。
---
# 建立或接入知识库

目标是让用户选定范围内的知识符合实例的 schema、政策、证据与导航规则。空库以可用结构验收；已有库还要逐项交代原笔记的接入结果。安装工具、初始化结构和转换旧内容是三个不同的完成条件。

## 定位与准备

确认仓库根目录、目标 vault 的绝对路径和收录范围。新库以仓库目录名作为 vault 名，创建 `<repository>/<repository-name>/`，其中 `pages/` 放知识页，`evidence/` 放原件与证据卡，`.noteweaver/` 放实例规则与配置；`repositoryRoot` 为 `..`。知识库显示名默认使用 vault 名。用户已经指定的信息直接使用；未指定收录范围时先盘点，再给出具体方案。

已有 vault 先按原路径盘点。用户要求改造布局、改名或按其他仓库形态接入时，读 [布局改造](references/layout.md)，按迁移计划处理目录、绑定和仓库入口；已初始化实例的 `onboard` 保留原配置，`init` 只负责创建结构。

从空目录开始时，在用户选择的位置创建 vault 目录，并在 Obsidian 打开。尚未安装工具时按同包 `docs/instances.md` 的安装说明使用已校验的 release 和 `--bootstrap`；它只安装工具，不生成知识。插件宿主注册是独立步骤。运行同包 `scripts/setup-tools.sh` 检查前置条件。已安装的环境复用现有工具。

确认 vault 已在 Obsidian 打开，同版本 Noteweaver 已启用。用 `obsidian vault=<名称> vault info=path` 核对绝对路径，按 [CLI 入口](../noteweaver-query/references/obsidian-cli.md) 检查 automation 协议并等待每次请求的 JSON。连接失败先处理前置条件，保持知识内容原样。

## 盘点并选择分支

先调用只读 `onboard`；无需已有 config，即使未传 `dryRun` 也不会写入：

```javascript
(async () => JSON.stringify(await app.plugins.plugins["noteweaver"].runAutomation({
  operation: "onboard", vault: "<目标绝对路径>",
  initialize: { repositoryRoot: ".." }
})))()
```

`initialize` 可指定显示名 `name`、`vaultName`、相对 vault 的 `paths`（schema、policies、review、bank、evidence）和完整 `schema`。`paths.bank` 是知识页路径的配置键，新库默认值为 `pages`；evidence 默认值为 `evidence`。插件核对新 vault 名与所选仓库目录名一致。用户明确选择 vault 本身作为仓库时用 `repositoryRoot: "."`。默认模板提供七种知识类别与最小词表。需要自定义时读同包 `docs/schema.md`，从 `templates/basic-schema.json` 起步。插件包根目录在本 skill 目录的 `../..`；仅 skills 安装模式下，完整包位于仓库的 `.agents/plugins/noteweaver/`。

读取 `code`、`data.state`、`data.conflicts`、`data.inventory` 和 `data.initialization`。inventory 只记录实际文件和 frontmatter，不推断事实、类别或来源可信度；code 0 表示盘点成功，结构合规仍需 `check`。

- `blank`：选定名称、目录和收录范围后进入初始化。
- `existing`：先读 [已有 vault 接入](references/adoption.md)，完成盘点、范围与逐文件转换计划，再初始化所需结构并分批接入。
- `initialized`：`data.config` 是现有配置，`data.initialization` 为 null。读取该实例的 schema 和政策，按已有 vault 工作流接入剩余内容；保留已有词表和人工规则。
- `legacy`：按同包 `docs/instances.md` 显式迁移旧身份和目录后重新盘点。冲突时原文件保持原样。

## 初始化结构

使用选定的同一组 `initialize` 参数调用 `operation: "init", dryRun: true`。读取 `code` 与 `data.conflicts`，给出具体创建路径和冲突处理方案。已有授权覆盖创建范围时，直接去掉 `dryRun` 执行。code 1 表示冲突且不写入，code 2 表示执行失败。解决 pages/evidence 的具体冲突后重新预览；需要改用其他路径时把偏离默认布局的理由写入计划。

再次初始化只补充相同配置下缺失的文件；已编辑的模板会报告冲突。已有实例继续使用它的配置与正常编辑操作，不通过初始化重置规则。

运行 `info` 取得实际实例路径，读取现有政策；新实例将实际收录范围、接入策略和排除范围写入其政策入口。已有库继续执行逐文件接入计划，知识内容生成遵循 [noteweaver-write](../noteweaver-write/SKILL.md) 的来源和证据要求。

## 验收

通过 Obsidian 依次运行 `schema`、`index`、`check` 和 `info`，解析各自的 code。检查错误清零，警告逐项处理或说明原因。已有 vault 的每个范围内原笔记都要有接入结果；仍缺来源、类别或冲突裁决的材料留在待审记录，交代未完成项，不能把空 pages 的检查成功当作整个 vault 已转换。布局改造还须完成参考中的绑定、引用和历史哈希验收。

交付说明实例路径、实际配置、接入与排除数量、待审项和检查结果。新 vault 没有 Git 历史时，检查会报告历史规则未核验；结构合规不替代事实核验或证据不可变历史检查。
