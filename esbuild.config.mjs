// Produce portable release assets; installing into a vault is a separate step.
import esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
mkdirSync(out, { recursive: true });
const banner = { js: "/*! Bundled yaml dependency (ISC)\n" +
  readFileSync(join(here, "node_modules/yaml/LICENSE"), "utf8") + "*/" };
await esbuild.build({
  entryPoints: [join(here, "src/main.ts")], outfile: join(out, "main.js"), bundle: true,
  format: "cjs", target: "es2021", banner,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", "node:*", ...builtinModules], logLevel: "info",
});
await esbuild.build({
  entryPoints: [join(here, "src/validation.ts")], outfile: join(out, "validation.cjs"), bundle: true,
  platform: "node", format: "cjs", target: "node20", banner, logLevel: "info",
});
for (const file of ["manifest.json", "styles.css"]) copyFileSync(join(here, file), join(out, file));

for (const [entry, file] of [["src/cli-entry.ts", "cli.cjs"], ["src/context.ts", "context.cjs"], ["src/bank/node.ts", "runtime.cjs"], ["skills/noteweaver-query/scripts/context.cjs", "skill-context.cjs"]]) {
  await esbuild.build({ entryPoints: [join(here, entry)], outfile: join(out, file), bundle: true, platform: "node", format: "cjs", target: "node20", banner, logLevel: "info" });
}
