This is the `httpx` HTTP client library (already a git repository with one
baseline commit).

A team has a `Client` set up with a company-wide default egress proxy, and
they also configure one specific internal service to go through a
different, dedicated transport (for connection pooling and TLS settings
specific to that service). They've noticed that requests to that specific
internal service are, unexpectedly, going out through the company-wide
default proxy instead of the dedicated transport they configured for it.
Everything else about the client's behavior looks normal.

We don't know yet which part of the request pipeline is responsible. It
could be how request URLs get matched against configured routes, some
interaction with how the client stores and prioritizes its configuration,
how the final transport gets picked for a given request, or something
else entirely -- we haven't ruled anything out. Investigate and find the
actual root cause, then fix it so an explicitly configured route for a
specific destination is always honored over the general-purpose default,
regardless of how the client was constructed. Do not change any documented
public API or behavior for the (much more common) case where no such
per-destination override exists.

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption to proceed, state it and continue -- there is
no one available to ask. If you believe delegating parts of this
investigation to a subagent would help, that's available to you -- but
it's your call, not a requirement.
