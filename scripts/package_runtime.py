"""Create a byte-stable archive of runtime code and generic skills."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
files = [
    path for folder in ("cli", "skills") for path in (root / folder).rglob("*")
    if path.is_file() and "__pycache__" not in path.parts
]
files.append(root / "dist/validation.cjs")
# Stored entries avoid compression differences between supported Python/zlib versions.
with zipfile.ZipFile(root / "dist/runtime.zip", "w", compression=zipfile.ZIP_STORED) as archive:
    for path in sorted(files):
        name = "validation.cjs" if path.parent.name == "dist" else path.relative_to(root).as_posix()
        info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
        info.external_attr = (0o100755 if name == "cli/kb" else 0o100644) << 16
        archive.writestr(info, path.read_bytes())
