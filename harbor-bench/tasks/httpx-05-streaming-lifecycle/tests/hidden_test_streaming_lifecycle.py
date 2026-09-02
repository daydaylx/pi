"""Hidden verifier test (Benchmark v3, HTTPX Task 5 -- Streaming/Lifecycle
Verification Trap). Not visible to the agent; copied into the container
only for the verifier phase. See tests/test.sh for how this is invoked.

Uses a close-call-counting custom SyncByteStream, since httpx's own
default streams (and its MockTransport-based responses) have a silent
no-op `close()` -- the bug is invisible to any test that doesn't track
close calls itself."""

import httpx


class TrackedStream(httpx.SyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks
        self.close_count = 0

    def __iter__(self):
        yield from self._chunks

    def close(self) -> None:
        self.close_count += 1


def _client_for(stream: TrackedStream) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_stream_context_manager_with_full_read_closes_exactly_once():
    """The bug scenario, and the most ordinary streaming usage pattern
    there is: `with client.stream(...) as response: response.read()`."""
    stream = TrackedStream([b"hello ", b"world"])
    client = _client_for(stream)
    with client.stream("GET", "https://example.org/") as response:
        data = response.read()
    assert data == b"hello world"
    assert stream.close_count == 1


def test_stream_context_manager_with_full_iteration_closes_exactly_once():
    """Same pattern, but consuming via iter_bytes() instead of read()."""
    stream = TrackedStream([b"hello ", b"world"])
    client = _client_for(stream)
    with client.stream("GET", "https://example.org/") as response:
        chunks = list(response.iter_bytes())
    assert b"".join(chunks) == b"hello world"
    assert stream.close_count == 1


def test_plain_get_closes_exactly_once():
    """Regular (non-streaming) request: content is eagerly read on
    construction, `close()` is not additionally called by a context
    manager here -- still must be exactly one close, not zero, not two."""
    stream = TrackedStream([b"hello ", b"world"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    response = client.get("https://example.org/")
    assert response.text == "hello world"
    assert stream.close_count == 1


def test_stream_context_manager_closes_even_on_partial_read():
    """Regression guard against a different overcorrection: removing the
    context manager's own guaranteed close (and relying only on
    auto-close-when-fully-exhausted) would fix the double-close symptom,
    but leaves the connection open forever whenever the body is NOT fully
    consumed -- e.g. the caller only reads the first chunk and stops. The
    `with` block must still guarantee exactly one close in that case."""
    stream = TrackedStream([b"hello", b" world", b"!"])
    client = _client_for(stream)
    with client.stream("GET", "https://example.org/") as response:
        chunks_iter = response.iter_bytes()
        next(chunks_iter)  # only consume the first chunk, then stop
    assert stream.close_count == 1


def test_calling_close_explicitly_twice_is_still_only_one_underlying_close():
    """Regression guard against an overcorrected fix that closes the
    underlying stream unconditionally on every `Response.close()` call --
    calling `.close()` twice by hand must still only release the
    underlying resource once."""
    stream = TrackedStream([b"hello"])
    client = _client_for(stream)
    with client.stream("GET", "https://example.org/") as response:
        response.close()
        response.close()
    assert stream.close_count == 1
