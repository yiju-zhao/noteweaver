import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadInstance, snapshot } from "../src/bank/node";
import { execute } from "../src/bank/operations";
import { htmlLinks } from "../src/bank/model";
import { frameFor, linkAction, presentationMove } from "../src/presentation";

/** Check a copy of the example vault with extra files written under it. */
function check(t: { after(f: () => void): void }, files: Record<string, string | Uint8Array>) {
  const tmp = mkdtempSync(join(tmpdir(), "noteweaver-presentation-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const vault = join(tmp, "example-vault");
  cpSync(join(process.env.NOTEWEAVER_ROOT!, "example-vault"), vault, { recursive: true });
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(vault, path)), { recursive: true });
    writeFileSync(join(vault, path), data);
  }
  const result = execute(snapshot(loadInstance(tmp)), { operation: "check" });
  return result.data.findings.filter((f: any) => f.code !== "history-skipped")
    .map((f: any) => ({ ...f, path: f.path.replace("example-vault/", "") }));
}
const attachments = (findings: any[]) => findings.filter((f) => f.code === "attachment").map((f) => f.path);

test("a page's same-name HTML is allowed; every other non-md file in the bank is an error", (t) => {
  const findings = check(t, {
    "bank/concepts/example-concept.html": "<p>presentation</p>",
    "bank/concepts/orphan.html": "<p>no page</p>",
    "bank/concepts/example-concept.json": "{}",
    "bank/concepts/example-concept.html.png": new Uint8Array([137, 80, 78, 71]),
    "bank/index.html": "<p>index is not a page</p>",
    "bank/.gitkeep": "",
    "bank/concepts/.DS_Store": "",
  });
  assert.deepEqual(attachments(findings).sort(), [
    "bank/concepts/example-concept.html.png", "bank/concepts/example-concept.json",
    "bank/concepts/orphan.html", "bank/index.html",
  ]);
  assert.ok(findings.filter((f: any) => f.code === "attachment").every((f: any) => f.severity === "error"));
});

test("a vault without attachments still passes", (t) => {
  assert.deepEqual(check(t, {}), []);
});

test("relative links in a presentation HTML must point at existing bank or evidence files", (t) => {
  const findings = check(t, {
    "bank/concepts/example-concept.html": [
      "<!doctype html><title>x</title>",
      '<a href="../entities/models/alpha-model.md#top">page</a>',
      '<a href="missing.pdf">gone</a>',
      '<img src="../../.noteweaver/schema.json">',
      '<a href="https://example.com/a">web</a> <a href="#local">anchor</a> <a href="data:text/plain,hi">d</a>',
    ].join("\n"),
  });
  assert.deepEqual(findings.map((f: any) => [f.code, f.severity, f.path, f.line]), [
    ["link-broken", "error", "bank/concepts/example-concept.html", 3],
    ["link-outside", "error", "bank/concepts/example-concept.html", 4],
  ]);
});

test("htmlLinks reads static tags only", () => {
  const html = [
    '<a href="a.md">one</a> <img SRC=b.png> <a href=\'c.md#x\'>',
    '<script>el.innerHTML = \'<a href="${url}">\'; const h = "<a href=\\"nope.md\\">";</script>',
    "<style>.x{background:url(href=\"nope.png\")}</style><!-- <a href=\"nope.md\"> -->",
    '<iframe srcdoc="&lt;a href=&quot;nope.md&quot;&gt;" src="d.html"></iframe>',
    '<a href="https://x.test/e">e</a><a href="//cdn.test/f">f</a><a href="mailto:a@b">m</a><a href="#top">t</a><a href="">e</a>',
    '<a href="g%20h.md?q=1#frag">enc</a>',
  ].join("\n");
  assert.deepEqual(htmlLinks(html), [
    { target: "a.md", line: 1 }, { target: "b.png", line: 1 }, { target: "c.md", line: 1 },
    { target: "d.html", line: 4 }, { target: "g h.md", line: 6 },
  ]);
});

test("only a bank's own HTML gets scripts, and no mode shares an origin with Obsidian", () => {
  const run = frameFor("<p>hi</p>", true), still = frameFor("<p>hi</p>", false);
  assert.ok(run.srcdoc.startsWith("<p>hi</p>") && run.srcdoc.includes("<script>"));
  assert.equal(run.sandbox.split(" ").includes("allow-scripts"), true);
  assert.equal(still.srcdoc, '<base href="about:srcdoc"><p>hi</p>');
  assert.equal(still.sandbox, "");
  for (const { sandbox } of [run, still]) assert.equal(sandbox.includes("allow-same-origin"), false);
});

test("a clicked link opens a web page, a vault file, or nothing", () => {
  const from = "pages/analyses/report.html";
  assert.deepEqual(linkAction("https://arxiv.org/abs/1#x", from), { kind: "external", url: "https://arxiv.org/abs/1#x" });
  assert.deepEqual(linkAction("mailto:a@b.test", from), { kind: "external", url: "mailto:a@b.test" });
  assert.deepEqual(linkAction("../../evidence/sources/arxiv.org/a%20b.pdf#page=3", from),
    { kind: "vault", path: "evidence/sources/arxiv.org/a b.pdf", hash: "page=3" });
  assert.deepEqual(linkAction("other.md?x=1", from), { kind: "vault", path: "pages/analyses/other.md", hash: "" });
  assert.deepEqual(linkAction("/pages/x.md", from), { kind: "vault", path: "pages/x.md", hash: "" });
  for (const href of ["obsidian://open?vault=v", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "//evil.test/x",
    "#top", "", "../../../../etc/passwd", "../../..", "?q=1", "%E0%A4%A", "x".repeat(5000)])
    assert.equal(linkAction(href, from), undefined, href);
});

test("a page move takes its same-name HTML along only inside the bank", () => {
  assert.deepEqual(presentationMove("pages/a/foo.md", "pages/b/bar.md", "pages"), ["pages/a/foo.html", "pages/b/bar.html"]);
  for (const [from, to] of [["pages/a/foo.md", "elsewhere/foo.md"], ["elsewhere/foo.md", "pages/foo.md"], ["pages/a/foo.html", "pages/a/bar.html"],
    ["pages/a/foo.md", "pages/a/foo.txt"], ["pages/a/index.md", "pages/a/other.md"], ["pages/a/foo.md", "pages/a/log.md"]])
    assert.equal(presentationMove(from, to, "pages"), undefined, `${from} → ${to}`);
});

test("a script-free frame keeps #fragment links and disarms every other link", () => {
  const html = '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>' +
    '<a href="#sec">in page</a><a id=x href=\'#y\'>y</a><a href="https://x.test/a">web</a><a class="c" href=/wiki/Foo>rel</a>' +
    '<area href="m.html"><a name="anchor-only">n</a><abbr href="z">not a link</abbr><article>text</article></body></html>';
  const { srcdoc } = frameFor(html, false);
  assert.ok(srcdoc.startsWith('<!DOCTYPE html><html lang="en"><head><base href="about:srcdoc"><title>'));
  assert.ok(srcdoc.includes('<a href="#sec">') && srcdoc.includes("<a id=x href='#y'>"));
  assert.ok(srcdoc.includes('<a target="_blank" href="https://x.test/a">'));
  assert.ok(srcdoc.includes('<a target="_blank" class="c" href=/wiki/Foo>'));
  assert.ok(srcdoc.includes('<area target="_blank" href="m.html">'));
  assert.ok(srcdoc.includes('<a name="anchor-only">') && srcdoc.includes('<abbr href="z">') && srcdoc.includes("<article>"));
  assert.equal(frameFor("<p>no head</p>", false).srcdoc, '<base href="about:srcdoc"><p>no head</p>');
  assert.equal(frameFor("<!doctype html><p>x</p>", false).srcdoc, '<!doctype html><base href="about:srcdoc"><p>x</p>');
  assert.equal(frameFor("<html><body>b</body></html>", false).srcdoc, '<html><base href="about:srcdoc"><body>b</body></html>');
});
