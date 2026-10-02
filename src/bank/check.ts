import {
  claimedAttributes,
  readFrontmatter,
  specFor,
  validate,
  splitFrontmatter,
} from "../core";
import { Registry, Term } from "./registry";
import {
  Repo,
  Page,
  Card,
  Dict,
  object,
  truth,
  eq,
  list,
  join,
  parent,
  filename,
  stem,
  inside,
  resolveLink,
  prose,
  links,
  htmlLinks,
  yaml,
  timestamp,
  ACTOR,
  SLUG,
  NOT_PAGES,
  parsePage,
  sourceLineBudgets,
} from "./model";
import { renderIndexes, staleSchema } from "./render";
import { liftable, unscopedDirect } from "./lift";
import { sourceEntry, SourceError } from "./sources";
import { planSourceBacklinks } from "../source-backlinks";
export interface Finding {
  code: string;
  severity: "error" | "warning";
  path: string;
  line: number;
  message: string;
}
const CLAIM_KEYS = new Set([
  "id",
  "attribute",
  "value",
  "unit",
  "scope",
  "valid",
  "basis",
  "method",
  "evidence",
  "verified",
  "retracted",
  "status",
]);
const IMMUTABLE = [
  "attribute",
  "value",
  "unit",
  "scope",
  "valid",
  "basis",
  "method",
];
const subset = (o: Dict, keys: string[]) =>
  Object.keys(o).every((k) => keys.includes(k));
export class Checker {
  findings: Finding[] = [];
  number: RegExp;
  wikilink: RegExp;
  times: RegExp[];
  special: string[];
  constructor(
    public repo: Repo,
    public reg: Registry,
  ) {
    this.number = new RegExp(reg.data.formats.quantity);
    this.wikilink = new RegExp(reg.data.formats.wikilink);
    this.times = reg.data.formats.time.map((p: string) => new RegExp(p));
    this.special = reg.data.special_values;
  }
  add(
    code: string,
    path: string,
    message: string,
    line = 0,
    severity: "error" | "warning" = "error",
  ) {
    this.findings.push({ code, path, message, line, severity });
  }
  warn(code: string, path: string, message: string, line = 0) {
    this.add(code, path, message, line, "warning");
  }
  run() {
    this.checkPages();
    this.checkAttachments();
    for (const p of this.repo.allPages()) {
      const path = this.repo.layout.vault
        ? p.path.slice(this.repo.layout.vault.length + 1)
        : p.path;
      const spec = specFor(this.reg.schema, path);
      if (!spec) continue;
      const text = this.repo.store.read(p.path),
        { data, error } = readFrontmatter(text);
      for (const f of validate(
        this.reg.schema,
        spec,
        data,
        error,
        (n) => this.repo.page(n)?.fm,
        claimedAttributes(text),
      ))
        if (f.code.startsWith("fm-"))
          this.add(f.code, p.rel, f.message, 1, f.severity);
    }
    this.checkRelations();
    this.checkClaims();
    this.checkEvidence();
    this.checkSourceBacklinks();
    this.checkIndex();
    this.checkHistory();
    return this.findings;
  }
  checkPages() {
    const descriptions = new Map<any, Page[]>(),
      resources = new Map<any, Page[]>();
    for (const [name, ps] of this.repo.pages)
      if (ps.length > 1)
        for (const p of ps)
          this.add(
            "page-name-duplicate",
            p.rel,
            `page name ${name} is used by ${ps.length} files`,
          );
    for (const p of this.repo.allPages()) {
      if (!SLUG.test(p.name) || p.name.length > 60)
        this.add(
          "page-name",
          p.rel,
          "page name must be [a-z0-9] words joined by single hyphens, at most 60 characters",
        );
      if (p.fm_error) {
        this.add("frontmatter", p.rel, p.fm_error, 1);
        continue;
      }
      const fm = p.fm;
      for (const k of this.reg.data.base_required)
        if (!truth(fm[k]))
          this.add("frontmatter-required", p.rel, `missing '${k}'`, 1);
      this.checkLocation(p);
      const g = fm.generated;
      if (
        truth(g) &&
        (!object(g) || !ACTOR.test(String(g.by ?? "")) || !timestamp(g.at))
      )
        this.add(
          "generated",
          p.rel,
          "generated must be {by: <actor>, at: <ISO time with UTC offset>}",
          1,
        );
      if (
        "status" in fm &&
        !["draft", "stable", "deprecated"].includes(fm.status)
      )
        this.add(
          "page-status",
          p.rel,
          "status must be one of draft, stable, deprecated",
          1,
        );
      this.checkVerified(p.rel, fm.verified, 1, true);
      if ("aliases" in fm && !Array.isArray(fm.aliases))
        this.add("aliases", p.rel, "aliases must be a list", 1);
      if ("tags" in fm)
        this.warn(
          "tags",
          p.rel,
          "v1 uses Topic pages, not tags (navigation.md)",
          1,
        );
      if (truth(fm.description))
        descriptions.set(fm.description, [
          ...(descriptions.get(fm.description) || []),
          p,
        ]);
      if (truth(fm.resource))
        resources.set(fm.resource, [...(resources.get(fm.resource) || []), p]);
      if (new TextEncoder().encode(p.body).length > 32768)
        this.warn(
          "page-size",
          p.rel,
          "body is over 32 KB; split the page or read it by section",
        );
      this.checkBody(p);
    }
    for (const [k, table] of [
      ["description", descriptions],
      ["resource", resources],
    ] as const)
      for (const ps of table.values())
        if (ps.length > 1)
          for (const p of ps)
            this.add(
              k + "-duplicate",
              p.rel,
              `${k} is shared with ${ps
                .filter((q) => q !== p)
                .map((q) => q.name)
                .join(", ")}`,
              1,
            );
  }
  /** Besides md pages the bank holds one thing: a page's same-name .html presentation. */
  checkAttachments() {
    const { bank, evidence, store, pages } = this.repo;
    for (const [path, record] of store.files) {
      if (
        !inside(path, bank) ||
        path.endsWith(".md") ||
        path
          .slice(bank.length + 1)
          .split("/")
          .some((s) => s.startsWith("."))
      )
        continue;
      const owner = path.slice(0, -5) + ".md";
      if (!path.endsWith(".html") || !pages.get(stem(owner))?.some((p) => p.path === owner)) {
        this.add(
          "attachment",
          path,
          "only md pages and a page's same-name .html presentation belong in the bank",
        );
        continue;
      }
      for (const { target, line } of htmlLinks(record.text ?? "")) {
        const link = resolveLink(path, target);
        if (!store.exists(link))
          this.add("link-broken", path, `link target '${target}' does not exist`, line);
        else if (!(inside(link, bank) || inside(link, evidence)))
          this.add(
            "link-outside",
            path,
            `link '${target}' leaves the bank and evidence directories`,
            line,
          );
      }
    }
  }
  checkLocation(p: Page) {
    const t = p.fm.type,
      r = this.reg;
    if (!(t in r.kind_dirs)) {
      this.add(
        "type",
        p.rel,
        `type must be one of ${Object.keys(r.kind_dirs).sort().join(", ")}`,
        1,
      );
      return;
    }
    let want: string;
    if (t === "entity") {
      const c = p.fm.class;
      if (!(c in r.class_dirs)) {
        this.add(
          "class",
          p.rel,
          `entity class must be one of ${Object.keys(r.class_dirs).sort().join(", ")}`,
          1,
        );
        return;
      }
      want = join(this.repo.bank, r.kind_dirs.entity, r.class_dirs[c]);
    } else {
      if ("class" in p.fm)
        this.add("class", p.rel, "only entity pages have a class", 1);
      want = join(this.repo.bank, r.kind_dirs[t]);
    }
    if (parent(p.path) !== want)
      this.add("page-location", p.rel, `a ${t} page belongs in ${want}/`);
  }
  checkBody(p: Page) {
    let raw = p.fm.sources || [];
    const sources: Record<string, string> = {};
    if (!Array.isArray(raw)) {
      this.add("sources", p.rel, "sources must be a list", 1);
      raw = [];
    }
    for (const s of raw) {
      let entry: { id: string; target: string };
      try {
        entry = sourceEntry(this.repo, p, s, this.reg.data.formats.sources === "wikilink");
      } catch (error) {
        if (!(error instanceof SourceError)) throw error;
        this.add(error.code, p.rel, error.message, 1);
        continue;
      }
      const { id: sid, target } = entry;
      if (sid in sources)
        this.add("sources", p.rel, `source id '${sid}' appears twice`, 1);
      sources[sid] = target;
      if (!inside(target, this.repo.evidence))
        this.add(
          "source-resource",
          p.rel,
          `source '${sid}' must point into the configured evidence directory`,
          1,
        );
      else if (!this.repo.cards.has(target))
        this.add(
          "source-resource",
          p.rel,
          `source '${sid}' points at ${this.repo.store.exists(target) ? "an evidence original, not its card" : "a missing file"}`,
          1,
        );
    }
    p.sources = sources;
    const used = new Set<string>(),
      defined: Record<string, [string, number]> = {};
    for (const [i, line] of prose(p.body)) {
      const n = p.body_line + i;
      if (line.includes("[["))
        this.add(
          "wikilink",
          p.rel,
          "use relative Markdown links, not [[wikilinks]]",
          n,
        );
      const m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
      if (m) defined[m[1]] = [m[2], n];
      for (const m of line.matchAll(/\[\^([^\]]+)\](?!:)/g)) used.add(m[1]);
      for (const t of links(line)) {
        const path = resolveLink(p.path, t);
        p.prose_targets.add(path);
        if (!this.repo.store.exists(path))
          this.add(
            "link-broken",
            p.rel,
            `link target '${t}' does not exist`,
            n,
          );
        else if (
          !(inside(path, this.repo.bank) || inside(path, this.repo.evidence))
        )
          this.add(
            "link-outside",
            p.rel,
            `link '${t}' leaves the bank and evidence directories`,
            n,
          );
      }
    }
    for (const ref of [...used].sort()) {
      if (!(ref in sources))
        this.add("footnote", p.rel, `footnote [^${ref}] has no sources entry`);
      if (!(ref in defined))
        this.add(
          "footnote",
          p.rel,
          `footnote [^${ref}] has no definition line`,
        );
    }
    for (const [ref, [text, n]] of Object.entries(defined)) {
      if (!(ref in sources)) {
        this.add(
          "footnote",
          p.rel,
          `footnote definition [^${ref}] has no sources entry`,
          n,
        );
        continue;
      }
      const targets = links(text);
      if (!targets.length || resolveLink(p.path, targets[0]) !== sources[ref])
        this.add(
          "footnote",
          p.rel,
          `footnote [^${ref}] must link to the same card as its sources entry`,
          n,
        );
    }
    p.footnotes = used;
    if (["topic", "question"].includes(p.fm.type) && p.claims !== null)
      this.add(
        "claims-kind",
        p.rel,
        `${p.fm.type} pages carry no claims`,
        p.claims_line,
      );
    if (p.fm.type === "topic" && (used.size || Object.keys(sources).length))
      this.add(
        "topic",
        p.rel,
        "topic pages only link; no footnotes or sources",
      );
  }
  checkVerified(rel: string, value: any, line: number, mapping = false) {
    if (value == null) return;
    if (mapping && object(value)) value = [value];
    if (!Array.isArray(value)) {
      this.add("verified", rel, "verified must be a list of {by, at}", line);
      return;
    }
    for (const v of value)
      if (!object(v) || !ACTOR.test(String(v.by ?? "")) || !timestamp(v.at))
        this.add(
          "verified",
          rel,
          "every verified entry is {by: <actor>, at: <ISO time with UTC offset>}",
          line,
        );
  }
  allowed(spec: any[], p: Page, subject?: Page) {
    return (
      !spec.length ||
      spec.some(
        ([t, c]) =>
          t === p.fm.type &&
          (c == null ||
            (c === "SAME"
              ? !!subject && p.fm.class === subject.fm.class
              : c.includes(p.fm.class))),
      )
    );
  }
  checkRelations() {
    for (const p of this.repo.allPages()) {
      if (p.fm_error) continue;
      for (const [k, v] of Object.entries(p.fm)) {
        const t = this.reg.terms[k];
        if (!t?.counterpart || !this.allowed(t.subject, p)) continue;
        const values = list(v);
        if (
          values.length > 1 &&
          values.some((x) => typeof x === "string" && this.special.includes(x))
        )
          this.add(
            "relation-sync",
            p.rel,
            `${k}: unknown/none cannot be mixed with other values`,
            1,
          );
        for (const x of values) {
          const m = typeof x === "string" ? this.wikilink.exec(x) : null,
            q = m ? this.repo.page(m[1]) : undefined;
          if (!q || !this.allowed(t.object, q, p)) continue;
          if (!list(q.fm[t.counterpart] ?? []).includes(`[[${p.name}]]`))
            this.add(
              "relation-stale",
              p.rel,
              `${k}: ${q.name}.${t.counterpart} is missing [[${p.name}]]; run Noteweaver relation sync in Obsidian`,
              1,
            );
        }
      }
    }
  }
  checkClaims() {
    const ids = new Map<any, Page[]>();
    for (const p of this.repo.allPages()) {
      if (p.claims === null) continue;
      if (p.claims_error)
        this.add("claims-block", p.rel, p.claims_error, p.claims_line);
      const used = new Set<string>();
      for (const c of p.claims) {
        if (!object(c)) {
          this.add("claim", p.rel, "every claim is a mapping", p.claims_line);
          continue;
        }
        ids.set(c.id ?? "", [...(ids.get(c.id ?? "") || []), p]);
        this.checkClaim(p, c, used);
      }
      this.unusedSources(p, used);
    }
    for (const [id, ps] of ids)
      if (id && ps.length > 1)
        for (const p of ps)
          this.add(
            "claim-id-duplicate",
            p.rel,
            `claim id '${id}' appears ${ps.length} times in the bank`,
          );
    for (const p of this.repo.allPages())
      if (p.claims === null) this.unusedSources(p, new Set());
  }
  unusedSources(p: Page, used: Set<string>) {
    for (const s of Object.keys(p.sources).sort())
      if (!used.has(s) && !p.footnotes.has(s))
        this.warn(
          "source-unused",
          p.rel,
          `source '${s}' is cited by no footnote and no claim`,
          1,
        );
  }
  checkClaim(p: Page, c: Dict, used: Set<string>) {
    const rel = p.rel,
      line = p.claims_line,
      where = `claim ${c.id || "(no id)"}`;
    for (const k of Object.keys(c).sort())
      if (!CLAIM_KEYS.has(k))
        this.add("claim-field", rel, `${where}: unknown field '${k}'`, line);
    for (const k of ["id", "attribute", "value", "basis", "evidence"])
      if (c[k] == null || c[k] === "" || eq(c[k], []))
        this.add("claim-required", rel, `${where}: missing '${k}'`, line);
    if (c.id && !/^[a-z0-9]+(?:-+[a-z0-9]+)*$/.test(c.id))
      this.add("claim-id", rel, `${where}: id must use [a-z0-9-]`, line);
    if (c.basis && !["direct", "derived", "estimated"].includes(c.basis))
      this.add(
        "claim-basis",
        rel,
        `${where}: basis must be one of direct, derived, estimated`,
        line,
      );
    if ("status" in c) {
      if (!["superseded", "conflicting"].includes(c.status))
        this.add(
          "claim-status",
          rel,
          `${where}: status must be one of superseded, conflicting`,
          line,
        );
      else
        this.warn(
          "claim-status",
          rel,
          `${where}: status is written only by kb, which does not judge it yet`,
          line,
        );
    }
    let t: Term | undefined = this.reg.terms[c.attribute];
    if (t?.inverse_of) t = undefined;
    if (c.attribute && !t)
      this.add(
        "claim-attribute",
        rel,
        `${where}: attribute '${c.attribute}' is not in attributes.md`,
        line,
      );
    else if (t && !this.allowed(t.subject, p))
      this.add(
        "claim-subject",
        rel,
        `${where}: a ${p.fm.type} page cannot carry '${t.key}'`,
        line,
      );
    if (t && c.value != null && c.value !== "")
      this.checkValue(p, c, t, c.value, where, line);
    if (c.method != null && c.method !== "") {
      const q = this.repo.page(c.method);
      if (!q)
        this.add(
          "claim-method",
          rel,
          `${where}: method page '${c.method}' does not exist`,
          line,
        );
      else if (!["method", "analysis"].includes(q.fm.type))
        this.add(
          "claim-method",
          rel,
          `${where}: method must name a Method or Analysis page`,
          line,
        );
    }
    if (c.attribute in p.fm && unscopedDirect(this.reg, c))
      this.add(
        "fm-duplicate",
        rel,
        `${where}: '${c.attribute}' is in frontmatter and in claims; keep one place`,
        line,
      );
    else if (liftable(this.reg, c))
      this.warn(
        "claim-place",
        rel,
        `${where}: unscoped direct value; Obsidian command noteweaver:lift moves it into frontmatter`,
        line,
      );
    this.checkValid(p, c, where, line);
    this.checkScope(p, c, where, line);
    this.checkEvidenceRefs(p, c, where, line, used);
    this.checkVerified(rel, c.verified, line);
    const r = c.retracted;
    if (r != null) {
      if (
        !object(r) ||
        !r.reason ||
        !ACTOR.test(String(r.by ?? "")) ||
        !timestamp(r.at)
      )
        this.add(
          "claim-retracted",
          rel,
          `${where}: retracted needs reason, by and at`,
          line,
        );
      else if (
        r.replaced_by &&
        !this.repo
          .allPages()
          .some((q) =>
            q.claims?.some((x) => object(x) && x.id === r.replaced_by),
          )
      )
        this.add(
          "claim-retracted",
          rel,
          `${where}: replaced_by '${r.replaced_by}' is no claim id`,
          line,
        );
    }
  }
  isTime(v: any) {
    return typeof v === "string" && this.times.some((p) => p.test(v));
  }
  quantity(v: any, method: any) {
    if (typeof v === "string") return this.number.test(v);
    if (
      !object(v) ||
      !truth(v) ||
      !subset(v, ["low", "mid", "high", "p"]) ||
      !("low" in v || "high" in v)
    )
      return false;
    if (
      Object.values(v).some(
        (x) => typeof x !== "string" || !this.number.test(x),
      )
    )
      return false;
    if ("p" in v && !(Number(v.p) > 0 && Number(v.p) <= 1)) return false;
    return !method || Object.keys(v).length === 4;
  }
  checkValue(p: Page, c: Dict, t: Term, v: any, w: string, n: number) {
    const rel = p.rel,
      u = c.unit;
    if (this.special.includes(v)) {
      if (u && t.vtype !== "quantity")
        this.add("claim-unit", rel, `${w}: only quantities have a unit`, n);
      return;
    }
    if (t.vtype === "page") {
      const q = typeof v === "string" ? this.repo.page(v) : undefined;
      if (!q) {
        this.add(
          "claim-page-ref",
          rel,
          `${w}: value ${JSON.stringify(v)} names no page`,
          n,
        );
        return;
      }
      if (!this.allowed(t.object, q, p))
        this.add(
          "claim-object",
          rel,
          `${w}: '${t.key}' cannot point at a ${q.fm.type} ${q.fm.class || ""}`.trimEnd(),
          n,
        );
      if (!p.prose_targets.has(q.path))
        this.add(
          "relation-link",
          rel,
          `${w}: the body must also link to ${v}.md`,
          n,
        );
    } else if (t.vtype === "quantity") {
      if (!this.quantity(v, c.method))
        this.add(
          "claim-value",
          rel,
          `${w}: a quantity is a number such as 8.02B or {low, mid, high, p}; this estimate needs all four when kb itself made it`,
          n,
        );
      if (!u) this.add("claim-unit", rel, `${w}: quantities need a unit`, n);
      else if (!(u in this.reg.units))
        this.add("claim-unit", rel, `${w}: unit '${u}' is not in units.md`, n);
      else if (t.unit && this.reg.units[u] !== this.reg.units[t.unit])
        this.add(
          "claim-unit",
          rel,
          `${w}: unit '${u}' is not a ${this.reg.units[t.unit]} unit`,
          n,
        );
    } else if (t.vtype === "time") {
      if (
        !(
          this.isTime(v) ||
          (object(v) &&
            truth(v) &&
            subset(v, ["low", "high"]) &&
            Object.values(v).every((x) => this.isTime(x)))
        )
      )
        this.add(
          "claim-value",
          rel,
          `${w}: a time is ISO 8601 or {low, high}`,
          n,
        );
    } else if (["enum", "boolean"].includes(t.vtype) && !t.values.includes(v))
      this.add(
        "claim-value",
        rel,
        `${w}: ${JSON.stringify(v)} is not a listed value of '${t.key}'`,
        n,
      );
    if (u && t.vtype !== "quantity")
      this.add("claim-unit", rel, `${w}: only quantities have a unit`, n);
  }
  checkValid(p: Page, c: Dict, w: string, n: number) {
    const v = c.valid;
    if (v == null) {
      if (c.value === "unknown")
        this.add(
          "claim-valid",
          p.rel,
          `${w}: an unknown value needs valid.at`,
          n,
        );
      return;
    }
    const ok =
      object(v) &&
      truth(v) &&
      subset(v, ["at", "from", "until"]) &&
      !("at" in v && ("from" in v || "until" in v)) &&
      Object.values(v).every((x) => this.isTime(x));
    if (!ok)
      this.add(
        "claim-valid",
        p.rel,
        `${w}: valid is {at} or {from, until} with ISO times`,
        n,
      );
    else if (c.value === "unknown" && !("at" in v))
      this.add(
        "claim-valid",
        p.rel,
        `${w}: an unknown value needs valid.at`,
        n,
      );
  }
  checkScope(p: Page, c: Dict, w: string, n: number) {
    const s = c.scope;
    if (s == null) return;
    if (!object(s) || !truth(s)) {
      this.add(
        "claim-scope",
        p.rel,
        `${w}: scope is a mapping of scope keys`,
        n,
      );
      return;
    }
    for (const [k, v] of Object.entries(s)) {
      const t = this.reg.scope_keys[k];
      if (!t)
        this.add(
          "claim-scope",
          p.rel,
          `${w}: scope key '${k}' is not in attributes.md`,
          n,
        );
      else if (t === "page" && !this.repo.page(v))
        this.add(
          "claim-scope",
          p.rel,
          `${w}: scope ${k} names no page ${JSON.stringify(v)}`,
          n,
        );
    }
  }
  checkEvidenceRefs(p: Page, c: Dict, w: string, n: number, used: Set<string>) {
    const ev = c.evidence;
    if (ev == null || ev === "" || eq(ev, [])) return;
    if (!Array.isArray(ev)) {
      this.add("claim-evidence", p.rel, `${w}: evidence is a list`, n);
      return;
    }
    for (const e of ev) {
      if (!object(e) || !e.source || !subset(e, ["source", "at"])) {
        this.add(
          "claim-evidence",
          p.rel,
          `${w}: every evidence entry is {source, at}`,
          n,
        );
        continue;
      }
      used.add(e.source);
      const target = p.sources[e.source];
      if (!target) {
        this.add(
          "claim-evidence",
          p.rel,
          `${w}: evidence source '${e.source}' is not in sources`,
          n,
        );
        continue;
      }
      if (!("at" in e)) continue;
      const spans = String(e.at)
        .split(",")
        .map((s) => /^L(\d+)(?:-L(\d+))?$/.exec(s.trim()));
      if (spans.some((s) => !s)) {
        this.add(
          "claim-evidence",
          p.rel,
          `${w}: at is line numbers such as L212-L218,L230`,
          n,
        );
        continue;
      }
      const card = this.repo.cards.get(target);
      if (!card) continue;
      const view = this.textView(card);
      if (view === undefined) {
        this.add(
          "claim-evidence",
          p.rel,
          `${w}: '${e.source}' has no text view (URL-only evidence takes no at)`,
          n,
        );
        continue;
      }
      const count = view.split("\n").length - (view.endsWith("\n") ? 1 : 0);
      for (const m of spans) {
        const a = Number(m![1]),
          b = Number(m![2] || m![1]);
        if (a < 1 || b < a || b > count)
          this.add(
            "claim-evidence",
            p.rel,
            `${w}: ${m![0]} is outside the ${count} lines of '${e.source}'`,
            n,
          );
      }
    }
  }
  textView(c: Card) {
    return this.repo.store.files.get(c.body.trim() ? c.path : c.original)?.text;
  }
  checkEvidence() {
    const referenced = new Set(
      this.repo
        .allPages()
        .flatMap((p) => [...Object.values(p.sources), ...p.prose_targets]),
    );
    for (const p of this.repo.originals) {
      if (!this.repo.cards.has(p + ".md"))
        this.add(
          "evidence-card-missing",
          p,
          "every evidence original needs a card named <original>.md",
        );
      this.checkEvidencePlace(p);
    }
    for (const [rel, c] of this.repo.cards) {
      if (!referenced.has(c.path) && !referenced.has(c.original))
        this.warn(
          "evidence-unreferenced",
          rel,
          "no bank content page references this evidence card or its original",
          1,
        );
      this.checkEvidencePlace(rel);
      if (c.fm_error) {
        this.add("evidence-card", rel, c.fm_error, 1);
        continue;
      }
      const fm = c.fm,
        has = this.repo.store.files.has(c.original),
        kind = fm.type,
        top = rel.slice(this.repo.evidence.length + 1).split("/")[0];
      if (
        !(
          (top === "sources" && kind === "source") ||
          (top === "records" && kind === "record")
        )
      )
        this.add(
          "evidence-card",
          rel,
          `a ${kind} card does not belong under ${top}/`,
          1,
        );
      const required = ["type", "title"];
      if (kind === "source") {
        required.push("publisher", "grade");
        if (has) required.push("captured_at", "sha256");
        else if (!fm.url)
          this.add(
            "evidence-card",
            rel,
            "a card without an original needs a url",
            1,
          );
        if (
          fm.grade &&
          !["official", "independent", "media", "rumor"].includes(fm.grade)
        )
          this.add(
            "evidence-card",
            rel,
            "grade must be one of official, independent, media, rumor",
            1,
          );
        if (fm.published_at && !this.isTime(fm.published_at))
          this.add("evidence-card", rel, "published_at must be an ISO date", 1);
        if (fm.captured_at && !timestamp(fm.captured_at))
          this.add(
            "evidence-card",
            rel,
            "captured_at needs a time with UTC offset",
            1,
          );
      } else {
        required.push("observed_at", "by", "sha256");
        if (fm.observed_at && !timestamp(fm.observed_at))
          this.add(
            "evidence-card",
            rel,
            "observed_at needs a time with UTC offset",
            1,
          );
        if (fm.by && !ACTOR.test(fm.by))
          this.add(
            "evidence-card",
            rel,
            "by must be an actor such as human:<id>",
            1,
          );
        if (!has)
          this.add("evidence-card", rel, "a record card needs its original", 1);
      }
      for (const k of required)
        if (!truth(fm[k])) this.add("evidence-card", rel, `missing '${k}'`, 1);
      if (c.body.trim() && !fm.extracted_by)
        this.add(
          "evidence-card",
          rel,
          "a card with extracted text needs extracted_by",
          1,
        );
      if (
        has &&
        fm.sha256 &&
        this.repo.store.files.get(c.original)!.hash !== fm.sha256
      )
        this.add(
          "evidence-sha256",
          rel,
          "sha256 does not match the original",
          1,
        );
      if (has && !c.body.trim() && this.textView(c) === undefined)
        this.add(
          "evidence-card",
          rel,
          "the original is not plain text, so the card needs extracted text",
          1,
        );
    }
  }
  checkEvidencePlace(rel: string) {
    const parts = rel.slice(this.repo.evidence.length + 1).split("/");
    if (
      parts.length !== 3 ||
      !(
        (parts[0] === "sources" && /^[a-z0-9.-]+$/.test(parts[1])) ||
        (parts[0] === "records" && /^\d{4}-\d{2}$/.test(parts[1]))
      )
    )
      this.add(
        "evidence-place",
        rel,
        "evidence lives in sources/<host>/ or records/<YYYY-MM>/",
      );
    const n = this.repo.cards.has(rel)
      ? filename(rel).slice(0, -3)
      : filename(rel);
    if (!/^[a-z0-9._-]+$/.test(n))
      this.add(
        "evidence-name",
        rel,
        "evidence file names use only [a-z0-9._-]",
      );
  }
  checkIndex() {
    for (const [rel, text] of Object.entries(
      renderIndexes(this.repo, this.reg),
    ))
      if (this.repo.store.files.get(rel)?.text !== text)
        this.add(
          "index-stale",
          rel,
          "differs from its generated form; run Obsidian command noteweaver:index",
        );
    for (const [rel, reason] of Object.entries(
      staleSchema(this.repo, this.reg),
    ))
      this.add("vocab-stale", rel, reason);
    for (const f of [
      "index.md",
      this.reg.kind_dirs.entity + "/index.md",
      "log.md",
    ])
      if (!this.repo.store.exists(join(this.repo.bank, f)))
        this.add("index-missing", join(this.repo.bank, f), "file is missing");
    const log = join(this.repo.bank, "log.md");
    if (!this.repo.store.files.has(log)) return;
    const text = this.repo.store.read(log),
      dates = [...text.matchAll(/^## (\S+)/gm)].map((m) => m[1]);
    if (
      dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)) ||
      !eq(dates, [...dates].sort().reverse())
    )
      this.warn(
        "log-order",
        log,
        "date headings are ## YYYY-MM-DD, newest first",
      );
    for (const [i, line] of prose(text))
      for (const t of links(line)) {
        const p = resolveLink(log, t);
        if (!(inside(p, this.repo.bank) || inside(p, this.repo.evidence)))
          this.add(
            "link-outside",
            log,
            `link '${t}' leaves the bank and evidence directories; write the path in backticks`,
            i + 1,
          );
        else if (!this.repo.store.exists(p))
          this.add(
            "link-broken",
            log,
            `link target '${t}' does not exist`,
            i + 1,
          );
      }
  }
  checkSourceBacklinks() {
    const prefix = this.repo.layout.vault ? this.repo.layout.vault + "/" : "";
    const relative = (p: string) => p.slice(prefix.length);
    const plan = planSourceBacklinks(this.reg.schema,
      this.repo.allPages().map(p => ({ path: relative(p.path), text: this.repo.store.read(p.path) })),
      [...this.repo.cards.values()].map(c => ({ path: relative(c.path), text: this.repo.store.read(c.path) })),
      relative(this.repo.evidence), sourceLineBudgets(this.repo));
    for (const issue of plan.issues) this.add(issue.code, prefix + issue.path, issue.message, 1);
    for (const patch of plan.patches) this.add("source-backlinks-stale", prefix + patch.path,
      "cited_by differs from page sources; run Noteweaver source-backlinks", 1);
  }
  backlinksOnly(rel: string) {
    if (!this.reg.schema.formats.sources_inverse || !this.repo.cards.has(rel)) return false;
    const old = this.repo.history?.files.get(rel)?.text, next = this.repo.store.files.get(rel)?.text;
    if (old === undefined || next === undefined) return false;
    const a = splitFrontmatter(old), b = splitFrontmatter(next);
    if (a.fm === null || b.fm === null || a.body !== b.body || a.bodyLine !== b.bodyLine) return false;
    const x = readFrontmatter(old).data, y = readFrontmatter(next).data;
    return x !== null && y !== null && ["source", "record"].includes(String(x.type)) &&
      [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => k !== "cited_by").every(k => eq(x[k], y[k]));
  }
  regraded(rel: string) {
    const old = this.repo.history?.files.get(rel)?.text,
      next = this.repo.store.files.get(rel)?.text;
    if (!rel.endsWith(".md") || old === undefined || next === undefined)
      return false;
    try {
      const a = splitFrontmatter(old),
        b = splitFrontmatter(next);
      if (a.fm === null || b.fm === null || a.body !== b.body ||
          (this.reg.schema.formats.sources_inverse && a.bodyLine !== b.bodyLine)) return false;
      const x = yaml(a.fm) || {},
        y = yaml(b.fm) || {};
      return (
        ["source", "record"].includes(x.type) &&
        (!eq(x.grade, y.grade) || !eq(x.publisher, y.publisher)) &&
        [...new Set([...Object.keys(x), ...Object.keys(y)])]
          .filter((k) => !["grade", "publisher", ...(this.reg.schema.formats.sources_inverse ? ["cited_by"] : [])].includes(k))
          .every((k) => eq(x[k], y[k]))
      );
    } catch {
      return false;
    }
  }
  approvedDeletions(deleted: Set<string>, refs: Set<string>) {
    const h = this.repo.history!,
      allowed = new Set<string>();
    for (const pin of this.repo.layout.config.cleanup_receipts || []) {
      try {
        if (
          !object(pin) ||
          typeof pin.path !== "string" ||
          !inside(pin.path, this.repo.layout.paths.review) ||
          pin.path.split("/").includes("..")
        )
          continue;
        const record = this.repo.store.files.get(pin.path);
        if (!record || record.hash !== pin.sha256) continue;
        const r = JSON.parse(record.text!);
        if (
          r.base_commit !== h.commit ||
          h.existing.has(pin.path) ||
          typeof r.authorization !== "string" ||
          !r.authorization.trim() ||
          !Array.isArray(r.entries)
        )
          continue;
        const candidates = new Set<string>();
        let valid = true;
        for (const e of r.entries) {
          const c = e.card;
          if (
            typeof c !== "string" ||
            !c.endsWith(".md") ||
            !c.startsWith(this.repo.evidence + "/sources/") ||
            join(c) !== c ||
            c.split("/").includes("..") ||
            typeof e.reason !== "string" ||
            !e.reason.trim() ||
            refs.has(c) ||
            refs.has(c.slice(0, -3))
          ) {
            valid = false;
            break;
          }
          const expected = h.existing.has(c.slice(0, -3))
            ? [c, c.slice(0, -3)]
            : [c];
          if (
            !Array.isArray(e.files) ||
            !eq(e.files.map((f: Dict) => f.path).sort(), expected.sort()) ||
            expected.some((p) => !deleted.has(p) || candidates.has(p))
          ) {
            valid = false;
            break;
          }
          for (const f of e.files) {
            const old = h.files.get(f.path);
            if (
              !old ||
              old.hash !== f.sha256 ||
              (f.path === c &&
                yaml(splitFrontmatter(old.text!).fm!).type !== "source")
            ) {
              valid = false;
              break;
            }
          }
          if (!valid) break;
          expected.forEach((p) => candidates.add(p));
        }
        if (valid) candidates.forEach((p) => allowed.add(p));
      } catch {
        continue;
      }
    }
    return allowed;
  }
  promoted(rel: string, c: Dict) {
    if (typeof c.value !== "string") return false;
    const p = this.repo.page(stem(rel));
    if (!p || p.rel !== rel) return false;
    return list(p.fm[c.attribute]).some(
      (v) =>
        (typeof v === "string" ? (this.wikilink.exec(v)?.[1] ?? v) : v) ===
        c.value,
    );
  }
  checkHistory() {
    const h = this.repo.history;
    if (!h || h.error) {
      this.warn(
        "history-skipped",
        ".",
        `no git revision '${h?.base ?? "HEAD"}'; append-only rules not checked`,
      );
      return;
    }
    const deleted = new Set(
        h.changes.filter(([s]) => s === "D").map(([, p]) => p),
      ),
      refs = new Set(
        this.repo
          .allPages()
          .flatMap((p) => [...Object.values(p.sources), ...p.prose_targets]),
      ),
      approved = this.approvedDeletions(deleted, refs);
    let bank = false,
      log = false;
    for (const [s, p] of h.changes) {
      if (inside(p, this.repo.evidence) && s !== "A") {
        if (s === "D" && approved.has(p)) {
        } else if (s === "M" && this.backlinksOnly(p)) {
        } else if (s === "M" && this.regraded(p))
          this.warn(
            "evidence-card-regraded",
            p,
            "card grade/publisher changed after review; log it",
          );
        else
          this.add(
            "evidence-append-only",
            p,
            `evidence is never modified or deleted (git status ${s})`,
          );
      }
      if (p === join(this.repo.bank, "log.md")) log = true;
      else if (
        inside(p, this.repo.bank) &&
        p.endsWith(".md") &&
        !NOT_PAGES.has(filename(p))
      )
        bank = true;
    }
    if (
      h.untracked.some((p) => p.endsWith(".md") && !NOT_PAGES.has(filename(p)))
    )
      bank = true;
    if (bank && !log)
      this.warn(
        "log-missing",
        join(this.repo.bank, "log.md"),
        "pages changed but log.md has no new entry",
      );
    const collect = (ps: Page[]) => {
      const out = new Map<string, [string, Dict]>();
      for (const p of ps)
        for (const c of p.claims || [])
          if (object(c) && c.id) out.set(c.id, [p.rel, c]);
      return out;
    };
    const old = collect(
        [...h.files]
          .filter(
            ([p, r]) =>
              inside(p, this.repo.bank) &&
              p.endsWith(".md") &&
              !NOT_PAGES.has(filename(p)) &&
              r.text !== undefined,
          )
          .map(([p, r]) => parsePage(r.text!, p)),
      ),
      now = collect(this.repo.allPages());
    for (const [id, [rel, c]] of old) {
      const found = now.get(id);
      if (!found) {
        if (this.repo.store.exists(rel)) {
          if (!this.promoted(rel, c))
            this.add(
              "claim-deleted",
              rel,
              `claim '${id}' was deleted; claims are only retracted`,
            );
        } else
          this.warn("claim-deleted", rel, `claim '${id}' left with its page`);
        continue;
      }
      const [path, n] = found;
      for (const k of IMMUTABLE)
        if (!eq(c[k], n[k]))
          this.add(
            "claim-immutable",
            path,
            `claim '${id}': ${k} changed; write a new claim and retract this one`,
          );
      for (const k of ["evidence", "verified"]) {
        const a = c[k] || [],
          b = n[k] || [];
        if (
          Array.isArray(a) &&
          Array.isArray(b) &&
          !eq(b.slice(0, a.length), a)
        )
          this.add(
            "claim-immutable",
            path,
            `claim '${id}': ${k} may only be appended to`,
          );
      }
      if (c.retracted != null && !eq(c.retracted, n.retracted))
        this.add(
          "claim-immutable",
          path,
          `claim '${id}': retracted cannot change once written`,
        );
    }
  }
}
export function refs(repo: Repo, name: string) {
  const target = repo.page(name)?.path,
    out: Array<[string, number, string, string]> = [];
  for (const p of repo.allPages()) {
    for (const [i, line] of prose(p.body))
      for (const t of links(line)) {
        const path = resolveLink(p.path, t);
        if (path === target || (!target && stem(path) === name))
          out.push([p.rel, p.body_line + i, "link", t]);
      }
    for (const c of p.claims || []) {
      if (!object(c)) continue;
      const id = c.id || "";
      if (c.value === name)
        out.push([p.rel, p.claims_line, "claim", `${id} ${c.attribute}`]);
      if (c.method === name)
        out.push([p.rel, p.claims_line, "claim", `${id} method`]);
      if (object(c.scope))
        for (const [k, v] of Object.entries(c.scope))
          if (v === name)
            out.push([p.rel, p.claims_line, "claim", `${id} scope.${k}`]);
      if (
        object(c.retracted) &&
        c.retracted.replaced_by?.startsWith(name + "--")
      )
        out.push([
          p.rel,
          p.claims_line,
          "claim",
          `${id} retracted.replaced_by`,
        ]);
    }
    for (const [k, v] of Object.entries(p.fm))
      for (const x of list(v))
        if (
          typeof x === "string" &&
          /^\[\[([^\[\]]+)\]\]$/.exec(x)?.[1] === name
        )
          out.push([p.rel, 1, "frontmatter", k]);
    if (Array.isArray(p.fm.aliases) && p.fm.aliases.includes(name))
      out.push([p.rel, 1, "alias", name]);
  }
  return out;
}
