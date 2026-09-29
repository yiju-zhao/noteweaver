"""Locate a Noteweave instance independently of repository and vault names."""
import json
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Layout:
    root: Path
    vault: Path
    config: dict

    def path(self, key):
        defaults = {"schema": ".kb/schema.json", "policies": ".kb/policies", "review": ".kb/review",
                    "bank": "bank", "evidence": "evidence"}
        value = self.config.get("paths", {}).get(key, defaults[key])
        if not isinstance(value, str) or not value or Path(value).is_absolute() or ".." in Path(value).parts:
            raise ValueError(f"invalid instance path: {key}")
        path = (self.vault / value).resolve()
        if not path.is_relative_to(self.vault):
            raise ValueError(f"instance path leaves vault: {key}")
        return path

    def rel(self, key):
        return self.path(key).relative_to(self.root).as_posix()


def load(start):
    start = Path(start).resolve()
    candidates = [start] if (start / ".kb/config.json").is_file() else [
        p for p in start.iterdir() if p.is_dir() and not p.name.startswith(".") and (p / ".kb/config.json").is_file()]
    if len(candidates) != 1:
        raise ValueError("select one vault with .kb/config.json using --root")
    vault = candidates[0]
    config = json.loads((vault / ".kb/config.json").read_text())
    if not isinstance(config, dict) or config.get("version") != 1:
        raise ValueError("unsupported .kb/config.json version")
    relative = config.get("repository_root", ".")
    if relative not in (".", ".."):
        raise ValueError("repository_root must be . or ..")
    instance = Layout((vault / relative).resolve(), vault, config)
    for key in ("schema", "policies", "review", "bank", "evidence"):
        instance.path(key)
    if (vault / ".obsidian/kb-schema.json").exists():
        raise ValueError("two schema locations: finish the migration from .obsidian/kb-schema.json")
    return instance
