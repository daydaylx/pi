"""Hidden verifier test (Benchmark v3, HTTPX Task 2 -- Sync/Async
Consistency). Not visible to the agent; copied into the container only for
the verifier phase. See tests/test.sh for how this is invoked."""

import pytest

import httpx


def redirects(request: httpx.Request) -> httpx.Response:
    if request.url.path != "/multiple_redirects":
        raise NotImplementedError()  # pragma: no cover
    params = dict(httpx.QueryParams(request.url.query))
    count = int(params.get("count", "0"))
    if count == 0:
        return httpx.Response(200, request=request)
    location = "/multiple_redirects"
    if count > 1:
        location = f"{location}?count={count - 1}"
    return httpx.Response(303, headers={"location": location}, request=request)


def test_sync_client_succeeds_at_exactly_max_redirects():
    client = httpx.Client(transport=httpx.MockTransport(redirects))
    response = client.get(
        "https://example.org/multiple_redirects?count=20", follow_redirects=True
    )
    assert response.status_code == 200


@pytest.mark.anyio
async def test_async_client_succeeds_at_exactly_max_redirects():
    async with httpx.AsyncClient(transport=httpx.MockTransport(redirects)) as client:
        response = await client.get(
            "https://example.org/multiple_redirects?count=20", follow_redirects=True
        )
        assert response.status_code == 200


@pytest.mark.anyio
async def test_async_client_still_rejects_too_many_redirects():
    async with httpx.AsyncClient(transport=httpx.MockTransport(redirects)) as client:
        with pytest.raises(httpx.TooManyRedirects):
            await client.get(
                "https://example.org/multiple_redirects?count=21",
                follow_redirects=True,
            )


def test_sync_client_still_rejects_too_many_redirects():
    client = httpx.Client(transport=httpx.MockTransport(redirects))
    with pytest.raises(httpx.TooManyRedirects):
        client.get(
            "https://example.org/multiple_redirects?count=21", follow_redirects=True
        )
