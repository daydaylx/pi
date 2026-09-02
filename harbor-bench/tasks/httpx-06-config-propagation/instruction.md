This is the `httpx` HTTP client library (already a git repository with one
baseline commit).

A team configures their `httpx.Client` with `http2=True` because most of
the services they talk to support and prefer HTTP/2. Everything works as
expected for the majority of their traffic. However, they noticed (via
server-side access logs showing the negotiated protocol) that requests
routed through their configured HTTP proxy are always negotiated as
HTTP/1.1, never HTTP/2 -- even though the same client, talking directly
(no proxy), correctly uses HTTP/2.

Find where this setting gets lost on the proxy path and fix it so that
`http2` (and every other transport-level setting a `Client`/`AsyncClient`
accepts) is applied consistently, whether a request goes out directly or
through a configured proxy. Check both the synchronous and asynchronous
client -- we don't yet know if one, both, or neither is affected.

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption to proceed, state it and continue -- there is
no one available to ask.
