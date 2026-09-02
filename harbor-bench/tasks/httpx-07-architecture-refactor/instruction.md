This is the `httpx` HTTP client library (already a git repository with one
baseline commit, unmodified from upstream).

`httpx/_client.py` has real, pre-existing duplication: the synchronous
`Client` and asynchronous `AsyncClient` classes each define their own
`_init_transport` and `_init_proxy_transport` methods, and the logic that
builds the keyword arguments for constructing the underlying HTTP
transport (`verify`, `cert`, `trust_env`, `http1`, `http2`, `limits`) is
repeated near-verbatim across all four of those methods.

Refactor this so that keyword-argument construction lives in exactly one
place, shared by all four call sites (sync and async, direct and
proxied), instead of being repeated. Requirements:

- The public API of `Client`/`AsyncClient` must not change (constructor
  signatures, accepted argument names/types, and observable behavior all
  stay exactly as they are).
- Synchronous and asynchronous behavior must remain exactly as they are
  relative to each other -- this is a pure internal refactor, not a
  behavior change.
- The full existing test suite must continue to pass unmodified.
- The duplication must actually be removed, not just reformatted or
  commented on. A refactor that leaves the same repeated argument-building
  code in place (even if renamed, reindented, or accompanied by a new
  unused helper) does not satisfy this task.

You have full access to the repository, its test suite, and standard
tooling (tests, type checking, linting, git). Work autonomously; if you
have to make an assumption about the exact shape of the refactor, state it
and continue -- there is no one available to ask.
