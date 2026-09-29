"""Call the release's shared TypeScript validator once per complete bank."""
import json
import subprocess
from pathlib import Path

def validate(repo, reg):
    payload = {"schema": reg.data, "pages": [
        {"path": p.path.relative_to(repo.layout.vault).as_posix(), "rel": p.rel, "text": p.path.read_text()}
        for p in repo.all_pages()]}
    result = subprocess.run(["node", str(Path(__file__).resolve().parents[1] / "validate.cjs")],
                            input=json.dumps(payload), text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError("Noteweave shared validation failed: " + result.stderr.strip())
    return json.loads(result.stdout)
