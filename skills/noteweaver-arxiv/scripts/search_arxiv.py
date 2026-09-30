#!/usr/bin/env python3
"""Search arXiv Atom metadata with versioned links and shared local throttling.

Adapted from NousResearch/hermes-agent e408d363393ccb72267e67bcccf4f8954b438cd9,
skills/research/arxiv/scripts/search_arxiv.py (MIT; see ../LICENSE).
Python standard library only; Linux/macOS (fcntl advisory lock).
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


API = "https://export.arxiv.org/api/query"
NS = {"a": "http://www.w3.org/2005/Atom",
      "o": "http://a9.com/-/spec/opensearch/1.1/"}
ID = re.compile(r"(?P<base>(?:[0-9]{4}\.[0-9]{4,5}|[A-Za-z][A-Za-z0-9.-]*/[0-9]{7}))(?P<version>v[1-9][0-9]*)?")
MAX_BYTES = 8 * 1024 * 1024


def compact(text):
    return " ".join((text or "").split())


def parse_feed(data):
    """Reject error/HTML responses; preserve full IDs, including legacy IDs."""
    root = ET.fromstring(data)
    if root.tag != "{%s}feed" % NS["a"]:
        raise ValueError("arXiv returned a non-Atom response")
    papers = []
    for entry in root.findall("a:entry", NS):
        raw_id = compact(entry.findtext("a:id", namespaces=NS))
        title = compact(entry.findtext("a:title", namespaces=NS))
        summary = compact(entry.findtext("a:summary", namespaces=NS))
        if title.lower() == "error" or "/api/errors" in raw_id:
            raise ValueError("arXiv API error: " + (summary or raw_id))
        full_id = raw_id.partition("/abs/")[2]
        match = ID.fullmatch(full_id)
        if not match or not title:
            raise ValueError("arXiv entry has no valid ID or title: " + raw_id)
        if not match["version"]:
            raise ValueError("arXiv entry has no version; cannot pin links: " + raw_id)
        papers.append({
            "id": full_id,
            "base_id": match["base"],
            "version": int(match["version"][1:]),
            "title": title,
            "authors": [compact(a.findtext("a:name", namespaces=NS))
                        for a in entry.findall("a:author", NS)],
            "published": entry.findtext("a:published", namespaces=NS),
            "updated": entry.findtext("a:updated", namespaces=NS),
            "summary": summary,
            "categories": [c.attrib["term"] for c in entry.findall("a:category", NS)],
            "abs_url": "https://arxiv.org/abs/" + full_id,
            "pdf_url": "https://arxiv.org/pdf/" + full_id,
        })
    total = root.findtext("o:totalResults", namespaces=NS)
    if total is None:
        raise ValueError("arXiv response is missing totalResults")
    return {"total_results": int(total), "papers": papers}


@contextmanager
def request_slot(state_dir):
    """Serialize local callers; leave >=3 seconds after the previous request."""
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state_dir / "request.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        lock.seek(0)
        previous = lock.read().strip()
        if previous:
            # A corrupt state file fails closed instead of disabling throttling.
            time.sleep(max(0, min(3, 3 - (time.time() - float(previous)))))
        try:
            yield
        finally:
            lock.seek(0)
            lock.truncate()
            lock.write(str(time.time()))
            lock.flush()
            fcntl.flock(lock, fcntl.LOCK_UN)


def retry_delay(header, attempt):
    if not header:
        return 3 * (2 ** attempt)
    try:
        delay = float(header)
    except ValueError:
        delay = parsedate_to_datetime(header).timestamp() - time.time()
    if delay > 60:
        raise ValueError("server requests a wait over 60 seconds; retry later")
    return max(3, delay)


def fetch(url, state_dir, timeout=20):
    """At most three attempts; permanent HTTP failures are reported immediately."""
    request = Request(url, headers={"User-Agent": "noteweaver-arxiv/1.0",
                                   "Accept": "application/atom+xml"})
    for attempt in range(3):
        delay = 3 * (2 ** attempt)
        try:
            with request_slot(state_dir):
                with urlopen(request, timeout=timeout) as response:
                    data = response.read(MAX_BYTES + 1)
                    if len(data) > MAX_BYTES:
                        raise ValueError("arXiv response exceeds 8 MiB; request fewer results")
                    return data
        except HTTPError as error:
            status = error.code
            retry_after = error.headers.get("Retry-After")
            error.close()
            if status not in (429, 500, 502, 503, 504) or attempt == 2:
                raise ValueError(f"arXiv HTTP {status}; no successful result") from error
            delay = retry_delay(retry_after, attempt)
        except (URLError, TimeoutError) as error:
            if attempt == 2:
                raise ValueError(f"arXiv request failed after 3 attempts: {error}") from error
        time.sleep(delay)
    raise AssertionError("unreachable")


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    group = result.add_mutually_exclusive_group(required=True)
    group.add_argument("--query", help='arXiv expression, e.g. all:"diffusion language model"')
    group.add_argument("--ids", help="comma-separated modern or legacy arXiv IDs; vN accepted")
    result.add_argument("--max-results", type=int, default=5, help="1–100 (default: 5)")
    result.add_argument("--start", type=int, default=0)
    result.add_argument("--sort-by", choices=["relevance", "submittedDate", "lastUpdatedDate"],
                        default="relevance")
    result.add_argument("--sort-order", choices=["ascending", "descending"], default="descending")
    result.add_argument("--raw", type=Path, help="save successful Atom bytes to a NEW file")
    result.add_argument("--timeout", type=float, default=20, help="seconds per attempt (1–60)")
    result.add_argument("--state-dir", type=Path,
                        default=Path(tempfile.gettempdir()) / f"noteweaver-arxiv-{os.getuid()}",
                        help="shared local rate-limit state; use the same path across callers")
    return result


def run(args):
    if not 1 <= args.max_results <= 100 or args.start < 0 or not 1 <= args.timeout <= 60:
        raise ValueError("max-results must be 1–100, start >=0, timeout 1–60")
    requested = []
    params = {"max_results": args.max_results, "start": args.start,
              "sortBy": args.sort_by, "sortOrder": args.sort_order}
    if args.ids is not None:
        requested = [item.strip() for item in args.ids.split(",")]
        if any(not ID.fullmatch(item) for item in requested):
            raise ValueError("ids must be comma-separated arXiv IDs, not URLs")
        # ID queries should return all requested IDs, not silently truncate at five.
        if len(requested) > 100 or args.start:
            raise ValueError("ID lookup accepts at most 100 IDs and start=0")
        params.update(id_list=",".join(requested), max_results=len(requested))
    else:
        if not args.query.strip():
            raise ValueError("query must not be empty")
        params["search_query"] = args.query
    if args.raw and args.raw.exists():
        raise ValueError("raw output already exists; choose a new file")
    url = API + "?" + urlencode(params)
    data = fetch(url, args.state_dir, args.timeout)
    captured = datetime.now(timezone.utc).isoformat(timespec="seconds")
    result = parse_feed(data)
    returned = {p["id"] for p in result["papers"]}
    for item in requested:
        match = ID.fullmatch(item)
        if match["version"] and item not in returned:
            same_base = [p for p in result["papers"] if p["base_id"] == match["base"]]
            if same_base:
                raise ValueError("arXiv returned another version for requested ID " + item)
    result["missing_ids"] = [
        item for item in requested
        if not any(item in (p["id"], p["base_id"]) for p in result["papers"])
    ]
    if args.raw:
        with args.raw.open("xb") as handle:
            handle.write(data)
    result.update(query_url=url, captured_at=captured,
                  raw_sha256=hashlib.sha256(data).hexdigest(),
                  raw_path=str(args.raw.resolve()) if args.raw else None)
    return result


def main():
    args = parser().parse_args()
    try:
        result = run(args)
    except (ValueError, OSError, ET.ParseError, KeyError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
