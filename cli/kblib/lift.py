"""kb lift: promote unscoped direct claims into frontmatter keys (ticket 26).

The Frontmatter 模式 section of attributes.md makes frontmatter the snapshot:
an unscoped, current, directly-sourced value belongs in a frontmatter key, not
a claim. lift moves mechanically liftable claims there and leaves everything
that needs a scope, a validity period, a method link or a human decision."""

import re
from datetime import datetime, timezone

import yaml

from .text import claims_block, split_frontmatter

WIKILINK = re.compile(r"^\[\[([^\[\]]+)\]\]$")


def unscoped_direct(reg, c):
    """A claim whose value belongs in frontmatter by the Frontmatter 模式 rule:
    a current, direct, unscoped, period-free scalar of a frontmatter-placed attribute."""
    term = reg.terms.get(c.get("attribute"))
    if term and term.inverse_of:
        return False
    if term is None or term.key in reg.place_claim:
        return False
    if c.get("scope") is not None or c.get("valid") is not None:
        return False
    if c.get("status") or c.get("retracted") is not None:
        return False
    if c.get("basis") != "direct" or c.get("method"):
        return False
    return isinstance(c.get("value"), str)


def liftable(reg, c):
    """unscoped_direct, and moving it loses nothing: a claim-level verified record
    has no frontmatter equivalent, so a verified claim stays where it is."""
    return unscoped_direct(reg, c) and not c.get("verified")


def plan(page, reg):
    """(promote: attr -> scalar or list, keep: claims, conflicts: [(attr, values)])."""
    keep, promote = [], {}
    for c in page.claims or []:
        if isinstance(c, dict) and liftable(reg, c):
            promote.setdefault(c["attribute"], []).append(c)
        else:
            keep.append(c)
    out, conflicts = {}, []
    for attr, cs in promote.items():
        term = reg.terms[attr]
        uniq = list(dict.fromkeys(c["value"] for c in cs))
        if len(uniq) > 1 and not term.multi:
            conflicts.append((attr, uniq))          # a human decides (ticket 26, Q5)
            keep.extend(cs)
        elif term.multi and len(uniq) > 1:
            out[attr] = uniq
        else:
            out[attr] = uniq[0]
    return out, keep, conflicts


def _fm_lines(promote, reg):
    """Frontmatter lines for the promoted keys, in vocabulary order."""
    def is_page(k):
        return reg.terms[k].vtype == "page"
    lines = []
    for k in sorted(promote, key=lambda k: list(reg.terms).index(k)):
        v = promote[k]
        if isinstance(v, list):
            lines.append(f"{k}:")
            lines += [f'  - "[[{x}]]"' if is_page(k) else f"  - {x}" for x in v]
        elif is_page(k) and v not in ("unknown", "none"):
            lines.append(f'{k}: "[[{v}]]"')
        else:
            lines.append(f"{k}: {v}")
    return lines


def _rewrite(path, promote, keep, reg):
    text = path.read_text(encoding="utf-8")
    fm_text, body, _ = split_frontmatter(text)
    lines = fm_text.rstrip("\n").split("\n")
    at = next((i for i, l in enumerate(lines) if l.startswith("generated:")), len(lines))
    lines[at:at] = _fm_lines(promote, reg)
    now = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    lines = [l for l in lines if not l.startswith("generated:")]
    lines.insert(min(at, len(lines)), f"generated: {{by: kb/lift, at: {now}}}")
    body = _set_claims(body, keep)
    if not body.startswith("\n"):
        body = "\n" + body
    path.write_text("---\n" + "\n".join(lines) + "\n---" + body, encoding="utf-8")


def _drop_claims_section(body):
    lines = body.split("\n")
    start = next((i for i, l in enumerate(lines) if l.strip() == "## 断言"), None)
    if start is None:
        return body
    i = start + 1
    while i < len(lines) and lines[i].strip() != "```yaml":
        i += 1
    j = i + 1
    while j < len(lines) and lines[j].strip() != "```":
        j += 1
    rest = lines[j + 1:]
    while rest and not rest[0].strip():
        rest.pop(0)
    out = lines[:start] + rest
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out) + "\n"


def _set_claims(body, keep):
    if not keep:
        return _drop_claims_section(body)
    block, start, error = claims_block(body)
    if error:
        raise ValueError(error)
    lines = body.split("\n")
    j = start
    while j < len(lines) and lines[j].strip() != "```":
        j += 1
    dumped = yaml.dump(keep, sort_keys=False, allow_unicode=True, default_flow_style=False, width=100)
    lines[start:j] = dumped.rstrip("\n").split("\n")
    return "\n".join(lines)


def run(repo, reg, dry_run=False):
    """Lift every page; returns stats. Conflicts are left for a human (exit 1)."""
    stats = {"pages": 0, "promoted": 0, "kept": 0, "conflicts": []}
    for p in repo.all_pages():
        if not p.claims or p.claims_error or p.fm_error:
            continue
        promote, keep, conflicts = plan(p, reg)
        for attr, values in conflicts:
            stats["conflicts"].append((p.rel, attr, values))
        if not promote:
            continue
        if not dry_run:
            _rewrite(p.path, promote, keep, reg)
        stats["pages"] += 1
        stats["promoted"] += len(promote)
        stats["kept"] += len(keep)
    return stats
