#!/usr/bin/env python3
"""Erfasst einen vollstaendigen, robusten Fingerprint vor einem real-duel-Lauf.

Ersetzt das fruehere fingerprint.sh (Bash-Heredoc-JSON war fehleranfaellig bei
Sonderzeichen in Dateinamen und konnte keine strukturierten Config-Hashes
liefern). Kann sowohl importiert (compute_fingerprint) als auch direkt
aufgerufen werden (druckt JSON auf stdout).

Hasht NIEMALS auth.json, models-store.json oder andere Dateien, die
OAuth-Tokens/API-Keys enthalten koennen -- nur nicht-geheime
Konfigurationsartefakte (settings.json, AGENTS.md, APPEND_SYSTEM.md,
Codex config.toml/instructions.md, Candidate-Manifeste, Task-Instruction).
"""

import hashlib
import json
import os
import subprocess
import sys
import time

REPO = "/home/d/.pi/agent"
CODEX_HOME = os.path.expanduser("~/.codex")
OPENBENCH_HOME = os.path.expanduser("~/.local/share/real-duel/openbench")


def _sha256_file(path):
    if not os.path.isfile(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()


def _sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _run(cmd, cwd=None):
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=10)
        return proc.stdout.strip() if proc.returncode == 0 else None
    except Exception:
        return None


def _git_status_porcelain(repo):
    proc = subprocess.run(["git", "-C", repo, "status", "--porcelain"],
                           capture_output=True, text=True, timeout=15)
    lines = [l for l in proc.stdout.splitlines() if l.strip()]
    return lines


def _pi_reasoning():
    settings_path = os.path.join(REPO, "settings.json")
    try:
        with open(settings_path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data.get("defaultThinkingLevel")
    except Exception:
        return None


def _codex_reasoning():
    config_path = os.path.join(CODEX_HOME, "config.toml")
    try:
        import tomllib
        with open(config_path, "rb") as fh:
            data = tomllib.load(fh)
        return data.get("model_reasoning_effort")
    except Exception:
        return None


def _openbench_ref():
    sha = _run(["git", "rev-parse", "HEAD"], cwd=OPENBENCH_HOME)
    tag = _run(["git", "describe", "--tags", "--exact-match"], cwd=OPENBENCH_HOME)
    return sha, tag


def compute_fingerprint(candidates=None, task_instruction=None, dirty_override=False,
                         model=None):
    """candidates: dict[name -> obench.candidates.ManifestHarness] (optional).
    task_instruction: raw instruction.md text of the task about to run (optional).
    Returns a fully-populated fingerprint dict. Never raises on missing optional
    pieces -- fields degrade to null rather than aborting the fingerprint itself.
    """
    dirty_lines = _git_status_porcelain(REPO)
    canonical_repo_clean = len(dirty_lines) == 0
    base_sha = _run(["git", "rev-parse", "HEAD"], cwd=REPO)

    pi_version = _run(["pi", "--version"])
    codex_version = _run(["codex", "--version"])
    openbench_sha, openbench_tag = _openbench_ref()

    fp = {
        "base_sha": base_sha,
        "canonical_repo_clean": canonical_repo_clean,
        "dirty_files_list": dirty_lines,
        "dirty_override": bool(dirty_override),
        "comparable": canonical_repo_clean,

        "pi_version": pi_version,
        "codex_version": codex_version,

        "pi_model": None,
        "codex_model": None,
        "pi_reasoning": _pi_reasoning(),
        "codex_reasoning": _codex_reasoning(),

        "openbench_sha": openbench_sha,
        "openbench_tag": openbench_tag,

        "pi_candidate_manifest_hash": None,
        "codex_candidate_manifest_hash": None,
        "task_prompt_hash": _sha256_text(task_instruction) if task_instruction else None,

        "agents_md_hash": _sha256_file(os.path.join(REPO, "AGENTS.md")),
        "settings_json_hash": _sha256_file(os.path.join(REPO, "settings.json")),
        "append_system_md_hash": _sha256_file(os.path.join(REPO, "APPEND_SYSTEM.md")),
        "codex_config_toml_hash": _sha256_file(os.path.join(CODEX_HOME, "config.toml")),
        "codex_instructions_md_hash": _sha256_file(os.path.join(CODEX_HOME, "instructions.md")),

        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    if candidates:
        for name, candidate in candidates.items():
            digest = candidate.provenance.get("spec_sha256") if candidate.provenance else None
            model_id = (candidate.models.get(model, model) if model and candidate.models
                        else None)
            if name == "pi-real":
                fp["pi_candidate_manifest_hash"] = digest
                fp["pi_model"] = model_id
            elif name == "codex-real":
                fp["codex_candidate_manifest_hash"] = digest
                fp["codex_model"] = model_id

    return fp


def main():
    dirty_override = "--allow-dirty" in sys.argv[1:]
    fp = compute_fingerprint(dirty_override=dirty_override)
    print(json.dumps(fp, indent=2))
    if not fp["canonical_repo_clean"] and not dirty_override:
        print(
            "\nERROR:\nrepository is dirty\n"
            "real-duel requires a clean canonical configuration baseline",
            file=sys.stderr,
        )
        return 1
    if not fp["canonical_repo_clean"] and dirty_override:
        print(
            f"\nWARN: --allow-dirty set, proceeding despite "
            f"{len(fp['dirty_files_list'])} dirty/untracked path(s) — "
            "run will be marked comparable=false",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
