"""kb refs: every place that points at one page, for renames, merges and deletes.

Obsidian updates and lists body links but not the Page references inside
"## 断言" blocks (pages.md), so this lists both."""

import os
import re
from pathlib import Path

from .text import links, prose_lines


def find(repo, name):
    target = repo.page(name)
    target_path = target.path if target else None
    out = []
    for p in repo.all_pages():
        for i, line in prose_lines(p.body):
            for t in links(line):
                path = Path(os.path.normpath(p.path.parent / t))
                if path == target_path or (target_path is None and path.stem == name):
                    out.append((p.rel, p.body_line + i, "link", t))
        for c in p.claims or []:
            if not isinstance(c, dict):
                continue
            cid = c.get("id", "")
            if c.get("value") == name:
                out.append((p.rel, p.claims_line, "claim", f"{cid} {c.get('attribute')}"))
            if c.get("method") == name:
                out.append((p.rel, p.claims_line, "claim", f"{cid} method"))
            scope = c.get("scope")
            if isinstance(scope, dict):
                for k, v in scope.items():
                    if v == name:
                        out.append((p.rel, p.claims_line, "claim", f"{cid} scope.{k}"))
            r = c.get("retracted")
            if isinstance(r, dict) and r.get("replaced_by", "").startswith(f"{name}--"):
                out.append((p.rel, p.claims_line, "claim", f"{cid} retracted.replaced_by"))
        for key, v in p.fm.items():
            vals = v if isinstance(v, list) else [v]
            for x in vals:
                if isinstance(x, str):
                    m = re.fullmatch(r"\[\[([^\[\]]+)\]\]", x)
                    if m and m.group(1) == name:
                        out.append((p.rel, 1, "frontmatter", key))
        aliases = p.fm.get("aliases")
        if isinstance(aliases, list) and name in aliases:
            out.append((p.rel, 1, "alias", name))
    return out
