import fs from "node:fs";
import { hasInstance } from "./instance";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadInstance, discover, Instance, realPath } from "./bank/node";
export function main(args: string[], scriptPath: string) {
  try {
    let instance: Instance | undefined;
    if (args.length) {
      if (args.length !== 2 || args[0] !== "--vault")
        throw new Error("usage: context.cjs [--vault <absolute path>]");
      instance = loadInstance(args[1]);
    } else {
      for (let p = path.dirname(realPath(scriptPath)); ; p = path.dirname(p)) {
        const binding = path.join(p, "noteweaver-instance.json");
        if (fs.existsSync(binding)) {
          const data = JSON.parse(fs.readFileSync(binding, "utf8"));
          if (data.version !== 1 || typeof data.vault !== "string" || !path.isAbsolute(data.vault))
            throw new Error("invalid Noteweaver instance binding");
          instance = loadInstance(data.vault);
          break;
        }
        // A distributed plugin is reusable. Its cache parent is not an instance.
        if (fs.existsSync(path.join(p, "plugin.json")) || fs.existsSync(path.join(p, ".codex-plugin/plugin.json"))) break;
        if (hasInstance(relative => fs.existsSync(path.join(p, relative)))) {
          instance = loadInstance(p);
          break;
        }
        if ([".agents", ".claude"].includes(path.basename(p))) {
          // Installed skills belong to this repository even when invoked through
          // a personal symlink from a different working directory. Fail on an
          // ambiguous/invalid instance instead of silently selecting the caller.
          instance = loadInstance(path.dirname(p));
          break;
        }
        if (path.dirname(p) === p) break;
      }
      instance ??= discover(process.cwd());
    }
    const { vault, root, layout } = instance,
      name = layout.config.vault_name ?? path.basename(vault);
    if (layout.config.require_obsidian) {
      const r = spawnSync("obsidian", [`vault=${name}`, "vault", "info=path"], {
        encoding: "utf8",
        timeout: 20000,
      });
      if (r.error || r.status !== 0 || path.resolve(r.stdout.trim()) !== vault)
        throw new Error(
          `Open Obsidian with ${vault} as vault ${name}; do not bypass this instance requirement`,
        );
    }
    console.log(
      JSON.stringify(
        { vault, repository: root, config: layout.config,
          paths: Object.fromEntries(Object.entries(layout.paths).map(([key, value]) => [key, path.join(root, value)])) },
        null,
        2,
      ),
    );
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
}
