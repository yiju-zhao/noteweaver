// Read-only bridge to the same schema validator bundled into Obsidian.
const fs = require("node:fs");
const path = require("node:path");
const artifact = path.join(__dirname, "../validation.cjs");
const api = require(fs.existsSync(artifact) ? artifact : "../dist/validation.cjs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const schema = api.readSchema(JSON.stringify(input.schema));
const byName = new Map();
for (const p of input.pages) {
  const {data} = api.readFrontmatter(p.text);
  const name = api.pageName(p.path);
  byName.set(name, [...(byName.get(name) || []), data]);
}
const lookup = name => { const ps = byName.get(name); return ps?.length === 1 ? ps[0] : undefined; };
const findings = input.pages.flatMap(p => {
  const spec = api.specFor(schema, p.path);
  if (!spec) return [];
  const {data,error} = api.readFrontmatter(p.text);
  return api.validate(schema, spec, data, error, lookup, api.claimedAttributes(p.text))
    .filter(f => f.code.startsWith("fm-"))
    .map(f => ({...f, path:p.rel}));
});
process.stdout.write(JSON.stringify(findings));
