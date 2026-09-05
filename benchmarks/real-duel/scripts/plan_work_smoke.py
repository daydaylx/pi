#!/usr/bin/env python3
"""E2E-Smoke-Test der Plan->Work-Mechanik gegen ECHTE Binaries (`pi`, `codex`).

Kein Worktree, kein Fingerprint, kein OpenBench-Overhead -- eigenes
`git init`-Scratch-Verzeichnis pro Zweig. Zweck: RPC-Framing, Hash-Bindung,
Session-Fortsetzung, Artefaktpfade und die in pi_rpc_driver.py/
codex_plan_work_driver.py dokumentierten "Unverifiziert bis zum Pilot"-
Annahmen einmal gegen echte Prozesse bestaetigen, BEVOR ein kostenpflichtiger
Benchmarklauf (pi-duel smoke/run --workflow plan-work) startet.

Verursacht reale, aber minimale Kosten (ein trivialer Plan- und Work-Turn je
Kandidat) -- vor Ausfuehrung mit dem User abstimmen, auch wenn die
Groessenordnung klein ist.

Exitcode 0 nur wenn ALLE Pruefpunkte PASS.

Benutzung:
    plan_work_smoke.py --model <guenstiges-modell>
    plan_work_smoke.py --model <m> --only pi
    plan_work_smoke.py --model <m> --codex-model <anderes-modell> --only codex
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import codex_plan_work_driver as codex_pw  # noqa: E402
import pi_rpc_driver as pi_rpc  # noqa: E402
import plan_quality_bridge as quality_bridge  # noqa: E402
import plan_work_gates as gates  # noqa: E402
import telemetry  # noqa: E402

APPROVAL_TEXT = (
    "Der erstellte Plan ist freigegeben. Setze ihn jetzt vollstaendig um, "
    "fuehre die vorgesehenen Pruefungen aus und berichte verbleibende "
    "Abweichungen."
)


class SmokeCheck:
    def __init__(self) -> None:
        self.results: list[tuple[str, bool, str]] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.results.append((name, ok, detail))
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name}" + (f" -- {detail}" if detail else ""))
        return ok

    def all_passed(self) -> bool:
        return bool(self.results) and all(ok for _, ok, _ in self.results)


def _init_scratch_repo(prefix: str) -> Path:
    scratch = Path(tempfile.mkdtemp(prefix=prefix))
    subprocess.run(["git", "init", "-q"], cwd=scratch, check=True)
    subprocess.run(["git", "config", "user.email", "smoke@local"], cwd=scratch, check=True)
    subprocess.run(["git", "config", "user.name", "plan-work-smoke"], cwd=scratch, check=True)
    (scratch / "README.md").write_text("plan-work-smoke scratch repo\n", encoding="utf-8")
    subprocess.run(["git", "add", "-A"], cwd=scratch, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=scratch, check=True)
    return scratch


def run_pi_smoke(check: SmokeCheck, *, model: str, provider: str, timeout: float) -> None:
    scratch = _init_scratch_repo("plan-work-smoke-pi-")
    target = scratch / "PLAN_SMOKE_OK.txt"
    # Bewusst nicht nur "lege eine Datei mit Inhalt X an": ein erster Lauf mit
    # exakt dieser Ein-Zeilen-Aufgabe hat gezeigt, dass das Modell dafuer
    # KEINEN plan_write-Aufruf macht, sondern direkt um Moduswechsel bittet
    # (nachvollziehbar -- SHARED_RULES in prompts.ts verbietet erfundene
    # Abschnittsinhalte, und fuer eine Ein-Datei-Aufgabe gibt es nichts zu
    # planen). Zwei Dateien mit einer winzigen echten Formulierungsentscheidung
    # sind der kleinste Fall, der plausibel noch einen Schnellplan ausloest.
    instruction = (
        f"Lege eine Datei {target.name} mit dem Inhalt ok an UND ergaenze "
        "eine zweite, neue Datei NOTES.md mit genau einer Ueberschrift, die "
        f"kurz erklaert, wozu {target.name} dient. Entscheide selbst, wie du "
        "die Ueberschrift knapp formulierst."
    )
    print(f"(scratch: {scratch})")

    # log_dir bewusst AUSSERHALB des geprueften Scratch-Repos -- sonst zeigt
    # der no_mutation_before_approval-Gate faelschlich das eigene RPC-
    # Transkript des Treibers als unerlaubte untracked Aenderung an (gleiche
    # Ursache wie beim Codex-out_dir-Fix oben; in echt liegt TRANSCRIPTS_DIR
    # in pi-duel ebenfalls ausserhalb des Task-Worktrees).
    log_dir = Path(tempfile.mkdtemp(prefix="plan-work-smoke-pi-log-"))
    plan_result = None
    try:
        try:
            plan_result = pi_rpc.run_plan_phase(
                cwd=str(scratch),
                model=model,
                provider=provider,
                instruction=instruction,
                plan_mode="simple_plan",
                followups={},
                quality_check=quality_bridge.check_plan_quality,
                timeout=timeout,
                log_dir=log_dir,
            )
        except Exception as exc:  # noqa: BLE001 -- jeder Fehler hier ist ein Smoke-Fehlschlag
            check.check("pi: planning_turn_completes", False, str(exc))
            return

        check.check("pi: planning_turn_settled", plan_result.settled)
        check.check(
            "pi: plan_artifact_present",
            plan_result.plan_path.exists() and plan_result.plan_path.stat().st_size > 0,
            str(plan_result.plan_path),
        )
        pre_status = gates.git_status_porcelain(scratch)
        check.check("pi: no_mutation_before_approval", not pre_status, str(pre_status))
        check.check("pi: target_not_yet_created", not target.exists())

        if not check.check(
            "pi: plan_quality_gate",
            plan_result.quality_ok is True,
            f"issues={plan_result.quality_issues}",
        ):
            print(
                "HINWEIS: trivialer Smoke-Plan besteht den Quality-Gate nicht -- "
                "das ist ein Befund fuer die Taskgestaltung des Piloten (Abschnitt 6 "
                "des Plans), kein Infra-Fehler. Work-Phase wird trotzdem versucht, "
                "um den Rest der Mechanik zu pruefen."
            )

        try:
            work_result = pi_rpc.approve_and_run_work(plan_result, timeout=timeout)
        except pi_rpc.PlanQualityGateFailed as exc:
            check.check("pi: approval_triggers_work_turn", False, str(exc))
            return
        except Exception as exc:  # noqa: BLE001
            check.check("pi: approval_triggers_work_turn", False, str(exc))
            return

        check.check(
            "pi: approval_used_exactly_once",
            gates.check_approval_used_exactly_once(work_result.approval_count).ok,
            f"approval_count={work_result.approval_count}",
        )
        check.check(
            "pi: plan_belongs_to_session",
            gates.check_plan_belongs_to_session(
                plan_result.session_id, work_result.session_id_after
            ).ok,
            f"plan={plan_result.session_id} work={work_result.session_id_after}",
        )
        check.check(
            "pi: no_premature_approval",
            gates.check_approval_not_preconsumed(work_result.preconsumed).ok,
            f"preconsumed={work_result.preconsumed}",
        )
        check.check("pi: target_created_after_approval", target.exists())
    finally:
        if plan_result is not None:
            plan_result.sess.close()


def run_codex_smoke(check: SmokeCheck, *, model: str, timeout: float) -> None:
    scratch = _init_scratch_repo("plan-work-smoke-codex-")
    target = scratch / "PLAN_SMOKE_OK.txt"
    # WICHTIG: out_dir liegt bewusst AUSSERHALB des geprueften Scratch-Repos --
    # sonst zeigt der no_mutation_before_approval-Gate faelschlich die eigenen
    # Transkript-/Last-message-Dateien des Treibers als unerlaubte untracked
    # Aenderung an (self-inflicted false positive, in echt spiegelt das
    # TRANSCRIPTS_DIR in pi-duel, das ebenfalls ausserhalb des Task-Worktrees
    # liegt).
    out_dir = Path(tempfile.mkdtemp(prefix="plan-work-smoke-codex-out-"))
    plan_instruction = f"Lege SOFORT eine Datei namens {target.name} mit dem Inhalt ok an."
    print(f"(scratch: {scratch})")

    t0 = time.monotonic()
    try:
        plan_result = codex_pw.run_plan_phase(
            cwd=str(scratch), model=model, instruction=plan_instruction,
            output_dir=out_dir, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        check.check(
            "codex: plan_turn_does_not_hang", False,
            f"Timeout nach {timeout}s -- read-only-Sandbox ohne --approve-for-me "
            "haengt moeglicherweise doch bei einem verweigerten Schreibversuch",
        )
        return
    except Exception as exc:  # noqa: BLE001
        check.check("codex: plan_turn_completes", False, str(exc))
        return
    elapsed = time.monotonic() - t0
    check.check("codex: plan_turn_does_not_hang", elapsed < timeout, f"{elapsed:.1f}s")
    check.check("codex: target_not_created_in_readonly_sandbox", not target.exists())
    check.check(
        "codex: session_id_found", bool(plan_result.session_id), plan_result.session_id or ""
    )

    pre_status = gates.git_status_porcelain(scratch)
    check.check("codex: no_mutation_before_approval", not pre_status, str(pre_status))

    try:
        work_result = codex_pw.run_approval_and_work(
            cwd=str(scratch),
            model=model,
            session_id=plan_result.session_id,
            approval_text=APPROVAL_TEXT,
            output_dir=out_dir,
            timeout=timeout,
        )
    except Exception as exc:  # noqa: BLE001
        check.check("codex: resume_call_succeeds", False, str(exc))
        return

    if not check.check(
        "codex: resume_call_succeeds",
        work_result.returncode == 0,
        f"returncode={work_result.returncode}",
    ):
        print(
            "HINWEIS: falls hier ein Argument-Parse-Fehler auftaucht, ist der "
            "Override-Wert 'approval_mode=never' vermutlich falsch -- alternative "
            "Werte ('on-request', 'untrusted', 'approve') gegen "
            "`codex exec resume --help` bzw. Fehlermeldung pruefen."
        )
    check.check("codex: target_created_after_resume", target.exists())
    check.check(
        "codex: plan_belongs_to_session",
        gates.check_plan_belongs_to_session(
            plan_result.session_id, work_result.session_id_after
        ).ok,
        f"plan={plan_result.session_id} work={work_result.session_id_after}",
    )

    try:
        split = telemetry.split_codex_plan_work(
            plan_result.transcript_path.read_text(encoding="utf-8"),
            work_result.transcript_path.read_text(encoding="utf-8"),
        )
        # consistent=False ist ein dokumentierter, moeglicher Ausgang (siehe
        # codex_plan_work_driver.py-Docstring) -- die Kumulativitaets-Annahme
        # kann sich als falsch herausstellen, split_codex_plan_work faengt das
        # bereits per work_phase_cumulative-Fallback ab. Das ist ein
        # informativer Befund, kein Smoke-Test-Fehlschlag; PASS heisst hier
        # nur "die Funktion lief durch und lieferte ein plausibles Ergebnis".
        check.check(
            "codex: telemetry_split_runs",
            "consistent" in split and "plan_phase" in split,
            str(split),
        )
        if not split.get("consistent"):
            print(
                f"HINWEIS: Kumulativitaets-Annahme widerlegt ({split.get('inconsistency_reason')}) "
                "-- work_phase_cumulative wird stattdessen verwendet (bereits vorgesehenes Verhalten)."
            )
    except Exception as exc:  # noqa: BLE001
        check.check("codex: telemetry_split_runs", False, str(exc))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", required=True,
        help="Guenstiges/schnelles Modell fuer den Smoke-Test -- bewusst NICHT die "
        "Benchmark-Konstante aus pi-duel (MODEL), um Kosten zu minimieren.",
    )
    parser.add_argument(
        "--codex-model", default=None,
        help="Abweichendes Modell fuer den Codex-Zweig (Default: --model)",
    )
    parser.add_argument(
        "--provider", default="openai-codex",
        help="Pi-Provider, muss mit candidates/pi-real.toml uebereinstimmen (default: openai-codex)",
    )
    parser.add_argument("--timeout", type=float, default=120, help="Timeout je Turn in Sekunden (default: 120)")
    parser.add_argument("--only", choices=["pi", "codex", "both"], default="both")
    args = parser.parse_args()

    check = SmokeCheck()
    print("=== Plan-Work Smoke-Test gegen ECHTE Binaries (pi, codex) ===")
    print(f"Modell: {args.model} | Timeout je Turn: {args.timeout}s\n")

    if args.only in ("pi", "both"):
        print("--- Pi-Zweig ---")
        run_pi_smoke(check, model=args.model, provider=args.provider, timeout=args.timeout)
        print()

    if args.only in ("codex", "both"):
        print("--- Codex-Zweig ---")
        run_codex_smoke(check, model=args.codex_model or args.model, timeout=args.timeout)
        print()

    print("=== Ergebnis ===")
    for name, ok, detail in check.results:
        marker = "PASS" if ok else "FAIL"
        suffix = f"  ({detail})" if detail and not ok else ""
        print(f"  {marker}  {name}{suffix}")

    if check.all_passed():
        print("\nAlle Pruefpunkte PASS.")
        return 0
    failed = [n for n, ok, _ in check.results if not ok]
    print(f"\nFAIL: {failed}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
