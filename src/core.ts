// Pure logic of the kb-types plugin: no Obsidian imports, so node can test it.
// Vocabulary comes from the v3 source of truth, kb-schema.json;
// this module applies the vocabulary without an Obsidian dependency.
import { isMap, isScalar, parse, parseDocument } from "yaml";

export interface Target { type: string; class?: string[] }
export interface KeySpec {
  label: string;
  place: "frontmatter" | "claim";
  value?: "page" | "quantity" | "time" | "enum" | "boolean";
  multi?: boolean;
  unit?: string;
  enum?: string[];
  targets?: Target[];
  counterpart?: string;
  inverseOf?: string;
}
export interface DirSpec {
  type: string;
  class: string | null;
  icon: string;
  required: string[];
  template: Record<string, unknown>;
  keys: Record<string, KeySpec>;
}
export interface KbSchema {
  version: number;
  base_required: string[];
  special_values: string[];
  formats: { quantity: string; time: string[]; wikilink: string; sources?: "wikilink" };
  vocabulary: Record<string, string>;
  directories: Record<string, DirSpec>;
}

interface TermDefinition extends Omit<KeySpec, "enum" | "targets"> {
  subject: Array<{ type: string; class?: string[] }>;
  object: Array<{ type: string; class?: string[] | "SAME" }>;
  enum?: string;
  inverse?: string;
  inverse_key?: string;
  inverse_multi?: boolean;
}
interface VocabularySchema extends Omit<KbSchema, "vocabulary" | "directories"> {
  predicates: Record<string, TermDefinition>;
  attributes: Record<string, TermDefinition>;
  enums: Record<string, Record<string, string>>;
  directories: Record<string, Omit<DirSpec, "keys" | "template">>;
}

/** Resolve the single term definitions into the plugin's in-memory directory views. */
export function readSchema(text: string): KbSchema {
  const raw: VocabularySchema = JSON.parse(text);
  if (parseDocument(text, { schema: "json", uniqueKeys: true }).errors.length) throw new Error("词表 JSON 含重复键或解析错误");
  if (raw?.version !== 3) throw new Error(`不认识的版本 ${raw?.version}，请更新插件`);
  if (raw.formats?.sources !== undefined && raw.formats.sources !== "wikilink")
    throw new Error("formats.sources must be wikilink when specified");
  for (const key of ["kinds", "directories", "predicates", "attributes", "scope_keys", "units", "enums", "jev", "formats"]) {
    const value = (raw as unknown as Record<string, unknown>)[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`缺少词表节 ${key}`);
  }
  for (const values of [raw.base_required, raw.special_values, raw.formats.time]) {
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) throw new Error("无效的词表列表");
  }
  const terms = { ...raw.predicates, ...raw.attributes };
  if (Object.keys(raw.predicates).some((key) => key in raw.attributes)) throw new Error("谓词与属性键重复");
  const reserved = new Set([...Object.keys(terms), ...raw.base_required, "sources", "class", "tags", "aliases", "status", "verified"]);
  const types = new Set(Object.values(raw.directories).map((d) => d.type));
  const classes = new Set(Object.values(raw.directories).filter((d) => d.type === "entity").map((d) => d.class));
  for (const [key, term] of Object.entries(raw.predicates)) {
    const inverse = term.inverse_key;
    if (term.value !== "page" || term.place !== "frontmatter" || !inverse ||
        !/^[a-z][a-z0-9_]*$/.test(inverse) || reserved.has(inverse) || typeof term.inverse !== "string" ||
        typeof term.multi !== "boolean" || typeof term.inverse_multi !== "boolean") {
      throw new Error(`谓词 ${key} 的反向字段定义无效或重复`);
    }
    for (const [where, targets] of [["subject", term.subject], ["object", term.object]] as const) {
      if (!Array.isArray(targets) || targets.some((s) => !s || !types.has(s.type) ||
          (s.class !== undefined && (s.type !== "entity" || (s.class === "SAME"
            ? where !== "object" || term.subject.some((p) => p.type !== "entity")
            : !Array.isArray(s.class) || !s.class.length || s.class.some((c) => !classes.has(c))))))) {
        throw new Error(`谓词 ${key}.${where} 的类别定义无效`);
      }
    }
    reserved.add(inverse);
    terms[inverse] = { ...term, label: term.inverse!, multi: term.inverse_multi,
      subject: term.object.map((s) => ({ type: s.type, ...(s.class && s.class !== "SAME" ? { class: s.class } : {}) })),
      object: term.subject.map((s) => ({ ...s, ...(term.object.some((o) => o.class === "SAME") ? { class: "SAME" as const } : {}) })),
      inverseOf: key, counterpart: key };
    terms[key] = { ...term, counterpart: inverse };
  }
  const vocabulary = Object.fromEntries(Object.entries(terms).map(([key, term]) => [key, term.label]));
  const directories: Record<string, DirSpec> = {};
  for (const [path, spec] of Object.entries(raw.directories)) {
    const template: Record<string, unknown> = { type: spec.type };
    if (spec.class) template.class = spec.class;
    for (const key of raw.base_required) {
      if (!(key in template)) template[key] = key === "generated" ? null : "";
    }
    for (const key of spec.required) template[key] = "";
    template.sources = [];
    const keys: Record<string, KeySpec> = {};
    for (const [key, term] of Object.entries(terms)) {
      if (term.subject.length && !term.subject.some((s) => s.type === spec.type &&
          (!s.class || (spec.class !== null && s.class.includes(spec.class))))) continue;
      if (term.place === "claim") {
        keys[key] = { label: term.label, place: "claim" };
        continue;
      }
      const value: KeySpec = { label: term.label, place: term.place, value: term.value, multi: term.multi };
      if (term.counterpart) value.counterpart = term.counterpart;
      if (term.inverseOf) value.inverseOf = term.inverseOf;
      if (term.value === "quantity") value.unit = term.unit;
      if (term.value === "enum") value.enum = Object.keys(raw.enums[term.enum!]);
      if (term.value === "boolean") value.enum = ["true", "false"];
      if (term.value === "page") value.targets = term.object.map((s) => ({
        type: s.type, ...(s.class ? { class: s.class === "SAME" ? [spec.class!] : s.class } : {}),
      }));
      keys[key] = value;
    }
    directories[path] = { ...spec, template, keys };
  }
  return { version: raw.version, base_required: raw.base_required, special_values: raw.special_values,
           formats: raw.formats, vocabulary, directories };
}
export interface PageInfo { type?: unknown; class?: unknown }
export type PageLookup = (name: string) => PageInfo | undefined;
export interface Finding { code: string; severity: "error" | "warning"; key?: string; message: string }

const NOT_PAGES = new Set(["index.md", "log.md"]);

/** The bound directory of a vault-relative page path, or undefined for index/log files and unbound places. */
export function specFor(schema: KbSchema, path: string): DirSpec | undefined {
  const slash = path.lastIndexOf("/");
  if (slash < 0 || !path.endsWith(".md") || NOT_PAGES.has(path.slice(slash + 1))) return undefined;
  return schema.directories[path.slice(0, slash)];
}

export function pageName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

// ------------------------------------------------------------------ frontmatter text

/** Same split as kb's text.split_frontmatter: frontmatter text (or null), body, 0-based line where the body starts. */
export function splitFrontmatter(text: string): { fm: string | null; body: string; bodyLine: number } {
  if (!text.startsWith("---\n")) return { fm: null, body: text, bodyLine: 0 };
  let end = text.indexOf("\n---\n", 3);
  if (end === -1) {
    if (!text.endsWith("\n---")) return { fm: null, body: text, bodyLine: 0 };
    end = text.length - 4;
  }
  const fm = text.slice(4, end + 1);
  return { fm, body: text.slice(end + 5), bodyLine: fm.split("\n").length + 1 };
}

/** Read failsafe YAML: every scalar a string, duplicate keys rejected. */
export function readYaml(text: string): { data: unknown; error?: string } {
  try {
    return { data: parse(text, { schema: "failsafe" }) };
  } catch (e) {
    return { data: null, error: String((e as Error).message).split("\n")[0] };
  }
}

export function readFrontmatter(text: string): { data: Record<string, unknown> | null; error?: string } {
  const { fm } = splitFrontmatter(text);
  if (fm === null) return { data: null, error: "缺少 frontmatter" };
  const { data, error } = readYaml(fm);
  if (error) return { data: null, error: `frontmatter 解析失败：${error}` };
  if (data === null || data === "") return { data: {} };
  if (typeof data !== "object" || Array.isArray(data)) return { data: null, error: "frontmatter 不是映射" };
  return { data: data as Record<string, unknown> };
}

// ------------------------------------------------------------------ validation

function allowed(targets: Target[] | undefined, page: PageInfo): boolean {
  if (!targets || targets.length === 0) return true;
  return targets.some((t) => t.type === page.type && (!t.class || t.class.includes(String(page.class))));
}

function describeTargets(targets: Target[] = []): string {
  return targets.map((t) => (t.class ? `${t.type}（${t.class.join("、")}）` : t.type)).join("；");
}

/** Frontmatter checks for one page with stable finding codes. */
export function validate(schema: KbSchema, spec: DirSpec, data: Record<string, unknown> | null,
                         error: string | undefined, lookup: PageLookup,
                         claimed: Set<string> = new Set()): Finding[] {
  if (error || !data) return [{ code: "frontmatter", severity: "error", message: error ?? "缺少 frontmatter" }];
  const out: Finding[] = [];
  const err = (code: string, key: string | undefined, message: string) =>
    out.push({ code, severity: "error", key, message });
  for (const key of schema.base_required) {
    if (!data[key]) err("frontmatter-required", key, `缺少 ${key}`);
  }
  if (data.type !== spec.type || (spec.class !== null && data.class !== spec.class)) {
    const want = spec.class ? `type: ${spec.type}、class: ${spec.class}` : `type: ${spec.type}`;
    err("page-location", "type", `这个目录只放 ${want} 的页面`);
  }
  for (const key of spec.required) {
    if (!(key in data) && !claimed.has(key)) {
      out.push({ code: "fm-required", severity: "error", key,
                 message: `缺少必填键 ${key}（${spec.keys[key]?.label ?? key}）；未披露写 unknown，不适用写 none` });
    }
  }
  const quantity = new RegExp(schema.formats.quantity);
  const times = schema.formats.time.map((p) => new RegExp(p));
  const wikilink = new RegExp(schema.formats.wikilink);
  for (const [key, value] of Object.entries(data)) {
    if (!(key in schema.vocabulary)) continue;
    const ks = spec.keys[key];
    if (!ks) {
      err("fm-subject", key, `${key}（${schema.vocabulary[key]}）不能写在 ${spec.class ?? spec.type} 页上`);
      continue;
    }
    if (ks.place === "claim") {
      err("fm-place", key, `${key} 总带适用范围，只能写进 ## 断言`);
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.some((v) => typeof v !== "string")) {
      err("fm-value", key, `${key} 的值只能是字符串${ks.multi ? "或字符串列表" : ""}`);
      continue;
    }
    if (values.length > 1 && !ks.multi) {
      err("fm-value", key, `${key} 是单值键；多个来源的值不同，交给人定`);
      continue;
    }
    for (const v of values as string[]) {
      if (schema.special_values.includes(v)) continue;
      if (v === "") {
        err("fm-value", key, `${key} 为空；填值，未披露写 unknown，不适用写 none`);
        continue;
      }
      if (ks.value === "page") {
        const m = wikilink.exec(v);
        if (!m) {
          err("fm-value", key, `${key} 的值写成 wikilink，如 "[[page-name]]"`);
          continue;
        }
        const target = lookup(m[1]);
        if (!target) err("fm-page-ref", key, `${key}：没有叫 ${m[1]} 的页面`);
        else if (!allowed(ks.targets, target)) {
          err("fm-object", key, `${key} 只能指向 ${describeTargets(ks.targets)}，${m[1]} 是 ${target.type}${target.class ? `（${target.class}）` : ""}`);
        }
      } else if (ks.value === "quantity") {
        if (!quantity.test(v)) err("fm-value", key, `${key} 是数量（单位 ${ks.unit}），写成 8.02B 这样的数；区间写断言`);
      } else if (ks.value === "time") {
        if (!times.some((t) => t.test(v))) err("fm-value", key, `${key} 是时间，写成 2025、2025-02 或 2025-02-14`);
      } else if (ks.enum && !ks.enum.includes(v)) {
        err("fm-value", key, `${key} 只能取 ${ks.enum.join("、")}（或 unknown、none），不能取 ${v}`);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ writing frontmatter

function scalar(v: string): string {
  if (v === "") return "";
  if (/^[A-Za-z0-9\u4e00-\u9fff_./+-][^:#{}[\],&*!|>'"%@`]*$/.test(v) && v.trim() === v && !/^[-?:]\s/.test(v)) return v;
  return JSON.stringify(v);
}

function keyLines(key: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.length === 0 ? [`${key}: []`] : [`${key}:`, ...value.map((v) => `  - ${scalar(String(v))}`)];
  }
  const s = scalar(String(value ?? ""));
  return [s === "" ? `${key}:` : `${key}: ${s}`];
}

/**
 * Template frontmatter for a new page in a bound directory, or null when the file
 * already has content. A file counts as new when it is empty, or when it only has the
 * type/class/title keys a Bases "new" button pre-fills; those values are kept.
 */
export function applyTemplate(text: string, spec: DirSpec, generated: { by: string; at: string }): string | null {
  let kept: Record<string, unknown> = {};
  if (text.trim() !== "") {
    const { fm, body } = splitFrontmatter(text);
    if (fm === null || body.trim() !== "") return null;
    const { data, error } = readFrontmatter(text);
    if (error || !data || Object.keys(data).some((k) => !["type", "class", "title"].includes(k))) return null;
    kept = data;
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(spec.template)) {
    if (key === "generated") {
      lines.push(`generated: {by: ${generated.by ? scalar(generated.by) : '""'}, at: ${generated.at}}`);
    } else {
      lines.push(...keyLines(key, key in kept ? kept[key] : value));
    }
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Set one top-level frontmatter key by editing its lines only, so the rest of the
 * frontmatter keeps its formatting (Obsidian's own property writer would re-serialize
 * all of it). A missing key goes before `sources`, where kb lift puts vocabulary keys.
 */
export function setFrontmatterKey(text: string, key: string, value: string | string[]): string | null {
  return setFrontmatterLines(text, key, keyLines(key, value));
}

/** Replace one YAML node while preserving every unrelated source byte. */
export function setFrontmatterLines(text: string, key: string, lines: string[]): string | null {
  const { fm } = splitFrontmatter(text);
  if (fm === null) return null;
  const doc = parseDocument(fm, { schema: "failsafe", uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) return null;
  const pair = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === key);
  const source = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === "sources");
  const lineStart = (offset: number) => fm.lastIndexOf("\n", offset - 1) + 1;
  let start = source?.key?.range ? lineStart(source.key.range[0]) : fm.length;
  let end = start;
  if (pair) {
    if (!pair.key?.range || !pair.value?.range) return null;
    start = lineStart(pair.key.range[0]);
    end = pair.value.range[2];
    if (end && fm[end - 1] !== "\n") {
      const next = fm.indexOf("\n", end);
      end = next < 0 ? fm.length : next + 1;
    }
  }
  const indent = /^ */.exec(fm.slice(start))![0];
  const fresh = lines.map((line) => indent + line).join("\n") + "\n";
  const updated = fm.slice(0, start) + fresh + fm.slice(end);
  // Preserve the rest of the original file, including its closing fence/newline.
  const result = text.slice(0, 4) + updated + text.slice(4 + fm.length);
  return readFrontmatter(result).error ? null : result;
}

/** The value to write after choosing `chosen` for a key: multi-valued keys collect values, special values replace. */
export function nextValue(schema: KbSchema, ks: KeySpec, current: unknown, chosen: string): string | string[] {
  if (!ks.multi || schema.special_values.includes(chosen)) return chosen;
  const cur = (Array.isArray(current) ? current : [current])
    .filter((v): v is string => typeof v === "string" && v !== "" && !schema.special_values.includes(v));
  const next = cur.includes(chosen) ? cur : [...cur, chosen];
  return next.length === 1 ? next[0] : next;
}

/** Values to offer for one key: enum values, or wikilinks to pages of the allowed classes; null for free text. */
export function valueChoices(schema: KbSchema, spec: DirSpec, key: string,
                             pages: Array<{ name: string; info: PageInfo }>): string[] | null {
  const ks = spec.keys[key];
  if (!ks || ks.place !== "frontmatter") return null;
  if (ks.enum) return [...ks.enum, ...schema.special_values];
  if (ks.value === "page") {
    const names = pages.filter((p) => allowed(ks.targets, p.info)).map((p) => `[[${p.name}]]`).sort();
    return [...names, ...schema.special_values];
  }
  return null;
}

// ------------------------------------------------------------------ the ## 断言 block

const FENCE = /^(`{3,}|~{3,})/;

/** Same rule as kb's text.claims_block, on the whole file: the first ```yaml fence under "## 断言". */
export function claimsBlock(text: string): { fenceLine: number; yaml: string; error?: string } | null {
  const { bodyLine } = splitFrontmatter(text);
  const lines = text.split("\n");
  const heads: number[] = [];
  let fence: string | null = null;
  for (let i = bodyLine; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      continue;
    }
    if (lines[i].trimEnd() === "## 断言") heads.push(i);
  }
  if (heads.length === 0) return null;
  if (heads.length > 1) return { fenceLine: heads[1], yaml: "", error: "有不止一个 ## 断言 标题" };
  let i = heads[0] + 1;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || lines[i].trim() !== "```yaml") {
    return { fenceLine: heads[0], yaml: "", error: "## 断言 下面要紧跟一个 ```yaml 块" };
  }
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== "```") j++;
  if (j >= lines.length) return { fenceLine: i, yaml: "", error: "断言块没有闭合" };
  return { fenceLine: i, yaml: lines.slice(i + 1, j).join("\n") };
}

/** Attributes of the claims that are not retracted: kb counts them as written required keys. */
export function claimedAttributes(text: string): Set<string> {
  const out = new Set<string>();
  const block = claimsBlock(text);
  if (!block || block.error) return out;
  const { data } = readYaml(block.yaml);
  if (Array.isArray(data)) {
    for (const c of data) if (isObj(c) && c.retracted == null && c.attribute) out.add(String(c.attribute));
  }
  return out;
}

export interface ClaimRow {
  id: string; attribute: string; label: string; value: string; scope: string; valid: string;
  basis: string; evidence: string; verified: string; state: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function mapText(v: unknown): string {
  if (!isObj(v)) return v === undefined ? "" : String(v);
  return Object.entries(v).map(([k, x]) => `${k}=${isObj(x) ? mapText(x) : String(x)}`).join("，");
}

function valueText(v: unknown, unit: unknown): string {
  let s: string;
  if (isObj(v)) {
    const { low, mid, high, p } = v as Record<string, string | undefined>;
    s = `${low ?? "…"} – ${high ?? "…"}`;
    if (mid !== undefined) s += `，中值 ${mid}`;
    if (p !== undefined) s += `，p=${p}`;
  } else {
    s = String(v ?? "");
  }
  return unit ? `${s} ${String(unit)}` : s;
}

function validText(v: unknown): string {
  if (!isObj(v)) return "";
  if (v.at !== undefined) return `截至 ${String(v.at)}`;
  return `${String(v.from ?? "")} – ${String(v.until ?? "")}`;
}

function listText(v: unknown, fmt: (x: Obj) => string): string {
  return Array.isArray(v) ? v.filter(isObj).map(fmt).join("；") : "";
}

/** Rows for the reading-view table; values stay the literal strings of the block. */
export function claimRows(schema: KbSchema | null, yamlText: string): { rows: ClaimRow[]; error?: string } {
  const { data, error } = readYaml(yamlText);
  if (error) return { rows: [], error: `断言块解析失败：${error}` };
  if (data === null || data === "") return { rows: [] };
  if (!Array.isArray(data)) return { rows: [], error: "断言块必须是 YAML 列表" };
  const rows = data.filter(isObj).map((c): ClaimRow => {
    const attribute = String(c.attribute ?? "");
    const r = c.retracted;
    let state = c.status ? String(c.status) : "";
    if (isObj(r)) state = `已撤回：${String(r.reason ?? "")}${r.replaced_by ? `（由 ${String(r.replaced_by)} 取代）` : ""}`;
    return {
      id: String(c.id ?? ""),
      attribute,
      label: schema?.vocabulary[attribute] ?? "",
      value: valueText(c.value, c.unit),
      scope: mapText(c.scope),
      valid: validText(c.valid),
      basis: String(c.basis ?? "") + (c.method ? `（${String(c.method)}）` : ""),
      evidence: listText(c.evidence, (e) => `${String(e.source ?? "")} ${String(e.at ?? "")}`.trim()),
      verified: listText(c.verified, (e) => String(e.by ?? "")),
      state,
    };
  });
  return { rows };
}

// ------------------------------------------------------------------ file-tree icons

/** CSS that puts each bound directory's icon before its pages and folder in the file explorer. */
export function iconCss(schema: KbSchema, svgFor: (icon: string) => string | null): string {
  const rules: string[] = [];
  const entries = Object.entries(schema.directories);
  // Entity classes bind pages; their grouping folders still need a folder-only icon.
  const parents = new Set(entries.filter(([, spec]) => spec.type === "entity" && spec.class)
    .map(([dir]) => dir.substring(0, dir.lastIndexOf("/")))
    .filter((dir) => dir && !(dir in schema.directories)));
  const icons = [
    ...[...parents].map((dir) => ({ dir, icon: "boxes", pages: false })),
    ...entries.map(([dir, spec]) => ({ dir, icon: spec.icon, pages: true })),
  ];
  for (const { dir, icon, pages } of icons) {
    const svg = svgFor(icon);
    if (!svg) continue;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    const d = dir.replace(/"/g, '\\"');
    rules.push(
      (pages ? `.nav-file-title[data-path^="${d}/"]:not([data-path$="/index.md"]):not([data-path$="/log.md"]) .nav-file-title-content::before,\n` : "") +
      `.nav-folder-title[data-path="${d}"] .nav-folder-title-content::before {\n` +
      `  content: ""; display: inline-block; width: 14px; height: 14px; margin-inline-end: 4px; vertical-align: -2px;\n` +
      `  background-color: currentColor; opacity: 0.7; -webkit-mask: ${url} center / contain no-repeat; mask: ${url} center / contain no-repeat;\n}`);
  }
  return rules.join("\n");
}
