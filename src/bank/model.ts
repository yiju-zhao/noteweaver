/** Knowledge rules operate on a repository snapshot. Adapters own all I/O. */
import { readYaml, splitFrontmatter } from "../core";
export type Dict = Record<string, any>;
export const object = (v: any): v is Dict =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const truth = (v: any): boolean =>
  !!v &&
  (!Array.isArray(v) || v.length > 0) &&
  (!object(v) || Object.keys(v).length > 0);
export const eq = (a: any, b: any): boolean => {
  if (a == null && b == null) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => eq(v, b[i]));
  if (object(a) && object(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((k) => k in b && eq(a[k], b[k]))
    );
  return a === b;
};
export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const list = (v: any) => (Array.isArray(v) ? v : [v]);
export const norm = (p: string) => {
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (!s || s === ".") continue;
    if (s === ".." && out.length && out.at(-1) !== "..") out.pop();
    else if (s !== ".." || out.length || !p.startsWith("/")) out.push(s);
  }
  return (p.startsWith("/") ? "/" : "") + out.join("/");
};
export const join = (...p: string[]) => norm(p.join("/"));
export const parent = (p: string) => p.slice(0, p.lastIndexOf("/"));
export const filename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const stem = (p: string) => filename(p).replace(/\.md$/, "");
export const inside = (p: string, d: string) =>
  p === d || p.startsWith(d + "/");
export const resolveLink = (p: string, t: string) =>
  t.startsWith("/") ? norm(t) : join(parent(p), t);
export const NOT_PAGES = new Set(["index.md", "log.md"]);
export const ACTOR =
  /^(?:(?:human|process):[A-Za-z0-9][A-Za-z0-9._-]*|[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._+~-]*)$/;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const timestamp = (s: any) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s);
export function yaml(text: string): any {
  const { data, error } = readYaml(text);
  if (error) throw new Error(error);
  return data;
}
export function* prose(body: string): Generator<[number, string]> {
  let fence = "";
  for (const [i, line] of body.split("\n").entries()) {
    const m = /^(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = "";
      continue;
    }
    if (m) {
      fence = m[1];
      continue;
    }
    yield [i, line.replace(/`[^`]*`/g, (s) => " ".repeat(s.length))];
  }
}
export function links(line: string) {
  return [
    ...line.matchAll(
      /!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    ),
  ]
    .map((m) => m[1])
    .filter((t) => !/^([a-zA-Z][a-zA-Z0-9+.-]*:|#)/.test(t))
    .map((t) => t.split("#")[0]);
}
/** Relative file references (`href`, `src`) in the static tags of an HTML document, with 1-based lines.
 * Comments, script/style text and quoted attribute values such as `srcdoc` are not scanned. */
export function htmlLinks(html: string): Array<{ target: string; line: number }> {
  const out: Array<{ target: string; line: number }> = [],
    tags = /<!--[\s\S]*?(?:-->|$)|<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let line = 1,
    seen = 0;
  for (let tag; (tag = tags.exec(html)); ) {
    if (!tag[1]) continue;
    line += html.slice(seen, tag.index).split("\n").length - 1;
    seen = tag.index;
    for (const attr of tag[2].matchAll(
      /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
    )) {
      if (!["href", "src"].includes(attr[1].toLowerCase())) continue;
      const value = (attr[2] ?? attr[3] ?? attr[4] ?? "").trim(),
        path = value.split(/[?#]/)[0];
      if (!path || value.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value))
        continue;
      try {
        out.push({ target: decodeURIComponent(path), line });
      } catch {
        out.push({ target: path, line });
      }
    }
    const name = tag[1].toLowerCase();
    if (["script", "style", "textarea", "title"].includes(name)) {
      const end = new RegExp(`</${name}\\b`, "gi");
      end.lastIndex = tags.lastIndex;
      tags.lastIndex = end.exec(html)?.index ?? html.length;
    }
  }
  return out;
}
export function claimsBlock(
  body: string,
): { text: string; start: number; error: string } | undefined {
  const lines = body.split("\n"),
    heads = [...prose(body)]
      .filter(([, l]) => l.trimEnd() === "## 断言")
      .map(([i]) => i);
  if (!heads.length) return;
  if (heads.length > 1)
    return {
      text: "",
      start: heads[1],
      error: 'more than one "## 断言" heading',
    };
  let i = heads[0] + 1;
  while (i < lines.length && !lines[i].trim()) i++;
  if (lines[i]?.trim() !== "```yaml")
    return {
      text: "",
      start: heads[0],
      error: '"## 断言" must be followed by a ```yaml block',
    };
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== "```") j++;
  return {
    text: lines.slice(i + 1, j).join("\n"),
    start: i + 1,
    error: j === lines.length ? "claims block is not closed" : "",
  };
}
export interface FileRecord {
  text?: string;
  hash: string;
  bytes: number;
}
export interface Store {
  files: Map<string, FileRecord>;
  exists(path: string): boolean;
  read(path: string): string;
}
export class MemoryStore implements Store {
  constructor(
    public files: Map<string, FileRecord>,
    public paths = new Set(files.keys()),
  ) {}
  exists(path: string) {
    return this.paths.has(path) || [...this.paths].some((p) => inside(p, path));
  }
  read(path: string) {
    const r = this.files.get(path);
    if (r?.text === undefined) throw new Error(`cannot read text: ${path}`);
    return r.text;
  }
}
export interface Layout {
  vault: string;
  config: Dict;
  paths: Record<string, string>;
}
export interface History {
  base: string;
  commit?: string;
  error?: string;
  changes: Array<[string, string]>;
  untracked: string[];
  files: Map<string, FileRecord>;
  existing: Set<string>;
}
export interface Page {
  path: string;
  rel: string;
  name: string;
  fm: Dict;
  body: string;
  body_line: number;
  fm_error: string;
  claims: any[] | null;
  claims_line: number;
  claims_error: string;
  sources: Record<string, string>;
  footnotes: Set<string>;
  prose_targets: Set<string>;
}
export interface Card {
  path: string;
  rel: string;
  fm: Dict;
  body: string;
  fm_error: string;
  original: string;
}
export function parsePage(text: string, path: string): Page {
  const { fm, body, bodyLine } = splitFrontmatter(text);
  const p: Page = {
    path,
    rel: path,
    name: stem(path),
    fm: {},
    body,
    body_line: bodyLine + 1,
    fm_error: "",
    claims: null,
    claims_line: 0,
    claims_error: "",
    sources: {},
    footnotes: new Set(),
    prose_targets: new Set(),
  };
  if (fm === null) p.fm_error = "missing frontmatter";
  else
    try {
      const data = yaml(fm);
      if (object(data)) p.fm = data;
      else p.fm_error = "frontmatter is not a mapping";
    } catch (e) {
      p.fm_error = `frontmatter does not parse: ${(e as Error).message}`;
    }
  const c = claimsBlock(body);
  if (c) {
    p.claims_line = p.body_line + c.start;
    p.claims = [];
    p.claims_error = c.error;
    if (!c.error)
      try {
        const data = yaml(c.text);
        if (Array.isArray(data)) p.claims = data;
        else if (data !== null && data !== "")
          p.claims_error = "claims block must be a YAML list";
      } catch (e) {
        p.claims_error = `claims block does not parse: ${(e as Error).message}`;
      }
  }
  return p;
}
export class Repo {
  pages = new Map<string, Page[]>();
  cards = new Map<string, Card>();
  originals: string[] = [];
  constructor(
    public layout: Layout,
    public store: Store,
    public history?: History,
  ) {
    for (const path of [...store.files.keys()].sort(compare)) {
      if (
        inside(path, this.bank) &&
        path.endsWith(".md") &&
        !NOT_PAGES.has(filename(path))
      ) {
        const p = parsePage(store.read(path), path);
        this.pages.set(p.name, [...(this.pages.get(p.name) || []), p]);
      }
      if (!inside(path, this.evidence) || filename(path) === ".gitkeep")
        continue;
      if (path.endsWith(".md")) {
        const { fm, body } = splitFrontmatter(store.read(path));
        let data: Dict = {},
          error = "";
        if (fm !== null)
          try {
            const v = yaml(fm);
            if (object(v)) data = v;
          } catch (e) {
            error = `frontmatter does not parse: ${(e as Error).message}`;
          }
        if (["source", "record"].includes(data.type) || error) {
          this.cards.set(path, {
            path,
            rel: path,
            fm: data,
            body,
            fm_error: error,
            original: path.slice(0, -3),
          });
          continue;
        }
      }
      this.originals.push(path);
    }
  }
  get bank() {
    return this.layout.paths.bank;
  }
  get evidence() {
    return this.layout.paths.evidence;
  }
  allPages() {
    return [...this.pages.values()].flat();
  }
  page(name: any) {
    const ps = this.pages.get(name);
    return ps?.length === 1 ? ps[0] : undefined;
  }
}
/** A changed card is compared against Git's evidence layout, including after a
 * native rename reserializes YAML. Unchanged/new cards use their current layout. */
export function sourceLineBudgets(repo: Repo): Map<string, number> {
  const prefix = repo.layout.vault ? repo.layout.vault + "/" : "";
  return new Map([...repo.cards.values()].map(c => [c.path.slice(prefix.length),
    splitFrontmatter(repo.history?.files.get(c.path)?.text ?? repo.store.read(c.path)).bodyLine]));
}

export interface Patch {
  path: string;
  before: string | null;
  after: string;
}
export function patches(
  store: Store,
  rendered: Record<string, string>,
): Patch[] {
  return Object.entries(rendered)
    .filter(([p, t]) => store.files.get(p)?.text !== t)
    .map(([path, after]) => ({
      path,
      before: store.files.get(path)?.text ?? null,
      after,
    }));
}
