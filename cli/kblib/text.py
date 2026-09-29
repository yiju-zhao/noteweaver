"""Parsing primitives shared by every command: YAML, frontmatter, markdown."""

import re

import yaml


class YamlError(ValueError):
    pass


class _Loader(yaml.BaseLoader):
    """Failsafe schema (every scalar stays a string, ADR-0007) that rejects duplicate keys."""

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=True)
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None, None, f"duplicate key {key!r}", key_node.start_mark)
            seen.add(key)
        return super().construct_mapping(node, deep=deep)


def load_yaml(text):
    try:
        return yaml.load(text, Loader=_Loader)
    except yaml.YAMLError as e:
        raise YamlError(str(e).replace("\n", " ")) from None


def split_frontmatter(text):
    """Return (frontmatter text or None, body, 1-based line number where body starts)."""
    if not text.startswith("---\n"):
        return None, text, 1
    end = text.find("\n---\n", 3)
    if end == -1:
        if text.endswith("\n---"):
            end = len(text) - 4
        else:
            return None, text, 1
    fm = text[4:end + 1]
    body = text[end + 5:]
    return fm, body, fm.count("\n") + 3


FENCE = re.compile(r"^(`{3,}|~{3,})")


def prose_lines(body):
    """Yield (index, line) for lines outside fenced code blocks, inline code blanked out."""
    fence = None
    for i, line in enumerate(body.split("\n")):
        m = FENCE.match(line)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
            continue
        if m:
            fence = m.group(1)
            continue
        yield i, re.sub(r"`[^`]*`", lambda c: " " * len(c.group(0)), line)


LINK = re.compile(r"!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def links(line):
    """Relative link targets in one prose line (external URLs and bare anchors skipped)."""
    out = []
    for m in LINK.finditer(line):
        target = m.group(1)
        if SCHEME.match(target) or target.startswith("#"):
            continue
        out.append(target.split("#", 1)[0])
    return out


def claims_block(body):
    """Locate the claims block: the first ```yaml fence under the "## 断言" heading.

    Returns (yaml text, 0-based body line of the first yaml line, error or None),
    or None when the page has no "## 断言" heading."""
    lines = body.split("\n")
    heads = [i for i, l in prose_lines(body) if l.rstrip() == "## 断言"]
    if not heads:
        return None
    if len(heads) > 1:
        return "", heads[1], "more than one \"## 断言\" heading"
    i = heads[0] + 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i].strip() != "```yaml":
        return "", heads[0], "\"## 断言\" must be followed by a ```yaml block"
    start = i + 1
    j = start
    while j < len(lines) and lines[j].strip() != "```":
        j += 1
    if j >= len(lines):
        return "", i, "claims block is not closed"
    return "\n".join(lines[start:j]), start, None


DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


def is_timestamp(s):
    return isinstance(s, str) and bool(DATETIME.match(s))


ACTOR = re.compile(r"^(?:(?:human|process):[A-Za-z0-9][A-Za-z0-9._-]*|[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._+~-]*)$")
SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
