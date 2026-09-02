"""Benchmark v3 Codex adapter for Harbor: same agent as Harbor's own
built-in ``harbor.agents.installed.codex:Codex`` (auth, CLI flags, ATIF
trajectory parsing all unchanged, inherited as-is), except for how the
Codex CLI itself gets into the container.

Harbor's own ``Codex.install()`` runs ``npm install -g @openai/codex`` fresh
inside every trial container. That package's platform-specific binary
(resolved via an npm dependency alias, e.g. ``@openai/codex-linux-x64``) is
~310MB (``unpackedSize`` per the npm registry). Confirmed unreliable in this
sandbox (see ``KNOWN_LIMITATIONS.md``): two real trials in a row failed --
one with ``npm error ETIMEDOUT`` fetching that package, the other with npm
silently dropping the optional dependency after a stalled fetch, leaving
``codex.js`` unable to find its own binary at runtime
(``Error: Missing optional dependency @openai/codex-linux-x64``). A direct
timed download of that exact tarball from this sandbox made no measurable
progress in 15s.

``CodexHarnessTrackA`` uploads a tarball of an already-installed, working
local Codex CLI instead (``environments/codex-cli.tar.gz``, built by
``environments/build-codex-tarball.sh`` from this host's own
``npm root -g``/@openai/codex) via Harbor's own ``environment.upload_file()``
-- the same host-to-container transfer mechanism, and the same reasoning,
``agents/pi_harness/agent.py`` already uses for Pi's product-stack tarball.
Node itself is still installed via nvm (unchanged from Harbor's own Codex
adapter) -- that download is ~30MB, an order of magnitude smaller, and has
not been the actual failure point in this session's real trials.

Real-usage parity, beyond just the binary: pass ``"config":
"/home/d/.codex/config.toml"`` in the job config's agent entry -- Harbor's
own ``Codex`` already supports this (``config_source``/``SUPPORTS_CONFIG``,
unchanged here) and uploads it as the effective ``$CODEX_HOME/config.toml``.
Deliberately NOT shipped, per user decision (2026-09-01): ``instructions.md``
(directs Codex to use ``ctx_read``/``ctx_search``/``ctx_shell``/``ctx_edit``
tools from a separate local MCP-adjacent tool, ``lean-ctx`` -- shipping the
instructions without also packaging and registering that tool would leave
Codex trying to call tools that don't exist) and ``hooks.json`` (invokes a
host GUI app path, ``tty7-app``, meaningless inside an ephemeral container).
config.toml itself has zero MCP servers configured, so it needed no
filtering for this.
"""

import shlex
from pathlib import Path, PurePosixPath
from typing import override

from harbor.agents.installed.codex import Codex
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment

_LOCAL_TARBALL = Path(__file__).parent.parent.parent / "environments" / "codex-cli.tar.gz"
_REMOTE_TARBALL_PATH = PurePosixPath("/tmp/codex-cli.tar.gz")
_REMOTE_NPM_GLOBAL = PurePosixPath("/usr/local/lib/node_modules")


class CodexHarnessTrackA(Codex):
    """Harbor's Codex agent, with a locally-sourced CLI install instead of
    a fresh network npm install per trial."""

    @staticmethod
    @override
    def name() -> str:
        return "codex-local-harness"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        if not _LOCAL_TARBALL.is_file():
            raise ValueError(
                f"Codex CLI tarball not found: {_LOCAL_TARBALL}. "
                "Build it with environments/build-codex-tarball.sh first."
            )

        # Node: nvm-based (unchanged from Harbor's own Codex.install()), but
        # forced onto nvm's curl/tarball install path instead of its default
        # `git clone` of nvm-sh/nvm (nvm's install.sh: method defaults to
        # "git" whenever git is on PATH, which it already is here -- the
        # git-parity baseline needs it). Confirmed real failure, not a
        # guess: two real trials in this sandbox hit `git clone
        # https://github.com/nvm-sh/nvm` failing with `fatal: could not
        # read Username for 'https://github.com'` (unauthenticated public
        # clone erroring as if auth were required -- the same class of
        # network-path flakiness as the other entries in
        # KNOWN_LIMITATIONS.md, just hitting git's smart-HTTP protocol
        # instead of a plain download this time). `METHOD=script` is nvm's
        # own override for this exact choice (verified against nvm's own
        # install.sh source, v0.40.2: `if [ -z "${METHOD}" ]; then ... if
        # nvm_has git; then install_nvm_from_git ... elif [ "${METHOD}" =
        # 'script' ] ... install_nvm_as_script`. NOT `NVM_METHOD` -- that
        # name doesn't exist in the script and silently has zero effect,
        # confirmed the hard way: the first attempt at this fix used
        # `NVM_METHOD` and still hit the git-clone path unchanged.)
        await self.ensure_system_dependencies(environment, ("curl", "bash"))
        await self.exec_as_agent(
            environment,
            command=f"set -euo pipefail; {nvm_node_install_snippet()}",
            env={
                "NVM_NODEJS_ORG_MIRROR": "https://nodejs.org/dist",
                "METHOD": "script",
            },
        )

        # Codex CLI: upload + extract the pre-resolved local install instead
        # of `npm install -g @openai/codex` (the ~310MB network step this
        # class exists to avoid).
        remote_npm_global = _REMOTE_NPM_GLOBAL.as_posix()
        remote_tarball_path = _REMOTE_TARBALL_PATH.as_posix()
        await self.exec_as_root(
            environment, command=f"mkdir -p {shlex.quote(remote_npm_global)}"
        )
        await environment.upload_file(_LOCAL_TARBALL, remote_tarball_path)
        await self.exec_as_root(
            environment,
            command=(
                f"tar -xzf {shlex.quote(remote_tarball_path)} "
                f"-C {shlex.quote(remote_npm_global)} && "
                f"rm -f {shlex.quote(remote_tarball_path)} && "
                f"chmod +x {shlex.quote(remote_npm_global)}/codex/bin/codex.js"
            ),
        )

        # Symlink node/codex to /usr/local/bin (root) -- identical to
        # Harbor's own Codex.install(), which this override otherwise skips.
        codex_bin = (_REMOTE_NPM_GLOBAL / "codex" / "bin" / "codex.js").as_posix()
        await self.exec_as_root(
            environment,
            command=(
                f'ln -sf {shlex.quote(codex_bin)} /usr/local/bin/codex && '
                'BIN_PATH="$(. ~/.nvm/nvm.sh 2>/dev/null; which node)"; '
                'if [ -n "$BIN_PATH" ]; then ln -sf "$BIN_PATH" /usr/local/bin/node; fi'
            ),
        )
        await self.exec_as_agent(environment, command="codex --version")
