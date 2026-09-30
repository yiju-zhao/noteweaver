/** Deterministic creation plan. Adapters supply observations and apply the plan. */
import starterSchema from "../templates/basic-schema.json";
import starterPolicies from "../templates/basic-policies.json";
import { INSTANCE_CONFIG, readInstanceConfig } from "./instance";
import { Dict, MemoryStore, Repo, Patch, FileRecord } from "./bank/model";
import { loadRegistry } from "./bank/registry";
import { renderIndexes, sections } from "./bank/render";
export interface InitOptions {
  name?: string;
  vaultName?: string;
  repositoryRoot?: "." | "..";
  paths?: Record<string, string>;
  schema?: Dict;
}
export function initialFiles(options: InitOptions = {}) {
  const config = readInstanceConfig(JSON.stringify({ version: 1,
    name: options.name ?? "Knowledge bank", vault_name: options.vaultName,
    repository_root: options.repositoryRoot ?? ".", require_obsidian: true, paths: options.paths }));
  const { paths } = config;
  if (paths.schema === INSTANCE_CONFIG) throw new Error("schema cannot replace the instance descriptor");
  const contentRoots = [paths.bank, paths.evidence, paths.policies, paths.review];
  for (const [i, a] of contentRoots.entries())
    for (const b of contentRoots.slice(i + 1))
      if (a === b || a.startsWith(b + "/") || b.startsWith(a + "/"))
        throw new Error(`overlapping instance paths: ${a}, ${b}`);
  const schema: Dict = JSON.parse(JSON.stringify(options.schema ?? starterSchema));
  if (!options.schema && paths.bank !== "bank") schema.directories = Object.fromEntries(
    Object.entries(schema.directories).map(([key, value]) => [paths.bank + key.slice(4), value]));
  const reg = loadRegistry(JSON.stringify(schema), paths.bank);
  const files: Record<string, string> = {
    [INSTANCE_CONFIG]: JSON.stringify(config, null, 2) + "\n",
    [paths.schema]: JSON.stringify(schema, null, 2) + "\n",
    [paths.bank + "/index.md"]: "---\nokf_version: '0.2'\n---\n# Knowledge bank\n\n" +
      Object.entries(reg.kind_dirs).map(([kind, dir]) => `* [${schema.kinds[kind].label}](${dir}/index.md)`).join("\n") + "\n",
    [paths.bank + "/log.md"]: "# Log\n",
  };
  for (const [name, text] of Object.entries(starterPolicies)) files[paths.policies + "/" + name] = text;
  for (const [file, blocks] of Object.entries(sections(reg, paths.policies)))
    files[file] = (files[file] ?? "---\ntype: guide\ntitle: Vocabulary\n---\n# Vocabulary\n") + "\n" +
      Object.entries(blocks).map(([key, body]) => `<!-- kb:${key}:start -->\n${body}<!-- kb:${key}:end -->\n`).join("\n");
  if (reg.kind_dirs.entity) files[`${paths.bank}/${reg.kind_dirs.entity}/index.md`] = "# Entities\n\n" +
    Object.entries(reg.class_dirs).map(([name, dir]) => `* [${name}](${dir}/index.md)`).join("\n") + "\n";
  const records = new Map<string, FileRecord>(Object.entries(files).map(([p, text]) => [p, { text, bytes: new TextEncoder().encode(text).length, hash: "" }]));
  const repo = new Repo({ vault: "", config, paths }, new MemoryStore(records));
  Object.assign(files, renderIndexes(repo, reg));
  const directories = new Set([paths.evidence + "/sources", paths.evidence + "/records", paths.review]);
  for (const target of [...Object.keys(files), ...directories]) {
    const parts = target.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
  }
  for (const directory of directories)
    if (directory in files) throw new Error(`file conflicts with directory: ${directory}`);
  return { config, files, directories: [...directories].sort() };
}
export function planInitialization(options: InitOptions, observed: Map<string, string | null>, occupied: Set<string> = new Set(), blockedDirectories: Set<string> = new Set()) {
  const initial = initialFiles(options), conflicts: string[] = [], changes: Patch[] = [];
  for (const old of [".kb", ".noteweave", ".obsidian/kb-schema.json"])
    if (occupied.has(old)) conflicts.push(`migrate existing ${old} before initialization`);
  for (const directory of initial.directories)
    if (blockedDirectories.has(directory)) conflicts.push(`file blocks directory: ${directory}`);
  const existing = observed.get(INSTANCE_CONFIG);
  if (existing != null) {
    readInstanceConfig(existing); // malformed config is an error, never an overwrite.
    if (JSON.stringify(readInstanceConfig(existing)) !== JSON.stringify(initial.config))
      conflicts.push("instance already initialized with different settings; use its configuration instead of reinitializing");
  }
  for (const [path, after] of Object.entries(initial.files)) {
    const before = observed.get(path) ?? null;
    if (before === after) continue;
    if (before !== null || occupied.has(path)) conflicts.push(`existing file differs: ${path}`);
    else changes.push({ path, before: null, after });
  }
  return { apiVersion: 1 as const, code: conflicts.length ? 1 : 0,
    data: { conflicts, directories: initial.directories, files: changes.map(p => p.path) },
    changes: conflicts.length ? [] : changes };
}
