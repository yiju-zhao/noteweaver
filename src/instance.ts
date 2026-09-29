/** Instance paths are shared by the desktop plugin and release consumers. */
export interface InstanceConfig { version: 1; paths?: { schema?: string; evidence?: string; bank?: string }; }
export function readInstanceConfig(text: string): InstanceConfig {
  const data = JSON.parse(text);
  if (!data || data.version !== 1 || (data.paths !== undefined && (!data.paths || typeof data.paths !== "object" || Array.isArray(data.paths)))) {
    throw new Error("unsupported .kb/config.json");
  }
  schemaPath(data);
  relativePath(data.paths?.evidence ?? "evidence");
  relativePath(data.paths?.bank ?? "bank");
  return data;
}
export function schemaPath(config: InstanceConfig): string {
  const path = config.paths?.schema ?? ".kb/schema.json";
  return relativePath(path);
}
function relativePath(path: unknown): string {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes(":") || path.split("/").some(x => !x || x === "." || x === "..")) {
    throw new Error("schema path must be a relative path inside the vault");
  }
  return path;
}
export async function instanceSchemaPath(read: (path: string) => Promise<string>, exists: (path: string) => Promise<boolean>, configDir = ".obsidian"): Promise<string> {
  const legacy = `${configDir}/kb-schema.json`;
  if (!(await exists(".kb/config.json"))) {
    if (await exists(".kb/schema.json")) throw new Error(".kb/config.json is required for the instance schema");
    return legacy;
  }
  const path = schemaPath(readInstanceConfig(await read(".kb/config.json")));
  if (path !== legacy && await exists(legacy)) throw new Error("Two schema files found; finish migrating the legacy schema before loading Noteweave");
  return path;
}
