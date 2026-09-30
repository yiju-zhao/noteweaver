#!/usr/bin/env bash
# Use the repository-pinned CLI and isolate daemon sockets across clones.
set -euo pipefail
browser_skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
browser_cli="$browser_skill_dir/node_modules/.bin/agent-browser"
if [ ! -x "$browser_cli" ]; then
  # Native hosts copy the plugin into their caches. Reuse the matching instance
  # installation's npm runtime instead of installing it separately in every host.
  browser_context=$(node "$browser_skill_dir/../noteweaver-query/scripts/context.cjs")
  browser_instance_skill=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["repository"]+"/.agents/plugins/noteweaver/skills/agent-browser")' "$browser_context")
  if [ -f "$browser_instance_skill/package-lock.json" ] && cmp -s "$browser_skill_dir/package-lock.json" "$browser_instance_skill/package-lock.json"; then
    browser_cli="$browser_instance_skill/node_modules/.bin/agent-browser"
  fi
fi
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
