"""Bounded public-document fetching with a pinned, validated DNS destination."""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin

import httpx

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_REDIRECTS = 5


async def resolve_public_target(url: str, *, timeout: float = 5.0) -> tuple[httpx.URL, str, str]:
    parsed = httpx.URL(url)
    if parsed.scheme not in {"http", "https"} or not parsed.host or parsed.username or parsed.password:
        raise ValueError("Only public HTTP(S) document URLs without credentials are allowed.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port not in {80, 443}:
        raise ValueError("Document fetches support only standard HTTP(S) ports.")
    try:
        addresses = [ipaddress.ip_address(parsed.host)]
    except ValueError:
        records = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(parsed.host, port, type=socket.SOCK_STREAM),
            timeout=timeout,
        )
        addresses = [ipaddress.ip_address(record[4][0]) for record in records]
    if not addresses or any(not address.is_global or address.is_multicast for address in addresses):
        raise ValueError("Private, loopback, link-local and other nonpublic document destinations are blocked.")
    # Pin the validated address for the actual connection. Validating DNS and
    # then letting the HTTP client resolve again permits DNS rebinding.
    return parsed.copy_with(host=str(addresses[0])), parsed.host, parsed.netloc.decode("ascii")


async def fetch_public_bytes(url: str, *, timeout: float, headers: dict[str, str]) -> tuple[bytes, str, str]:
    current = url
    async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=timeout, headers=headers) as client:
        for hop in range(MAX_REDIRECTS + 1):
            pinned, hostname, host_header = await resolve_public_target(current, timeout=min(timeout, 5.0))
            # Preserve the original HTTP Host and TLS certificate/SNI name
            # while connecting to the public address we have just validated.
            async with client.stream("GET", pinned, headers={"Host": host_header}, extensions={"sni_hostname": hostname}) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location or hop >= MAX_REDIRECTS:
                        raise ValueError("Document redirect limit exceeded or redirect location missing.")
                    current = urljoin(current, location)
                    continue
                response.raise_for_status()
                declared = response.headers.get("content-length")
                if declared and int(declared) > MAX_DOCUMENT_BYTES:
                    raise ValueError("Document exceeds the 10 MiB download limit.")
                content = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    if len(content) + len(chunk) > MAX_DOCUMENT_BYTES:
                        raise ValueError("Document exceeds the 10 MiB download limit.")
                    content.extend(chunk)
                return bytes(content), response.headers.get("content-type", ""), current
    raise ValueError("Document redirect limit exceeded.")
