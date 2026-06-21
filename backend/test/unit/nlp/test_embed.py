"""Unit tests for the embedder's per-input token clamping."""

import asyncio

import tiktoken

from topix.nlp import embed as embed_mod
from topix.nlp.embed import MAX_EMBED_TOKENS, OpenAIEmbedder
from topix.nlp.tokens import EMBED_ENCODING

_enc = tiktoken.get_encoding(EMBED_ENCODING)


class _FakeEmbeddings:
    """Captures the `input` it receives and returns matching dummy vectors."""

    def __init__(self):
        self.last_input: list[str] | None = None

    async def create(self, *, model, input, dimensions):
        """Stand in for `client.embeddings.create`, recording the input."""
        self.last_input = input
        data = [type("E", (), {"embedding": [0.0] * dimensions})() for _ in input]
        return type("R", (), {"data": data})()


class _FakeClient:
    """Minimal AsyncOpenAI stand-in exposing `.embeddings.create`."""

    def __init__(self):
        self.embeddings = _FakeEmbeddings()


class TestEmbedderClamping:
    """The embedder must never hand the API an over-limit input."""

    def _embedder(self) -> tuple[OpenAIEmbedder, _FakeClient]:
        embedder = OpenAIEmbedder(api_key="test-key")
        fake = _FakeClient()
        embedder._client = fake
        return embedder, fake

    async def test_oversized_input_is_clamped_before_api_call(self):
        """A >8191-token text reaches the API clamped under MAX_EMBED_TOKENS."""
        embedder, fake = self._embedder()
        huge = "lorem ipsum dolor sit amet " * 5000

        await embedder.embed([huge])

        sent = fake.embeddings.last_input
        assert sent is not None and len(sent) == 1
        assert len(_enc.encode_ordinary(sent[0])) <= MAX_EMBED_TOKENS

    async def test_empty_text_becomes_placeholder(self):
        """Empty strings keep the existing `$` placeholder behaviour."""
        embedder, fake = self._embedder()

        await embedder.embed([""])

        assert fake.embeddings.last_input == ["$"]

    async def test_short_text_passes_through_untouched(self):
        """Normal short text is sent verbatim."""
        embedder, fake = self._embedder()

        await embedder.embed(["The capital of Peru is Lima."])

        assert fake.embeddings.last_input == ["The capital of Peru is Lima."]

    async def test_long_batch_offloads_encode_to_thread(self, monkeypatch):
        """A batch with encode-worthy text runs the fit off the event loop."""
        embedder, _ = self._embedder()
        calls = {"n": 0}
        real = asyncio.to_thread

        async def _spy(fn, *args, **kwargs):
            calls["n"] += 1
            return await real(fn, *args, **kwargs)

        monkeypatch.setattr(embed_mod.asyncio, "to_thread", _spy)
        await embedder.embed(["x" * (MAX_EMBED_TOKENS * 4)])
        assert calls["n"] == 1

    async def test_short_batch_fits_inline(self, monkeypatch):
        """An all-short batch never pays for a thread hop."""
        embedder, _ = self._embedder()
        calls = {"n": 0}

        async def _spy(fn, *args, **kwargs):
            calls["n"] += 1
            return fn(*args, **kwargs)

        monkeypatch.setattr(embed_mod.asyncio, "to_thread", _spy)
        await embedder.embed(["short text", "another short one"])
        assert calls["n"] == 0
