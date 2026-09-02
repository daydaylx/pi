This is the `httpx` HTTP client library (already a git repository with one
baseline commit).

A user reports that a service they depend on follows a long, entirely
legitimate chain of redirects right up to the configured redirect limit,
and the request completes successfully when they use the synchronous
client. When they switched the same code to the async client (same
configuration, same redirect chain, same limit), the async version fails
with a "too many redirects" error instead, even though the chain length
hasn't changed and it's within the configured limit.

Find the root cause and fix it so the synchronous and asynchronous clients
behave identically for this scenario. Do not change the public API or
weaken the redirect-limit protection itself (a chain that's genuinely too
long must still be rejected, by both clients).

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption to proceed, state it and continue -- there is
no one available to ask.
