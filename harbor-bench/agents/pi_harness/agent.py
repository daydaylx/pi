"""Benchmark v3 Pi adapter for Harbor.

Registered under ``pi-product-harness`` -- a distinct name from Harbor's own
built-in ``Pi`` agent (``harbor.agents.installed.pi:Pi``, registered as
``"pi"``) to avoid a name collision (see "Namenskollision" in
``/home/d/.claude/plans/arbeitsauftrag-pi-vs-codex-benchmark-eager-sparkle.md``).
Previously named ``pi-harness-stub``; renamed (Benchmark v3, Teil A9) because
it has not been a stub since it started loading the real product stack.

``PiHarnessTrackA`` uses the REAL production stack: instead of Harbor's
generic ``npm install -g @earendil-works/pi-coding-agent`` (vanilla package,
no project config -- see the git history of this file / ``HARBOR_SETUP.md``
"Sitzung 1" for that earlier stub), ``install()`` uploads and extracts a
tarball of this repo's actual product-stack files
(``AGENTS.md``, ``APPEND_SYSTEM.md``, ``settings.json``, ``models-store.json``,
``agents/*.md``, ``extensions/``, the exact resolved ``npm/node_modules``)
built by ``environments/build-tarball.sh``. ``run()`` uploads real OAuth
credentials (from the local ``auth.json`` on the host running Harbor, never
committed, never the full file -- only the entries actually needed) for
every provider referenced in ``settings.json``'s ``subagents.agentOverrides``
(``openai-codex`` for main/investigator/debugger, ``anthropic`` for the
mandatory-verifier default), so that real subagent delegation
(investigator/debugger/verifier, per ``AGENTS.md`` "Subagenten" criteria) is
actually exercisable, not just the main agent turn.

Mirrors Harbor's own Codex adapter auth pattern
(``harbor.agents.installed.codex:Codex._resolve_auth_json_path`` /
``_upload_config_text``): read OAuth entries from the local (host) auth.json
-- on the Harbor orchestrator process, never inside the container -- and
upload only a redacted subset into the container's
``PI_CODING_AGENT_DIR/auth.json``.
"""

import importlib.metadata
import json
import shlex
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.model_connection import ModelConnectionSpec
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths

from postprocess.pi_normalizer import build_pi_telemetry
from postprocess.schema import TELEMETRY_NAMESPACE


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

_LOCAL_PI_AUTH_JSON = Path("/home/d/.pi/agent/auth.json")
_LOCAL_TARBALL = Path(__file__).parent.parent.parent / "environments" / "pi-product-stack.tar.gz"

# Providers referenced by settings.json's subagents.agentOverrides /
# modelScope.allow (anthropic/claude-sonnet-5 for verifier,
# openai-codex/gpt-5.6-terra for main + investigator/debugger + verifier
# fallback). Uploading both lets real delegation actually authenticate,
# not just the main-agent turn.
_AUTH_PROVIDERS = ("openai-codex", "anthropic")

_REMOTE_STACK_DIR = PurePosixPath("/opt/pi-harness")
_REMOTE_TARBALL_PATH = PurePosixPath("/tmp/pi-product-stack.tar.gz")
_OUTPUT_FILENAME = "pi.txt"

# Own semver for this adapter file, independent of harbor==0.22.0 and of the
# Pi package version baked into the tarball. Bump on any behavior-relevant
# change to agent.py itself (install()/run()/populate_context_post_run()).
_ADAPTER_VERSION = "3.0.0"


class PiHarnessTrackA(BaseInstalledAgent):
    """Track A (autonomous, no clarification questions expected). Real
    production stack + real provider OAuth (main model and subagent
    roles), per module docstring."""

    SUPPORTS_RESUME: bool = True
    MODEL_CONNECTION = ModelConnectionSpec(passthrough=True)

    @staticmethod
    @override
    def name() -> str:
        return "pi-product-harness"

    @override
    def get_version_command(self) -> str | None:
        return ". ~/.nvm/nvm.sh; pi --version"

    @override
    def parse_version(self, stdout: str) -> str:
        return stdout.strip().splitlines()[-1].strip()

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        if not _LOCAL_TARBALL.is_file():
            raise ValueError(
                f"Product-stack tarball not found: {_LOCAL_TARBALL}. "
                "Build it with environments/build-tarball.sh first."
            )

        # A5 phase timestamps (self-instrumented: populate_context_post_run()
        # only receives AgentContext, not Harbor's own TrialResult phase
        # timing -- see postprocess/schema.py RuntimeBreakdown docstring).
        self._phase_ts: dict[str, tuple[str, str]] = {}

        remote_stack_dir = _REMOTE_STACK_DIR.as_posix()
        remote_tarball_path = _REMOTE_TARBALL_PATH.as_posix()

        # container_setup_time: upload + extract the product-stack tarball.
        t0 = _now_iso()
        await self.exec_as_agent(
            environment, command=f"mkdir -p {shlex.quote(remote_stack_dir)}"
        )
        await environment.upload_file(_LOCAL_TARBALL, remote_tarball_path)
        await self.exec_as_agent(
            environment,
            command=(
                f"tar -xzf {shlex.quote(remote_tarball_path)} "
                f"-C {shlex.quote(remote_stack_dir)} && "
                f"rm -f {shlex.quote(remote_tarball_path)}"
            ),
        )
        self._phase_ts["container_setup_time"] = (t0, _now_iso())

        # MANIFEST.json ships inside the tarball (Benchmark v3 Teil A1, written
        # by scripts/build_version_manifest.py at build-tarball.sh time) --
        # read it back so node gets pinned to the EXACT version the tarball's
        # npm/package.json engines.node requires, not just nvm's major-only
        # default, and so populate_context_post_run() can report it.
        manifest_path = (_REMOTE_STACK_DIR / "MANIFEST.json").as_posix()
        manifest_result = await self.exec_as_agent(
            environment, command=f"cat {shlex.quote(manifest_path)}"
        )
        self._version_manifest: dict = json.loads(manifest_result.stdout)
        node_version_pinned = self._version_manifest["node_version_pinned"]

        # dependency_setup_time: system packages (git -- pi-subagents resolves
        # its exactly-pinned fork via a runtime `git clone` into
        # PI_CODING_AGENT_DIR/git/... even though a resolved copy already
        # ships inside npm/node_modules, confirmed by a real `spawn git
        # ENOENT` failure without this dependency) + node install.
        t1 = _now_iso()
        await self.ensure_system_dependencies(environment, ("curl", "git"))
        await self.exec_as_agent(
            environment,
            command=(
                f"set -euo pipefail; "
                f"{nvm_node_install_snippet(node_major=node_version_pinned)}"
            ),
            # nvm's install.sh defaults to `git clone`ing nvm-sh/nvm whenever
            # git is on PATH -- which it always is here, installed on the
            # line above. Confirmed real, reproducible failure in this
            # sandbox (not a guess): `git clone https://github.com/nvm-sh/nvm`
            # errors `fatal: could not read Username for 'https://github.com'`
            # on an unauthenticated public clone -- hit this identically on
            # both agents/codex_harness/agent.py's own nvm install (same
            # snippet, same bug, fixed there first) and here. `METHOD=script`
            # is nvm's own documented override to force its curl/tarball
            # path instead (verified against nvm v0.40.2's own install.sh
            # source: `if [ -z "${METHOD}" ]; then if nvm_has git; then
            # install_nvm_from_git ... elif [ "${METHOD}" = 'script' ] ...
            # install_nvm_as_script`). NOT `NVM_METHOD` -- that name doesn't
            # exist in the script.
            env={"METHOD": "script"},
        )
        self._phase_ts["dependency_setup_time"] = (t1, _now_iso())

        # agent_install_time: symlink the resolved pi binary + version probe.
        t2 = _now_iso()
        pi_bin = (_REMOTE_STACK_DIR / "npm" / "node_modules" / ".bin" / "pi").as_posix()
        await self.exec_as_root(
            environment,
            command=f"ln -sf {shlex.quote(pi_bin)} /usr/local/bin/pi",
        )
        await self.exec_as_agent(environment, command=". ~/.nvm/nvm.sh; pi --version")
        self._phase_ts["agent_install_time"] = (t2, _now_iso())

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")
        provider, model_id = self.model_name.split("/", 1)

        if not _LOCAL_PI_AUTH_JSON.is_file():
            raise ValueError(f"Local Pi auth.json not found: {_LOCAL_PI_AUTH_JSON}")
        full_auth = json.loads(_LOCAL_PI_AUTH_JSON.read_text())
        redacted_auth = {
            name: full_auth[name] for name in _AUTH_PROVIDERS if name in full_auth
        }
        if provider not in redacted_auth:
            raise ValueError(
                f"Main-model provider {provider!r} has no entry in "
                f"{_LOCAL_PI_AUTH_JSON} (checked {_AUTH_PROVIDERS})"
            )

        remote_stack_dir = _REMOTE_STACK_DIR.as_posix()
        remote_auth_path = (_REMOTE_STACK_DIR / "auth.json").as_posix()
        await self._upload_config_text(
            environment,
            content=json.dumps(redacted_auth, indent=2) + "\n",
            remote_path=remote_auth_path,
            filename="auth.json",
        )

        escaped_instruction = shlex.quote(instruction)
        env = {"PI_CODING_AGENT_DIR": remote_stack_dir}
        agent_dir = EnvironmentPaths.agent_dir.as_posix()

        # A5: process-spawn instant, the start of agent_startup_time (ends at
        # Pi's own "session" NDJSON event timestamp -- see pi_normalizer.py).
        self._process_started_at = _now_iso()
        await self.exec_as_agent(
            environment,
            command=(
                f". ~/.nvm/nvm.sh; "
                f"pi --print --mode json --approve "
                f"--session-dir {agent_dir}/pi/sessions "
                f"--provider {provider} --model {model_id} "
                f"{escaped_instruction} "
                f'2>&1 </dev/null | grep -v \'"type":"message_update"\' | '
                f"stdbuf -oL tee {agent_dir}/{_OUTPUT_FILENAME}"
            ),
            env=env,
        )

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        output_file = self.logs_dir / _OUTPUT_FILENAME
        if not output_file.exists():
            return

        subagent_artifacts_dirs = list(self.logs_dir.rglob("subagent-artifacts"))

        try:
            harbor_version = importlib.metadata.version("harbor")
        except importlib.metadata.PackageNotFoundError:
            harbor_version = None

        telemetry = build_pi_telemetry(
            output_file,
            phase_timestamps=getattr(self, "_phase_ts", None),
            process_started_at=getattr(self, "_process_started_at", None),
            version_manifest=getattr(self, "_version_manifest", None),
            harbor_version=harbor_version,
            adapter_name=self.name(),
            adapter_version=_ADAPTER_VERSION,
            subagent_artifacts_dir=subagent_artifacts_dirs[0] if subagent_artifacts_dirs else None,
        )

        # Harbor's own core AgentContext fields, derived from the SAME
        # computed telemetry (not a second, independently-summed pass) --
        # n_input_tokens keeps Pi's "fresh + cache-read" semantics per
        # Harbor's own convention (see TokenBreakdown docstring).
        tokens = telemetry.tokens
        context.n_input_tokens = (tokens.input_fresh or 0) + (tokens.input_cache_read or 0)
        context.n_output_tokens = tokens.output
        context.n_cache_tokens = tokens.input_cache_read
        context.cost_usd = tokens.cost_usd

        context.metadata = context.metadata or {}
        context.metadata[TELEMETRY_NAMESPACE] = telemetry.model_dump(mode="json")
