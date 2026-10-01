# Noteweaver 的 Obsidian CLI 入口

日常操作使用官方 `obsidian`，先按 context 返回值选择 `config.vault_name`；下例的 `VAULT` 和绝对路径必须换成目标实例。插件 ID、命令前缀和安装目录统一为 `noteweaver`。

```sh
obsidian vault=VAULT commands filter=noteweaver
obsidian vault=VAULT command id=noteweaver:check
```

可用命令后缀：`check`、`index`、`schema`、`lift-preview`、`lift`、`sources-preview`、`sources`、`info`、`review`、`refs`。`refs` 使用当前页；preview 只预览。`command` 触发回调即返回，进程成功不代表检查通过。需要结果时运行：

```sh
obsidian vault=VAULT eval 'code=(async()=>JSON.stringify(await app.plugins.plugins["noteweaver"].commandResult("check")))()'
```

它等待最近一次知识库命令完成，返回 `commandId` 和下述结果；重载后无结果或命令 ID 不符返回 code 2。并行 agent 应使用下一种单次调用，避免共享最近结果。

传参、批处理和 agent 默认直接用 `eval`，一次取得对应调用的结果：

```sh
obsidian vault=VAULT eval 'code=(async()=>{const p=app.plugins.plugins["noteweaver"];if(p?.automationVersion!==1)throw Error("Noteweaver automation unavailable");return JSON.stringify(await p.runAutomation({operation:"check",vault:"/absolute/path/to/vault"}));})()'
```

输出可能有 `=> ` 前缀；去掉后解析 JSON：`{apiVersion:1, code, data, changes}`。code 0 为成功，1 为检查问题或冲突，2 为执行失败。先检查 code，再读取 data；不能只依赖 obsidian 进程退出码。插件不存在、协议不符、目标 vault 不符或连接失败就停止并处理前置条件，不回退直接写盘。

请求的 `vault` 使用 context 返回的绝对路径，防止同名实例误操作。替换请求中的 operation 和参数即可复用这一调用：

| operation | 参数 | data |
| --- | --- | --- |
| check | 可选 `base:"<git revision>"` | errors、warnings、findings、pages、claims、cards |
| index / schema | `check:true` 只检查生成结果 | 待更新或已更新的路径 |
| refs | 必填 `name:"页面名"` | frontmatter、Claim、正文的入链列表 |
| lift / sources | `dryRun:true` 预览 | 迁移统计与冲突/错误 |
| source-backlinks | `dryRun:true` 预览；需 schema 的 `formats.sources_inverse: "cited_by"` | cards、paths、errors；自动维护证据卡的反向引用属性 |
| info | 无 | 实例配置、root、vault 与绝对 paths |
| review | 无 | status 为 open 的文档列表 |

`index`、`schema`、`lift`、`sources`、`source-backlinks` 未传预览参数时会写入，应遵守目标实例政策和本次授权。多文件修改会在并发冲突时停止后续写入，不保证全局回滚。搜索、读取、改名、回收仍用 Obsidian 对应的原生命令。仓库配置中的 commands 仅提供 setup 等实例维护动作。

独立 Node runner 只用于 CI 或明确指定的隔离测试，必须显式传 `--offline`；不提供日常 `kb` 包装器。
