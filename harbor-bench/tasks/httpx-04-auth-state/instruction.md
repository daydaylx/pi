This is the `httpx` HTTP client library (already a git repository with one
baseline commit).

We migrated a service from using credentials embedded directly in request
URLs (`https://user:pass@host/...`, an old, discouraged pattern still
present in some legacy config strings we don't fully control) to
explicitly configuring authentication on our `httpx` client instances
instead, so we have one clear, auditable place where credentials are set.

After the migration, in one environment we found requests were still going
out with the _old_, embedded-in-the-URL credentials, completely ignoring
the explicit authentication we'd configured on the client -- even though
the code clearly sets up the client with the new, explicit auth. It's not
happening for every request; some requests do use the explicitly
configured auth correctly.

Find the root cause and fix it, so that explicitly configured
authentication (whether set on the client or passed per-request) always
takes precedence over credentials that happen to be embedded in a request
URL. Embedded URL credentials should still work as a fallback when no
explicit authentication is configured at all -- that existing behavior
must not change.

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption to proceed, state it and continue -- there is
no one available to ask.
