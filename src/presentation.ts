/** Presentation HTML: rules shared by the Obsidian view and rename handling. No Obsidian API here. */
import { filename, inside, NOT_PAGES, resolveLink } from "./bank/model";

export const LINK_MESSAGE = "noteweaver-link";

/** Appended to a script-enabled presentation. The page runs in an opaque origin and cannot reach Obsidian,
 * so it only reports clicked links; the view decides what opens. Anchors scroll inside the frame because
 * `#id` in a srcdoc document resolves against the parent's URL. Downloads and links the page handled
 * itself are left alone. */
const LINK_SCRIPT = `<script>(function () {
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download")) return;
    var href = a.getAttribute("href");
    if (/^(blob|data|javascript):/i.test(href)) return;
    e.preventDefault();
    if (href.charAt(0) !== "#") { parent.postMessage({ type: "${LINK_MESSAGE}", href: href }, "*"); return; }
    var id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (_) {}
    var el = id ? document.getElementById(id) || document.getElementsByName(id)[0] : document.documentElement;
    if (el) el.scrollIntoView();
  });
})();</script>`;

/** A frame without scripts cannot report clicks, and a link left alone navigates the frame away from the
 * document (to Obsidian's own URL, or blank). So every link except `#fragment` gets `target="_blank"`, which
 * a sandbox without `allow-popups` turns into a no-op, and `<base href="about:srcdoc">` keeps `#fragment`
 * links scrolling in place. */
function inertLinks(html: string): string {
  const links = html.replace(/<(a|area)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi, (tag, name, attrs) =>
    /\shref\b/i.test(attrs) && !/\shref\s*=\s*["']?\s*#/i.test(attrs) ? `<${name} target="_blank"${attrs}>` : tag);
  const at = /<head\b[^>]*>/i.exec(links) ?? /<html\b[^>]*>/i.exec(links) ?? /^\s*<!doctype[^>]*>/i.exec(links);
  const end = at ? at.index + at[0].length : 0;
  return links.slice(0, end) + '<base href="about:srcdoc">' + links.slice(end);
}

/** The iframe document, and the sandbox it runs in. Scripts run only for `scripts`; neither mode gets
 * `allow-same-origin`, so page code never shares an origin with Obsidian. Downloads need `allow-downloads`:
 * with `allow-scripts` alone a page's own CSV/SVG downloads are silently dropped. */
export function frameFor(html: string, scripts: boolean): { srcdoc: string; sandbox: string } {
  return scripts
    ? { srcdoc: html + LINK_SCRIPT, sandbox: "allow-scripts allow-downloads" }
    : { srcdoc: inertLinks(html), sandbox: "" };
}

export type LinkAction =
  | { kind: "external"; url: string }
  | { kind: "vault"; path: string; hash: string };

/** What a link clicked inside a presentation at vault path `from` should do; undefined means nothing. */
export function linkAction(href: string, from: string): LinkAction | undefined {
  if (typeof href !== "string" || href.length > 4096) return;
  if (/^(https?|mailto):/i.test(href)) return { kind: "external", url: href };
  if (!href || href.startsWith("#") || href.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return;
  const [, path, hash = ""] = /^([^?#]*)[^#]*(?:#(.*))?$/.exec(href)!;
  let target: string;
  try {
    target = resolveLink(from, decodeURIComponent(path)).replace(/^\/+/, "");
  } catch {
    return;
  }
  if (!path || !target || target === ".." || target.startsWith("../")) return;
  return { kind: "vault", path: target, hash };
}

/** When a page moves, its same-name HTML moves with it: [from, to], or undefined if the rename is not a page move. */
export function presentationMove(oldPath: string, newPath: string, bank: string): [string, string] | undefined {
  const pages = [oldPath, newPath];
  if (!pages.every((p) => p.endsWith(".md") && inside(p, bank) && !NOT_PAGES.has(filename(p)))) return;
  return [oldPath.slice(0, -3) + ".html", newPath.slice(0, -3) + ".html"];
}
