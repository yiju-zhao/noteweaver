import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeZip } from "./zip.mjs";
const root = dirname(dirname(fileURLToPath(import.meta.url))), dist = join(root, "dist");
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const hash = data => createHash("sha256").update(data).digest("hex");
const files = new Map();
function walk(directory, prefix) {
  for (const e of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "__pycache__", ".DS_Store"].includes(e.name)) continue;
    const p = join(directory, e.name), name = prefix + e.name;
    if (e.isSymbolicLink()) throw Error(`cannot bundle symlink ${p}`);
    if (e.isDirectory()) walk(p, name + "/");
    else files.set(name, readFileSync(p));
  }
}
// The whole reviewed archify runtime is pinned and bundled, including schemas/examples.
const archifyHash = "4c59fa6557a2385beaaef8c7219cc414573acc9f0c30a932d5053b0b20689a46";
const cache = join(root, ".cache"); mkdirSync(cache, {recursive:true});
const archive = join(cache, "archify-2.16.0.zip");
if (!existsSync(archive) || hash(readFileSync(archive)) !== archifyHash) {
  const response = await fetch("https://github.com/tt-a1i/archify/releases/download/v2.16.0/archify.zip");
  if (!response.ok) throw Error(`archify download: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== archifyHash) throw Error("archify SHA-256 mismatch");
  writeFileSync(archive, bytes);
}
const temporary = mkdtempSync(join(cache, "archify-"));
try { execFileSync("unzip", ["-q", archive, "-d", temporary]); walk(join(temporary,"archify"), "skills/archify/"); }
finally { rmSync(temporary, {recursive:true,force:true}); }
walk(join(root,"skills"), "skills/");
walk(join(root,"templates"), "templates/");
walk(join(root,"docs"), "docs/");
files.set("skills/noteweaver-query/scripts/context.cjs", readFileSync(join(dist,"skill-context.cjs")));
for (const name of ["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", "THIRD_PARTY_NOTICES.md", "scripts/setup-tools.sh"])
  files.set(name, readFileSync(join(root,name)));
const skills = readdirSync(join(root,"skills"), {withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();
const inventory = Object.fromEntries([...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([p,b])=>[p,hash(b)]));
files.set("bundle.json", Buffer.from(JSON.stringify({version, skills, files:inventory}, null,2)+"\n"));
writeZip(join(dist,"agent-plugin.zip"), [...files]);
writeZip(join(dist,"runtime.zip"), [
  ...["cli.cjs","context.cjs","runtime.cjs"].map(name=>["cli/"+name,readFileSync(join(dist,name))]),
  ["validation.cjs",readFileSync(join(dist,"validation.cjs"))],
]);
copyFileSync(join(root,"scripts/install.py"), join(dist,"installer.py"));
const assets = ["main.js","manifest.json","styles.css","validation.cjs","runtime.zip","agent-plugin.zip","installer.py"];
writeFileSync(join(dist,"SHA256SUMS"),assets.map(name=>`${hash(readFileSync(join(dist,name)))}  ${name}\n`).join(""));
console.log(`Packaged Noteweaver ${version}: ${skills.length} skills, ${files.size} agent plugin files`);
