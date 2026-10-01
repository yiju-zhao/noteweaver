/** Filesystem and Git adapter for CI. The desktop adapter reuses only Git acquisition. */
import fs from "node:fs";
import { INSTANCE_CONFIG, hasInstance, instanceConfigPath, readInstanceConfig, assertSingleSchema } from "../instance";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  Dict,
  Layout,
  FileRecord,
  MemoryStore,
  Repo,
  History,
  Patch,
  inside,
  parsePage,
  prose,
  links,
  resolveLink,
} from "./model";
import { execute, Request, Result } from "./operations";
export interface Instance {
  root: string;
  vault: string;
  layout: Layout;
}
const slash = (p: string) => p.split(path.sep).join("/");
export function realPath(p: string): string {
  if (fs.existsSync(p)) return fs.realpathSync(p);
  const parent = path.dirname(p);
  if (parent === p) return p;
  return path.join(realPath(parent), path.basename(p));
}
function existsIn(directory: string) {
  return (relative: string) => fs.existsSync(path.join(directory, relative));
}
function candidatesAt(start: string): string[] {
  if (hasInstance(existsIn(start))) return [start];
  return fs.readdirSync(start, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith(".") && hasInstance(existsIn(path.join(start, e.name))))
    .map(e => path.join(start, e.name));
}
export function loadInstance(start: string, configDir = ".obsidian"): Instance {
  start = realPath(path.resolve(start));
  const candidates = candidatesAt(start);
  if (candidates.length !== 1)
    throw new Error(`select one vault with ${INSTANCE_CONFIG} using --root`);
  const vault = realPath(candidates[0]);
  const configPath = instanceConfigPath(existsIn(vault));
  if (!configPath) throw new Error(`${INSTANCE_CONFIG} is required`);
  const config = readInstanceConfig(fs.readFileSync(path.join(vault, configPath), "utf8"));
  const root = path.resolve(vault, config.repository_root ?? ".");
  const paths: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.paths)) {
    const abs = realPath(path.join(vault, value));
    if (!abs.startsWith(vault + path.sep))
      throw new Error(`instance path leaves vault: ${key}`);
    paths[key] = slash(path.relative(root, abs));
  }
  assertSingleSchema(config, existsIn(vault), configDir);
  return { root, vault, layout: { vault: slash(path.relative(root, vault)), config, paths } };
}
export function discover(start: string) {
  for (let p = path.resolve(start); ; p = path.dirname(p)) {
    // An invalid or ambiguous instance is an error, not permission to select a
    // different ancestor. Only a directory without any candidate is skipped.
    if (candidatesAt(p).length) return loadInstance(p);
    if (path.dirname(p) === p)
      throw new Error("no knowledge bank found; pass --root <vault>");
  }
}
export function record(data: Uint8Array): FileRecord {
  let text: string | undefined;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      data,
    );
  } catch {}
  return {
    text,
    bytes: data.byteLength,
    hash: createHash("sha256").update(data).digest("hex"),
  };
}
export function git(root: string, ...args: string[]) {
  const r = spawnSync("git", ["-C", root, ...args], { maxBuffer: 256 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(r.stderr.toString().trim() || "git failed");
  return r.stdout;
}
export function history(instance: Instance, base = "HEAD"): History {
  const h: History = {
    base,
    changes: [],
    untracked: [],
    files: new Map(),
    existing: new Set(),
  };
  const { root, layout } = instance;
  try {
    h.commit = git(root, "rev-parse", "--verify", `${base}^{commit}`)
      .toString()
      .trim();
  } catch (e) {
    h.error = String(e);
    return h;
  }
  const revision = h.commit;
  const rows = git(
    root,
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    revision,
    "--",
    layout.vault || ".",
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  for (let i = 0; i < rows.length; i += 2)
    h.changes.push([rows[i], rows[i + 1]]);
  h.existing = new Set(
    git(root, "ls-tree", "-r", "--name-only", "-z", revision)
      .toString()
      .split("\0")
      .filter(Boolean),
  );
  h.untracked = git(
    root,
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    layout.paths.bank,
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const wanted = [...h.existing].filter(
    (p) =>
      (inside(p, layout.paths.bank) && p.endsWith(".md")) ||
      h.changes.some(
        ([s, q]) => s !== "A" && q === p && inside(p, layout.paths.evidence),
      ),
  );
  if (wanted.length) {
    const r = spawnSync("git", ["-C", root, "cat-file", "--batch"], {
      input: wanted.map((p) => `${revision}:${p}\n`).join(""),
      maxBuffer: 256 << 20,
    });
    if (r.error || r.status !== 0)
      throw r.error ?? new Error(r.stderr.toString());
    let at = 0;
    for (const p of wanted) {
      const end = r.stdout.indexOf(10, at);
      const header = r.stdout.subarray(at, end).toString(),
        n = Number(header.split(" ")[2]);
      if (!Number.isSafeInteger(n))
        throw new Error(`cannot read git object ${p}`);
      h.files.set(p, record(r.stdout.subarray(end + 1, end + 1 + n)));
      at = end + 2 + n;
    }
  }
  return h;
}
export function snapshot(instance: Instance, base?: string) {
  const files = new Map<string, FileRecord>(),
    paths = new Set<string>();
  const { root, vault, layout } = instance;
  function walk(abs: string) {
    if (!fs.existsSync(abs)) return;
    const real = realPath(abs);
    if (real !== vault && !real.startsWith(vault + path.sep))
      throw new Error(`snapshot path leaves vault: ${abs}`);
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink())
      throw new Error(`snapshot does not follow symlinks: ${abs}`);
    const rel = slash(path.relative(root, abs));
    paths.add(rel);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(abs)) walk(path.join(abs, f));
    } else if (stat.isFile()) files.set(rel, record(fs.readFileSync(abs)));
  }
  for (const rel of Object.values(layout.paths)) walk(path.join(root, rel));
  // Link existence is separate from loading content; outside knowledge paths are never imported.
  for (const [p, r] of files)
    if (inside(p, layout.paths.bank) && p.endsWith(".md"))
      for (const [, line] of prose(parsePage(r.text ?? "", p).body))
        for (const t of links(line)) {
          const q = resolveLink(p, t);
          if (fs.existsSync(path.resolve(root, q))) paths.add(q);
        }
  return new Repo(
    layout,
    new MemoryStore(files, paths),
    base === undefined ? undefined : history(instance, base),
  );
}
export function applyOffline(instance: Instance, changes: Patch[]) {
  const check = (p: Patch) => {
    const abs = path.resolve(instance.root, p.path),
      real = realPath(abs);
    if (real !== instance.vault && !real.startsWith(instance.vault + path.sep))
      throw new Error("write leaves vault");
    const old = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (old !== p.before)
      throw new Error(`file changed since planning: ${p.path}`);
    return abs;
  };
  for (const p of changes) check(p);
  for (const p of changes) {
    const abs = check(p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, p.after);
  }
}
export function runOffline(instance: Instance, request: Request): Result {
  const repo = snapshot(
      instance,
      ["check", "sources", "source-backlinks"].includes(request.operation) ? (request.base ?? "HEAD") : undefined,
    ),
    result = execute(repo, request);
  applyOffline(instance, result.changes);
  return result;
}
export * from "./exports";
