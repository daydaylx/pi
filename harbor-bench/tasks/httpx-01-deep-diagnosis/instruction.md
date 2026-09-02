This is the `httpx` HTTP client library (already a git repository with one
baseline commit).

We've been getting bug reports from users of our internal API client
wrapper, which is built on top of `httpx.Client`. The wrapper configures a
default query parameter on the client (used for an API key / tenant ID)
so that it doesn't have to be repeated on every call.

Most requests work fine and correctly include that default parameter.
However, in some situations the default parameter is silently missing from
the outgoing request entirely -- no error, no exception, the request just
goes out without it. Other requests, made through the same client, are not
affected. Users have not been able to pin down a consistent pattern beyond
"it happens sometimes."

Investigate the library and find the root cause. Fix it so that the
default parameter is reliably included, without changing any documented
public behavior and without breaking the existing test suite.

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption to proceed, state it and continue -- there is
no one available to ask.
