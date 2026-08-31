"""Benchmark v2 Pi adapter for Harbor.

Extends Harbor's built-in ``Pi`` agent (``harbor.agents.installed.pi:Pi``),
registered under a distinct name (see "Namenskollision" in
``/home/d/.claude/plans/arbeitsauftrag-pi-vs-codex-benchmark-eager-sparkle.md``).

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

import json
import shlex
from pathlib import Path, PurePosixPath
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.model_connection import ModelConnectionSpec
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths

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


class PiHarnessTrackA(BaseInstalledAgent):
    """Track A (autonomous, no clarification questions expected). Real
    production stack + real provider OAuth (main model and subagent
    roles), per module docstring."""

    SUPPORTS_RESUME: bool = True
    MODEL_CONNECTION = ModelConnectionSpec(passthrough=True)

    @staticmethod
    @override
    def name() -> str:
        return "pi-harness-stub"

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

        # git: pi-subagents resolves its exactly-pinned fork via a runtime
        # `git clone` into PI_CODING_AGENT_DIR/git/... (see docs/subagents.md
        # "gepinnter daydaylx/pi-subagents-Fork") even though a resolved copy
        # already ships inside npm/node_modules -- confirmed by a real
        # `spawn git ENOENT` failure without this dependency.
        await self.ensure_system_dependencies(environment, ("curl", "git"))
        await self.exec_as_agent(
            environment,
            command=f"set -euo pipefail; {nvm_node_install_snippet()}",
        )

        remote_stack_dir = _REMOTE_STACK_DIR.as_posix()
        remote_tarball_path = _REMOTE_TARBALL_PATH.as_posix()
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

        pi_bin = (_REMOTE_STACK_DIR / "npm" / "node_modules" / ".bin" / "pi").as_posix()
        await self.exec_as_root(
            environment,
            command=f"ln -sf {shlex.quote(pi_bin)} /usr/local/bin/pi",
        )
        await self.exec_as_agent(environment, command=". ~/.nvm/nvm.sh; pi --version")

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

        await self.exec_as_agent(
            environment,
            command=(
                f". ~/.nvm/nvm.sh; "
                f"pi --print --mode json "
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

        total_input_tokens = 0
        total_output_tokens = 0
        total_cache_read_tokens = 0
        total_cache_write_tokens = 0
        total_cost = 0.0

        for line in output_file.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except (json.JSONDecodeError, AttributeError, TypeError):
                continue
            if event.get("type") != "message_end":
                continue
            message = event.get("message") or {}
            if message.get("role") != "assistant":
                continue
            usage = message.get("usage") or {}
            total_input_tokens += usage.get("input", 0)
            total_output_tokens += usage.get("output", 0)
            total_cache_read_tokens += usage.get("cacheRead", 0)
            total_cache_write_tokens += usage.get("cacheWrite", 0)
            cost = usage.get("cost") or {}
            total_cost += cost.get("total", 0.0)

        context.n_input_tokens = total_input_tokens + total_cache_read_tokens
        context.n_output_tokens = total_output_tokens
        context.n_cache_tokens = total_cache_read_tokens
        context.cost_usd = total_cost if total_cost > 0 else None
