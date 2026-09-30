---
name: noteweaver-init
description: 在原生 Obsidian vault 中初始化符合 schema 的知识库，或预览已有 vault 接入 Noteweaver 的冲突。已有知识的查询、调研与写入分别使用 noteweaver-query、noteweaver-research、noteweaver-write。
---
# 初始化知识库

确认用户选择的 vault 已在 Obsidian 打开，并已安装启用同版本 Noteweaver 插件。用 `obsidian vault=<名称> vault info=path` 核对绝对路径。新 vault 尚无配置时，安装器的 `--bootstrap` 只安装工具；知识库文件由下面的 Obsidian 操作生成。

使用原生 `eval` 调用并等待 JSON：

```javascript
(async () => JSON.stringify(await app.plugins.plugins["noteweaver"].runAutomation({
  operation: "init", vault: "<目标绝对路径>", dryRun: true,
  initialize: { name: "<知识库名称>", repositoryRoot: "." }
})))()
```

`initialize` 可指定 `vaultName`、相对 vault 的 `paths`（schema、policies、review、bank、evidence），以及完整 `schema` 对象。默认模板提供七种知识类别与最小词表；实际收录范围由用户决定。vault 是仓库的直接子目录时 `repositoryRoot` 用 `..`。需要自定义 schema 时按 [schema 说明](../../docs/schema.md) 对照已有结构；安装包中用同包 `templates/basic-schema.json` 作为起点。

检查 `code` 和 `data.conflicts`，向用户呈现具体创建范围；已有任务授权覆盖该范围时，直接用同一请求去掉 `dryRun` 执行。code 1 表示冲突且不写入，code 2 表示执行失败。冲突文件保留原样；旧 `.kb` 或 `.noteweave` 先走显式目录迁移。连接失败停止，不回退文件系统写入。

完成后运行 `check`、`info`，读取实际实例路径，再将实际收录范围写入该实例政策。新 vault 没有 Git 历史时，检查会报告历史规则未核验，不能声称已检查证据不可变性。再次初始化只补充相同配置下缺失的文件；已编辑的模板文件会报告冲突，不能覆盖本地规则。

知识内容的生成交给 [noteweaver-write](../noteweaver-write/SKILL.md)，它遵循实例的来源和证据要求。结构合规检查不替代事实核验。
