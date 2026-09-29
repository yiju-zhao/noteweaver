import { parseDocument } from "yaml";
import { readSchema, KbSchema } from "../core";
import { Dict, object, eq } from "./model";
export interface Term {
  key: string;
  predicate: boolean;
  vtype: string;
  multi: boolean;
  subject: any[];
  object: any[];
  unit: string;
  values: string[];
  label: string;
  inverse_of: string;
  counterpart: string;
}
export interface Registry {
  data: Dict;
  schema: KbSchema;
  kind_dirs: Record<string, string>;
  class_dirs: Record<string, string>;
  terms: Record<string, Term>;
  scope_keys: Record<string, string>;
  units: Record<string, string>;
  place_claim: string[];
  fm_required: Record<string, string[]>;
}
function fields(value: any, shape: Record<string, string>, where: string) {
  if (!object(value)) throw new Error(`${where}: expected an object`);
  for (const [k, t] of Object.entries(shape)) {
    if (
      t === "array"
        ? !Array.isArray(value[k])
        : t === "object"
          ? !object(value[k])
          : typeof value[k] !== t
    )
      throw new Error(`${where}.${k}: missing or invalid ${t}`);
  }
}
function strings(v: any, where: string) {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error(`${where}: expected a list of strings`);
  if (new Set(v).size !== v.length)
    throw new Error(`${where}: duplicate values`);
}
export function jevValues(data: Dict, vocabulary: string): Dict {
  const values = Object.fromEntries(
    vocabulary === "entity-class"
      ? Object.values<Dict>(data.directories)
          .filter((e) => e.class)
          .map((e) => [e.class, e.jev])
      : Object.entries<Dict>(
          data[vocabulary === "kind" ? "kinds" : vocabulary + "s"],
        ).map(([k, v]) => [k, v.jev]),
  );
  const extra = data.jev[vocabulary].extra_values;
  if (Object.keys(extra).some((k) => k in values))
    throw new Error(
      `jev.${vocabulary}: extra_values duplicates a vocabulary entry`,
    );
  return { ...values, ...extra };
}
export function loadRegistry(text: string, bank = "bank"): Registry {
  const data: Dict = JSON.parse(text);
  if (parseDocument(text, { schema: "json", uniqueKeys: true }).errors.length)
    throw new Error("duplicate JSON key or malformed schema");
  fields(
    data,
    Object.fromEntries(
      [
        "kinds",
        "directories",
        "predicates",
        "attributes",
        "scope_keys",
        "units",
        "enums",
        "jev",
        "formats",
      ].map((k) => [k, "object"]),
    ),
    "schema",
  );
  if (data.version !== 3)
    throw new Error(`unsupported version ${data.version}; expected 3`);
  for (const k of ["base_required", "special_values"]) strings(data[k], k);
  fields(
    data.formats,
    { quantity: "string", wikilink: "string", time: "array" },
    "formats",
  );
  strings(data.formats.time, "formats.time");
  for (const p of [
    data.formats.quantity,
    data.formats.wikilink,
    ...data.formats.time,
  ])
    new RegExp(p);
  const kind_dirs: Record<string, string> = {},
    class_dirs: Record<string, string> = {},
    fm_required: Record<string, string[]> = {},
    terms: Record<string, Term> = {},
    units: Record<string, string> = {},
    scope_keys: Record<string, string> = {},
    place_claim: string[] = [];
  for (const [k, e] of Object.entries<Dict>(data.kinds)) {
    fields(
      e,
      Object.fromEntries(
        ["directory", "label", "meaning", "not_for", "examples"].map((k) => [
          k,
          "string",
        ]),
      ),
      `kinds.${k}`,
    );
    if (!/^[a-z-]+$/.test(e.directory))
      throw new Error(`kinds.${k}: invalid directory`);
    kind_dirs[k] = e.directory;
  }
  if (
    !kind_dirs.entity ||
    new Set(Object.values(kind_dirs)).size !== Object.keys(kind_dirs).length
  )
    throw new Error("kinds: missing entity or duplicate directories");
  for (const [p, e] of Object.entries<Dict>(data.directories)) {
    fields(
      e,
      { type: "string", icon: "string", required: "array" },
      `directories.${p}`,
    );
    const t = e.type,
      c = e.class,
      prefix = `${bank}/${kind_dirs[t]}`;
    if (
      !(t in kind_dirs) ||
      (t === "entity") !== (typeof c === "string") ||
      (t !== "entity" && c !== null)
    )
      throw new Error(`directories.${p}: invalid type/class binding`);
    if (c) {
      fields(e, { meaning: "string", jev: "object" }, `directories.${p}`);
      if (
        !p.startsWith(prefix + "/") ||
        !/^[a-z-]+$/.test(p.slice(prefix.length + 1))
      )
        throw new Error(`directories.${p}: invalid entity directory`);
      class_dirs[c] = p.slice(prefix.length + 1);
    } else if (p !== prefix)
      throw new Error(`directories.${p}: differs from kinds.${t}.directory`);
    const key = JSON.stringify([t, c]);
    if (key in fm_required)
      throw new Error(`directories.${p}: duplicate type/class binding`);
    strings(e.required, `directories.${p}.required`);
    fm_required[key] = e.required;
  }
  if (
    !Object.keys(class_dirs).length ||
    Object.keys(kind_dirs).some(
      (t) => t !== "entity" && !(JSON.stringify([t, null]) in fm_required),
    )
  )
    throw new Error("directories: missing Kind or Entity class binding");
  function spec(items: any, where: string, same = false) {
    if (!Array.isArray(items)) throw new Error(`${where}: expected a list`);
    return items.map((e) => {
      fields(e, { type: "string" }, where);
      if (!(e.type in kind_dirs)) throw new Error(`${where}: unknown type`);
      const c = e.class ?? null;
      if (c !== null && !(c === "SAME" && same && e.type === "entity")) {
        strings(c, where + ".class");
        if (
          e.type !== "entity" ||
          !c.length ||
          c.some((v: string) => !(v in class_dirs))
        )
          throw new Error(`${where}: unknown entity class`);
      }
      return [e.type, c];
    });
  }
  for (const [k, e] of Object.entries<Dict>(data.units)) {
    fields(
      e,
      { dimension: "string", factor: "string", meaning: "string" },
      `units.${k}`,
    );
    units[k] = e.dimension;
  }
  for (const [k, v] of Object.entries<Dict>(data.enums))
    if (
      !object(v) ||
      !Object.keys(v).length ||
      Object.values(v).some((x) => typeof x !== "string")
    )
      throw new Error(`enums.${k}: expected values with meanings`);
  for (const g of ["predicates", "attributes"])
    for (const [k, e] of Object.entries<Dict>(data[g])) {
      const where = `${g}.${k}`;
      fields(
        e,
        {
          ...Object.fromEntries(
            [
              "label",
              "meaning",
              "not_for",
              "statement",
              "value",
              "unit",
              "place",
            ].map((k) => [k, "string"]),
          ),
          multi: "boolean",
          subject: "array",
          object: "array",
          jev: "object",
        },
        where,
      );
      if (k in terms) throw new Error(`${where}: duplicate term`);
      if (!["quantity", "time", "enum", "boolean", "page"].includes(e.value))
        throw new Error(`${where}: unknown value type`);
      if (g === "predicates") {
        fields(
          e,
          {
            inverse: "string",
            inverse_key: "string",
            inverse_multi: "boolean",
          },
          where,
        );
        if (e.value !== "page" || e.place !== "frontmatter")
          throw new Error(
            `${where}: paired predicates must have page values in frontmatter`,
          );
      }
      if (!["frontmatter", "claim"].includes(e.place))
        throw new Error(`${where}: unknown place`);
      if (e.place === "claim") {
        fields(e, { place_reason: "string" }, where);
        place_claim.push(k);
      }
      if (e.value === "quantity" && !(e.unit in units))
        throw new Error(`${where}: unknown unit`);
      if (e.value === "enum" && !(e.enum in data.enums))
        throw new Error(`${where}: unknown enum`);
      terms[k] = {
        key: k,
        predicate: g === "predicates",
        vtype: e.value,
        multi: e.multi,
        subject: spec(e.subject, where + ".subject"),
        object: spec(e.object, where + ".object", true),
        unit: e.unit,
        values:
          e.value === "enum"
            ? Object.keys(data.enums[e.enum])
            : e.value === "boolean"
              ? ["true", "false"]
              : [],
        label: e.label,
        inverse_of: "",
        counterpart: "",
      };
    }
  const reserved = new Set([
    ...Object.keys(terms),
    ...data.base_required,
    "sources",
    "class",
    "tags",
    "aliases",
    "status",
    "verified",
  ]);
  for (const [k, e] of Object.entries<Dict>(data.predicates)) {
    const inverse = e.inverse_key;
    if (!/^[a-z][a-z0-9_]*$/.test(inverse) || reserved.has(inverse))
      throw new Error(`predicates.${k}: invalid or duplicate inverse_key`);
    reserved.add(inverse);
    const t = terms[k];
    t.counterpart = inverse;
    const same = t.object.some(([, c]) => c === "SAME");
    terms[inverse] = {
      ...t,
      key: inverse,
      multi: e.inverse_multi,
      subject: t.object.map(([t, c]) => [t, c === "SAME" ? null : c]),
      object: t.subject.map(([t, c]) => [t, same ? "SAME" : c]),
      unit: "",
      values: [],
      label: e.inverse,
      inverse_of: k,
      counterpart: k,
    };
  }
  for (const [b, keys] of Object.entries(fm_required)) {
    const [t, c] = JSON.parse(b);
    for (const k of keys)
      if (
        !terms[k] ||
        terms[k].inverse_of ||
        (terms[k].subject.length &&
          !terms[k].subject.some(
            ([tt, cs]) => tt === t && (cs === null || cs.includes(c)),
          ))
      )
        throw new Error(`directories.${b}.required: unavailable key ${k}`);
  }
  for (const [k, e] of Object.entries<Dict>(data.scope_keys)) {
    fields(
      e,
      { label: "string", value: "string", meaning: "string" },
      `scope_keys.${k}`,
    );
    if (
      !["quantity", "time", "enum", "boolean", "page", "text"].includes(e.value)
    )
      throw new Error(`scope_keys.${k}: unknown value type`);
    if (e.value === "quantity" && !(e.unit in units))
      throw new Error(`scope_keys.${k}: unknown unit`);
    if (e.value === "enum") strings(e.enum, `scope_keys.${k}.enum`);
    if (e.value === "page") spec(e.object, `scope_keys.${k}.object`);
    scope_keys[k] = e.value;
  }
  for (const v of ["predicate", "attribute", "kind", "entity-class"]) {
    const c = data.jev[v];
    fields(
      c,
      {
        primitive: "string",
        question: "object",
        escape_value: "string",
        order: "array",
        extra_values: "object",
      },
      `jev.${v}`,
    );
    fields(
      c.question,
      { en: "string", focus_en: "string" },
      `jev.${v}.question`,
    );
    strings(c.order, `jev.${v}.order`);
    const values = jevValues(data, v);
    if (!eq(Object.keys(values).sort(), [...c.order].sort()))
      throw new Error(`jev.${v}.order: differs from vocabulary entries`);
    for (const [k, e] of Object.entries(values)) {
      fields(
        e,
        { what: "string", not_for: "string", examples: "array" },
        `jev.${v}.${k}`,
      );
      strings(e.examples, `jev.${v}.${k}.examples`);
      if ("counter_examples" in e)
        strings(e.counter_examples, `jev.${v}.${k}.counter_examples`);
    }
  }
  return {
    data,
    schema: readSchema(text),
    kind_dirs,
    class_dirs,
    terms,
    scope_keys,
    units,
    place_claim,
    fm_required,
  };
}
