// Bundle each test/*.test.ts with esbuild into a temporary directory and run it with node's test runner,
// so the tests need nothing beyond the build's own dev dependencies and run on Node 20+.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "kb-types-test-"));
try {
  const entries = readdirSync(here).filter((f) => f.endsWith(".test.ts")).map((f) => join(here, f));
  await build({ entryPoints: entries, outdir: out, bundle: true, platform: "node", format: "cjs",
                outExtension: { ".js": ".cjs" }, logLevel: "warning" });
  const files = readdirSync(out).map((f) => join(out, f));
  const r = spawnSync(process.execPath, ["--test", ...files], {
    stdio: "inherit", env: { ...process.env, KB_TYPES_ROOT: resolve(here, "..") } });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
