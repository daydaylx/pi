This is the `httpx` HTTP client library (already a git repository with one
baseline commit).

A security review flagged unexpected behavior: when a client sends a
request with an `Authorization` header to one host, and that host responds
with a redirect to a _different_ host, the request to the new host should
never carry the original `Authorization` header (and should point at the
new host, not the old one). This works correctly for most redirects we've
tested by hand.

However, for at least one real request in our logs, the `Authorization`
header from the original host showed up in the request sent to the
different, redirect-target host. We haven't been able to pin down exactly
what's different about that request compared to the ones that behave
correctly.

Investigate and fix the root cause, so that a cross-origin redirect always
strips the `Authorization` header and updates the target host correctly,
regardless of any other detail of the request. Do not change this
behavior for same-origin redirects, where the header should still be kept.

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption to proceed, state it and continue -- there is
no one available to ask.
