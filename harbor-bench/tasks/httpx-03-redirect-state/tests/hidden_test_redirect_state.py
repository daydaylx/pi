"""Hidden verifier test (Benchmark v3, HTTPX Task 3 -- Redirect State Bug).
Not visible to the agent; copied into the container only for the verifier
phase. See tests/test.sh for how this is invoked."""

import httpx


def redirects(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/cross_domain_303":
        return httpx.Response(
            303, headers={"location": "https://example.org/target"}
        )
    if request.url.path == "/cross_domain_307":
        return httpx.Response(
            307, headers={"location": "https://example.org/target"}
        )
    if request.url.path == "/same_domain_303":
        return httpx.Response(
            303, headers={"location": "https://example.com/target"}
        )
    if request.url.path == "/target":
        return httpx.Response(200, json={"headers": dict(request.headers)})
    raise NotImplementedError()  # pragma: no cover


def test_cross_domain_303_post_strips_auth_and_updates_host():
    """The bug scenario: a method-downgrading (POST -> GET) redirect that
    also crosses origins must still strip Authorization and update Host."""
    client = httpx.Client(transport=httpx.MockTransport(redirects))
    response = client.post(
        "https://example.com/cross_domain_303",
        headers={"Authorization": "abc"},
        follow_redirects=True,
    )
    headers = response.json()["headers"]
    assert "authorization" not in headers
    assert headers["host"] == "example.org"


def test_cross_domain_307_post_strips_auth_and_updates_host():
    """Regression guard: cross-origin redirects that do NOT change the
    method (307 keeps POST) must also strip Authorization / update Host --
    this case already worked before the bug and must keep working."""
    client = httpx.Client(transport=httpx.MockTransport(redirects))
    response = client.post(
        "https://example.com/cross_domain_307",
        headers={"Authorization": "abc"},
        follow_redirects=True,
    )
    headers = response.json()["headers"]
    assert "authorization" not in headers
    assert headers["host"] == "example.org"


def test_same_domain_303_post_keeps_auth():
    """Regression guard: same-origin redirects must still KEEP the
    Authorization header -- do not overcorrect into stripping it always."""
    client = httpx.Client(transport=httpx.MockTransport(redirects))
    response = client.post(
        "https://example.com/same_domain_303",
        headers={"Authorization": "abc"},
        follow_redirects=True,
    )
    headers = response.json()["headers"]
    assert headers.get("authorization") == "abc"
