"""Unit tests for trusted image-generation domain models."""

from __future__ import annotations

from hashlib import sha256

import pytest

from pydantic import ValidationError

import topix.image_generation.models as image_models

from topix.image_generation.models import (
    MAX_PROVIDER_REFERENCE_IMAGE_BYTES,
    GenerationReference,
    GenerationStart,
    ImageAssetCreate,
    ImageAssetSource,
    ImageGenerationParameters,
    ProviderImageReference,
    ProviderImageRequest,
    canonical_request_fingerprint,
)


def _asset_kwargs() -> dict[str, object]:
    """Return deterministic valid metadata for one image asset."""
    return {
        "board_uid": "board-1",
        "created_by_user_uid": "user-1",
        "source_kind": ImageAssetSource.UPLOADED,
        "mime_type": "image/png",
        "byte_size": 1,
        "width": 1,
        "height": 1,
        "content_sha256": "a" * 64,
    }


@pytest.mark.parametrize(
    "storage_key",
    [
        "./images/x.png",
        "images/./x.png",
        "images/../x.png",
        "images//x.png",
        "images/",
        ".",
        "..",
        "/images/x.png",
        "images\\x.png",
        "https://example.test/x.png",
    ],
)
def test_asset_rejects_unsafe_raw_storage_keys(storage_key: str) -> None:
    """Raw dot, empty, URL, absolute, and backslash forms never normalize through."""
    with pytest.raises(ValidationError, match="storage_key"):
        ImageAssetCreate(storage_key=storage_key, **_asset_kwargs())


@pytest.mark.parametrize("storage_key", ["images/x.png", "generated/01ABCDEF/result.avif"])
def test_asset_accepts_internal_relative_storage_keys(storage_key: str) -> None:
    """Opaque internal relative keys accepted by PostgreSQL also validate here."""
    asset = ImageAssetCreate(storage_key=storage_key, **_asset_kwargs())
    assert asset.storage_key == storage_key


def test_asset_rejects_svg_mime_type() -> None:
    """Active image assets are restricted to the raster allowlist."""
    with pytest.raises(ValidationError, match="mime_type"):
        ImageAssetCreate(storage_key="images/x.svg", **(_asset_kwargs() | {"mime_type": "image/svg+xml"}))


def test_generation_accepts_asset_only_and_node_associated_references() -> None:
    """PR-02 may send asset IDs alone while PR-04 may associate authorized nodes."""
    generation = GenerationStart(
        client_request_uid="request-1",
        user_uid="user-1",
        board_uid="board-1",
        worker_uid="worker-1",
        model_id="test/model",
        prompt="test",
        references=(
            GenerationReference(ordinal=0, asset_uid="asset-1"),
            GenerationReference(ordinal=1, asset_uid="asset-2", reference_node_uid="node-2"),
        ),
    )

    assert generation.references[0].reference_node_uid is None
    assert generation.references[1].reference_node_uid == "node-2"


def test_generation_ignores_none_when_checking_duplicate_node_ids() -> None:
    """Only provided node associations participate in uniqueness validation."""
    GenerationStart(
        client_request_uid="request-1",
        user_uid="user-1",
        board_uid="board-1",
        worker_uid="worker-1",
        model_id="test/model",
        prompt="test",
        references=(
            GenerationReference(ordinal=0, asset_uid="asset-1"),
            GenerationReference(ordinal=1, asset_uid="asset-2"),
        ),
    )

    with pytest.raises(ValidationError, match="reference node IDs must be unique"):
        GenerationStart(
            client_request_uid="request-2",
            user_uid="user-1",
            board_uid="board-1",
            worker_uid="worker-1",
            model_id="test/model",
            prompt="test",
            references=(
                GenerationReference(ordinal=0, asset_uid="asset-1", reference_node_uid="node-1"),
                GenerationReference(ordinal=1, asset_uid="asset-2", reference_node_uid="node-1"),
            ),
        )


def test_request_fingerprint_is_canonical_and_reference_order_sensitive() -> None:
    """Stable JSON produces repeatable hashes while ordered references remain billable input."""
    parameters = ImageGenerationParameters(aspect_ratio="16:9", resolution="1K")
    first = canonical_request_fingerprint(
        model_id="test/model",
        prompt="Create an image",
        parameters=parameters,
        reference_asset_uids=("asset-a", "asset-b"),
        generator_node_uid=None,
    )
    same = canonical_request_fingerprint(
        model_id="test/model",
        prompt="Create an image",
        parameters=parameters.model_copy(),
        reference_asset_uids=("asset-a", "asset-b"),
        generator_node_uid=None,
    )
    reordered = canonical_request_fingerprint(
        model_id="test/model",
        prompt="Create an image",
        parameters=parameters,
        reference_asset_uids=("asset-b", "asset-a"),
        generator_node_uid=None,
    )

    assert first == same
    assert first != reordered


def test_generation_rejects_client_supplied_mismatched_fingerprint() -> None:
    """The domain recomputes rather than trusting an arbitrary request hash."""
    with pytest.raises(ValidationError, match="request_fingerprint"):
        GenerationStart(
            client_request_uid="request-1",
            user_uid="user-1",
            board_uid="board-1",
            worker_uid="worker-1",
            model_id="test/model",
            prompt="Create an image",
            request_fingerprint="a" * 64,
        )


def test_generation_requires_explicit_client_request_uid_and_worker_owner() -> None:
    """Durable idempotency and lease ownership cannot be silently randomized per model."""
    with pytest.raises(ValidationError, match="client_request_uid"):
        GenerationStart(
            user_uid="user-1",
            board_uid="board-1",
            worker_uid="worker-1",
            model_id="test/model",
            prompt="Create an image",
        )
    with pytest.raises(ValidationError, match="worker_uid"):
        GenerationStart(
            client_request_uid="request-1",
            user_uid="user-1",
            board_uid="board-1",
            model_id="test/model",
            prompt="Create an image",
        )


def _reference(*, content: bytes, ordinal: int = 0) -> ProviderImageReference:
    """Build one hash-verified in-memory provider reference."""
    return ProviderImageReference(
        asset_uid=f"asset-{ordinal}",
        ordinal=ordinal,
        mime_type="image/png",
        content_sha256=sha256(content).hexdigest(),
        width=1,
        height=1,
        content=content,
    )


def test_provider_reference_rejects_payload_above_memory_ceiling() -> None:
    """A single domain reference cannot retain unbounded external bytes."""
    content = b"x" * (MAX_PROVIDER_REFERENCE_IMAGE_BYTES + 1)
    with pytest.raises(ValidationError, match="at most"):
        _reference(content=content)


def test_provider_reference_accepts_payload_at_individual_ceiling() -> None:
    """The documented individual limit is inclusive."""
    content = b"x" * MAX_PROVIDER_REFERENCE_IMAGE_BYTES
    assert len(_reference(content=content).content) == MAX_PROVIDER_REFERENCE_IMAGE_BYTES


def test_provider_request_rejects_aggregate_bytes_above_memory_ceiling(monkeypatch) -> None:
    """Many individually valid references also have one aggregate request cap."""
    monkeypatch.setattr(image_models, "MAX_PROVIDER_REQUEST_BYTES", 3)
    references = (_reference(content=b"aa", ordinal=0), _reference(content=b"bb", ordinal=1))

    with pytest.raises(ValidationError, match="request byte limit"):
        ProviderImageRequest(
            generation_uid="generation-1",
            attempt_uid="attempt-1",
            model_id="test/model",
            prompt="test",
            references=references,
        )


@pytest.mark.parametrize(("sizes", "accepted"), [((1, 2), True), ((2, 2), True), ((2, 3), False)])
def test_provider_request_raw_limit_boundaries(monkeypatch, sizes: tuple[int, ...], accepted: bool) -> None:
    """Raw aggregate bytes immediately below, at, and above the limit are deterministic."""
    monkeypatch.setattr(image_models, "MAX_PROVIDER_REQUEST_BYTES", 4)
    monkeypatch.setattr(image_models, "MAX_PROVIDER_ENCODED_REQUEST_BYTES", 100_000)
    kwargs = {
        "generation_uid": "generation-1",
        "attempt_uid": "attempt-1",
        "model_id": "test/model",
        "prompt": "test",
        "references": tuple(_reference(content=b"x" * size, ordinal=ordinal) for ordinal, size in enumerate(sizes)),
    }
    if accepted:
        assert ProviderImageRequest(**kwargs).references
    else:
        with pytest.raises(ValidationError, match="request byte limit"):
            ProviderImageRequest(**kwargs)


def test_fourteen_references_still_obey_aggregate_limit(monkeypatch) -> None:
    """Gemini's larger reference count never bypasses the provider-neutral byte cap."""
    monkeypatch.setattr(image_models, "MAX_PROVIDER_REQUEST_BYTES", 13)
    monkeypatch.setattr(image_models, "MAX_PROVIDER_ENCODED_REQUEST_BYTES", 100_000)
    references = tuple(_reference(content=b"x", ordinal=ordinal) for ordinal in range(14))
    with pytest.raises(ValidationError, match="request byte limit"):
        ProviderImageRequest(
            generation_uid="generation-1",
            attempt_uid="attempt-1",
            model_id="google/gemini-3-pro-image",
            prompt="test",
            references=references,
        )


def test_provider_request_rejects_encoded_request_above_memory_ceiling(monkeypatch) -> None:
    """Base64 and JSON amplification is bounded independently from raw bytes."""
    monkeypatch.setattr(image_models, "MAX_PROVIDER_ENCODED_REQUEST_BYTES", 4_200)
    with pytest.raises(ValidationError, match="encoded provider request"):
        ProviderImageRequest(
            generation_uid="generation-1",
            attempt_uid="attempt-1",
            model_id="test/model",
            prompt="test",
            references=(_reference(content=b"reference", ordinal=0),),
        )


def test_verified_reference_is_not_rehashed_when_reused(monkeypatch) -> None:
    """Frozen trusted instances verify once when nested, copied, or revalidated."""
    calls = 0
    real_sha256 = sha256

    def counting_sha256(content: bytes):
        """Count digest construction while preserving hashlib behavior."""
        nonlocal calls
        calls += 1
        return real_sha256(content)

    monkeypatch.setattr(image_models, "sha256", counting_sha256)
    reference = _reference(content=b"reference")
    request = ProviderImageRequest(
        generation_uid="generation-1",
        attempt_uid="attempt-1",
        model_id="test/model",
        prompt="test",
        references=(reference,),
    )

    request.model_copy()
    ProviderImageReference.model_validate(reference)
    assert calls == 1
