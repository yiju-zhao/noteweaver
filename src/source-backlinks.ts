/** Citation inverses are a derived view, not independently editable evidence facts.
 * Keep the original body and its absolute line numbers stable for existing Claims. */
import { isMap, parseDocument } from "yaml";
import { readFrontmatter, specFor, splitFrontmatter, type KbSchema } from "./core";
import { nativeSource } from "./sources";
import type { RelationIssue, RelationPage, RelationPatch } from "./relations";

export interface SourceBacklinkPlan { patches: RelationPatch[]; issues: RelationIssue[] }

export function readSourceLines(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([path, n]) => path.endsWith(".md") &&
    typeof n === "number" && Number.isSafeInteger(n) && n >= 3));
}

export function setSourceBacklinks(text: string, values: string[], bodyLine = splitFrontmatter(text).bodyLine): string | null {
  const { fm } = splitFrontmatter(text);
  if (fm === null) return null;
  const doc = parseDocument(fm, { schema: "failsafe", uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) return null;
  doc.set("cited_by", values);
  const links = doc.get("cited_by", true);
  if (links && typeof links === "object" && "flow" in links) links.flow = true;
  doc.contents.flow = true;
  let rendered = doc.toString({ lineWidth: 0 }).trimEnd();
  const slots = bodyLine - 2;
  // For ordinary scalar cards, keep one existing metadata field on each line.
  // The generated list shares the last line; changing its size never moves text.
  if (!rendered.includes("\n")) {
    const flow = parseDocument(rendered, { schema: "failsafe" });
    if (isMap(flow.contents)) {
      const items = flow.contents.items;
      for (let i = Math.min(items.length - 2, slots - 1); i > 0; i--) {
        const start = items[i - 1].value?.range?.[1], end = items[i].key?.range?.[0];
        if (start !== undefined && end !== undefined)
          rendered = rendered.slice(0, start) + ",\n  " + rendered.slice(end);
      }
    }
  }
  const count = rendered.split("\n").length;
  if (count > slots) return null;
  const result = text.slice(0, 4) + rendered + "\n".repeat(slots - count + 1) + text.slice(4 + fm.length);
  const parsed = readFrontmatter(result);
  return parsed.error || splitFrontmatter(result).bodyLine !== bodyLine ? null : result;
}

export function planSourceBacklinks(schema: KbSchema, pages: RelationPage[], cards: RelationPage[],
                                   evidenceRoot = "evidence", bodyLines: ReadonlyMap<string, number> = new Map()): SourceBacklinkPlan {
  const issues: RelationIssue[] = [], patches: RelationPatch[] = [];
  if (schema.formats.sources_inverse !== "cited_by") return { patches, issues };
  const issue = (path: string, message: string) => issues.push({ path, key: "sources",
    code: "source-backlinks", severity: "error", message });
  const byPath = new Map<string, { card: RelationPage; data: Record<string, unknown>; incoming: Set<string> }>();
  for (const card of cards) {
    if (!card.path.startsWith(evidenceRoot + "/")) continue;
    const { data, error } = readFrontmatter(card.text);
    if (error || !data || !["source", "record"].includes(String(data.type))) {
      issue(card.path, error || "证据卡类型必须是 source 或 record"); continue;
    }
    byPath.set(card.path, { card, data, incoming: new Set() });
  }
  for (const page of pages) {
    if (!specFor(schema, page.path)) continue;
    const { data, error } = readFrontmatter(page.text);
    if (error || !data) { issue(page.path, error || "frontmatter 无效"); continue; }
    if (data.sources === undefined) continue;
    if (!Array.isArray(data.sources)) { issue(page.path, "sources 必须是原生链接列表"); continue; }
    for (const value of data.sources) {
      const source = nativeSource(value);
      const card = source && byPath.get(source.path);
      if (!card) { issue(page.path, "sources 必须指向已有证据卡，并带有效的页内引用 ID"); continue; }
      card.incoming.add(`[[${page.path}]]`);
    }
  }
  if (issues.length) return { patches, issues };
  for (const { card, data, incoming } of byPath.values()) {
    const wanted = [...incoming].sort();
    const current = data.cited_by;
    const bodyLine = bodyLines.get(card.path) ?? splitFrontmatter(card.text).bodyLine;
    if (splitFrontmatter(card.text).bodyLine === bodyLine &&
        ((!wanted.length && current === undefined) || JSON.stringify(current) === JSON.stringify(wanted))) continue;
    const after = setSourceBacklinks(card.text, wanted, bodyLine);
    if (after === null) issue(card.path, "无法在保留证据正文行号的前提下写入 cited_by");
    else patches.push({ path: card.path, before: card.text, after });
  }
  return { patches: issues.length ? [] : patches, issues };
}
