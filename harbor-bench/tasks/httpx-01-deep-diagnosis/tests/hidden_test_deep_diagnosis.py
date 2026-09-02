"""Hidden verifier test (Benchmark v3, HTTPX Task 1 -- Deep Repository
Diagnosis). Not visible to the agent; copied into the container only for
the verifier phase. See tests/test.sh for how this is invoked."""

import httpx


def echo(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text=str(request.url))


def test_client_default_param_survives_request_without_params():
    client = httpx.Client(
        params={"api_key": "secret123"}, transport=httpx.MockTransport(echo)
    )
    response = client.get("http://example.org/widgets")
    assert "api_key=secret123" in response.text


def test_client_default_param_merges_with_request_params():
    client = httpx.Client(
        params={"api_key": "secret123"}, transport=httpx.MockTransport(echo)
    )
    response = client.get("http://example.org/widgets", params={"page": "2"})
    assert "api_key=secret123" in response.text
    assert "page=2" in response.text


def test_request_only_params_still_work_without_client_params():
    client = httpx.Client(transport=httpx.MockTransport(echo))
    response = client.get("http://example.org/widgets", params={"page": "2"})
    assert "page=2" in response.text


def test_no_params_at_all_produces_no_query_string():
    client = httpx.Client(transport=httpx.MockTransport(echo))
    response = client.get("http://example.org/widgets")
    assert "?" not in response.text
