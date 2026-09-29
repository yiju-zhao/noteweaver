/** Read-only presentation: no Obsidian dependency and no file-writing callback. */
export const NESTED_KEYS = new Set(["generated", "sources", "verified"]);

export interface EvidenceLink { path: string; title: string }
export type EvidenceLookup = (path: string) => EvidenceLink | undefined;

/** Resolve the literal resource relative to its bank page, never by basename.
 * Only evidence cards inside this vault are eligible for navigation. */
export function evidencePath(sourcePath: string, resource: unknown, evidenceRoot = "evidence"): string | undefined {
  if (typeof resource !== "string" || !resource || /^[a-z][a-z0-9+.-]*:/i.test(resource)
      || /[\\?#\[\]]/.test(resource) || resource.startsWith("/")) return;
  const parts = sourcePath.split("/").slice(0, -1);
  for (const part of resource.split("/")) {
    if (part === "..") { if (!parts.length) return; parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  const path = parts.join("/");
  if (!path.startsWith(evidenceRoot + "/")) return;
  return /^(sources|records)\/[^/]+\/[^/]+\.md$/.test(path.slice(evidenceRoot.length + 1)) ? path : undefined;
}

export function evidenceLink(sourcePath: string, resource: unknown, lookup: EvidenceLookup, evidenceRoot = "evidence"): EvidenceLink | undefined {
  const path = evidencePath(sourcePath, resource, evidenceRoot);
  return path ? lookup(path) : undefined;
}

function element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text?: string) {
  const el = parent.ownerDocument.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}

function scalar(value: unknown): string {
  return value === null ? "null" : value === undefined ? "未填写" : String(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tree(parent: HTMLElement, value: unknown, seen = new Set<unknown>(), depth = 0) {
  if (value === null || typeof value !== "object") {
    element(parent, "span", "kb-nested-scalar", scalar(value));
    return;
  }
  if (depth > 12 || seen.has(value)) { element(parent, "span", "kb-nested-muted", "请在源码中查看"); return; }
  const next = new Set(seen).add(value);
  if (Array.isArray(value)) {
    if (!value.length) { element(parent, "span", "kb-nested-muted", "暂无记录"); return; }
    const list = element(parent, "ol", "kb-nested-list");
    for (const item of value) tree(element(list, "li", ""), item, next, depth + 1);
  } else {
    const entries = Object.entries(value);
    if (!entries.length) { element(parent, "span", "kb-nested-muted", "未填写"); return; }
    const list = element(parent, "dl", "kb-nested-fields");
    for (const [key, item] of entries) {
      element(list, "dt", "", key);
      tree(element(list, "dd", ""), item, next, depth + 1);
    }
  }
}

export function renderNested(
  root: HTMLElement, key: string, value: unknown, sourcePath: string,
  lookup: EvidenceLookup, open: (link: EvidenceLink, event: MouseEvent) => void, evidenceRoot = "evidence",
) {
  root.replaceChildren();
  root.classList.add("kb-nested");
  root.setAttribute("aria-label", `${key}（只读）`);
  if (key !== "sources" || !Array.isArray(value)) { tree(root, value); return; }
  if (!value.length) { element(root, "span", "kb-nested-muted", "暂无证据"); return; }
  const details = element(root, "details", "kb-nested-sources");
  details.open = value.length <= 3;
  element(details, "summary", "", `${value.length} 份证据`);
  const list = element(details, "ol", "kb-nested-list");
  for (const entry of value) {
    const item = element(list, "li", "kb-nested-source");
    if (!object(entry)) { tree(item, entry); continue; }
    element(item, "code", "kb-nested-source-id", scalar(entry.id));
    const link = evidenceLink(sourcePath, entry.resource, lookup, evidenceRoot);
    if (link) {
      const a = element(item, "a", "internal-link kb-nested-evidence", link.title);
      a.setAttribute("href", link.path);
      a.setAttribute("data-href", link.path);
      a.title = typeof entry.resource === "string" ? entry.resource : link.path;
      const follow = (event: MouseEvent) => {
        if (event.button > 1) return;
        event.preventDefault(); event.stopPropagation();
        open(link, event);
      };
      a.addEventListener("click", follow);
      a.addEventListener("auxclick", follow);
    } else {
      element(item, "span", "kb-nested-missing", scalar(entry.resource));
      element(item, "span", "kb-nested-muted", "（证据卡片不存在或路径无效）");
    }
    const extra = Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "id" && k !== "resource"));
    if (Object.keys(extra).length) tree(item, extra);
  }
}
