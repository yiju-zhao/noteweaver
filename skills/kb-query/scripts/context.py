#!/usr/bin/env python3
"""Resolve the skill's bound instance and verify its Obsidian vault when required."""
import argparse,json,subprocess,sys
from pathlib import Path
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument("--vault",type=Path)
a=ap.parse_args()
candidates=[a.vault.resolve()/".kb/config.json"] if a.vault else []
if not candidates:
    for start in [Path(__file__).resolve().parent,Path.cwd()]:
        for p in [start,*start.parents]:
            for config in [p/".kb/config.json",p/"config.json" if p.name==".kb" else p/".kb/config.json"]:
                if config.is_file():candidates.append(config)
if not candidates:
    sys.exit("Specify the intended Noteweave vault with --vault; no bound instance was found")
config_path=candidates[0];config=json.loads(config_path.read_text());vault=config_path.parent.parent
if config.get("version")!=1:sys.exit("Unsupported instance configuration")
name=config.get("vault_name",vault.name)
if config.get("require_obsidian",False):
    try:r=subprocess.run(["obsidian",f"vault={name}","vault","info=path"],capture_output=True,text=True,timeout=20)
    except (OSError,subprocess.TimeoutExpired):sys.exit(f"Open Obsidian with {vault} as vault {name}; then rerun setup")
    if r.returncode or Path(r.stdout.strip()).resolve()!=vault.resolve():sys.exit(f"Open Obsidian with {vault} as vault {name}; do not bypass this instance requirement")
print(json.dumps({"vault":str(vault),"repository":str((vault/config.get("repository_root",".")).resolve()),"config":config},ensure_ascii=False,indent=2))
