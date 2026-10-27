import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadInstance, snapshot } from "../src/bank/node";
import { execute } from "../src/bank/operations";

test("a Claim has no status field; superseded and conflicting are not written", (t) => {
  const tmp = mkdtempSync(join(tmpdir(), "noteweaver-claims-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const vault = join(tmp, "example-vault");
  cpSync(join(process.env.NOTEWEAVER_ROOT!, "example-vault"), vault, { recursive: true });
  appendFileSync(join(vault, "bank/entities/models/alpha-model.md"),
    "\n## 断言\n\n```yaml\n- id: alpha-model--tpf\n  attribute: tpf\n  value: 8\n  unit: token/forward\n" +
    "  basis: direct\n  status: superseded\n```\n");
  const findings = execute(snapshot(loadInstance(tmp)), { operation: "check" }).data.findings;
  const status = findings.filter((f: any) => /status/.test(f.message));
  assert.deepEqual(status.map((f: any) => [f.code, f.severity]), [["claim-field", "error"]]);
});
