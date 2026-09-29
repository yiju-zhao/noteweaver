"""Generate the Kind and class index.md files (instance navigation policy)."""

from .registry import index_headings


def generated_dirs(repo, reg):
    """Directories (relative to the bank) whose index.md kb generates."""
    dirs = [d for t, d in reg.kind_dirs.items() if t != "entity"]
    dirs += [f"{reg.kind_dirs['entity']}/{d}" for d in reg.class_dirs.values()]
    return sorted(dirs)


def render(repo, reg, directory, headings):
    pages = [p for p in repo.all_pages() if p.path.parent == repo.bank / directory]
    pages.sort(key=lambda p: p.name)

    def line(p):
        return f"* [{p.fm.get('title', p.name)}]({p.name}.md) - {p.fm.get('description', '')}"

    live = [line(p) for p in pages if p.fm.get("status") != "deprecated"]
    dead = [line(p) for p in pages if p.fm.get("status") == "deprecated"]
    out = f"# {headings.get(directory, directory)}\n"
    if live:
        out += "\n" + "\n".join(live) + "\n"
    if dead:
        out += "\n# 已弃用\n\n" + "\n".join(dead) + "\n"
    return out


def build(repo, reg):
    """{relative index path: expected content}."""
    headings = index_headings(repo.root)
    return {f"{repo.layout.rel('bank')}/{d}/index.md": render(repo, reg, d, headings)
            for d in generated_dirs(repo, reg)}


def write(repo, reg):
    changed = []
    for rel, content in build(repo, reg).items():
        path = repo.root / rel
        old = path.read_text(encoding="utf-8") if path.exists() else None
        if old != content:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            changed.append(rel)
    return changed
