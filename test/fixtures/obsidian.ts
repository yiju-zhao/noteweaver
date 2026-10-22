/** In-memory desktop surface. All mutations are recorded for read-only regressions. */
export class FileSystemAdapter {
  files: Map<string, string>;
  folders = new Set<string>();
  writes: string[] = [];
  constructor(entries: Iterable<[string, string]> = []) { this.files = new Map(entries); }
  getBasePath() { return "/synthetic/fixture"; }
  async stat(path: string) {
    if (this.files.has(path)) return { type: "file" };
    if (this.folders.has(path) || [...this.files.keys()].some(p => p.startsWith(path + "/"))) return { type: "folder" };
    return null;
  }
  async exists(path: string) { return !!await this.stat(path); }
  async read(path: string) {
    if (!this.files.has(path)) throw new Error(`missing file: ${path}`);
    return this.files.get(path)!;
  }
  async write(path: string, text: string) { this.writes.push(path); this.files.set(path, text); }
  async mkdir(path: string) { this.writes.push(path); this.folders.add(path); }
}
export class TFile {
  constructor(public path: string) {}
  get extension() { return this.path.split(".").at(-1); }
  get basename() { return this.path.split("/").at(-1)!.replace(/\.[^.]+$/, ""); }
}
export function memoryApp(entries: Iterable<[string, string]> = []) {
  const adapter = new FileSystemAdapter(entries);
  const getFiles = () => [...adapter.files.keys()].filter(p => !p.split("/").some(part => part.startsWith("."))).map(p => new TFile(p));
  return {
    vault: {
      adapter, configDir: ".obsidian",
      getName: () => "fixture",
      getFiles,
      getMarkdownFiles: () => getFiles().filter(f => f.extension === "md"),
      read: (file: TFile) => adapter.read(file.path),
      create: async (path: string, text: string) => { await adapter.write(path, text); return new TFile(path); },
    },
  };
}
// UI classes are only needed to load the plugin; these tests use its automation API.
export class Plugin { constructor(public app: any, public manifest?: any) {} }
export class Modal {}
export class SuggestModal<T> {}
export class EditorSuggest<T> {}
export class ItemView {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export const debounce = (fn: (...args: any[]) => any) => fn;
export const normalizePath = (path: string) => path.replace(/\\/g, "/");
export const getIcon = () => null;
export const setIcon = () => {};
export const Keymap = { isModEvent: () => false };
export const moment = () => ({ format: () => "2026-09-30T12:00:00Z" });
