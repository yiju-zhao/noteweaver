"""Validate instance-pinned, one-time evidence deletion receipts."""

import hashlib
import json
import subprocess
from pathlib import PurePosixPath

from .repo import git
from .text import load_yaml, split_frontmatter


def approved_deletions(repo, base, deleted, references):
    """Return validated paths; malformed or inapplicable receipts allow none."""
    root = repo.root
    receipts = repo.layout.config.get("cleanup_receipts", [])
    if not deleted or not receipts:
        return set()
    allowed = set()
    for pin in receipts:
        allowed.update(_receipt(repo, base, deleted, references, pin))
    return allowed


def _receipt(repo, base, deleted, references, pin):
    root = repo.root
    if not isinstance(pin, dict) or not isinstance(pin.get("path"), str):
        return set()
    path = (root / pin["path"]).resolve()
    if not path.is_relative_to(repo.layout.path("review")):
        return set()
    if not deleted or not path.is_file():
        return set()
    try:
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != pin.get("sha256"):
            return set()
        receipt = json.loads(raw)
        if receipt.get("base_commit") != git(root, "rev-parse", f"{base}^{{commit}}").strip():
            return set()
        if git(root, "ls-tree", "--name-only", base, "--", pin["path"]).strip():
            return set()  # An old receipt must never authorize another deletion.
        if not isinstance(receipt.get("authorization"), str) or not receipt["authorization"].strip():
            return set()
        entries = receipt["entries"]
        if not isinstance(entries, list):
            return set()
        allowed = set()
        for entry in entries:
            card = entry["card"]
            original = card[:-3]
            if (not isinstance(card, str) or not card.endswith(".md")
                    or not card.startswith(repo.layout.rel("evidence") + "/sources/")
                    or PurePosixPath(card).as_posix() != card
                    or ".." in PurePosixPath(card).parts
                    or not isinstance(entry.get("reason"), str) or not entry["reason"].strip()):
                return set()
            if {root / card, root / original} & references:
                return set()
            files = entry["files"]
            paths = [f["path"] for f in files]
            has_original = bool(git(root, "ls-tree", "--name-only", base, "--", original).strip())
            expected = {card, original} if has_original else {card}
            if (len(paths) != len(set(paths)) or set(paths) != expected
                    or not expected <= deleted or expected & allowed):
                return set()
            for item in files:
                data = subprocess.run(
                    ["git", "-C", str(root), "show", f"{base}:{item['path']}"],
                    check=True, capture_output=True,
                ).stdout
                if hashlib.sha256(data).hexdigest() != item["sha256"]:
                    return set()
                if item["path"] == card:
                    fm, _, _ = split_frontmatter(data.decode("utf-8"))
                    if load_yaml(fm).get("type") != "source":
                        return set()
            allowed.update(expected)
        return allowed
    except (KeyError, TypeError, ValueError, AttributeError, OSError, RuntimeError,
            subprocess.CalledProcessError):
        return set()
