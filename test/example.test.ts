import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSchema, readFrontmatter, specFor, pageName, validate, claimedAttributes, checkRelations } from "../src/validation";

test("the standalone example has valid frontmatter and synchronized relations", () => {
  const vault = join(process.env.NOTEWEAVE_ROOT!, "example-vault");
  const schema = readSchema(readFileSync(join(vault, ".kb/schema.json"), "utf8"));
  const pages = Object.keys(schema.directories).flatMap((directory) =>
    readdirSync(join(vault, directory)).filter((name) => name.endsWith(".md") && specFor(schema, `${directory}/${name}`)).map((name) => ({
      path: `${directory}/${name}`, text: readFileSync(join(vault, directory, name), "utf8"),
    })));
  assert.ok(pages.length >= 3);
  const lookup = (name: string) => {
    const page = pages.find((p) => pageName(p.path) === name);
    return page ? readFrontmatter(page.text).data! : undefined;
  };
  for (const page of pages) {
    const { data, error } = readFrontmatter(page.text);
    assert.deepEqual(validate(schema, specFor(schema, page.path)!, data, error, lookup, claimedAttributes(page.text)), [], page.path);
  }
  assert.deepEqual(checkRelations(schema, pages), []);
});
