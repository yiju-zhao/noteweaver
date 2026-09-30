/** The instance discovery convention and path semantics, shared by every adapter. */
export const INSTANCE_DIRECTORY = ".noteweaver";
export const INSTANCE_CONFIG = `${INSTANCE_DIRECTORY}/config.json`;
const previousDirectories = [".kb", ".noteweave"];
const defaults = {
  schema: `${INSTANCE_DIRECTORY}/schema.json`,
  policies: `${INSTANCE_DIRECTORY}/policies`,
  review: `${INSTANCE_DIRECTORY}/review`,
  bank: "bank",
  evidence: "evidence",
};
export type InstancePaths = typeof defaults;
export interface InstanceConfig {
  version: 1;
  repository_root?: "." | "..";
  paths: InstancePaths;
  [key: string]: any;
}
// Probes also recognize incomplete/old instances so discovery fails at their
// owner instead of silently falling back to an ancestor or working directory.
const INSTANCE_MARKERS = [INSTANCE_DIRECTORY, INSTANCE_CONFIG, defaults.schema,
  ...previousDirectories.flatMap(p => [p, `${p}/config.json`, `${p}/schema.json`])];
export function hasInstance(exists: (path: string) => boolean): boolean {
  return INSTANCE_MARKERS.some(exists);
}
export function instanceConfigPath(exists: (path: string) => boolean): string | undefined {
  for (const previousDirectory of previousDirectories)
    if (exists(previousDirectory) || exists(`${previousDirectory}/config.json`) || exists(`${previousDirectory}/schema.json`))
      throw new Error(`Migrate ${previousDirectory} to ${INSTANCE_DIRECTORY}; keep only one instance configuration`);
  if (exists(INSTANCE_CONFIG)) return INSTANCE_CONFIG;
  if (exists(INSTANCE_DIRECTORY) || exists(defaults.schema)) throw new Error(`${INSTANCE_CONFIG} is required for the instance schema`);
  return undefined;
}
export function readInstanceConfig(text: string): InstanceConfig {
  const data = JSON.parse(text);
  if (!data || data.version !== 1 || (data.paths !== undefined && (!data.paths || typeof data.paths !== "object" || Array.isArray(data.paths))))
    throw new Error(`unsupported ${INSTANCE_CONFIG}`);
  if (data.repository_root !== undefined && ![".", ".."].includes(data.repository_root))
    throw new Error("repository_root must be . or ..");
  const paths = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = data.paths?.[key] === undefined ? fallback : data.paths[key];
    if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("\\") || value.includes(":") || value.split("/").some(x => !x || x === "." || x === ".."))
      throw new Error(`invalid instance path: ${key}; use a relative path inside the vault`);
    return [key, value];
  })) as InstancePaths;
  return { ...data, paths };
}
export function assertSingleSchema(config: InstanceConfig, exists: (path: string) => boolean, configDir = ".obsidian") {
  const legacy = `${configDir}/kb-schema.json`;
  if (config.paths.schema !== legacy && exists(legacy))
    throw new Error("Two schema files found; finish migrating the legacy schema before loading Noteweaver");
}
/** Async storage adapter for desktop/mobile; the filesystem adapter uses the same pure rules. */
export async function readVaultInstance(read: (path: string) => Promise<string>, exists: (path: string) => Promise<boolean>, configDir = ".obsidian") {
  const legacy = `${configDir}/kb-schema.json`;
  const found = new Set<string>();
  await Promise.all([...INSTANCE_MARKERS, legacy].map(async p => { if (await exists(p)) found.add(p); }));
  const configPath = instanceConfigPath(p => found.has(p));
  const config = configPath ? readInstanceConfig(await read(configPath)) : undefined;
  if (config) assertSingleSchema(config, p => found.has(p), configDir);
  return { config, paths: config?.paths ?? { ...defaults, schema: legacy } };
}
