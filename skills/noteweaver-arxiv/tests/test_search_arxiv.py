"""Regression checks for reproducible paper discovery; no live API calls."""
from contextlib import nullcontext
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
import xml.etree.ElementTree as ET


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "search_arxiv.py"
spec = importlib.util.spec_from_file_location("search_arxiv", SCRIPT)
arxiv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arxiv)


def feed(ids=("2502.09992v3",), total=None):
    entries = "".join(
        f"""<entry><id>http://arxiv.org/abs/{paper}</id>
        <title>Full paper title</title><summary>{'abstract ' * 60}</summary>
        <author><name>Example Author</name></author><category term="cs.CL"/>
        <published>2025-02-14T00:00:00Z</published>
        <updated>2025-06-01T12:00:00Z</updated></entry>""" for paper in ids)
    count = len(ids) if total is None else total
    return f"""<feed xmlns="http://www.w3.org/2005/Atom"
        xmlns:o="http://a9.com/-/spec/opensearch/1.1/">
        <o:totalResults>{count}</o:totalResults>{entries}</feed>""".encode()


class PaperTests(unittest.TestCase):
    def test_modern_and_legacy_versions_survive_in_both_links(self):
        papers = arxiv.parse_feed(feed(("2502.09992v3", "hep-th/9901001v1",
                                       "math.GT/0309136v2")))["papers"]
        for paper in papers:
            self.assertTrue(paper["abs_url"].endswith(paper["id"]))
            self.assertTrue(paper["pdf_url"].endswith(paper["id"]))
            self.assertGreater(len(paper["summary"]), 300)
            self.assertNotEqual(paper["published"], paper["updated"])
        self.assertEqual(papers[1]["base_id"], "hep-th/9901001")
        self.assertEqual(papers[2]["version"], 2)

    def test_empty_result_is_distinct_from_error_and_html(self):
        self.assertEqual(arxiv.parse_feed(feed(()))["papers"], [])
        bad = feed().replace(b"Full paper title", b"Error")
        for body in (bad, b"<html>Blocked</html>", b"<feed>"):
            with self.subTest(body=body[:30]):
                with self.assertRaises((ValueError, ET.ParseError)):
                    arxiv.parse_feed(body)
        with self.assertRaisesRegex(ValueError, "no version"):
            arxiv.parse_feed(feed(("2502.09992",)))

    def test_query_encoding_and_pagination(self):
        args = arxiv.parser().parse_args([
            "--query", 'au:"Yann LeCun" AND cat:cs.LG', "--start", "10",
            "--max-results", "7", "--sort-by", "submittedDate"])
        with patch.object(arxiv, "fetch", return_value=feed(())) as fetch:
            arxiv.run(args)
        query = parse_qs(urlsplit(fetch.call_args.args[0]).query)
        self.assertEqual(query["search_query"], [args.query])
        self.assertEqual(query["start"], ["10"])
        self.assertEqual(query["sortBy"], ["submittedDate"])

    def test_id_lookup_reports_missing_and_does_not_truncate_at_five(self):
        ids = [f"2502.0999{i}v1" for i in range(7)]
        args = arxiv.parser().parse_args(["--ids", ",".join(ids)])
        with patch.object(arxiv, "fetch", return_value=feed(ids[:6])) as fetch:
            result = arxiv.run(args)
        query = parse_qs(urlsplit(fetch.call_args.args[0]).query)
        self.assertEqual(query["max_results"], ["7"])
        self.assertEqual(result["missing_ids"], ids[6:])

    def test_requested_version_cannot_silently_become_latest(self):
        args = arxiv.parser().parse_args(["--ids", "2502.09992v1"])
        with patch.object(arxiv, "fetch", return_value=feed()):
            with self.assertRaisesRegex(ValueError, "another version"):
                arxiv.run(args)

    def test_raw_response_is_exact_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            raw = Path(temp) / "response.xml"
            args = arxiv.parser().parse_args(["--ids", "2502.09992v3", "--raw", str(raw)])
            with patch.object(arxiv, "fetch", return_value=feed()) as fetch:
                result = arxiv.run(args)
                self.assertEqual(raw.read_bytes(), feed())
                self.assertEqual(len(result["raw_sha256"]), 64)
                with self.assertRaisesRegex(ValueError, "already exists"):
                    arxiv.run(args)
                self.assertEqual(fetch.call_count, 1)
                self.assertEqual(raw.read_bytes(), feed())

    def test_invalid_ids_and_limits_fail_before_network(self):
        for flags in (["--ids", "https://arxiv.org/abs/2502.09992v3"],
                      ["--ids", ""],
                      ["--ids", "2502.09992v3", "--start", "1"],
                      ["--query", "test", "--max-results", "0"]):
            with self.subTest(flags=flags), patch.object(arxiv, "fetch") as fetch:
                with self.assertRaises(ValueError):
                    arxiv.run(arxiv.parser().parse_args(flags))
                fetch.assert_not_called()


class RequestTests(unittest.TestCase):
    def test_rate_state_is_shared_between_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp)
            with patch.object(arxiv.time, "time", return_value=100):
                with arxiv.request_slot(state):
                    pass
            with patch.object(arxiv.time, "time", return_value=101):
                with patch.object(arxiv.time, "sleep") as sleep:
                    with arxiv.request_slot(state):
                        pass
                    sleep.assert_called_once_with(2)
            self.assertEqual((state / "request.lock").read_text(), "101")

    def test_permanent_failure_is_not_an_empty_result_or_retried(self):
        error = HTTPError(arxiv.API, 406, "unavailable", {}, io.BytesIO())
        with patch.object(arxiv, "request_slot", return_value=nullcontext()):
            with patch.object(arxiv, "urlopen", side_effect=error) as request:
                with self.assertRaisesRegex(ValueError, "HTTP 406"):
                    arxiv.fetch(arxiv.API, Path("/unused"))
                self.assertEqual(request.call_count, 1)

    def test_429_retries_then_returns_successful_bytes(self):
        error = HTTPError(arxiv.API, 429, "slow down", {"Retry-After": "5"}, io.BytesIO())
        with patch.object(arxiv, "request_slot", side_effect=lambda _: nullcontext()):
            with patch.object(arxiv.time, "sleep") as sleep:
                with patch.object(arxiv, "urlopen",
                                  side_effect=[error, io.BytesIO(feed())]) as request:
                    self.assertEqual(arxiv.fetch(arxiv.API, Path("/unused")), feed())
                    self.assertEqual(request.call_count, 2)
                    sleep.assert_called_once_with(5)

    def test_transient_failures_have_a_finite_attempt_budget(self):
        def fail(*args, **kwargs):
            raise HTTPError(arxiv.API, 503, "unavailable", {}, io.BytesIO())
        with patch.object(arxiv, "request_slot", side_effect=lambda _: nullcontext()):
            with patch.object(arxiv.time, "sleep"):
                with patch.object(arxiv, "urlopen", side_effect=fail) as request:
                    with self.assertRaisesRegex(ValueError, "HTTP 503"):
                        arxiv.fetch(arxiv.API, Path("/unused"))
                    self.assertEqual(request.call_count, 3)

    def test_long_retry_after_reports_when_to_retry_instead_of_retrying_early(self):
        with self.assertRaisesRegex(ValueError, "retry later"):
            arxiv.retry_delay("120", 0)


if __name__ == "__main__":
    unittest.main()
