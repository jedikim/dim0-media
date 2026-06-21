"""Token-aware helpers for keeping embedding inputs under model limits."""

import tiktoken

# `cl100k_base` is the encoding used by the `text-embedding-3-*` models, so
# truncating with it matches how the embedding API counts input tokens.
EMBED_ENCODING = "cl100k_base"

_enc: tiktoken.Encoding | None = None


def _encoder() -> tiktoken.Encoding:
    """Return a process-wide singleton encoder, loading it once on first use.

    The BPE vocab load costs ~1s, so it must never run per call. It's lazy
    rather than import-time so importing this module stays cheap and free of a
    network/disk dependency until something actually embeds.
    """
    global _enc
    if _enc is None:
        _enc = tiktoken.get_encoding(EMBED_ENCODING)
    return _enc


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """Truncate `text` to at most `max_tokens` tokens under the embed encoding.

    Returns the text unchanged when it already fits. Uses ordinary encoding so
    arbitrary user text — including strings that look like special tokens — is
    treated as plain text rather than parsed.

    Avoids the (synchronous, GIL-holding) BPE encode entirely for short text:
    a token spans at least one UTF-8 byte and a char is at most 4 bytes, so
    `tokens <= 4 * len(text)`. Any string within `max_tokens // 4` chars
    therefore cannot overflow — which covers the common case at O(1) and keeps
    bulk embedding off the event loop's critical path.
    """
    if not text or len(text) <= max_tokens // 4:
        return text
    enc = _encoder()
    tokens = enc.encode_ordinary(text)
    if len(tokens) <= max_tokens:
        return text
    return enc.decode(tokens[:max_tokens])
