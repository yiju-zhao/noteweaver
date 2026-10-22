# 仓库布局与改造

新库默认采用仓库同名 vault。以 `daal-atlas` 为例：

```text
daal-atlas/                       # 仓库根
├── daal-atlas/                   # Obsidian vault，名称 daal-atlas
│   ├── pages/                   # 知识页、索引、log.md
│   ├── evidence/
│   │   ├── sources/             # 外部原件和证据卡
│   │   └── records/             # 原始记录和证据卡
│   ├── .noteweaver/             # config、schema、policies、review、版本锁
│   └── .obsidian/               # Obsidian 配置和已安装插件
└── .agents/plugins/noteweaver/   # 已校验安装包生成的 Agent 插件
```

实例中的 `repository_root` 为 `..`，`vault_name` 为 `daal-atlas`，`paths.bank` 为 `pages`，`paths.evidence` 为 `evidence`。保留 `bank` 配置键，它表示知识页根目录；目录名由值决定。用户明确选择仓库根作为 vault 时，pages/evidence 位于该根，`repository_root` 为 `.`。

## 改造已有布局

适用于 `bank → pages`、通用 vault 名改为 repo 名、仓库根 vault 拆为子 vault，以及用户指定的参考仓库形态。内容接入仍按 [adoption](adoption.md) 执行；布局改造本身保留领域 schema、人工规则和证据字节。

1. 在原 vault 上运行 `onboard` 和 `info`，记录仓库根、实际配置、插件版本与安装绑定。尚无 config 的旧库先用 `repositoryRoot: "."` 盘点；它不创建配置。记录迁移前 Git commit、每个证据原件和卡片的路径与 SHA-256，以及需保持的 Claim 和人工核验字段。
2. 列出旧路径到新路径的映射、目标冲突、链接修复、配置修改和恢复方式。已有目标含独立内容时逐文件处理冲突。`init` 的创建预览不能代替移动计划；当前 automation 没有 `refactor` 操作。
3. 通过运行中的 Obsidian 移动 vault 内目录，更新原生链接。调整 vault 根目录后，在 Obsidian 重新打开目标 vault，用 CLI 核对绝对路径和名称。将 config 的 `vault_name`、`repository_root`、`paths.bank`、`paths.evidence` 与 schema 的 `directories` 更新为实际布局。
4. 核对正文相对链接、完整 wikilink、frontmatter 关系、sources 和 Claims。更新仓库 README、AGENTS/CLAUDE 入口、setup、CI、hooks、tests 和忽略规则中的路径。检查 repo-relative 的 review/receipt 引用；历史 receipt 原件保留字节，其外部引用按新位置更新。
5. 用同一已校验 release 重新绑定安装，核对 `noteweaver-instance.json`、marketplace 路径和宿主技能缓存。保留插件的 actor、关系状态、实例政策与版本锁。完成条件是 context 和 Obsidian `info` 都指向同一个新 vault。
6. 按路径映射逐一比较证据原件和卡片的 SHA-256，核对 Claim 不可变字段与人工核验字段，修复引用并运行 `schema`、`index`、`check`。当前历史检查按当前配置路径取 Git 历史；跨根目录改名后的 `check` 成功不能代替迁移前后的哈希比较。记录本次布局变更和检查范围，再完成逐文件接入验收。

## 参考仓库的交付范围

要求完整仓库形态时，除上述 vault 外还需按实际实例生成仓库 README、Agent 操作入口、维护说明与日志、可重建的 setup、插件 marketplace、忽略规则、CI、pre-commit 和消费端验收。`init` 只生成 vault 内的 config、schema、starter policies、indexes、log 和 evidence 占位文件；安装器只安装版本锁指定的工具。仓库入口与消费端检查目前由 agent 按任务创建和核验，runtime 不自动生成。

参考仓库的领域类别、属性、来源评级、收录范围和已核验内容属于该实例。根据目标材料制定本库规则；从参考库复制目录树不代表完成内容转换或事实核验。交付分别说明 vault 结构、工具接入、仓库入口和选定知识范围的完成情况。
