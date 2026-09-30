import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandResults } from "../src/commands";
import type { Result } from "../src/bank/operations";
const ok: Result = { apiVersion: 1, code: 0, data: { errors: 0 }, changes: [] };
test("native command result waits for asynchronous completion", async () => {
  const commands = new CommandResults();
  let finish!: (r: Result) => void;
  commands.start("check-bank", () => new Promise(resolve => { finish = resolve; }));
  let completed = false;
  const result = commands.result("check-bank").then(r => { completed = true; return r; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish({ ...ok, code: 1, data: { errors: 2 } });
  assert.deepEqual(await result, { ...ok, code: 1, data: { errors: 2 }, commandId: "check-bank" });
});
test("failures and missing or mismatched commands cannot look like previous success", async () => {
  const commands = new CommandResults();
  assert.equal((await commands.result()).code, 2);
  await commands.start("index", async () => ok);
  assert.equal((await commands.result("check-bank")).code, 2);
  commands.start("check-bank", async () => { throw Error("connection lost"); });
  const result = await commands.result("check-bank");
  assert.equal(result.code, 2);
  assert.equal(result.data.error, "connection lost");
});
test("older completion cannot overwrite the latest invocation including busy failure", async () => {
  const commands = new CommandResults();
  let finish!: (r: Result) => void;
  const first = commands.start("index", () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  await commands.start("schema", async () => ({ ...ok, code: 2, data: { error: "busy" } }));
  finish(ok);
  await first;
  const latest = await commands.result();
  assert.equal(latest.commandId, "schema");
  assert.equal(latest.code, 2);
});
