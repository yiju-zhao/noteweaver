/** Live adapter: content comes from Obsidian; writes use its Vault API. */
import { App, FileSystemAdapter, TFile, normalizePath } from "obsidian";
import path from "node:path";
import {
  MemoryStore,
  FileRecord,
  Repo,
  Patch,
  inside,
  parsePage,
  prose,
  links,
  resolveLink,
} from "./model";
import { history, loadInstance, record } from "./node";
import { execute, Request, Result } from "./operations";
import { applyChanges } from "./write";
export class ObsidianBank {
  private busy = false;
  constructor(private app: App) {}
  async run(request: Request): Promise<Result> {
    if (this.busy)
      return {
        apiVersion: 1,
        code: 2,
        data: { error: "another Noteweave operation is running" },
        changes: [],
      };
    this.busy = true;
    try {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter))
        throw new Error(
          "full knowledge-bank automation requires desktop Obsidian",
        );
      const instance = loadInstance(adapter.getBasePath());
      if (request.vault && path.resolve(request.vault) !== instance.vault)
        throw new Error(
          "requested vault does not match the running Obsidian vault",
        );
      const { layout } = instance,
        prefix = layout.vault ? layout.vault + "/" : "",
        relative = (p: string) => {
          if (prefix && !p.startsWith(prefix))
            throw new Error(`path leaves vault: ${p}`);
          return normalizePath(p.slice(prefix.length));
        };
      const files = new Map<string, FileRecord>(),
        paths = new Set<string>();
      const walk = async (rel: string) => {
        const vp = relative(rel),
          stat = await adapter.stat(vp);
        if (!stat) return;
        paths.add(rel);
        if (stat.type === "folder") {
          const listing = await adapter.list(vp);
          for (const f of [...listing.folders, ...listing.files])
            await walk(prefix + f);
        } else {
          const file = this.app.vault.getAbstractFileByPath(vp);
          const data =
            file instanceof TFile && file.extension === "md"
              ? new TextEncoder().encode(await this.app.vault.read(file))
              : new Uint8Array(await adapter.readBinary(vp));
          files.set(rel, record(data));
        }
      };
      for (const p of Object.values(layout.paths)) await walk(p);
      for (const [p, r] of files)
        if (inside(p, layout.paths.bank) && p.endsWith(".md"))
          for (const [, line] of prose(parsePage(r.text ?? "", p).body))
            for (const target of links(line)) {
              const q = resolveLink(p, target);
              if (
                (!prefix || q.startsWith(prefix)) &&
                (await adapter.exists(relative(q)))
              )
                paths.add(q);
            }
      const repo = new Repo(
          layout,
          new MemoryStore(files, paths),
          ["check", "sources"].includes(request.operation)
            ? history(instance, request.base ?? "HEAD")
            : undefined,
        ),
        result = execute(repo, request);
      const read = async (p: string) => {
        const vp = relative(p);
        if (!(await adapter.exists(vp))) return null;
        const f = this.app.vault.getAbstractFileByPath(vp);
        return f instanceof TFile ? this.app.vault.read(f) : adapter.read(vp);
      };
      await applyChanges(
        {
          read,
          write: async (patch) => {
            const vp = relative(patch.path),
              file = this.app.vault.getAbstractFileByPath(vp);
            if (file instanceof TFile) {
              await this.app.vault.process(file, (current) => {
                if (current !== patch.before)
                  throw new Error(`file changed since planning: ${patch.path}`);
                return patch.after;
              });
            } else {
              if ((await read(patch.path)) !== patch.before)
                throw new Error(`file changed since planning: ${patch.path}`);
              const folder = vp.slice(0, vp.lastIndexOf("/"));
              if (!(await adapter.exists(folder)))
                await this.app.vault.createFolder(folder);
              if (vp.split("/").some((p) => p.startsWith(".")))
                await adapter.write(vp, patch.after);
              else if (patch.before === null)
                await this.app.vault.create(vp, patch.after);
              else throw new Error(`file not loaded in Obsidian: ${vp}`);
            }
          },
        },
        result.changes,
      );
      // Return paths, not entire before/after page contents, across the CLI transport.
      return {
        ...result,
        data: request.operation === "info" ? {
          ...result.data, root: instance.root, vault: instance.vault,
          paths: Object.fromEntries(Object.entries(layout.paths).map(([key, value]) => [key, path.join(instance.root, value)])),
        } : result.data,
        changes: result.changes.map((p) => ({
          path: p.path,
          before: null,
          after: "",
        })),
      };
    } catch (e) {
      return {
        apiVersion: 1,
        code: 2,
        data: { error: (e as Error).message },
        changes: [],
      };
    } finally {
      this.busy = false;
    }
  }
}
