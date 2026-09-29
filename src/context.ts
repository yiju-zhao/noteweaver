import fs from "node:fs";
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
        if (fs.existsSync(path.join(p, ".kb/config.json"))) {
          instance = loadInstance(p);
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
        { vault, repository: root, config: layout.config },
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
