"""Command line: kb check | kb index | kb refs | kb lift | kb schema."""

import argparse
import json
import sys
from pathlib import Path

from .layout import load as load_layout
from . import checks, indexgen, lift as lift_mod, refs, registry, repo as repo_mod, schema

EXIT_OK, EXIT_FINDINGS, EXIT_USAGE = 0, 1, 2


def find_root(start):
    for d in [start, *start.parents]:
        try:
            return load_layout(d).root
        except (OSError, ValueError):
            continue
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="kb", description="Check and maintain the knowledge bank.")
    ap.add_argument("--root", type=Path, help="vault or repository root (default: discovered from the current directory)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="check every rule kb can check mechanically")
    c.add_argument("--json", action="store_true", help="print findings as JSON")
    c.add_argument("--base", default="HEAD", help="revision for append-only rules (default HEAD)")
    i = sub.add_parser("index", help="regenerate the Kind and class index.md files")
    i.add_argument("--check", action="store_true", help="only report index files that differ")
    l = sub.add_parser("lift", help="promote unscoped direct claims into frontmatter keys ")
    l.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    r = sub.add_parser("refs", help="list links, claim references and aliases pointing at a page")
    r.add_argument("name", help="page name (file name without .md)")
    s = sub.add_parser("schema", help="render policy vocabulary sections from the instance schema")
    s.add_argument("--check", action="store_true", help="only report stale vocabulary sections")
    sub.add_parser("info", help="print this instance configuration and absolute paths")
    sub.add_parser("review", help="list open review documents as JSON")
    args = ap.parse_args(argv)

    root = args.root or find_root(Path.cwd()) or find_root(Path(__file__).resolve().parent)
    if root is None:
        print("kb: no knowledge bank found; run inside the repository or pass --root", file=sys.stderr)
        return EXIT_USAGE
    root = root.resolve()
    try:
        instance = load_layout(root)
        root = instance.root
        if args.cmd == "info":
            print(json.dumps({"root": str(root), "vault": str(instance.vault), "config": instance.config, "paths": {key: str(instance.path(key)) for key in ("schema", "policies", "review", "bank", "evidence")}}, ensure_ascii=False, indent=2))
            return EXIT_OK
        if args.cmd == "review":
            from .text import split_frontmatter, load_yaml
            rows = []
            for path in sorted(instance.path("review").rglob("*.md")):
                fm, _, _ = split_frontmatter(path.read_text())
                data = load_yaml(fm) if fm else {}
                if isinstance(data, dict) and data.get("status") == "open":
                    rows.append({"path": str(path.relative_to(root)), "title": data.get("title"), "object": data.get("object")})
            print(json.dumps(rows, ensure_ascii=False, indent=2))
            return EXIT_OK
        reg = registry.load(root)
    except (registry.RegistryError, OSError, ValueError) as e:
        print(f"kb: cannot read vocabulary: {e}", file=sys.stderr)
        return EXIT_USAGE
    repo = repo_mod.load(root)

    if args.cmd == "check":
        findings = checks.Checker(repo, reg, base=args.base).run()
        findings.sort(key=lambda f: (f.severity != "error", f.path, f.line, f.code))
        errors = sum(f.severity == "error" for f in findings)
        if args.json:
            print(json.dumps({"errors": errors, "warnings": len(findings) - errors,
                              "findings": [f.as_dict() for f in findings]}, ensure_ascii=False, indent=2))
        else:
            for f in findings:
                loc = f"{f.path}:{f.line}" if f.line else f.path
                print(f"{loc}: {f.severity}: [{f.code}] {f.message}")
            pages = len(repo.all_pages())
            claims = sum(len(p.claims or []) for p in repo.all_pages())
            print(f"kb check: {pages} pages, {claims} claims, {len(repo.cards)} evidence cards: "
                  f"{errors} errors, {len(findings) - errors} warnings")
        return EXIT_FINDINGS if errors else EXIT_OK

    if args.cmd == "index":
        if args.check:
            stale = [rel for rel, content in indexgen.build(repo, reg).items()
                     if not (root / rel).exists() or (root / rel).read_text(encoding="utf-8") != content]
            for rel in stale:
                print(f"{rel}: differs from its generated form")
            return EXIT_FINDINGS if stale else EXIT_OK
        for rel in indexgen.write(repo, reg):
            print(f"wrote {rel}")
        return EXIT_OK

    if args.cmd == "lift":
        stats = lift_mod.run(repo, reg, dry_run=args.dry_run)
        what = "would lift" if args.dry_run else "lifted"
        print(f"kb lift: {what} {stats['promoted']} keys on {stats['pages']} pages; "
              f"{stats['kept']} claims stay")
        for rel, attr, values in stats["conflicts"]:
            print(f"{rel}: conflict on {attr}: {' vs '.join(values)}; a human decides", file=sys.stderr)
        return EXIT_FINDINGS if stats["conflicts"] else EXIT_OK

    if args.cmd == "schema":
        if args.check:
            stale = schema.stale(root, reg)
            for rel, reason in stale.items():
                print(f"{rel}: {reason}")
            return EXIT_FINDINGS if stale else EXIT_OK
        try:
            for rel in schema.write(root, reg):
                print(f"wrote {rel}")
        except (registry.RegistryError, OSError, ValueError) as e:
            print(f"kb schema: {e}", file=sys.stderr)
            return EXIT_USAGE
        return EXIT_OK

    if args.cmd == "refs":
        found = refs.find(repo, args.name)
        for rel, line, kind, detail in found:
            print(f"{rel}:{line}: {kind}: {detail}")
        if repo.page(args.name) is None:
            print(f"kb: note: no page named {args.name!r}; listed references by name only", file=sys.stderr)
        return EXIT_OK
    return EXIT_USAGE
