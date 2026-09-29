// Schema-driven relationship reconciliation. No Obsidian dependency.
import { pageName, readFrontmatter, setFrontmatterKey, specFor, validate,
  type Finding, type KbSchema, type KeySpec, type PageInfo } from "./core";

export interface RelationPage { path: string; text: string }
export type Edge = [predicate: string, subject: string, object: string];
export interface RelationState { schema: string; edges: Edge[] }
export interface RelationIssue extends Finding { path: string }
export interface RelationPatch { path: string; before: string; after: string }
export interface RelationPlan { patches: RelationPatch[]; issues: RelationIssue[]; state: RelationState }

export function checkRelations(schema: KbSchema, pages: RelationPage[]): RelationIssue[] {
  const plan = planRelations(schema, pages);
  return [...plan.issues, ...plan.patches.map((p): RelationIssue => ({ path: p.path,
    code: "relation-stale", severity: "error", message: "正反字段不一致；运行「同步全库双向关系」" }))];
}

const edgeKey = (edge: Edge) => JSON.stringify(edge);
const fieldKey = (page: string, key: string) => JSON.stringify([page, key]);
const sorted = (values: Iterable<string>) => [...values].sort();
const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** Only relation definitions invalidate a checkpoint; enum/label edits do not. */
export function relationSchema(schema: KbSchema): string {
  return JSON.stringify(Object.entries(schema.directories).sort(([a], [b]) => a.localeCompare(b)).map(([path, spec]) =>
    [path, spec.type, spec.class, Object.entries(spec.keys).filter(([, k]) => k.counterpart)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, k]) => [key, k.counterpart, k.inverseOf, k.multi, k.targets])]));
}

export function readRelationState(value: unknown): RelationState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const s = value as RelationState;
  if (typeof s.schema !== "string" || !Array.isArray(s.edges) || s.edges.some((e) =>
    !Array.isArray(e) || e.length !== 3 || e.some((v) => typeof v !== "string"))) return undefined;
  return s;
}

/**
 * Each edge has two representations. Against the last agreed edge set, an edit
 * on either side wins over the unchanged side. Both sides changing a single-valued
 * field to different targets is a conflict, never a last-writer-wins overwrite.
 * With no checkpoint, the forward facts are authoritative (installation/repair).
 */
export function planRelations(schema: KbSchema, pages: RelationPage[], previous?: RelationState,
                              renames: ReadonlyMap<string, string> = new Map()): RelationPlan {
  const signature = relationSchema(schema);
  const canonical = (name: string): string => {
    const seen = new Set<string>();
    while (renames.has(name) && !seen.has(name)) { seen.add(name); name = renames.get(name)!; }
    return name;
  };
  const old = new Set((previous?.schema === signature ? previous.edges : []).map(([k, a, b]) =>
    edgeKey([k, canonical(a), canonical(b)])));
  const initialized = previous?.schema === signature;
  const issues: RelationIssue[] = [];
  const issue = (path: string, key: string | undefined, message: string, code = "relation-sync") =>
    issues.push({ path, key, code, severity: "error", message });
  const byName = new Map<string, { page: RelationPage; data: Record<string, unknown> }>();
  for (const page of pages) {
    const spec = specFor(schema, page.path);
    if (!spec) continue;
    const { data, error } = readFrontmatter(page.text);
    if (!data || error) { issue(page.path, undefined, error || "frontmatter 无效，关系同步暂停"); continue; }
    if (data.type !== spec.type || (spec.class !== null && data.class !== spec.class)) {
      issue(page.path, undefined, "页面类型与目录绑定不符，关系同步暂停"); continue;
    }
    const name = pageName(page.path);
    if (byName.has(name)) issue(page.path, undefined, `页面名 ${name} 重复，关系无法消歧`);
    byName.set(name, { page, data });
  }
  // Obsidian's native rename updater can emit relative wikilinks even when the
  // original used a bare slug. Resolve the actual path before normalizing it.
  const normalizePath = (path: string): string => {
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") parts.pop(); else parts.push(part);
    }
    return parts.join("/").replace(/\.md$/, "");
  };
  const resolve = (link: string, sourcePath: string): string => {
    const target = link.split("|", 1)[0].replace(/\.md$/, "");
    if (!target.includes("/")) return canonical(target);
    const name = canonical(target.slice(target.lastIndexOf("/") + 1));
    const page = byName.get(name)?.page;
    if (!page) return name; // unresolved references are checked below
    const replaceName = (path: string) => path.slice(0, path.lastIndexOf("/") + 1) + canonical(path.slice(path.lastIndexOf("/") + 1));
    const candidates = [normalizePath(target), normalizePath(sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) + target)]
      .map(replaceName);
    const actual = page.path.replace(/\.md$/, "");
    return candidates.some((p) => p === actual) || (!target.startsWith(".") && actual.endsWith("/" + candidates[0])) ? name : link;
  };
  const lookup = (name: string): PageInfo | undefined => byName.get(canonical(name))?.data;
  const forward = new Set<string>(), reverse = new Set<string>();
  const fields = new Map<string, { path: string; key: string; spec: KeySpec; values: Set<string> }>();
  const deleted = new Set<string>();
  for (const [name, { page, data }] of byName) {
    const spec = specFor(schema, page.path)!;
    // Validate relation fields only. Other properties are handled by frontmatter validation.
    const normalized = { ...data };
    for (const [key, ks] of Object.entries(spec.keys)) {
      if (!ks.counterpart || !(key in data)) continue;
      const values = Array.isArray(data[key]) ? data[key] as unknown[] : [data[key]];
      if (values.some((v) => typeof v === "string" && schema.special_values.includes(v)) && values.length > 1) {
        issue(page.path, key, `${key} 不能把 unknown/none 与其他值混写`);
      }
      const cleaned: unknown[] = [];
      for (const value of values) {
        const match = typeof value === "string" && new RegExp(schema.formats.wikilink).exec(value);
        if (!match) { cleaned.push(value); continue; }
        const target = resolve(match[1], page.path);
        const edge: Edge = ks.inverseOf ? [ks.inverseOf, target, name] : [key, name, target];
        const id = edgeKey(edge);
        // Remove references to a deleted endpoint only if this edge was previously
        // synchronized. Newly typed unresolved links remain visible errors.
        if (!byName.has(target) && old.has(id) && !pages.some((p) => pageName(p.path) === target)) {
          deleted.add(id); continue;
        }
        cleaned.push(`[[${target}]]`);
      }
      normalized[key] = Array.isArray(data[key]) ? cleaned : cleaned[0] ?? [];
    }
    for (const finding of validate(schema, spec, normalized, undefined, lookup)) {
      if (finding.key && finding.key in normalized && (spec.keys[finding.key]?.counterpart ||
          Object.values(schema.directories).some((d) => d.keys[finding.key!]?.counterpart))) {
        issues.push({ ...finding, path: page.path });
      }
    }
    for (const [key, ks] of Object.entries(spec.keys)) {
      if (!ks.counterpart) continue;
      const value = normalized[key];
      const values = new Set<string>();
      for (const v of Array.isArray(value) ? value : [value]) {
        const match = typeof v === "string" && new RegExp(schema.formats.wikilink).exec(v);
        if (!match) continue;
        const target = match[1];
        values.add(target);
        (ks.inverseOf ? reverse : forward).add(edgeKey(ks.inverseOf ? [ks.inverseOf, target, name] : [key, name, target]));
      }
      fields.set(fieldKey(name, key), { path: page.path, key, spec: ks, values });
    }
  }

  const agreed = new Set<string>();
  for (const id of new Set([...old, ...forward, ...reverse])) {
    const [, a, b] = JSON.parse(id) as Edge;
    if (deleted.has(id) || !byName.has(a) || !byName.has(b)) continue;
    const f = forward.has(id), r = reverse.has(id);
    if (initialized ? (f === r ? f : !old.has(id)) : f) agreed.add(id);
  }
  const desired = new Map<string, Set<string>>();
  const add = (page: string, key: string, target: string) => {
    const id = fieldKey(page, key);
    const values = desired.get(id) ?? new Set<string>();
    values.add(target); desired.set(id, values);
  };
  for (const id of agreed) {
    const [key, source, target] = JSON.parse(id) as Edge;
    const counterpart = fields.get(fieldKey(source, key))?.spec.counterpart;
    if (!counterpart || !fields.has(fieldKey(target, counterpart))) {
      issue(byName.get(source)!.page.path, key, `${key} 的关系两端不符合 schema`); continue;
    }
    add(source, key, target); add(target, counterpart, source);
  }
  for (const [id, values] of desired) {
    const field = fields.get(id)!;
    if (!field.spec.multi && values.size > 1) {
      issue(field.path, field.key, `${field.key} 是单值关系；两端修改产生 ${sorted(values).join("、")}，请人工消解`, "relation-conflict");
    }
  }
  const state = { schema: signature, edges: sorted(agreed).map((s) => JSON.parse(s) as Edge) };
  if (issues.length) return { patches: [], issues, state };
  const texts = new Map([...byName].map(([name, { page }]) => [name, page.text]));
  for (const [id, field] of fields) {
    const [name] = JSON.parse(id) as [string, string];
    const wanted = desired.get(id) ?? new Set<string>();
    const data = byName.get(name)!.data;
    const original = data[field.key];
    const rawLinks = new Set((Array.isArray(original) ? original : [original]).flatMap((v) => {
      const m = typeof v === "string" && new RegExp(schema.formats.wikilink).exec(v);
      return m ? [m[1]] : [];
    }));
    if (same(rawLinks, wanted)) continue;
    const values = sorted(wanted).map((n) => `[[${n}]]`);
    const value = field.spec.multi || !values.length ? values : values[0];
    const updated = setFrontmatterKey(texts.get(name)!, field.key, value);
    if (updated === null) issue(field.path, field.key, `${field.key} 无法安全写入`);
    else texts.set(name, updated);
  }
  const patches = [...byName].flatMap(([name, { page }]) => {
    const after = texts.get(name)!;
    return after === page.text ? [] : [{ path: page.path, before: page.text, after }];
  });
  return { patches: issues.length ? [] : patches, issues, state };
}

/** I/O seam: compare inside the host's atomic per-file update, checkpoint only after
 * all writes succeed. A partial failure can safely retry against the old checkpoint. */
export async function applyRelationPlan(plan: RelationPlan, host: {
  update(path: string, transform: (text: string) => string): Promise<void>;
  checkpoint(state: RelationState): Promise<void>;
}): Promise<void> {
  if (plan.issues.length) throw new Error("关系检查未通过，未写入");
  for (const patch of plan.patches) {
    await host.update(patch.path, (text) => {
      if (text !== patch.before) throw new Error(`关系同步期间页面发生修改：${patch.path}，将重新读取`);
      return patch.after;
    });
  }
  await host.checkpoint(plan.state);
}
