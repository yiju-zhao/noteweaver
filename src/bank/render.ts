import { Registry, jevValues } from "./registry";
import { Dict, Repo, join, parent, compare } from "./model";
function table(headers: any[], rows: any[][]) {
  const row = (cells: any[]) =>
    "| " +
    cells
      .map((c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, "<br>"))
      .join(" | ") +
    " |\n";
  return (
    row(headers) +
    "|" +
    "---|".repeat(headers.length) +
    "\n" +
    rows.map(row).join("")
  );
}
const ticks = (v: string[]) => v.map((x) => "`" + x + "`").join(" ");
function classes(data: Dict, spec: Dict[]) {
  return spec
    .map((s) => {
      let l = data.kinds[s.type].label;
      if (s.class === "SAME") l = "同一 class 的 " + l;
      else if (s.class?.length) l += "（" + s.class.join("、") + "）";
      return l;
    })
    .join("；");
}
function value(data: Dict, e: Dict) {
  let l: string = (
    {
      quantity: "数量",
      time: "时间",
      enum: "受控枚举",
      boolean: "布尔",
      page: "Page 引用",
      text: "文本",
    } as Dict
  )[e.value];
  if (e.value === "quantity") l += `，\`${e.unit}\``;
  else if (e.value === "enum")
    l += Array.isArray(e.enum)
      ? "：" + e.enum.map((v: string) => "`" + v + "`").join("、")
      : "，见下表";
  else if (e.value === "page" && e.object?.length)
    l += "（" + classes(data, e.object) + "）";
  return l;
}
export function renderJev(data: Dict, vocabulary: string) {
  const c = data.jev[vocabulary],
    values = jevValues(data, vocabulary),
    quote = JSON.stringify;
  const lines = [
    "```yaml",
    `vocabulary: ${vocabulary}`,
    `primitive: ${c.primitive}`,
    "question:",
    ...Object.entries(c.question).map(([k, v]) => `  ${k}: ${quote(v)}`),
    `escape_value: ${c.escape_value}`,
    "values:",
  ];
  for (const k of c.order) {
    const v = values[k];
    lines.push(
      `  ${k}:`,
      `    what: ${quote(v.what)}`,
      `    not_for: ${quote(v.not_for)}`,
    );
    for (const f of ["examples", "counter_examples"])
      if (f in v)
        lines.push(
          `    ${f}:` + (v[f].length ? "" : " []"),
          ...v[f].map((x: string) => "      - " + quote(x)),
        );
  }
  return [...lines, "```", ""].join("\n");
}
export function sections(reg: Registry, prefix: string) {
  const data = reg.data,
    a: Record<string, string> = {};
  for (const g of ["predicates", "attributes"]) {
    const pred = g === "predicates",
      headers = [
        pred ? "谓词" : "属性",
        "中文",
        "主语",
        ...(pred
          ? ["宾语", "值数", "反向字段", "反向值数"]
          : ["值类型", "值数"]),
        "陈述模板",
        "含义",
        "不用于",
      ];
    a[g] = table(
      headers,
      Object.entries<Dict>(data[g]).map(([k, e]) => {
        const multi =
          (e.multi ? "多值" : "单值") +
          (e.multi_note ? "；" + e.multi_note : "");
        return [
          "`" + k + "`",
          e.label,
          classes(data, e.subject),
          ...(pred
            ? [
                classes(data, e.object),
                multi,
                `\`${e.inverse_key}\`（${e.inverse}）`,
                e.inverse_multi ? "多值" : "单值",
              ]
            : [value(data, e), multi]),
          e.statement,
          e.meaning,
          e.not_for,
        ];
      }),
    );
    a["jev-" + g.slice(0, -1)] = renderJev(data, g.slice(0, -1));
  }
  a.enums = Object.entries<Dict>(data.enums)
    .map(
      ([k, v]) =>
        "`" +
        k +
        "`\n\n" +
        table(
          ["取值", "含义"],
          Object.entries(v).map(([v, m]) => ["`" + v + "`", m]),
        ),
    )
    .join("\n");
  a["scope-keys"] = table(
    ["键", "中文", "值类型", "说明"],
    Object.entries<Dict>(data.scope_keys).map(([k, e]) => [
      "`" + k + "`",
      e.label,
      value(data, e),
      e.meaning,
    ]),
  );
  a["claim-only"] = table(
    ["只写断言的属性", "原因"],
    ["predicates", "attributes"].flatMap((g) =>
      Object.entries<Dict>(data[g])
        .filter(([, e]) => e.place === "claim")
        .map(([k, e]) => ["`" + k + "`", e.place_reason]),
    ),
  );
  a.required = table(
    ["类型", "必填"],
    Object.values<Dict>(data.directories)
      .filter((e) => e.required.length)
      .map((e) => [
        classes(data, [
          { type: e.type, ...(e.class ? { class: [e.class] } : {}) },
        ]),
        ticks(e.required),
      ]),
  );
  const kinds = {
    kinds: table(
      ["Kind", "目录", "归这里", "不归这里（该去哪）", "例子"],
      Object.entries<Dict>(data.kinds).map(([k, e]) => [
        e.label,
        "`" + e.directory + "/" + (k === "entity" ? "<子类>/" : "") + "`",
        e.meaning,
        e.not_for,
        e.examples,
      ]),
    ),
    classes: table(
      ["`class`", "目录", "范围"],
      Object.values<Dict>(data.directories)
        .filter((e) => e.class)
        .map((e) => [e.class, "`" + reg.class_dirs[e.class] + "/`", e.meaning]),
    ),
    "jev-kind": renderJev(data, "kind"),
    "jev-entity-class": renderJev(data, "entity-class"),
  };
  return {
    [prefix + "/attributes.md"]: a,
    [prefix + "/kinds.md"]: kinds,
    [prefix + "/units.md"]: {
      units: table(
        ["代码", "量纲", "相对基准的倍数", "说明"],
        Object.entries<Dict>(data.units).map(([k, e]) => [
          "`" + k + "`",
          e.dimension,
          e.factor,
          e.meaning,
        ]),
      ),
    },
  };
}
export function replaceSections(
  text: string,
  blocks: Record<string, string>,
  rel: string,
) {
  for (const [k, content] of Object.entries(blocks)) {
    const start = `<!-- kb:${k}:start -->`,
      end = `<!-- kb:${k}:end -->`;
    if (
      text.split(start).length !== 2 ||
      text.split(end).length !== 2 ||
      text.indexOf(start) > text.indexOf(end)
    )
      throw new Error(
        `${rel}: missing or duplicate ${k} markers; restore the markers from git`,
      );
    text =
      text.slice(0, text.indexOf(start)) +
      start +
      "\n" +
      content +
      text.slice(text.indexOf(end));
  }
  const expected = Object.keys(blocks).flatMap((k) =>
    ["start", "end"].map((e) => `<!-- kb:${k}:${e} -->`),
  );
  const actual = [...text.matchAll(/<!-- kb:[^\n]*? -->/g)].map((m) => m[0]);
  if (
    actual.some((x) => !expected.includes(x)) ||
    expected.some((x) => !actual.includes(x))
  )
    throw new Error(`${rel}: unknown generated-section markers`);
  return text;
}
export function renderSchema(repo: Repo, reg: Registry) {
  return Object.fromEntries(
    Object.entries(sections(reg, repo.layout.paths.policies)).map(
      ([p, blocks]) => [p, replaceSections(repo.store.read(p), blocks, p)],
    ),
  );
}
export function staleSchema(repo: Repo, reg: Registry) {
  const out: Record<string, string> = {};
  for (const [p, blocks] of Object.entries(
    sections(reg, repo.layout.paths.policies),
  )) {
    try {
      const text = repo.store.read(p);
      if (text !== replaceSections(text, blocks, p))
        out[p] = "differs from schema.json; run Obsidian command noteweaver:schema";
    } catch (e) {
      out[p] = (e as Error).message;
    }
  }
  return out;
}
export function renderIndexes(repo: Repo, reg: Registry) {
  const headings: Record<string, string> = {};
  for (const base of ["", reg.kind_dirs.entity + "/"]) {
    const p = join(repo.bank, base, "index.md");
    if (repo.store.files.has(p))
      for (const m of repo.store
        .read(p)
        .matchAll(/^\* \[([^\]]+)\]\(([a-z-]+)\/index\.md\)/gm))
        headings[base + m[2]] = m[1];
  }
  const dirs = [
      ...Object.entries(reg.kind_dirs)
        .filter(([t]) => t !== "entity")
        .map(([, d]) => d),
      ...Object.values(reg.class_dirs).map(
        (d) => reg.kind_dirs.entity + "/" + d,
      ),
    ].sort(compare),
    out: Record<string, string> = {};
  for (const d of dirs) {
    const ps = repo
      .allPages()
      .filter((p) => parent(p.path) === join(repo.bank, d))
      .sort((a, b) => compare(a.name, b.name));
    const line = (p: (typeof ps)[number]) =>
      `* [${p.fm.title ?? p.name}](${p.name}.md) - ${p.fm.description ?? ""}`;
    const live = ps.filter((p) => p.fm.status !== "deprecated").map(line),
      dead = ps.filter((p) => p.fm.status === "deprecated").map(line);
    out[join(repo.bank, d, "index.md")] =
      `# ${headings[d] ?? d}\n` +
      (live.length ? "\n" + live.join("\n") + "\n" : "") +
      (dead.length ? "\n# 已弃用\n\n" + dead.join("\n") + "\n" : "");
  }
  return out;
}
