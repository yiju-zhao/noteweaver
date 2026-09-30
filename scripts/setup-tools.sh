#!/usr/bin/env bash
# Dependencies of the installed skills; no instance paths or policy are embedded.
set -euo pipefail
noteweaver_package=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
fail() { echo "Noteweaver setup: $*" >&2; exit 1; }
case "${1:-}" in ""|--research) ;; *) fail 'usage: setup-tools.sh [--research]' ;; esac
command -v node >/dev/null || fail 'install Node.js 20+'
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || fail 'install Node.js 20+'
command -v python3 >/dev/null || fail 'install Python 3.9+'
python3 -c 'import sys; sys.exit(sys.version_info < (3,9))' || fail 'install Python 3.9+'
command -v pdftotext >/dev/null || fail 'install poppler-utils (pdftotext)'
[ "$(defuddle --version 2>/dev/null || true)" = 0.19.4 ] || fail 'install defuddle 0.19.4 (npm install -g defuddle@0.19.4)'
node "$noteweaver_package/skills/archify/bin/archify.mjs" doctor >/dev/null
if [ "${1:-}" = --research ]; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || fail 'browser tools require Node.js 24+'
  for required_tool in curl git rg; do command -v "$required_tool" >/dev/null || fail "install $required_tool"; done
  python3 -c 'import fcntl' || fail 'arXiv helper requires Linux/macOS'
  browser_skill="$noteweaver_package/skills/agent-browser"
  browser_runner="$browser_skill/scripts/browser.sh"
  browser_version=$(node -p 'require(process.argv[1]).dependencies["agent-browser"]' "$browser_skill/package.json")
  browser_hash=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$browser_skill/package-lock.json")
  marker="$browser_skill/node_modules/.noteweaver-lock-sha256"
  if [ "$(cat "$marker" 2>/dev/null || true)" != "$browser_hash" ] || [ "$("$browser_runner" --version 2>/dev/null || true)" != "agent-browser $browser_version" ]; then
    (cd "$browser_skill" && npm ci --ignore-scripts --no-audit --no-fund && node node_modules/agent-browser/scripts/postinstall.js)
    [ "$("$browser_runner" --version)" = "agent-browser $browser_version" ] || fail 'browser binary version mismatch'
    echo "$browser_hash" > "$marker"
  fi
  "$browser_runner" skills get core >/dev/null
  diagnosis=$("$browser_runner" doctor --offline --quick --json) || true
  if ! python3 -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(not any(c["id"]=="chrome.installed" and c["status"]=="pass" for c in d["checks"]))' "$diagnosis"; then
    "$browser_runner" install || fail 'install a supported Chrome/Chromium and set AGENT_BROWSER_EXECUTABLE_PATH'
  fi
  "$browser_runner" doctor --offline --quick || fail 'resolve browser diagnostics; select Chrome with AGENT_BROWSER_EXECUTABLE_PATH if needed'
  session="noteweaver-setup-$$"
  trap '"$browser_runner" --session "$session" close >/dev/null 2>&1 || true' EXIT
  "$browser_runner" --session "$session" open about:blank
  "$browser_runner" --session "$session" close >/dev/null
  trap - EXIT
  python3 "$noteweaver_package/skills/noteweaver-arxiv/scripts/search_arxiv.py" --help >/dev/null
fi
echo 'Noteweaver skill dependencies ready'
