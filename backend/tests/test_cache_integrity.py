from __future__ import annotations

from backend.shared.cache import MultiTierCache


def test_cache_blob_integrity_roundtrip() -> None:
    cache = MultiTierCache(redis_url=None)
    blob = cache._encode_blob({"a": 1, "b": "x"})
    value = cache._decode_blob(blob)
    assert value == {"a": 1, "b": "x"}


def test_cache_blob_integrity_tamper_detected() -> None:
    cache = MultiTierCache(redis_url=None)
    blob = bytearray(cache._encode_blob({"a": 1}))
    blob[-1] = (blob[-1] + 1) % 255
    value = cache._decode_blob(bytes(blob))
    assert value is None
