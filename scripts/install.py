#!/usr/bin/env python3
"""Install a pinned Noteweaver release into an Obsidian knowledge-bank instance."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

ASSETS = {'main.js', 'manifest.json', 'styles.css', 'validation.cjs', 'runtime.zip', 'agent-plugin.zip', 'installer.py'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_lock(path):
    lock = json.loads(path.read_text())
    if (lock.get('repository') != 'CARI-DAAL/noteweaver'
            or not re.fullmatch(r'\d+\.\d+\.\d+', lock.get('version', ''))
            or set(lock.get('assets', {})) != ASSETS
            or any(not re.fullmatch(r'[a-f0-9]{64}', sha) for sha in lock['assets'].values())
            or not isinstance(lock.get('schema_version'), int)
            or not re.fullmatch(r'[a-f0-9]{40}', lock.get('source_commit', ''))):
        raise ValueError('invalid tools.lock.json')
    return lock

def download(lock, name):
    result = subprocess.run(['gh', 'release', 'download', lock['version'], '--repo', lock['repository'],
                             '--pattern', name, '--output', '-'], capture_output=True, timeout=90)
    if result.returncode:
        raise ValueError(f"cannot download {name}: {result.stderr.decode(errors='replace').strip()}")
    if len(result.stdout) > 32 * 1024 * 1024:
        raise ValueError('release asset exceeds 32 MiB')
    return result.stdout

def unpack(data):
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        total = 0
        for entry in archive.infolist():
            p = Path(entry.filename); total += entry.file_size
            if (entry.is_dir() or p.is_absolute() or '..' in p.parts or '\\' in entry.filename
                    or p.as_posix() != entry.filename or stat.S_ISLNK(entry.external_attr >> 16)
                    or entry.filename in files or total > 64 * 1024 * 1024):
                raise ValueError('invalid archive path or size')
            files[entry.filename] = archive.read(entry)
    return files

def validate_bundle(files, version):
    manifest = json.loads(files.get('bundle.json', b'{}'))
    expected = manifest.get('files', {})
    if manifest.get('version') != version or set(expected) != set(files) - {'bundle.json'}:
        raise ValueError('invalid agent bundle inventory')
    if any(digest(files[p]) != sha for p, sha in expected.items()):
        raise ValueError('agent bundle file checksum mismatch')
    skills = manifest.get('skills', [])
    if not skills or len(skills) != len(set(skills)) or any(not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', n) for n in skills):
        raise ValueError('invalid skill inventory')
    actual = {p.split('/')[1] for p in files if p.startswith('skills/')}
    if actual != set(skills) or any(f'skills/{n}/SKILL.md' not in files for n in skills):
        raise ValueError('incomplete skill inventory')
    for name in ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json']:
        m = json.loads(files.get(name, b'{}'))
        if m.get('name') != 'noteweaver' or m.get('version') != version:
            raise ValueError('agent manifest does not match release')
    return skills

def tree_matches(directory, files):
    if directory.is_symlink() or not directory.is_dir(): return False
    entries = [p for p in directory.rglob('*') if not {'node_modules', '__pycache__'} & set(p.relative_to(directory).parts)]
    if any(p.is_symlink() for p in entries): return False
    return {p.relative_to(directory).as_posix() for p in entries if p.is_file()} == files.keys() and all(
        (directory / p).read_bytes() == data for p, data in files.items())

def replace_installation(replacements, staging):
    applied = []
    try:
        for index, (target, fresh) in enumerate(replacements):
            target.parent.mkdir(parents=True, exist_ok=True)
            backup = staging / f'backup-{index}' if os.path.lexists(target) else None
            if backup is not None: os.replace(target, backup)
            applied.append((target, backup)); os.replace(fresh, target)
    except OSError:
        for target, backup in reversed(applied):
            if target.is_symlink() or target.is_file(): target.unlink()
            elif target.is_dir(): shutil.rmtree(target)
            if backup is not None: os.replace(backup, target)
        raise

def instance_layout(metadata, bootstrap=False):
    if metadata.is_symlink(): raise ValueError('metadata must be a real directory')
    metadata = metadata.resolve(); vault = metadata.parent
    if metadata.name != '.noteweaver': raise ValueError('instance metadata must be .noteweaver')
    for old in ['.kb', '.noteweave']:
        if (vault / old).exists(): raise ValueError(f'migrate {old} to .noteweaver before installing')
    cp = metadata / 'config.json'
    config = json.loads(cp.read_text()) if cp.exists() else ({'version': 1} if bootstrap else None)
    if not isinstance(config, dict) or config.get('version') != 1: raise ValueError('valid instance config required (or use --bootstrap for a new vault)')
    if config.get('repository_root', '.') not in ('.', '..'): raise ValueError('repository_root must be . or ..')
    root = (vault / config.get('repository_root', '.')).resolve()
    paths = config.get('paths', {})
    if not isinstance(paths, dict): raise ValueError('invalid instance paths')
    name = paths.get('schema', '.noteweaver/schema.json')
    if (not isinstance(name, str) or not name or name.startswith('/') or '\\' in name or ':' in name
            or any(p in ('', '.', '..') for p in name.split('/'))): raise ValueError('invalid schema path')
    schema = (vault / name).resolve()
    if vault not in schema.parents: raise ValueError('schema path leaves vault')
    return root, vault, schema

def install(metadata, lock, assets=None, mode='plugin', bootstrap=False):
    root, vault, schema_path = instance_layout(metadata, bootstrap)
    metadata = metadata.resolve()
    for old in ['kb-types', 'noteweave']:
        if (vault / '.obsidian/plugins' / old).exists():
            raise ValueError(f'disable {old} in Obsidian and migrate its settings directory to noteweaver before installing')
    if (vault / '.obsidian/kb-schema.json').exists(): raise ValueError('finish the single-schema migration before installing')
    if schema_path.exists():
        if json.loads(schema_path.read_text()).get('version') != lock['schema_version']:
            raise ValueError('schema version differs from pinned plugin')
    elif not bootstrap: raise ValueError('instance schema is missing')
    destination = vault / '.obsidian/plugins/noteweaver'
    plugin = root / '.agents/plugins/noteweaver'
    runtime = metadata / 'runtime'
    for target in [destination, plugin, runtime, root / '.agents/skills']:
        for parent in [target, *target.parents]:
            if parent == root.parent: break
            if parent.is_symlink(): raise ValueError(f'managed installation path must be a real directory: {parent}')
    targets = {n: (metadata if n in {'runtime.zip', 'agent-plugin.zip', 'installer.py'} else destination) / n for n in ASSETS}
    verified, pending = {}, {}
    for name, sha in lock['assets'].items():
        current = targets[name]; data = current.read_bytes() if current.is_file() else b''
        if digest(data) != sha:
            data = (assets / name).read_bytes() if assets is not None else download(lock, name)
            if digest(data) != sha: raise ValueError(f'{name}: SHA-256 mismatch; no release files installed')
            pending[name] = data
        verified[name] = data
    manifest = json.loads(verified['manifest.json'])
    if manifest.get('id') != 'noteweaver' or manifest.get('version') != lock['version']: raise ValueError('Obsidian manifest does not match lock')
    runtime_files = unpack(verified['runtime.zip'])
    if not {'cli/cli.cjs', 'cli/runtime.cjs', 'cli/context.cjs', 'validation.cjs'} <= runtime_files.keys() or any(p.startswith('skills/') for p in runtime_files):
        raise ValueError('invalid runtime archive')
    bundle_files = unpack(verified['agent-plugin.zip'])
    skills = validate_bundle(bundle_files, lock['version'])
    binding = json.dumps({'version': 1, 'vault': str(vault)}, indent=2).encode() + b'\n'
    trees = {runtime: runtime_files, plugin: {**bundle_files, 'noteweaver-instance.json': binding}}
    if mode == 'skills':
        for name in skills:
            prefix = f'skills/{name}/'
            trees[root / '.agents/skills' / name] = {p[len(prefix):]: b for p, b in bundle_files.items() if p.startswith(prefix)}
    receipt_path = metadata / 'installation.json'
    previous = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
    for target in trees:
        if target == runtime: continue
        if target.exists() and str(target.relative_to(root)) not in previous.get('managed', []):
            raise ValueError(f'unmanaged installation exists; preserve it before installing: {target}')
    managed = [str(p.relative_to(root)) for p in trees]
    if previous.get('mode', mode) != mode:
        raise ValueError('installation mode changed; remove old discovery entries explicitly before switching modes')
    receipt = json.dumps({'version': lock['version'], 'mode': mode, 'skills': skills, 'managed': managed}, indent=2).encode() + b'\n'
    repair = {target: content for target, content in trees.items() if not tree_matches(target, content)}
    if pending or repair or not receipt_path.exists() or receipt_path.read_bytes() != receipt:
        metadata.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='noteweaver-', dir=metadata) as tmp:
            staging = Path(tmp); replacements = []
            for index, (target, content) in enumerate(repair.items()):
                fresh = staging / f'tree-{index}'
                for name, data in content.items():
                    p = fresh / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
                    if p.suffix == '.sh': p.chmod(0o755)
                replacements.append((target, fresh))
            for name, data in pending.items():
                fresh = staging / name; fresh.write_bytes(data); replacements.append((targets[name], fresh))
            fresh = staging / 'installation.json'; fresh.write_bytes(receipt); replacements.append((receipt_path, fresh))
            replace_installation(replacements, staging)
        print(f"Noteweaver {lock['version']} installed ({len(skills)} skills); reload Obsidian and refresh the agent plugin")
    else: print(f"Noteweaver {lock['version']}: plugin, runtime and {len(skills)} skills verified")
    return destination

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install', 'check'])
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--assets', type=Path)
    parser.add_argument('--mode', choices=['plugin', 'skills'], default='plugin')
    parser.add_argument('--bootstrap', action='store_true', help='install tools into a new vault before Obsidian init')
    args = parser.parse_args()
    try:
        lock = read_lock(args.metadata / 'tools.lock.json')
        install(args.metadata, lock, args.assets, args.mode, args.bootstrap)
        return 0
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        print(f'Noteweaver: {error}', file=sys.stderr); return 1

if __name__ == '__main__': sys.exit(main())
