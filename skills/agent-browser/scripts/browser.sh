#!/usr/bin/env bash
# Use the repository-pinned CLI and isolate daemon sockets across clones.
set -euo pipefail
browser_skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
browser_cli="$browser_skill_dir/node_modules/.bin/agent-browser"
if [ ! -x "$browser_cli" ]; then
  echo "browser: run the instance research_setup command or the bundled scripts/setup-tools.sh --research" >&2
  exit 1
fi
if [ -z "${AGENT_BROWSER_SOCKET_DIR:-}" ]; then
  browser_scope=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:12])' "$browser_skill_dir")
  export AGENT_BROWSER_SOCKET_DIR="${TMPDIR:-/tmp}/noteweaver-browser-$(id -u)-$browser_scope"
fi
mkdir -p "$AGENT_BROWSER_SOCKET_DIR"
exec "$browser_cli" "$@"
