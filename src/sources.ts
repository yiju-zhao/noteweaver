/** Native property links carry the page-local citation ID as their display alias.
 * Paths are exact, vault-relative card paths, never ambiguous basenames. */
export function nativeSource(value: unknown): { id: string; path: string } | undefined {
  if (typeof value !== "string") return;
  const match = /^\[\[([^\[\]|#?\\\r\n]+)\|([a-z0-9]+(?:-[a-z0-9]+)*)\]\]$/.exec(value);
  if (!match) return;
  const [, path, id] = match;
  if (!path.endsWith(".md") || /[:%]/.test(path) || path.trim() !== path ||
      path.split("/").some((p) => !p || p === "." || p === "..")) return;
  return { id, path };
}

export function nativeSources(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
