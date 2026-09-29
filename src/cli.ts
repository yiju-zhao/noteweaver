import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { discover, loadInstance, runOffline, Instance } from "./bank/node";
import { Request, Result } from "./bank/operations";
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
    !["check", "index", "schema", "lift", "refs", "info", "review"].includes(
      operation ?? "",
    )
  )
    throw new Error("choose check, index, schema, lift, refs, info, or review");
  request.operation = operation as Request["operation"];
  return { root, offline, json, request };
}
export function live(instance: Instance, request: Request): Result {
  request = { ...request, vault: instance.vault };
  const name =
    instance.layout.config.vault_name ?? path.basename(instance.vault);
  const code = `(async()=>{const p=app.plugins.plugins['kb-types'];if(!p||p.automationVersion!==1)throw Error('Noteweave automation unavailable; install and reload the pinned plugin');return JSON.stringify(await p.runAutomation(${JSON.stringify(request)}));})()`;
  const r = spawnSync("obsidian", [`vault=${name}`, "eval", `code=${code}`], {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 64 << 20,
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(r.stderr || r.stdout || "Obsidian command failed");
  let result: Result;
  try {
    result = JSON.parse(r.stdout.trim().replace(/^=>\s*/, ""));
  } catch {
    throw new Error(
      `Obsidian returned no structured result: ${r.stdout.trim().slice(0, 400)}`,
    );
  }
  if (
    result.apiVersion !== 1 ||
    !Number.isInteger(result.code) ||
    !Array.isArray(result.changes)
  )
    throw new Error("unsupported Noteweave automation response");
  return result;
}
export function main(args: string[]) {
  if (args.includes("--help") || !args.length) {
    console.log(
      "Noteweave: kb [--root VAULT] [--offline] <check|index|schema|refs|lift|info|review> [--json] [--base REV] [--check] [--dry-run]\nNormal commands connect to Obsidian. --offline explicitly selects filesystem execution for CI and isolated fixtures.",
    );
    return 0;
  }
  try {
    const { root, offline, json, request } = parseArgs(args);
    const instance = root ? loadInstance(root) : discover(process.cwd());
    const result = offline
      ? runOffline(instance, request)
      : live(instance, request);
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
        `kb check: ${result.data.pages} pages, ${result.data.claims} claims, ${result.data.cards} evidence cards: ${result.data.errors} errors, ${result.data.warnings} warnings`,
      );
    } else if (request.operation === "lift") {
      const s = result.data;
      console.log(
        `kb lift: ${request.dryRun ? "would lift" : "lifted"} ${s.promoted} keys on ${s.pages} pages; ${s.kept} claims stay`,
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
    console.error(`kb: ${(e as Error).message}`);
    return 2;
  }
}

