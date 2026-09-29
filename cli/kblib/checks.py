"""kb check: mechanical rules from the JSON vocabulary, registry prose and kb-write.

Each finding carries a code, so agents and CI can filter it. Errors fail the
check; warnings are reported but do not."""

import hashlib
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from . import indexgen, core_bridge
from .evidence_cleanup import approved_deletions
from .lift import liftable, unscoped_direct
from .repo import NOT_PAGES, base_pages, git
from .text import (ACTOR, SLUG, is_timestamp, links, load_yaml, prose_lines,
                   split_frontmatter, YamlError)

CLAIM_KEYS = {"id", "attribute", "value", "unit", "scope", "valid", "basis", "method", "evidence",
              "verified", "retracted", "status"}
IMMUTABLE = ("attribute", "value", "unit", "scope", "valid", "basis", "method")
BASIS = ("direct", "derived", "estimated")
STATUS = ("superseded", "conflicting")
PAGE_STATUS = ("draft", "stable", "deprecated")
GRADES = ("official", "independent", "media", "rumor")
AT = re.compile(r"^L(\d+)(?:-L(\d+))?$")
CLAIM_ID = re.compile(r"^[a-z0-9]+(?:-+[a-z0-9]+)*$")
EVIDENCE_NAME = re.compile(r"^[a-z0-9._-]+$")
PAGE_BYTES = 32 * 1024


@dataclass
class Finding:
    code: str
    severity: str
    path: str
    line: int
    message: str

    def as_dict(self):
        return asdict(self)


class Checker:
    def __init__(self, repo, reg, base="HEAD"):
        self.repo, self.reg, self.base = repo, reg, base
        self.findings = []
        self.special = reg.data["special_values"]
        self.number = re.compile(reg.data["formats"]["quantity"])
        self.wikilink = re.compile(reg.data["formats"]["wikilink"])
        self.times = [re.compile(p) for p in reg.data["formats"]["time"]]

    def add(self, code, path, message, line=0, severity="error"):
        self.findings.append(Finding(code, severity, path, line, message))

    def warn(self, code, path, message, line=0):
        self.add(code, path, message, line, "warning")

    # ------------------------------------------------------------------ driver
    def run(self):
        for p in self.reg.problems:
            self.add("registry", self.repo.layout.rel("schema"), p)
        self.check_pages()
        for f in core_bridge.validate(self.repo, self.reg):
            self.add(f["code"], f["path"], f["message"], 1, f.get("severity", "error"))
        self.check_relations()
        self.check_claims()
        self.check_evidence()
        self.check_index()
        self.check_history()
        return self.findings

    # ------------------------------------------------------------------ pages
    def check_pages(self):
        repo, reg = self.repo, self.reg
        descriptions, resources = {}, {}
        for name, pages in repo.pages.items():
            if len(pages) > 1:
                for p in pages:
                    self.add("page-name-duplicate", p.rel, f"page name {name!r} is used by {len(pages)} files")
        for p in repo.all_pages():
            if not SLUG.match(p.name) or len(p.name) > 60:
                self.add("page-name", p.rel, "page name must be [a-z0-9] words joined by single hyphens, at most 60 characters")
            if p.fm_error:
                self.add("frontmatter", p.rel, p.fm_error, 1)
                continue
            fm = p.fm
            for key in self.reg.data["base_required"]:
                if not fm.get(key):
                    self.add("frontmatter-required", p.rel, f"missing {key!r}", 1)
            self.check_location(p)
            gen = fm.get("generated")
            if gen and (not isinstance(gen, dict) or not ACTOR.match(str(gen.get("by", "")))
                        or not is_timestamp(gen.get("at"))):
                self.add("generated", p.rel, "generated must be {by: <actor>, at: <ISO time with UTC offset>}", 1)
            if "status" in fm and fm["status"] not in PAGE_STATUS:
                self.add("page-status", p.rel, f"status must be one of {', '.join(PAGE_STATUS)}", 1)
            self.check_verified(p.rel, fm.get("verified"), 1, allow_mapping=True)
            if "aliases" in fm and not isinstance(fm["aliases"], list):
                self.add("aliases", p.rel, "aliases must be a list", 1)
            if "tags" in fm:
                self.warn("tags", p.rel, "v1 uses Topic pages, not tags (navigation.md)", 1)
            if fm.get("description"):
                descriptions.setdefault(fm["description"], []).append(p)
            if fm.get("resource"):
                resources.setdefault(fm["resource"], []).append(p)
            if len(p.body.encode("utf-8")) > PAGE_BYTES:
                self.warn("page-size", p.rel, "body is over 32 KB; split the page or read it by section")
            self.check_body(p)
        for kind, table in (("description", descriptions), ("resource", resources)):
            for value, ps in table.items():
                if len(ps) > 1:
                    for p in ps:
                        self.add(f"{kind}-duplicate", p.rel, f"{kind} is shared with "
                                 + ", ".join(q.name for q in ps if q is not p), 1)

    def check_location(self, p):
        t, reg = p.fm.get("type"), self.reg
        if t not in reg.kind_dirs:
            self.add("type", p.rel, f"type must be one of {', '.join(sorted(reg.kind_dirs))}", 1)
            return
        if t == "entity":
            cls = p.fm.get("class")
            if cls not in reg.class_dirs:
                self.add("class", p.rel, f"entity class must be one of {', '.join(sorted(reg.class_dirs))}", 1)
                return
            want = self.repo.bank / "entities" / reg.class_dirs[cls]
        else:
            if "class" in p.fm:
                self.add("class", p.rel, "only entity pages have a class", 1)
            want = self.repo.bank / reg.kind_dirs[t]
        if p.path.parent != want:
            self.add("page-location", p.rel, f"a {t} page belongs in {want.relative_to(self.repo.root).as_posix()}/")

    def resolve(self, page_path, target):
        return Path(os.path.normpath(page_path.parent / target))

    def check_body(self, p):
        """Links, footnotes and sources of one page."""
        repo, fm = self.repo, p.fm
        sources = {}
        raw = fm.get("sources") or []
        if not isinstance(raw, list):
            self.add("sources", p.rel, "sources must be a list", 1)
            raw = []
        for s in raw:
            if not isinstance(s, dict) or not s.get("id") or not s.get("resource"):
                self.add("sources", p.rel, "every sources entry needs id and resource", 1)
                continue
            sid = s["id"]
            if not SLUG.match(sid):
                self.add("sources", p.rel, f"source id {sid!r} must use [a-z0-9-]", 1)
            if sid in sources:
                self.add("sources", p.rel, f"source id {sid!r} appears twice", 1)
            target = self.resolve(p.path, s["resource"])
            sources[sid] = target
            if not self.inside(target, repo.evidence):
                self.add("source-resource", p.rel, f"source {sid!r} must point into the configured evidence directory", 1)
            elif target.relative_to(repo.root).as_posix() not in repo.cards:
                what = "an evidence original, not its card" if target.exists() else "a missing file"
                self.add("source-resource", p.rel, f"source {sid!r} points at {what}", 1)
        p.sources = sources

        used, defined = set(), {}
        for i, line in prose_lines(p.body):
            n = p.body_line + i
            if "[[" in line:
                self.add("wikilink", p.rel, "use relative Markdown links, not [[wikilinks]] ", n)
            m = re.match(r"^\[\^([^\]]+)\]:\s*(.*)$", line)
            if m:
                defined[m.group(1)] = (m.group(2), n)
            for ref in re.findall(r"\[\^([^\]]+)\](?!:)", line):
                used.add(ref)
            for target in links(line):
                path = self.resolve(p.path, target)
                p.prose_targets.add(path)
                if not path.exists():
                    self.add("link-broken", p.rel, f"link target {target!r} does not exist", n)
                elif not (self.inside(path, repo.bank) or self.inside(path, repo.evidence)):
                    self.add("link-outside", p.rel, f"link {target!r} leaves the bank and evidence directories", n)
        for ref in sorted(used):
            if ref not in sources:
                self.add("footnote", p.rel, f"footnote [^{ref}] has no sources entry")
            if ref not in defined:
                self.add("footnote", p.rel, f"footnote [^{ref}] has no definition line")
        for ref, (text, n) in defined.items():
            if ref not in sources:
                self.add("footnote", p.rel, f"footnote definition [^{ref}] has no sources entry", n)
                continue
            targets = links(text)
            if not targets or self.resolve(p.path, targets[0]) != sources[ref]:
                self.add("footnote", p.rel, f"footnote [^{ref}] must link to the same card as its sources entry", n)
        p.footnotes = used
        if fm.get("type") in ("topic", "question") and p.claims is not None:
            self.add("claims-kind", p.rel, f"{fm['type']} pages carry no claims", p.claims_line)
        if fm.get("type") == "topic" and (used or sources):
            self.add("topic", p.rel, "topic pages only link; no footnotes or sources")

    @staticmethod
    def inside(path, directory):
        try:
            path.relative_to(directory)
            return True
        except ValueError:
            return False

    def check_verified(self, rel, value, line, allow_mapping=False):
        if value is None:
            return
        if allow_mapping and isinstance(value, dict):
            value = [value]
        if not isinstance(value, list):
            self.add("verified", rel, "verified must be a list of {by, at}", line)
            return
        for v in value:
            if not isinstance(v, dict) or not ACTOR.match(str(v.get("by", ""))) or not is_timestamp(v.get("at")):
                self.add("verified", rel, "every verified entry is {by: <actor>, at: <ISO time with UTC offset>}", line)

    # ------------------------------------------------------------------ frontmatter schema

    def check_relations(self):
        """Paired frontmatter fields encode the same edge, not two independent facts."""
        for p in self.repo.all_pages():
            if p.fm_error:
                continue
            for key, value in p.fm.items():
                term = self.reg.terms.get(key)
                if not term or not term.counterpart or not self.allowed(term.subject, p):
                    continue
                values = value if isinstance(value, list) else [value]
                if len(values) > 1 and any(isinstance(v, str) and v in self.special for v in values):
                    self.add('relation-sync', p.rel, f'{key}: unknown/none cannot be mixed with other values', 1)
                for value in values:
                    m = self.wikilink.match(value) if isinstance(value, str) else None
                    target = self.repo.page(m.group(1)) if m else None
                    if target is None or not self.allowed(term.object, target, subject=p):
                        continue
                    other = target.fm.get(term.counterpart, [])
                    other = other if isinstance(other, list) else [other]
                    if f'[[{p.name}]]' not in other:
                        self.add('relation-stale', p.rel,
                                 f'{key}: {target.name}.{term.counterpart} is missing [[{p.name}]]; '
                                 'run kb-types: 同步全库双向关系 in Obsidian', 1)

    # ------------------------------------------------------------------ claims
    def check_claims(self):
        ids = {}
        for p in self.repo.all_pages():
            if p.claims is None:
                continue
            if p.claims_error:
                self.add("claims-block", p.rel, p.claims_error, p.claims_line)
            used_sources = set()
            for c in p.claims:
                if not isinstance(c, dict):
                    self.add("claim", p.rel, "every claim is a mapping", p.claims_line)
                    continue
                cid = c.get("id", "")
                ids.setdefault(cid, []).append(p)
                self.check_claim(p, c, used_sources)
            unused = set(p.sources) - used_sources - p.footnotes
            for sid in sorted(unused):
                self.warn("source-unused", p.rel, f"source {sid!r} is cited by no footnote and no claim", 1)
        for cid, ps in ids.items():
            if cid and len(ps) > 1:
                for p in ps:
                    self.add("claim-id-duplicate", p.rel, f"claim id {cid!r} appears {len(ps)} times in the bank")
        for p in self.repo.all_pages():
            if p.claims is None and p.sources:
                unused = set(p.sources) - p.footnotes
                for sid in sorted(unused):
                    self.warn("source-unused", p.rel, f"source {sid!r} is cited by no footnote and no claim", 1)

    def check_claim(self, p, c, used_sources):
        rel, line = p.rel, p.claims_line
        cid = c.get("id", "")
        where = f"claim {cid or '(no id)'}"
        for key in sorted(set(c) - CLAIM_KEYS):
            self.add("claim-field", rel, f"{where}: unknown field {key!r}", line)
        for key in ("id", "attribute", "value", "basis", "evidence"):
            if c.get(key) in (None, "", []):
                self.add("claim-required", rel, f"{where}: missing {key!r}", line)
        if cid and not CLAIM_ID.match(cid):
            self.add("claim-id", rel, f"{where}: id must use [a-z0-9-]", line)
        basis = c.get("basis")
        if basis and basis not in BASIS:
            self.add("claim-basis", rel, f"{where}: basis must be one of {', '.join(BASIS)}", line)
        if "status" in c:
            if c["status"] not in STATUS:
                self.add("claim-status", rel, f"{where}: status must be one of {', '.join(STATUS)}", line)
            else:
                self.warn("claim-status", rel, f"{where}: status is written only by kb, which does not judge it yet", line)
        term = self.reg.terms.get(c.get("attribute"))
        if term and term.inverse_of:
            term = None
        if c.get("attribute") and term is None:
            self.add("claim-attribute", rel, f"{where}: attribute {c['attribute']!r} is not in attributes.md", line)
        elif term:
            self.check_subject(p, term, where, line)
        value = c.get("value")
        if term and value not in (None, ""):
            self.check_value(p, c, term, value, where, line)
        if c.get("method") not in (None, ""):
            target = self.repo.page(c["method"])
            if target is None:
                self.add("claim-method", rel, f"{where}: method page {c['method']!r} does not exist", line)
            elif target.fm.get("type") not in ("method", "analysis"):
                self.add("claim-method", rel, f"{where}: method must name a Method or Analysis page", line)
        attr = c.get("attribute")
        if attr in p.fm and unscoped_direct(self.reg, c):
            self.add("fm-duplicate", rel, f"{where}: {attr!r} is in frontmatter and in claims; keep one place", line)
        elif liftable(self.reg, c):
            self.warn("claim-place", rel, f"{where}: unscoped direct value; kb lift moves it into frontmatter", line)
        self.check_valid(p, c, where, line)
        self.check_scope(p, c, where, line)
        self.check_evidence_refs(p, c, where, line, used_sources)
        self.check_verified(rel, c.get("verified"), line)
        r = c.get("retracted")
        if r is not None:
            if not isinstance(r, dict) or not r.get("reason") or not ACTOR.match(str(r.get("by", ""))) \
                    or not is_timestamp(r.get("at")):
                self.add("claim-retracted", rel, f"{where}: retracted needs reason, by and at", line)
            elif r.get("replaced_by") and not any(r["replaced_by"] == x.get("id") for q in self.repo.all_pages()
                                                  for x in (q.claims or []) if isinstance(x, dict)):
                self.add("claim-retracted", rel, f"{where}: replaced_by {r['replaced_by']!r} is no claim id", line)

    def page_classes(self, page):
        return page.fm.get("type"), page.fm.get("class")

    def allowed(self, spec, page, subject=None):
        if not spec:
            return True
        t, cls = self.page_classes(page)
        for kind, classes in spec:
            if kind != t:
                continue
            if classes is None:
                return True
            if classes == "SAME":
                return subject is not None and cls == subject.fm.get("class")
            if cls in classes:
                return True
        return False

    def check_subject(self, p, term, where, line):
        if not self.allowed(term.subject, p):
            self.add("claim-subject", p.rel, f"{where}: a {p.fm.get('type')} page cannot carry {term.key!r}", line)

    def check_value(self, p, c, term, value, where, line):
        rel = p.rel
        unit = c.get("unit")
        if value in self.special:
            if unit and term.vtype != "quantity":
                self.add("claim-unit", rel, f"{where}: only quantities have a unit", line)
            return
        if term.vtype == "page":
            target = self.repo.page(value) if isinstance(value, str) else None
            if target is None:
                self.add("claim-page-ref", rel, f"{where}: value {value!r} names no page", line)
                return
            if not self.allowed(term.object, target, subject=p):
                self.add("claim-object", rel, f"{where}: {term.key!r} cannot point at a "
                         f"{target.fm.get('type')} {target.fm.get('class') or ''}".rstrip(), line)
            if target.path not in p.prose_targets:
                self.add("relation-link", rel, f"{where}: the body must also link to {value}.md", line)
        elif term.vtype == "quantity":
            if not self.quantity(value, c.get("method")):
                self.add("claim-value", rel, f"{where}: a quantity is a number such as 8.02B or "
                         "{low, mid, high, p}; this estimate needs all four when kb itself made it", line)
            if not unit:
                self.add("claim-unit", rel, f"{where}: quantities need a unit", line)
            elif unit not in self.reg.units:
                self.add("claim-unit", rel, f"{where}: unit {unit!r} is not in units.md", line)
            elif term.unit and self.reg.units[unit] != self.reg.units.get(term.unit):
                self.add("claim-unit", rel, f"{where}: unit {unit!r} is not a {self.reg.units.get(term.unit)} unit", line)
        elif term.vtype == "time":
            ok = self.is_time(value) or (isinstance(value, dict) and set(value) <= {"low", "high"} and value
                                    and all(self.is_time(v) for v in value.values()))
            if not ok:
                self.add("claim-value", rel, f"{where}: a time is ISO 8601 (2025, 2025-02, 2025-02-14, or a "
                         "timestamp with offset) or {low, high}", line)
        elif term.vtype in ("enum", "boolean"):
            if value not in term.values:
                self.add("claim-value", rel, f"{where}: {value!r} is not a listed value of {term.key!r}", line)
        if unit and term.vtype != "quantity":
            self.add("claim-unit", rel, f"{where}: only quantities have a unit", line)

    def is_time(self, value):
        return isinstance(value, str) and any(pattern.match(value) for pattern in self.times)

    def quantity(self, value, method):
        if isinstance(value, str):
            return bool(self.number.match(value))
        if not isinstance(value, dict) or not value or not set(value) <= {"low", "mid", "high", "p"}:
            return False
        if "low" not in value and "high" not in value:
            return False
        for k, v in value.items():
            if not isinstance(v, str) or not self.number.match(v):
                return False
        if "p" in value:
            try:
                if not 0 < float(value["p"]) <= 1:
                    return False
            except ValueError:
                return False
        if method and set(value) != {"low", "mid", "high", "p"}:
            return False
        return True

    def check_valid(self, p, c, where, line):
        v = c.get("valid")
        if v is None:
            if c.get("value") == "unknown":
                self.add("claim-valid", p.rel, f"{where}: an unknown value needs valid.at", line)
            return
        ok = isinstance(v, dict) and v and set(v) <= {"at", "from", "until"} \
            and not ("at" in v and ({"from", "until"} & set(v))) and all(self.is_time(x) for x in v.values())
        if not ok:
            self.add("claim-valid", p.rel, f"{where}: valid is {{at}} or {{from, until}} with ISO times", line)
        elif c.get("value") == "unknown" and "at" not in v:
            self.add("claim-valid", p.rel, f"{where}: an unknown value needs valid.at", line)

    def check_scope(self, p, c, where, line):
        s = c.get("scope")
        if s is None:
            return
        if not isinstance(s, dict) or not s:
            self.add("claim-scope", p.rel, f"{where}: scope is a mapping of scope keys", line)
            return
        for key, value in s.items():
            vt = self.reg.scope_keys.get(key)
            if vt is None:
                self.add("claim-scope", p.rel, f"{where}: scope key {key!r} is not in attributes.md", line)
            elif vt == "page" and self.repo.page(value) is None:
                self.add("claim-scope", p.rel, f"{where}: scope {key} names no page {value!r}", line)

    def check_evidence_refs(self, p, c, where, line, used_sources):
        ev = c.get("evidence")
        if ev in (None, "", []):
            return
        if not isinstance(ev, list):
            self.add("claim-evidence", p.rel, f"{where}: evidence is a list", line)
            return
        for e in ev:
            if not isinstance(e, dict) or not e.get("source") or set(e) - {"source", "at"}:
                self.add("claim-evidence", p.rel, f"{where}: every evidence entry is {{source, at}}", line)
                continue
            sid = e["source"]
            used_sources.add(sid)
            target = p.sources.get(sid)
            if target is None:
                self.add("claim-evidence", p.rel, f"{where}: evidence source {sid!r} is not in sources", line)
                continue
            card = self.repo.cards.get(target.relative_to(self.repo.root).as_posix()) \
                if self.inside(target, self.repo.root) else None
            if "at" not in e:
                continue
            spans = [AT.match(s.strip()) for s in str(e["at"]).split(",")]
            if not all(spans):
                self.add("claim-evidence", p.rel, f"{where}: at is line numbers such as L212-L218,L230", line)
                continue
            if card is None:
                continue
            view = self.text_view(card)
            if view is None:
                self.add("claim-evidence", p.rel, f"{where}: {sid!r} has no text view (URL-only evidence takes no at)", line)
                continue
            n = view.count("\n") + (0 if view.endswith("\n") else 1)
            for m in spans:
                a, b = int(m.group(1)), int(m.group(2) or m.group(1))
                if a < 1 or b < a or b > n:
                    self.add("claim-evidence", p.rel, f"{where}: {m.group(0)} is outside the {n} lines of {sid!r}", line)

    def text_view(self, card):
        """Text of the file line numbers refer to: the card if it carries text, else the original."""
        if card.body.strip():
            return card.path.read_text(encoding="utf-8", errors="replace")
        if not card.original.exists():
            return None
        try:
            return card.original.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            return None

    # ------------------------------------------------------------------ evidence
    def check_evidence(self):
        repo = self.repo
        # check_pages has resolved both sources and prose links. Index/log and
        # migration bookkeeping are deliberately absent from repo.all_pages().
        referenced = set()
        for page in repo.all_pages():
            referenced.update(page.sources.values())
            referenced.update(page.prose_targets)
        for rel in repo.originals:
            path = repo.root / rel
            if f"{rel}.md" not in repo.cards:
                self.add("evidence-card-missing", rel, "every evidence original needs a card named <original>.md")
            self.check_evidence_place(rel, path)
        for rel, card in repo.cards.items():
            if card.path not in referenced and card.original not in referenced:
                self.warn("evidence-unreferenced", rel,
                          "no bank content page references this evidence card or its original", 1)
            self.check_evidence_place(rel, card.path)
            if card.fm_error:
                self.add("evidence-card", rel, card.fm_error, 1)
                continue
            fm, has_original = card.fm, card.original.exists()
            kind = fm.get("type")
            top = rel.split("/")[2]
            if (top, kind) not in (("sources", "source"), ("records", "record")):
                self.add("evidence-card", rel, f"a {kind} card does not belong under {top}/", 1)
            required = ["type", "title"]
            if kind == "source":
                required += ["publisher", "grade"]
                if has_original:
                    required += ["captured_at", "sha256"]
                elif not fm.get("url"):
                    self.add("evidence-card", rel, "a card without an original needs a url", 1)
                if fm.get("grade") and fm["grade"] not in GRADES:
                    self.add("evidence-card", rel, f"grade must be one of {', '.join(GRADES)}", 1)
                if fm.get("published_at") and not self.is_time(fm["published_at"]):
                    self.add("evidence-card", rel, "published_at must be an ISO date", 1)
                if fm.get("captured_at") and not is_timestamp(fm["captured_at"]):
                    self.add("evidence-card", rel, "captured_at needs a time with UTC offset", 1)
            else:
                required += ["observed_at", "by", "sha256"]
                if fm.get("observed_at") and not is_timestamp(fm["observed_at"]):
                    self.add("evidence-card", rel, "observed_at needs a time with UTC offset", 1)
                if fm.get("by") and not ACTOR.match(fm["by"]):
                    self.add("evidence-card", rel, "by must be an actor such as human:<id>", 1)
                if not has_original:
                    self.add("evidence-card", rel, "a record card needs its original", 1)
            for key in required:
                if not fm.get(key):
                    self.add("evidence-card", rel, f"missing {key!r}", 1)
            if card.body.strip() and not fm.get("extracted_by"):
                self.add("evidence-card", rel, "a card with extracted text needs extracted_by", 1)
            if has_original and fm.get("sha256"):
                digest = hashlib.sha256(card.original.read_bytes()).hexdigest()
                if digest != fm["sha256"]:
                    self.add("evidence-sha256", rel, "sha256 does not match the original", 1)
            if has_original and not card.body.strip() and self.text_view(card) is None:
                self.add("evidence-card", rel, "the original is not plain text, so the card needs extracted text", 1)

    def check_evidence_place(self, rel, path):
        parts = rel.split("/")
        ok = len(parts) == 5 and (
            (parts[2] == "sources" and re.match(r"^[a-z0-9.-]+$", parts[3]))
            or (parts[2] == "records" and re.match(r"^\d{4}-\d{2}$", parts[3])))
        if not ok:
            self.add("evidence-place", rel, "evidence lives in sources/<host>/ or records/<YYYY-MM>/")
        name = path.name[:-3] if rel in self.repo.cards else path.name
        if not EVIDENCE_NAME.match(name):
            self.add("evidence-name", rel, "evidence file names use only [a-z0-9._-]")

    # ------------------------------------------------------------------ index and log
    def check_index(self):
        for rel, content in indexgen.build(self.repo, self.reg).items():
            path = self.repo.root / rel
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                self.add("index-stale", rel, "differs from its generated form; run kb index")
        self.check_vocab()
        for rel in tuple(f"{self.repo.layout.rel('bank')}/{p}" for p in ("index.md", "entities/index.md", "log.md")):
            if not (self.repo.root / rel).exists():
                self.add("index-missing", rel, "file is missing")
        log = self.repo.root / f"{self.repo.layout.rel('bank')}/log.md"
        if log.exists():
            dates = re.findall(r"^## (\S+)", log.read_text(encoding="utf-8"), re.M)
            if any(not re.match(r"^\d{4}-\d{2}-\d{2}$", d) for d in dates) or dates != sorted(dates, reverse=True):
                self.warn("log-order", f"{self.repo.layout.rel('bank')}/log.md", "date headings are ## YYYY-MM-DD, newest first")
            for i, line in prose_lines(log.read_text(encoding="utf-8")):
                for target in links(line):
                    path = self.resolve(log, target)
                    if not (self.inside(path, self.repo.bank) or self.inside(path, self.repo.evidence)):
                        self.add("link-outside", f"{self.repo.layout.rel('bank')}/log.md",
                                 f"link {target!r} leaves the bank and evidence directories; write the path in backticks ", i + 1)
                    elif not path.exists():
                        self.add("link-broken", f"{self.repo.layout.rel('bank')}/log.md", f"link target {target!r} does not exist", i + 1)

    def check_vocab(self):
        """The human-readable vocabulary must match the JSON source of truth."""
        from . import schema
        for rel, reason in schema.stale(self.repo.root, self.reg).items():
            self.add("vocab-stale", rel, reason)

    # ------------------------------------------------------------------ against the base revision
    REGRADABLE = {"grade", "publisher"}

    def _card_regraded(self, base, rel):
        """True when a card changed only in its reviewable judgment fields."""
        if not rel.endswith(".md"):
            return False
        try:
            old = git(self.repo.root, "show", f"{base}:{rel}")
            new = (self.repo.root / rel).read_text(encoding="utf-8")
            old_fm, old_body, _ = split_frontmatter(old)
            new_fm, new_body, _ = split_frontmatter(new)
            if old_fm is None or new_fm is None or old_body != new_body:
                return False
            old_d, new_d = load_yaml(old_fm) or {}, load_yaml(new_fm) or {}
        except (RuntimeError, OSError, YamlError):
            return False
        if old_d.get("type") not in ("source", "record"):
            return False
        keys = set(old_d) | set(new_d)
        return all(old_d.get(k) == new_d.get(k) for k in keys - self.REGRADABLE)

    def _promoted(self, rel, claim):
        """True when kb lift moved this claim's value into that page's frontmatter."""
        value = claim.get("value")
        if not isinstance(value, str):
            return False
        for p in self.repo.pages.get(Path(rel).stem, []):
            if p.rel != rel:
                continue
            fm = p.fm.get(claim.get("attribute"))
            vals = fm if isinstance(fm, list) else [fm]
            stripped = [(self.wikilink.match(v).group(1) if isinstance(v, str) and self.wikilink.match(v) else v)
                        for v in vals]
            return value in stripped
        return False

    def check_history(self):
        root, base = self.repo.root, self.base
        try:
            git(root, "rev-parse", "--verify", f"{base}^{{commit}}")
        except (RuntimeError, FileNotFoundError):
            self.warn("history-skipped", ".", f"no git revision {base!r}; append-only rules not checked")
            return
        changed = git(root, "diff", "--name-status", "--no-renames", base, "--", self.repo.layout.vault.relative_to(root).as_posix()).splitlines()
        deleted = {row.split("\t", 1)[1] for row in changed if row.startswith("D\t")}
        references = {target for p in self.repo.all_pages()
                      for target in (*p.sources.values(), *p.prose_targets)}
        approved = approved_deletions(self.repo, base, deleted, references)
        bank_changed = False
        log_changed = False
        for row in changed:
            status, rel = row.split("\t", 1)
            if rel.startswith(self.repo.layout.rel("evidence") + "/") and status != "A":
                if status == "D" and rel in approved:
                    pass
                elif status == "M" and self._card_regraded(base, rel):
                    self.warn("evidence-card-regraded", rel, "card grade/publisher changed after review; log it")
                else:
                    self.add("evidence-append-only", rel, f"evidence is never modified or deleted (git status {status})")
            if rel == f"{self.repo.layout.rel('bank')}/log.md":
                log_changed = True
            elif rel.startswith(self.repo.layout.rel("bank") + "/") and rel.endswith(".md") and rel.rsplit("/", 1)[-1] not in NOT_PAGES:
                bank_changed = True
        untracked = git(root, "ls-files", "--others", "--exclude-standard", "--", self.repo.layout.rel("bank"))
        if any(r.endswith(".md") and r.rsplit("/", 1)[-1] not in NOT_PAGES for r in untracked.splitlines()):
            bank_changed = True
        if bank_changed and not log_changed:
            self.warn("log-missing", f"{self.repo.layout.rel('bank')}/log.md", "pages changed but log.md has no new entry")

        old = {}
        for rel, page in base_pages(root, base).items():
            for c in page.claims or []:
                if isinstance(c, dict) and c.get("id"):
                    old[c["id"]] = (rel, c)
        now = {}
        for p in self.repo.all_pages():
            for c in p.claims or []:
                if isinstance(c, dict) and c.get("id"):
                    now[c["id"]] = (p.rel, c)
        for cid, (rel, c) in old.items():
            if cid not in now:
                if (root / rel).exists():
                    if self._promoted(rel, c):
                        continue
                    self.add("claim-deleted", rel, f"claim {cid!r} was deleted; claims are only retracted")
                else:
                    self.warn("claim-deleted", rel, f"claim {cid!r} left with its page")
                continue
            new_rel, n = now[cid]
            for key in IMMUTABLE:
                if c.get(key) != n.get(key):
                    self.add("claim-immutable", new_rel, f"claim {cid!r}: {key} changed; write a new claim and retract this one")
            for key in ("evidence", "verified"):
                a, b = c.get(key) or [], n.get(key) or []
                if isinstance(a, list) and isinstance(b, list) and b[:len(a)] != a:
                    self.add("claim-immutable", new_rel, f"claim {cid!r}: {key} may only be appended to")
            if c.get("retracted") is not None and c.get("retracted") != n.get("retracted"):
                self.add("claim-immutable", new_rel, f"claim {cid!r}: retracted cannot change once written")
