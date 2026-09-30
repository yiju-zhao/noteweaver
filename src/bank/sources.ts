import { nativeSource } from "../sources";
import { setFrontmatterKey, setFrontmatterLines } from "../core";
import { Repo, Page, Patch, object, resolveLink, join, inside, SLUG } from "./model";

export class SourceError extends Error {
  constructor(public code: "sources" | "source-resource", message: string) { super(message); }
}

export function sourceEntry(repo: Repo, page: Page, entry: unknown, nativeRequired = false) {
  if (typeof entry === "string") {
    const parsed = nativeSource(entry);
    if (!parsed) throw new SourceError("sources", 'source must be "[[vault/path/card.md|local-id]]"');
    return { id: parsed.id, target: repo.layout.vault ? join(repo.layout.vault, parsed.path) : parsed.path };
  }
  if (nativeRequired) throw new SourceError("sources", 'schema requires native source links: "[[vault/path/card.md|local-id]]"');
  if (!object(entry) || !entry.id || !entry.resource)
    throw new SourceError("sources", "every sources entry needs id and resource");
  if (typeof entry.id !== "string" || !SLUG.test(entry.id))
    throw new SourceError("sources", `source id '${entry.id}' must use [a-z0-9-]`);
  if (typeof entry.resource !== "string")
    throw new SourceError("source-resource", "source resource must be a path");
  return { id: entry.id, target: resolveLink(page.path, entry.resource) };
}

/** Caller validates the whole snapshot before returning any patches. */
export function migrateSources(repo: Repo, now: string): Patch[] {
  const changes: Patch[] = [];
  for (const page of repo.allPages()) {
    const entries = page.fm.sources;
    if (!Array.isArray(entries) || !entries.some(object)) continue;
    const values = entries.map((entry) => {
      if (object(entry) && Object.keys(entry).some((key) => !["id", "resource"].includes(key)))
        throw new Error(`source has extra metadata; resolve before migration: ${page.path}`);
      const { id, target } = sourceEntry(repo, page, entry);
      if (!inside(target, repo.evidence) || !repo.cards.has(target))
        throw new Error(`source does not point to an evidence card: ${page.path}`);
      const path = target.slice(repo.layout.vault ? repo.layout.vault.length + 1 : 0);
      const value = `[[${path}|${id}]]`;
      if (!nativeSource(value)) throw new Error(`cannot represent source as a native link: ${page.path}`);
      return value;
    });
    const before = repo.store.read(page.path);
    const linked = setFrontmatterKey(before, "sources", values);
    const after = linked && setFrontmatterLines(linked, "generated", [
      `generated: {by: noteweave/sources, at: ${now}}`,
    ]);
    if (!after) throw new Error(`cannot update frontmatter: ${page.path}`);
    changes.push({ path: page.path, before, after });
  }
  return changes;
}
