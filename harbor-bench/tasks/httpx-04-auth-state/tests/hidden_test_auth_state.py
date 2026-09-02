"""Hidden verifier test (Benchmark v3, HTTPX Task 4 -- Authentication State
Bug). Not visible to the agent; copied into the container only for the
verifier phase. See tests/test.sh for how this is invoked."""

import base64

import httpx


def echo_auth(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"auth": request.headers.get("authorization")})


def _basic(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def test_explicit_client_auth_wins_over_url_credentials():
    """The bug scenario: URL-embedded credentials must not override an
    explicitly configured client-level auth."""
    client = httpx.Client(
        transport=httpx.MockTransport(echo_auth),
        auth=("explicit-user", "explicit-pass"),
    )
    response = client.get("https://url-user:url-pass@example.org/")
    assert response.json()["auth"] == _basic("explicit-user", "explicit-pass")


def test_explicit_per_request_auth_wins_over_url_credentials():
    """Same combination, but auth passed per-request instead of on the
    client -- must also take precedence over URL-embedded credentials."""
    client = httpx.Client(transport=httpx.MockTransport(echo_auth))
    response = client.get(
        "https://url-user:url-pass@example.org/",
        auth=("explicit-user", "explicit-pass"),
    )
    assert response.json()["auth"] == _basic("explicit-user", "explicit-pass")


def test_url_credentials_still_work_as_fallback():
    """Regression guard: with no explicit auth configured anywhere,
    URL-embedded credentials must still be used -- this existing behavior
    must not change."""
    client = httpx.Client(transport=httpx.MockTransport(echo_auth))
    response = client.get("https://url-user:url-pass@example.org/")
    assert response.json()["auth"] == _basic("url-user", "url-pass")


def test_explicit_auth_without_url_credentials_still_works():
    """Regression guard: explicit auth with a plain URL (no embedded
    credentials) must keep working."""
    client = httpx.Client(
        transport=httpx.MockTransport(echo_auth),
        auth=("explicit-user", "explicit-pass"),
    )
    response = client.get("https://example.org/")
    assert response.json()["auth"] == _basic("explicit-user", "explicit-pass")
