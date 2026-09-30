#!/usr/bin/env python3
"""Static checks for an explainer page.

Usage: python check_page.py page.html [--allow-host HOST ...]

Checks: stray U+FFFD characters, balanced <div>/<section>, duplicate ids,
getElementById targets that exist nowhere in the markup or scripts, unequal
data-l translation counts, JS syntax (via `node --check` when node is available),
external hosts outside the allowlist, and leftover placeholders.
Exit code 1 if any FAIL.
"""
import argparse, re, shutil, subprocess, sys, tempfile
from collections import Counter
from pathlib import Path

ALLOWED = {"fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com",
           "cdn.tailwindcss.com", "code.jquery.com"}  # claude.ai artifact CSP


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page")
    ap.add_argument("--allow-host", action="append", default=[])
    a = ap.parse_args()
    s = Path(a.page).read_text(encoding="utf-8")
    fails, warns, oks = [], [], []

    n = s.count("�")
    (fails if n else oks).append(f"U+FFFD characters: {n}")

    for tag in ("div", "section"):
        o, c = len(re.findall(rf"<{tag}\b", s)), len(re.findall(rf"</{tag}>", s))
        (fails if o != c else oks).append(f"<{tag}> open/close: {o}/{c}")

    ids = re.findall(r'\bid="([^"]+)"', s)
    dup = sorted(k for k, v in Counter(ids).items() if v > 1)
    (fails if dup else oks).append(f"duplicate ids: {dup or 'none'}")

    wanted = set(re.findall(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", s))
    missing = sorted(w for w in wanted if w not in ids)
    (warns if missing else oks).append(f"getElementById targets not found in markup: {missing or 'none'}")

    langs = Counter(re.findall(r'data-l="([^"]+)"', s))
    if len(langs) > 1:
        counts = set(langs.values())
        (fails if len(counts) > 1 else oks).append(f"translation counts: {dict(langs)}")
    else:
        oks.append(f"translation counts: {dict(langs) or 'single language'}")

    scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", s, re.S)
    node = shutil.which("node")
    if scripts and node:
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write("\n;\n".join(scripts))
        r = subprocess.run([node, "--check", f.name], capture_output=True, text=True)
        (fails if r.returncode else oks).append("JS syntax: " + ("ok" if not r.returncode else r.stderr.strip().splitlines()[-1]))
    elif scripts:
        warns.append("JS syntax: node not found, not checked")

    hosts = set(re.findall(r'(?:src|href)="https?://([^/"]+)', s))
    bad = sorted(h for h in hosts if h not in ALLOWED | set(a.allow_host))
    (warns if bad else oks).append(f"external hosts outside allowlist: {bad or 'none'}")

    ph = re.findall(r"\{\{[A-Z_]+\}\}|__[A-Z][A-Z_]*__|\bTODO\b|(?i:lorem ipsum)", s)
    (warns if ph else oks).append(f"placeholders left: {sorted(set(ph)) or 'none'}")

    for tag, items in (("FAIL", fails), ("WARN", warns), ("ok", oks)):
        for i in items:
            print(f"[{tag}] {i}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
