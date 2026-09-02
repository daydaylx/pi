"""Hidden verifier test (Benchmark v3, HTTPX Task 8 -- Subagent
Candidate). Not visible to the agent; copied into the container only for
the verifier phase. See tests/test.sh for how this is invoked."""

import httpx


def test_sync_explicit_mounts_wins_over_proxy_on_catchall_collision():
    """The bug scenario: mounts={"all://": ...} must win over proxy=,
    which also produces an "all://" pattern internally."""
    dedicated = httpx.HTTPTransport(proxy="http://dedicated.internal:9999")
    client = httpx.Client(
        proxy="http://global.internal:8888",
        mounts={"all://": dedicated},
    )
    transport = client._transport_for_url(httpx.URL("https://example.org/"))
    assert transport is dedicated


def test_async_explicit_mounts_wins_over_proxy_on_catchall_collision():
    """Same bug, async client."""
    dedicated = httpx.AsyncHTTPTransport(proxy="http://dedicated.internal:9999")
    client = httpx.AsyncClient(
        proxy="http://global.internal:8888",
        mounts={"all://": dedicated},
    )
    transport = client._transport_for_url(httpx.URL("https://example.org/"))
    assert transport is dedicated


def test_proxy_alone_still_routes_everything():
    """Regression guard: the much more common case (proxy=, no mounts=)
    must keep working exactly as before."""
    client = httpx.Client(proxy="http://global.internal:8888")
    transport = client._transport_for_url(httpx.URL("https://example.org/"))
    assert transport is not client._transport
    assert transport._pool._proxy_url.host == b"global.internal"


def test_specific_mount_alongside_proxy_still_wins_for_its_own_host():
    """Regression guard: a non-colliding, more specific mount pattern
    (not "all://") combined with a global proxy= must still route its own
    host to the dedicated transport and everything else to the proxy --
    this already worked before the mutation and must keep working."""
    dedicated = httpx.HTTPTransport(proxy="http://dedicated.internal:9999")
    client = httpx.Client(
        proxy="http://global.internal:8888",
        mounts={"all://api.example.com": dedicated},
    )
    dedicated_transport = client._transport_for_url(
        httpx.URL("https://api.example.com/")
    )
    other_transport = client._transport_for_url(httpx.URL("https://other.org/"))
    assert dedicated_transport is dedicated
    assert other_transport is not dedicated
    assert other_transport._pool._proxy_url.host == b"global.internal"
