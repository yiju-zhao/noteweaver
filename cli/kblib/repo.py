"""Load the bank pages and evidence cards of one working tree."""

import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .layout import load as load_layout
from .text import YamlError, claims_block, load_yaml, split_frontmatter

NOT_PAGES = ("index.md", "log.md")


@dataclass
class Page:
    path: Path
    rel: str
    name: str
    fm: dict
    body: str
    body_line: int                  # file line number of the first body line
    fm_error: str = ""
    claims: list = None             # None when the page has no "## 断言" heading
    claims_line: int = 0            # file line number of the first yaml line
    claims_error: str = ""
    sources: dict = field(default_factory=dict)       # source id -> resolved card path
    footnotes: set = field(default_factory=set)       # footnote ids referenced in the body
    prose_targets: set = field(default_factory=set)   # resolved paths the body links to


@dataclass
class Card:
    path: Path
    rel: str
    fm: dict
    body: str
    fm_error: str = ""

    @property
    def original(self):
        return self.path.with_name(self.path.name[:-3])


@dataclass
class Repo:
    root: Path
    layout: object = None
    pages: dict = field(default_factory=dict)       # page name -> [Page]
    cards: dict = field(default_factory=dict)       # rel path -> Card
    originals: list = field(default_factory=list)   # rel paths of evidence originals

    @property
    def bank(self):
        return self.layout.path("bank")

    @property
    def evidence(self):
        return self.layout.path("evidence")

    def all_pages(self):
        return [p for ps in self.pages.values() for p in ps]

    def page(self, name):
        ps = self.pages.get(name)
        return ps[0] if ps and len(ps) == 1 else None


def parse_page(text, path, rel):
    fm_text, body, body_line = split_frontmatter(text)
    page = Page(path, rel, path.stem, {}, body, body_line)
    if fm_text is None:
        page.fm_error = "missing frontmatter"
    else:
        try:
            fm = load_yaml(fm_text)
            if isinstance(fm, dict):
                page.fm = fm
            else:
                page.fm_error = "frontmatter is not a mapping"
        except YamlError as e:
            page.fm_error = f"frontmatter does not parse: {e}"
    found = claims_block(body)
    if found is not None:
        block, start, error = found
        page.claims_line = body_line + start
        if error:
            page.claims, page.claims_error = [], error
        else:
            try:
                data = load_yaml(block)
                page.claims = data if isinstance(data, list) else []
                if data not in (None, "") and not isinstance(data, list):
                    page.claims_error = "claims block must be a YAML list"
            except YamlError as e:
                page.claims, page.claims_error = [], f"claims block does not parse: {e}"
    return page


def load(root):
    instance = load_layout(root)
    root = instance.root
    repo = Repo(root, layout=instance)
    for path in sorted(repo.bank.rglob("*.md")):
        if path.name in NOT_PAGES:
            continue
        rel = path.relative_to(root).as_posix()
        page = parse_page(path.read_text(encoding="utf-8"), path, rel)
        repo.pages.setdefault(page.name, []).append(page)
    for path in sorted(repo.evidence.rglob("*")):
        if not path.is_file() or path.name == ".gitkeep":
            continue
        rel = path.relative_to(root).as_posix()
        if path.suffix == ".md":
            text = path.read_text(encoding="utf-8", errors="replace")
            fm_text, body, _ = split_frontmatter(text)
            fm, err = {}, ""
            if fm_text is not None:
                try:
                    fm = load_yaml(fm_text)
                    if not isinstance(fm, dict):
                        fm = {}
                except YamlError as e:
                    err = f"frontmatter does not parse: {e}"
            if fm.get("type") in ("source", "record") or err:
                repo.cards[rel] = Card(path, rel, fm, body, err)
                continue
        repo.originals.append(rel)
    return repo


def git(root, *args):
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"git {' '.join(args)} failed")
    return r.stdout


def base_pages(root, base):
    """Bank pages as they were at the base revision: rel path -> Page."""
    out = {}
    for rel in git(root, "ls-tree", "-r", "--name-only", base, "--", load_layout(root).rel("bank")).splitlines():
        name = rel.rsplit("/", 1)[-1]
        if not rel.endswith(".md") or name in NOT_PAGES:
            continue
        text = git(root, "show", f"{base}:{rel}")
        out[rel] = parse_page(text, root / rel, rel)
    return out
