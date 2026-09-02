"""Hidden verifier test (Benchmark v3, HTTPX Task 6 -- Configuration
Propagation Bug). Not visible to the agent; copied into the container only
for the verifier phase. See tests/test.sh for how this is invoked.

Introspects the underlying httpcore pool's `_http2` attribute directly
(httpx's own `HTTPTransport`/`AsyncHTTPTransport` just forward the
constructor argument to it) since MockTransport-based tests never
construct a real HTTPTransport/httpcore pool at all."""

import httpx


def test_sync_client_http2_propagates_to_proxy_transport():
    """The bug scenario."""
    client = httpx.Client(http2=True, proxy="http://localhost:8030")
    direct = client._transport
    proxied = client._transport_for_url(httpx.URL("https://example.org/"))
    assert direct._pool._http2 is True
    assert proxied._pool._http2 is True


def test_async_client_http2_propagates_to_proxy_transport():
    """Same bug, async client."""
    client = httpx.AsyncClient(http2=True, proxy="http://localhost:8030")
    direct = client._transport
    proxied = client._transport_for_url(httpx.URL("https://example.org/"))
    assert direct._pool._http2 is True
    assert proxied._pool._http2 is True


def test_sync_client_http2_false_still_propagates_to_proxy_transport():
    """Regression guard: explicit http2=False must also propagate
    correctly (not just the True case) -- both the default transport and
    the proxy transport should agree with the client's own setting."""
    client = httpx.Client(http2=False, proxy="http://localhost:8030")
    proxied = client._transport_for_url(httpx.URL("https://example.org/"))
    assert proxied._pool._http2 is False


def test_sync_client_http1_still_propagates_to_proxy_transport():
    """Regression guard: a neighboring, still-correct setting (http1)
    must keep working -- catches an overcorrected fix that breaks other
    transport-level settings while fixing http2."""
    client = httpx.Client(http1=False, http2=True, proxy="http://localhost:8030")
    proxied = client._transport_for_url(httpx.URL("https://example.org/"))
    assert proxied._pool._http1 is False
