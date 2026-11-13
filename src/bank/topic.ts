/** Working state of a recurring topic study: its brief, run notes, and what the
 * bank already holds for it. Read-only; briefs and run notes are instance
 * records like review documents, never knowledge or evidence. */
import { Repo, Page, parsePage, inside, list, object, prose, links, resolveLink, compare } from "./model";
import { sourceEntry } from "./sources";

const RUNS = 10, RELATED = 20;
const briefs = (repo: Repo) => {
  const root = repo.layout.paths.topics;
  return [...repo.store.files.keys()]
    .filter((p) => inside(p, root) && p.endsWith("/brief.md") && p.split("/").length === root.split("/").length + 2)
    .sort(compare)
    .map((path) => ({ name: path.split("/").at(-2)!, path, page: parsePage(repo.store.read(path), path) }));
};
const runs = (repo: Repo, brief: string) => {
  const dir = brief.slice(0, -"brief.md".length) + "runs";
  return [...repo.store.files.keys()].filter((p) => inside(p, dir) && p.endsWith(".md")).sort(compare).reverse();
};

export function topics(repo: Repo) {
  return briefs(repo).map(({ name, path, page }) => {
    const notes = runs(repo, path);
    return { name, path, title: page.fm.title, status: page.fm.status, topic: page.fm.topic,
      report: page.fm.report, runs: notes.length, last_run: notes[0] };
  });
}

export function topic(repo: Repo, name: string) {
  const found = briefs(repo).find((b) => b.name === name);
  if (!found) throw new Error(`no topic brief: ${repo.layout.paths.topics}/${name}/brief.md`);
  const { fm } = found.page, problems: string[] = [], byPath = new Map(repo.allPages().map((p) => [p.path, p]));
  const outlinks = (p: Page) => {
    const out = new Set<Page>();
    for (const [, line] of prose(p.body))
      for (const t of links(line)) {
        const q = byPath.get(resolveLink(p.path, t));
        if (q && q !== p) out.add(q);
      }
    for (const value of Object.values(p.fm))
      for (const x of list(value)) {
        const q = typeof x === "string" && repo.page(/^\[\[([^\[\]]+)\]\]$/.exec(x)?.[1]);
        if (q && q !== p) out.add(q);
      }
    return out;
  };
  // Scope: the pages the brief names, plus everything those pages link to.
  const seeds = new Set<Page>();
  for (const key of ["topic", "report", "pages"])
    for (const value of list(fm[key] ?? []).filter((v) => v !== "")) {
      const page = repo.page(value);
      if (page) seeds.add(page);
      else problems.push(`${key}: no page named ${value}`);
    }
  const members = new Set(seeds);
  for (const seed of seeds) for (const p of outlinks(seed)) members.add(p);
  const names = new Set([...members].map((p) => p.name));

  const cardsOf = (p: Page) => {
    const out = new Set<string>();
    for (const entry of Array.isArray(p.fm.sources) ? p.fm.sources : [])
      try {
        out.add(sourceEntry(repo, p, entry).target);
      } catch {
        // Malformed source entries are check findings, not part of the ledger.
      }
    return out;
  };
  const cited = new Map<string, number>();
  for (const p of members) for (const c of cardsOf(p)) cited.set(c, (cited.get(c) ?? 0) + 1);
  const related = repo.allPages()
    .filter((p) => !members.has(p))
    .map((p) => ({ name: p.name, shared: [...cardsOf(p)].filter((c) => cited.has(c)).length }))
    .filter((r) => r.shared >= 2)
    .sort((a, b) => b.shared - a.shared || compare(a.name, b.name))
    .slice(0, RELATED);

  const navigation = repo.page(fm.topic), listed = navigation && outlinks(navigation);
  const pointsAt = (target: string) => repo.allPages()
    .filter((p) => Object.values(p.fm).some((v) => list(v).some((x) => x === `[[${target}]]`)))
    .map((p) => p.name);
  const notes = runs(repo, found.path);
  return {
    brief: { path: found.path, ...fm },
    runs: { total: notes.length, latest: notes.slice(0, RUNS) },
    problems,
    members: [...members].sort((a, b) => compare(a.name, b.name)).map((p) => ({
      name: p.name, path: p.path, type: p.fm.type, title: p.fm.title, status: p.fm.status,
      generated: object(p.fm.generated) ? p.fm.generated.at : undefined,
      bytes: repo.store.files.get(p.path)?.bytes, claims: p.claims?.length ?? 0, sources: cardsOf(p).size,
      seed: seeds.has(p) || undefined,
    })),
    // What has already been captured for this topic: the test for "new" material.
    evidence: (() => {
      const cards = [...cited.keys()].map((path) => repo.cards.get(path)?.fm ?? {});
      const latest = (key: string) => cards.map((c) => c[key]).filter((v) => typeof v === "string").sort(compare).at(-1);
      return { cards: cards.length, latest_published_at: latest("published_at"), latest_captured_at: latest("captured_at"),
        urls: cards.map((c) => c.url).filter((u) => typeof u === "string").sort(compare) };
    })(),
    signals: {
      questions: [...members].filter((p) => p.fm.type === "question")
        .map((p) => ({ name: p.name, title: p.fm.title, frontmatter_refs: pointsAt(p.name) })),
      unknown_claims: [...members].flatMap((p) => (p.claims ?? [])
        .filter((c) => object(c) && c.value === "unknown" && !c.retracted)
        .map((c) => ({ id: c.id, page: p.name, attribute: c.attribute, at: c.valid?.at }))),
      not_in_topic: listed ? [...members].filter((p) => p !== navigation && !listed.has(p)).map((p) => p.name).sort(compare) : [],
      related,
      review: [...repo.store.files.keys()]
        .filter((p) => inside(p, repo.layout.paths.review) && p.endsWith(".md"))
        .map((p) => ({ path: p, fm: parsePage(repo.store.read(p), p).fm }))
        .filter(({ fm }) => fm.status === "open" && typeof fm.object === "string" && names.has(fm.object.split("--")[0]))
        .map(({ path, fm }) => ({ path, title: fm.title, object: fm.object })),
    },
  };
}
