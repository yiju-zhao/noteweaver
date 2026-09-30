---
name: noteweaver-arxiv
description: 按主题、作者、类别或 ID 搜索 arXiv 论文，核对版本并取得固定版本的摘要/PDF 地址。用于论文发现；阅读全文与比较用 noteweaver-research，正式收录用 noteweaver-write。
---

# arXiv 检索

先用同包 [查询上下文](../noteweaver-query/SKILL.md) 定位实例；运行实例的 `commands.research_setup`（如有）。脚本仅依赖 Python 标准库，支持 Linux/macOS；API 用法见 [arXiv 手册](https://info.arxiv.org/help/api/user-manual.html)。

以本 skill 的实际安装目录替换下列 `<skill>`，从任意工作目录运行：

```bash
python3 <skill>/scripts/search_arxiv.py \
  --query 'all:"diffusion language model"' --max-results 5
python3 <skill>/scripts/search_arxiv.py \
  --query 'au:"Yann LeCun" AND cat:cs.LG' --sort-by submittedDate
python3 <skill>/scripts/search_arxiv.py \
  --ids '2502.09992v3,hep-th/9901001v1'
```

`--query` 接受 arXiv 查询表达式；`--start` 从 0 开始分页，`--max-results` 范围为 1–100。`--ids` 接受逗号分隔的 ID，保留 vN，并返回全部所请求 ID（最多 100）；不与分页混用。用 `--help` 看参数。

输出 JSON 包含完整摘要、作者、类别、发布时间、更新时间、版本化 ID 与 abs/PDF URL、实际查询地址、抓取时间和响应哈希。查无结果为 `papers: []`；按 ID 查询还列出 `missing_ids`。HTTP/API/解析失败退出码为 1，stderr 是错误 JSON，不能解读成“没有论文”。

API 不可用（例如 HTTP 406）时，记录失败，按 [agent-browser](../agent-browser/SKILL.md) 使用 arXiv 官方搜索页；已知 ID 可直接阅读 `https://arxiv.org/abs/完整ID` 并取得对应 PDF。说明结果来自网页，保持版本号，不把网页结果伪装成成功的 API 响应。

需要保存 Atom 原始响应时：

```bash
kb_arxiv_dir=$(mktemp -d)
python3 <skill>/scripts/search_arxiv.py \
  --ids '2502.09992v3' --raw "$kb_arxiv_dir/results.xml" \
  > "$kb_arxiv_dir/results.json"
```

原始响应文件必须不存在，防止覆盖。输出中的 ID 和 URL 都保留 API 返回的 vN；不把链接改成不带版本的地址。发布日期与更新日期用途不同，引用实际阅读版本。

## 请求与阅读

脚本用本机临时目录 `noteweaver-arxiv-<uid>` 中的锁串行化同用户、跨仓库的调用，每次响应结束至少等 3 秒再开始下一次。重试最多 3 次，遵守短时 Retry-After；服务要求等待超过 60 秒则退出并提示稍后再试。多进程不要各设不同 `--state-dir`，多机器共同抓取要另行协调，总限制见 [arXiv API 条款](https://info.arxiv.org/help/api/tou.html)。不默认批量爬全文。

摘要仅用来筛选。方法、实验和数值结论继续下载输出的固定版本 PDF，用 `pdftotext -layout` 阅读；遇到公式或图表直接查看对应页面。读法见 [论文研究](../noteweaver-research/references/literature.md)；已有收录授权时将原始 PDF 和定位交给 [noteweaver-write](../noteweaver-write/SKILL.md)。

改写自 [Hermes arxiv](https://github.com/NousResearch/hermes-agent/tree/e408d363393ccb72267e67bcccf4f8954b438cd9/skills/research/arxiv)，MIT，见 [LICENSE](LICENSE)。本地补全版本保留、JSON、分页、串行限速、错误处理和独占原始响应写入；不依赖 Hermes 的 web_extract 或全局安装路径。
