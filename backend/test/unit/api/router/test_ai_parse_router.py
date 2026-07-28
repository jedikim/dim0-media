"""Unit tests for POST /ai/parse — PDF → markdown via Mistral OCR.

The Mistral client is faked, so no network and no key are needed; we exercise
the endpoint's file handling, PDF gate, BYOK-key pass-through, and shaping.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

import topix.api.router.ai as ai_module

from topix.api.router.ai import meter_run, router


class _FakeParser:
    """Stand-in for MistralParser: records the api key, returns fixed pages."""

    last_api_key: str | None = None
    num_pages: int = 2  # what get_num_pages reports (drives the page-limit gate)

    def __init__(self, api_key: str | None = None):
        _FakeParser.last_api_key = api_key

    @classmethod
    def from_config(cls):
        return cls(api_key="server-key")

    def get_num_pages(self, filepath) -> int:
        return _FakeParser.num_pages

    async def parse(self, filepath, max_pages: int = 200):
        return [{"markdown": "# Page 1", "page": 0}, {"markdown": "body", "page": 1}]


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(ai_module, "MistralParser", _FakeParser)
    _FakeParser.last_api_key = None
    _FakeParser.num_pages = 2
    app = FastAPI()
    app.include_router(router)

    async def _no_meter():
        return None

    app.dependency_overrides[meter_run] = _no_meter
    return TestClient(app)


def _pdf_file() -> dict:
    return {"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")}


def test_parse_returns_joined_markdown_and_page_count(monkeypatch):
    """A PDF OCRs to markdown (pages joined with a blank line) + a page count."""
    res = _client(monkeypatch).post("/ai/parse", files=_pdf_file())
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["markdown"] == "# Page 1\n\nbody"
    assert data["pages"] == 2


def test_parse_uses_server_key_by_default(monkeypatch):
    """No X-Provider-Key → MistralParser.from_config() (our key)."""
    _client(monkeypatch).post("/ai/parse", files=_pdf_file())
    assert _FakeParser.last_api_key == "server-key"


def test_parse_relays_byok_provider_key(monkeypatch):
    """X-Provider-Key → MistralParser is constructed with the user's key (relayed)."""
    _client(monkeypatch).post("/ai/parse", files=_pdf_file(), headers={"X-Provider-Key": "user-mistral-key"})
    assert _FakeParser.last_api_key == "user-mistral-key"


def test_parse_tolerates_a_page_missing_the_markdown_key(monkeypatch):
    """A page dict without a 'markdown' key contributes '' rather than 500-ing."""
    client = _client(monkeypatch)

    async def _parse_missing(self, filepath, max_pages: int = 200):
        return [{"markdown": "ok", "page": 0}, {"page": 1}]  # 2nd page lacks 'markdown'

    monkeypatch.setattr(_FakeParser, "parse", _parse_missing)
    res = client.post("/ai/parse", files=_pdf_file())
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["markdown"] == "ok\n\n"  # the empty second page joins as ""
    assert data["pages"] == 2


def test_parse_rejects_non_pdf(monkeypatch):
    """A non-PDF upload is a 400 (only PDFs are supported at launch)."""
    res = _client(monkeypatch).post(
        "/ai/parse", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert res.status_code == 400


def test_parse_rejects_oversize_file(monkeypatch):
    """A PDF over the 5 MB byte limit is rejected (413) before OCR."""
    big = b"%PDF-1.4 " + b"x" * (5 * 1024 * 1024)
    res = _client(monkeypatch).post("/ai/parse", files={"file": ("big.pdf", big, "application/pdf")})
    assert res.status_code == 413


def test_parse_rejects_too_many_pages(monkeypatch):
    """A PDF over the 50-page limit is rejected (400) before OCR."""
    client = _client(monkeypatch)  # resets num_pages, so set it after
    _FakeParser.num_pages = 51
    res = client.post("/ai/parse", files=_pdf_file())
    assert res.status_code == 400


def test_parse_accepts_a_pdf_at_the_page_limit(monkeypatch):
    """Exactly 50 pages is allowed (boundary)."""
    client = _client(monkeypatch)
    _FakeParser.num_pages = 50
    res = client.post("/ai/parse", files=_pdf_file())
    assert res.status_code == 200
