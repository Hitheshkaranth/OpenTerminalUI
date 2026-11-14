import socket

import httpx
import pytest

from backend.core.research import network


@pytest.mark.asyncio
@pytest.mark.parametrize("url", ["http://127.0.0.1/secret", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://10.0.0.2/", "http://192.168.1.2/", "file:///etc/passwd", "https://user:password@example.test/", "http://8.8.8.8:8080/"])
async def test_private_and_unsupported_destinations_are_rejected(url):
    with pytest.raises(ValueError):
        await network.resolve_public_target(url)


@pytest.mark.asyncio
async def test_dns_resolutions_must_all_be_public(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))])
    with pytest.raises(ValueError, match="nonpublic"):
        await network.resolve_public_target("https://research.example.test/report")


@pytest.mark.asyncio
async def test_public_connection_is_pinned_and_private_redirect_is_blocked(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))])
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})
    original = httpx.AsyncClient
    monkeypatch.setattr(network.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(ValueError, match="nonpublic"):
        await network.fetch_public_bytes("https://research.example.test/report", timeout=2, headers={})
    assert len(requests) == 1
    assert requests[0].url.host == "93.184.216.34"
    assert requests[0].headers["host"] == "research.example.test"
    assert requests[0].extensions["sni_hostname"] == "research.example.test"


@pytest.mark.asyncio
async def test_public_document_remains_usable_and_download_size_is_bounded(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))])
    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, headers={"content-type": "text/plain"}, content=b"research"))
    monkeypatch.setattr(network.httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs))
    content, mime, final_url = await network.fetch_public_bytes("https://research.example.test/paper", timeout=2, headers={})
    assert (content, mime, final_url) == (b"research", "text/plain", "https://research.example.test/paper")
    monkeypatch.setattr(network, "MAX_DOCUMENT_BYTES", 3)
    with pytest.raises(ValueError, match="download limit"):
        await network.fetch_public_bytes("https://research.example.test/paper", timeout=2, headers={})
