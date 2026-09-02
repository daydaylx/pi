This is the `httpx` HTTP client library (already a git repository with one
baseline commit).

We use `httpx`'s streaming API heavily (`with client.stream(...) as
response: ...`), and one of our custom transport integrations has started
logging intermittent warnings that a connection resource was released more
than once for the same request. It only happens for a subset of requests
-- most streaming requests never trigger it. Our own transport code hasn't
changed recently, and this only started after an unrelated update to the
`httpx` version we pin.

We suspect something in how `httpx` manages the lifecycle of a streamed
response (opening, reading, and releasing the underlying connection) is
releasing it more times than it should for some code paths. Find the root
cause and fix it, so that the underlying stream/connection for a given
response is only ever released exactly once, regardless of how the
response body ends up being consumed (fully read at once, iterated
chunk-by-chunk, or accessed inside a `with client.stream(...)` block).

Do not change any documented public API or behavior. The fix should not
introduce a _new_ place where the connection might be released, and must
not leave any path where it is never released at all (that would replace
one resource bug with another).

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption to proceed, state it and continue -- there is
no one available to ask.
