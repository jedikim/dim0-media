"""Unit tests for token-aware embedding-input truncation."""

import tiktoken

from topix.nlp import tokens as tokens_mod
from topix.nlp.tokens import EMBED_ENCODING, truncate_to_tokens

_enc = tiktoken.get_encoding(EMBED_ENCODING)


def _ntokens(text: str) -> int:
    """Count tokens the same way the embedding API does."""
    return len(_enc.encode_ordinary(text))


class TestTruncateToTokens:
    """Behaviour of `truncate_to_tokens` across content types."""

    def test_short_text_passes_through_unchanged(self):
        """Text already under the cap is returned byte-for-byte."""
        text = "The capital of Peru is Lima."
        assert truncate_to_tokens(text, 8000) == text

    def test_empty_text_passes_through(self):
        """Empty input is returned as-is (no crash, no encoder work)."""
        assert truncate_to_tokens("", 8000) == ""

    def test_text_at_limit_unchanged(self):
        """Text exactly at the cap is not truncated."""
        text = "word " * 100
        cap = _ntokens(text)
        assert truncate_to_tokens(text, cap) == text

    def test_long_english_truncated_within_cap(self):
        """A long English string is clipped to at most `max_tokens`."""
        text = "Photosynthesis turns sunlight into sugar. " * 1000
        out = truncate_to_tokens(text, 500)
        assert len(out) < len(text)
        assert _ntokens(out) <= 500

    def test_long_code_truncated_within_cap(self):
        """Dense code (low chars/token) still lands inside the cap."""
        text = "const x = useState<number>(0);\n" * 2000
        out = truncate_to_tokens(text, 500)
        assert _ntokens(out) <= 500

    def test_long_cjk_truncated_within_cap(self):
        """CJK (high tokens/char) is the case char-based truncation misses."""
        text = "光合作用把阳光转化为糖分并释放氧气。" * 2000
        out = truncate_to_tokens(text, 500)
        assert _ntokens(out) <= 500

    def test_realistic_overflow_fits_embed_limit(self):
        """A message larger than the 8191 limit is brought under 8000 tokens."""
        text = "lorem ipsum dolor sit amet " * 5000
        assert _ntokens(text) > 8191
        out = truncate_to_tokens(text, 8000)
        assert _ntokens(out) <= 8000

    def test_short_text_skips_the_encoder(self, monkeypatch):
        """Text within the O(1) fast-path window never touches the BPE encoder."""
        def _boom():
            raise AssertionError("encoder must not load for short text")

        monkeypatch.setattr(tokens_mod, "_encoder", _boom)
        text = "x" * (8000 // 4)  # at the fast-path boundary
        assert truncate_to_tokens(text, 8000) == text
