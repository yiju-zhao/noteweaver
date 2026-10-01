/** Read-only observations for agents planning a vault's adoption. No inferred facts. */
import { INSTANCE_CONFIG, readInstanceConfig } from "./instance";
import { initialFiles, InitOptions, LEGACY_INIT_PATHS, planInitialization } from "./initialize";
import { compare, filename, inside, NOT_PAGES, parent, parsePage, SLUG, stem, truth } from "./bank/model";
import { loadRegistry } from "./bank/registry";
import type { Result } from "./bank/operations";

export function planOnboarding(
  options: InitOptions,
  observed: Map<string, string | null>,
  markdown: Map<string, string>,
  occupied: Set<string> = new Set(markdown.keys()),
  blockedDirectories: Set<string> = new Set(),
): Result {
  const descriptor = observed.get(INSTANCE_CONFIG);
  const initial = descriptor != null ? undefined : initialFiles(options);
  const config = descriptor != null ? readInstanceConfig(descriptor) : initial!.config;
  const schemaText = initial ? initial.files[config.paths.schema] : observed.get(config.paths.schema);
  if (schemaText == null) throw new Error(`missing instance schema: ${config.paths.schema}`);
  const reg = loadRegistry(schemaText, config.paths.bank);
  const initialization = initial
    ? planInitialization(options, observed, occupied, blockedDirectories)
    : null;
  const legacy = LEGACY_INIT_PATHS.filter(p => occupied.has(p));
  const conflicts = initialization?.data.conflicts ?? legacy.map(p => `migrate existing ${p} before onboarding`);
  const notes = [...markdown].sort(([a], [b]) => compare(a, b)).map(([path, text]) => {
    const page = parsePage(text, path);
    const role = inside(path, config.paths.evidence) ? "evidence"
      : inside(path, config.paths.policies) ? "policy"
      : inside(path, config.paths.review) ? "review"
      : inside(path, config.paths.bank) ? (NOT_PAGES.has(filename(path)) ? "navigation" : "knowledge")
      : "unmanaged";
    // Bindings apply to an exact directory, never recursively to its children.
    const binding = role === "knowledge" ? reg.schema.directories[parent(path)] ?? null : null;
    const candidate = role === "knowledge" || role === "unmanaged";
    const missingProperties: string[] = candidate ? [
      ...reg.schema.base_required.filter(key => !truth(page.fm[key])),
      ...(binding?.required ?? []).filter(key => !(key in page.fm)),
    ] : [];
    return {
      path, role,
      title: typeof page.fm.title === "string" ? page.fm.title : null,
      declaredType: typeof page.fm.type === "string" ? page.fm.type : null,
      declaredClass: typeof page.fm.class === "string" ? page.fm.class : null,
      binding: binding ? { type: binding.type, class: binding.class, required: binding.required } : null,
      missingProperties: [...new Set(missingProperties)],
      frontmatterError: page.fm_error || null,
      claimsError: page.claims_error || null,
      needsSlug: candidate && (!SLUG.test(stem(path)) || stem(path).length > 60),
    };
  });
  const names = new Map<string, string[]>();
  for (const note of notes.filter(n => n.role === "knowledge" || n.role === "unmanaged")) {
    const name = stem(note.path);
    names.set(name, [...names.get(name) ?? [], note.path]);
  }
  const otherFiles = [...occupied].filter(p => !p.endsWith(".md")
    && !p.split("/").some(part => part.startsWith("."))
    && !LEGACY_INIT_PATHS.includes(p)
    && p !== config.paths.schema).sort(compare);
  const directories = new Map<string, { path: string; notes: number; otherFiles: number }>();
  for (const [paths, key] of [[notes.map(n => n.path), "notes"], [otherFiles, "otherFiles"]] as const)
    for (const path of paths) {
      const directory = path.includes("/") ? parent(path) : "";
      const entry = directories.get(directory) ?? { path: directory, notes: 0, otherFiles: 0 };
      entry[key]++;
      directories.set(directory, entry);
    }
  return {
    apiVersion: 1, code: conflicts.length ? 1 : 0, changes: [],
    data: {
      state: legacy.length ? "legacy" : descriptor != null ? "initialized"
        : markdown.size || otherFiles.length ? "existing" : "blank",
      config, conflicts,
      initialization: initialization ? { code: initialization.code, ...initialization.data } : null,
      inventory: {
        totalNotes: notes.length,
        knowledgeNotes: notes.filter(n => n.role === "knowledge").length,
        unmanagedNotes: notes.filter(n => n.role === "unmanaged").length,
        notes, otherFiles,
        directories: [...directories.values()].sort((a, b) => compare(a.path, b.path)),
        duplicateNames: [...names].filter(([, paths]) => paths.length > 1).map(([name, paths]) => ({ name, paths })),
      },
    },
  };
}
