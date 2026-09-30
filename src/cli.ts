import path from "node:path";
import { discover, loadInstance, runOffline } from "./bank/node";
import { Request } from "./bank/operations";
export function parseArgs(args: string[]) {
  let root: string | undefined,
    offline = false,
    json = false,
    operation: string | undefined;
  const request: Request = { operation: "info" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--offline") offline = true;
    else if (a === "--json") json = true;
    else if (a === "--base") request.base = args[++i];
    else if (a === "--check") request.check = true;
    else if (a === "--dry-run") request.dryRun = true;
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else if (!operation) operation = a;
    else if (operation === "refs" && !request.name) request.name = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (
    !["check", "index", "schema", "lift", "sources", "refs", "info", "review"].includes(
      operation ?? "",
    )
  )
    throw new Error("choose check, index, schema, lift, sources, refs, info, or review");
  request.operation = operation as Request["operation"];
  return { root, offline, json, request };
}
export function main(args: string[]) {
  if (args.includes("--help") || !args.length) {
    console.log(
      "Noteweave offline runner: node cli.cjs [--root VAULT] --offline <check|index|schema|refs|lift|sources|info|review> [--json] [--base REV] [--check] [--dry-run]\nRequires --offline for CI and isolated fixtures. Daily use: obsidian vault=<name> command id=kb-types:check-bank; use Obsidian eval for parameters and JSON.",
    );
    return 0;
  }
  try {
    const { root, offline, json, request } = parseArgs(args);
    if (!offline) throw new Error("daily operations use Obsidian CLI: obsidian vault=<name> command id=kb-types:check-bank; this runner requires --offline for CI or isolated fixtures");
    const instance = root ? loadInstance(root) : discover(process.cwd());
    const result = runOffline(instance, request);
    if (result.code === 2)
      throw new Error(result.data?.error ?? "Noteweave operation failed");
    if (json || ["info", "review"].includes(request.operation))
      console.log(
        JSON.stringify(
          request.operation === "info"
            ? {
                ...result.data,
                root: instance.root,
                vault: instance.vault,
                paths: Object.fromEntries(
                  Object.entries(instance.layout.paths).map(([k, p]) => [
                    k,
                    path.join(instance.root, p),
                  ]),
                ),
              }
            : result.data,
        ),
      );
    else if (request.operation === "check") {
      for (const f of result.data.findings)
        console.log(
          `${f.path}${f.line ? ":" + f.line : ""}: ${f.severity}: [${f.code}] ${f.message}`,
        );
      console.log(
        `Noteweave check: ${result.data.pages} pages, ${result.data.claims} claims, ${result.data.cards} evidence cards: ${result.data.errors} errors, ${result.data.warnings} warnings`,
      );
    } else if (request.operation === "sources") {
      console.log(`Noteweave sources: ${request.dryRun ? "would migrate" : "migrated"} ${result.data.pages} pages`);
      for (const f of result.data.errors) console.log(`${f.path}: [${f.code}] ${f.message}`);
    } else if (request.operation === "lift") {
      const s = result.data;
      console.log(
        `Noteweave lift: ${request.dryRun ? "would lift" : "lifted"} ${s.promoted} keys on ${s.pages} pages; ${s.kept} claims stay`,
      );
      for (const [p, a, v] of s.conflicts)
        console.log(
          `${p}: conflict on ${a}: ${v.join(" vs ")}; a human decides`,
        );
    } else if (request.operation === "refs") {
      for (const [p, n, k, v] of result.data)
        console.log(`${p}:${n}: ${k}: ${v}`);
    } else
      for (const p of result.data)
        console.log(
          request.check
            ? `${p}: differs from its generated form`
            : `wrote ${p}`,
        );
    return result.code;
  } catch (e) {
    console.error(`Noteweave: ${(e as Error).message}`);
    return 2;
  }
}
