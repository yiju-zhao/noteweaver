import { parseDocument, isSeq } from "yaml";
import {
  splitFrontmatter,
  setFrontmatterKey,
  setFrontmatterLines,
} from "../core";
import { Registry } from "./registry";
import { Dict, Page, Repo, Patch, object, truth, claimsBlock } from "./model";
export function unscopedDirect(reg: Registry, c: Dict) {
  const t = reg.terms[c.attribute];
  return (
    !!t &&
    !t.inverse_of &&
    !reg.place_claim.includes(t.key) &&
    c.scope == null &&
    c.valid == null &&
    !truth(c.status) &&
    c.retracted == null &&
    c.basis === "direct" &&
    !truth(c.method) &&
    typeof c.value === "string"
  );
}
export const liftable = (reg: Registry, c: Dict) =>
  unscopedDirect(reg, c) && !truth(c.verified);
export function planLift(page: Page, reg: Registry) {
  const keep: any[] = [],
    groups: Record<string, Dict[]> = {},
    promote: Dict = {},
    conflicts: Array<[string, string[]]> = [];
  for (const c of page.claims || []) {
    if (object(c) && liftable(reg, c)) (groups[c.attribute] ??= []).push(c);
    else keep.push(c);
  }
  for (const [attr, cs] of Object.entries(groups)) {
    const values = [...new Set<string>(cs.map((c) => c.value))];
    if (values.length > 1 && !reg.terms[attr].multi) {
      conflicts.push([attr, values]);
      keep.push(...cs);
    } else promote[attr] = values.length > 1 ? values : values[0];
  }
  return { promote, keep, conflicts };
}
export function lift(repo: Repo, reg: Registry, now: string) {
  const stats = {
      pages: 0,
      promoted: 0,
      kept: 0,
      conflicts: [] as Array<[string, string, string[]]>,
    },
    changes: Patch[] = [];
  for (const p of repo.allPages()) {
    if (!p.claims?.length || p.claims_error || p.fm_error) continue;
    const { promote, keep, conflicts } = planLift(p, reg);
    stats.conflicts.push(
      ...conflicts.map(([a, v]): [string, string, string[]] => [p.rel, a, v]),
    );
    if (!Object.keys(promote).length) continue;
    // Reuse the plugin source editor; unrelated YAML retains its exact bytes.
    const before = repo.store.read(p.path);
    const { body } = splitFrontmatter(before);
    let updated = before;
    for (const k of Object.keys(reg.terms))
      if (k in promote) {
        const v = promote[k],
          convert = (x: string) =>
            reg.terms[k].vtype === "page" &&
            !reg.data.special_values.includes(x)
              ? `[[${x}]]`
              : x;
        const next = setFrontmatterKey(
          updated,
          k,
          Array.isArray(v) ? v.map(convert) : convert(v),
        );
        if (next === null)
          throw new Error(`cannot edit frontmatter: ${p.path}`);
        updated = next;
      }
    const generated = setFrontmatterLines(updated, "generated", [
      `generated: {by: kb/lift, at: ${now}}`,
    ]);
    if (generated === null) throw new Error(`cannot edit generated: ${p.path}`);
    const fm = splitFrontmatter(generated).fm!;
    let nextBody = body;
    const block = claimsBlock(body)!;
    const lines = body.split("\n");
    let end = block.start;
    while (end < lines.length && lines[end].trim() !== "```") end++;
    if (!keep.length) {
      const head = lines.findIndex((l) => l.trim() === "## 断言");
      const rest = lines.slice(end + 1);
      while (rest.length && !rest[0].trim()) rest.shift();
      nextBody = [...lines.slice(0, head), ...rest].join("\n").trimEnd() + "\n";
    } else {
      const claims = parseDocument(block.text, { schema: "failsafe" });
      if (!isSeq(claims.contents)) throw new Error("claims must be a sequence");
      claims.contents.items = claims.contents.items.filter((_, i) =>
        keep.includes(p.claims![i]),
      );
      lines.splice(
        block.start,
        end - block.start,
        ...String(claims).trimEnd().split("\n"),
      );
      nextBody = lines.join("\n");
    }
    changes.push({
      path: p.path,
      before,
      after:
        "---\n" +
        fm +
        "---" +
        (nextBody.startsWith("\n") ? "" : "\n") +
        nextBody,
    });
    stats.pages++;
    stats.promoted += Object.keys(promote).length;
    stats.kept += keep.length;
  }
  return { stats, changes };
}
