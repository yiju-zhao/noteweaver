import { Repo, Patch, patches, parsePage, inside, compare } from "./model";
import { loadRegistry } from "./registry";
import { Checker, refs } from "./check";
import { renderIndexes, renderSchema } from "./render";
import { lift } from "./lift";
import { migrateSources } from "./sources";
export interface Request {
  operation: "check" | "index" | "schema" | "lift" | "sources" | "refs" | "info" | "review";
  base?: string;
  name?: string;
  check?: boolean;
  dryRun?: boolean;
  vault?: string;
}
export interface Result {
  apiVersion: 1;
  code: number;
  data: any;
  changes: Patch[];
}
export function execute(
  repo: Repo,
  request: Request,
  now = new Date().toISOString(),
): Result {
  const done = (data: any, code = 0, changes: Patch[] = []): Result => ({
    apiVersion: 1,
    code,
    data,
    changes,
  });
  if (request.operation === "info")
    return done({ config: repo.layout.config, paths: repo.layout.paths });
  if (request.operation === "review")
    return done(
      [...repo.store.files]
        .filter(
          ([p]) => inside(p, repo.layout.paths.review) && p.endsWith(".md"),
        )
        .map(([p, r]) => ({ p, page: parsePage(r.text!, p) }))
        .filter(({ page }) => page.fm.status === "open")
        .map(({ p, page }) => ({
          path: p,
          title: page.fm.title,
          object: page.fm.object,
        })),
    );
  const bank = repo.layout.paths.bank.slice(
      repo.layout.vault ? repo.layout.vault.length + 1 : 0,
    ),
    reg = loadRegistry(repo.store.read(repo.layout.paths.schema), bank);
  switch (request.operation) {
    case "check": {
      const findings = new Checker(repo, reg)
        .run()
        .sort(
          (a, b) =>
            compare(
              a.severity === "error" ? "0" : "1",
              b.severity === "error" ? "0" : "1",
            ) ||
            compare(a.path, b.path) ||
            a.line - b.line ||
            compare(a.code, b.code),
        );
      const errors = findings.filter((f) => f.severity === "error").length;
      return done(
        {
          errors,
          warnings: findings.length - errors,
          findings,
          pages: repo.allPages().length,
          claims: repo
            .allPages()
            .reduce((n, p) => n + (p.claims?.length || 0), 0),
          cards: repo.cards.size,
        },
        errors ? 1 : 0,
      );
    }
    case "refs":
      if (!request.name) throw new Error("refs requires a page name");
      return done(refs(repo, request.name));
    case "index":
    case "schema": {
      const changes = patches(
        repo.store,
        request.operation === "index"
          ? renderIndexes(repo, reg)
          : renderSchema(repo, reg),
      );
      return done(
        changes.map((p) => p.path),
        request.check && changes.length ? 1 : 0,
        request.check ? [] : changes,
      );
    }
    case "lift": {
      const { stats, changes } = lift(repo, reg, now);
      return done(
        stats,
        stats.conflicts.length ? 1 : 0,
        request.dryRun ? [] : changes,
      );
    }
    case "sources": {
      if (reg.data.formats.sources !== "wikilink")
        throw new Error("set schema formats.sources to wikilink before migrating");
      // Existing instances may contain both formats while resuming an interrupted
      // migration. Validate IDs, cards, footnotes and claims before any write.
      const legacy = { ...reg, data: { ...reg.data, formats: { ...reg.data.formats, sources: undefined } } };
      const errors = new Checker(repo, legacy).run().filter((f) => f.severity === "error");
      if (errors.length) return done({ pages: 0, errors }, 1);
      const changes = migrateSources(repo, now);
      return done({ pages: changes.length, paths: changes.map((p) => p.path), errors: [] }, 0,
        request.dryRun ? [] : changes);
    }
    default:
      throw new Error("unknown Noteweave operation");
  }
}
