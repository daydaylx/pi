"""Harte Gates fuer Plan->Work-Laeufe, gemeinsam fuer Pi- und Codex-Treiber.

Trennung nach dem Arbeitsauftrag:
  - Vor-Freigabe-Gates (`PRE_APPROVAL`): muessen bestehen, BEVOR eine Freigabe
    ausgeloest wird. Ein Verstoss ist ein harter Fehler des Laufs.
  - Nach-Freigabe-Gates (`POST_APPROVAL`): muessen nach Abschluss des
    Work-Turns bestehen.

Jedes Gate liefert ein GateResult. `summarize()` fasst zusammen, ob alle
PFLICHT-Gates bestanden sind -- nur das entscheidet ueber den Exitcode eines
Plan->Work-Laufs. Informative (nicht-Pflicht-)Gates duerfen fehlschlagen, ohne
den Lauf ungueltig zu machen (z.B. eine nicht mechanisch pruefbare
Abschlusskriterium-Formulierung).
"""

from __future__ import annotations

import fnmatch
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class GateResult:
    name: str
    required: bool
    ok: bool
    detail: str = ""


def git_status_porcelain(workdir: str | Path) -> list[str]:
    r = subprocess.run(
        ["git", "-C", str(workdir), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    )
    return [line for line in r.stdout.splitlines() if line.strip()]


def check_no_project_mutation_before_approval(
    workdir: str | Path, allowed_untracked_prefixes: tuple[str, ...] = ()
) -> GateResult:
    """Keine getrackten Aenderungen, keine unerlaubten untracked Dateien."""
    lines = git_status_porcelain(workdir)
    tracked_changes = [l for l in lines if not l.startswith("??")]
    untracked = [l[3:].strip() for l in lines if l.startswith("??")]
    disallowed_untracked = [
        u for u in untracked if not any(u.startswith(p) for p in allowed_untracked_prefixes)
    ]
    ok = not tracked_changes and not disallowed_untracked
    detail = ""
    if tracked_changes:
        detail += f"getrackte Aenderungen: {tracked_changes}. "
    if disallowed_untracked:
        detail += f"unerlaubte untracked Dateien: {disallowed_untracked}."
    return GateResult("no_project_mutation_before_approval", True, ok, detail)


def check_plan_artifact_present(plan_path: Path) -> GateResult:
    ok = plan_path.exists() and plan_path.stat().st_size > 0
    detail = "" if ok else f"kein Planartefakt unter {plan_path}"
    return GateResult("plan_artifact_present", True, ok, detail)


def check_plan_hash_recorded(expected_hash: str | None) -> GateResult:
    ok = bool(expected_hash)
    detail = "" if ok else "kein Planhash aufgezeichnet"
    return GateResult("plan_hash_recorded", True, ok, detail)


def check_plan_belongs_to_session(plan_session_id: str, run_session_id: str) -> GateResult:
    ok = plan_session_id == run_session_id
    detail = "" if ok else f"Plan-Session {plan_session_id!r} != Lauf-Session {run_session_id!r}"
    return GateResult("plan_belongs_to_session", True, ok, detail)


def check_plan_quality(quality_ok: bool | None, issues: list | None = None) -> GateResult:
    """quality_ok=None bedeutet: Qualitaets-Gate konnte nicht ausgewertet werden
    (z.B. Bruecke nicht ladbar) -- zaehlt als Fehlschlag, nicht als Erfolg."""
    ok = quality_ok is True
    detail = "" if ok else f"Quality-Gate nicht bestanden oder unauswertbar: {issues}"
    return GateResult("plan_quality_gate", True, ok, detail)


def check_planning_turn_settled(settled: bool) -> GateResult:
    return GateResult(
        "planning_turn_settled", True, settled, "" if settled else "kein agent_settled beobachtet"
    )


def check_approval_not_preconsumed(preconsumed: bool) -> GateResult:
    ok = not preconsumed
    detail = "" if ok else "Freigabe wurde vor dem vorgesehenen Zeitpunkt verbraucht"
    return GateResult("no_premature_approval", True, ok, detail)


def check_allowed_followups_only(
    asked_questions: list[str], allowed: dict[str, str]
) -> GateResult:
    """Waehrend der Planungsphase gestellte Rueckfragen muessen alle in der
    Task-Konfiguration vorgesehen sein (feste Antwort). Eine unvorgesehene
    Rueckfrage ist ein harter Fehler, keine Gelegenheit fuer den Treiber, sich
    eine Antwort auszudenken."""
    unexpected = [q for q in asked_questions if q not in allowed]
    ok = not unexpected
    detail = "" if ok else f"unvorgesehene Rueckfragen: {unexpected}"
    return GateResult("only_allowed_followups", True, ok, detail)


# ---- Nach der Freigabe ----


def check_approval_used_exactly_once(approval_count: int) -> GateResult:
    ok = approval_count == 1
    return GateResult(
        "approval_used_exactly_once", True, ok, f"approval_count={approval_count}"
    )


def check_work_mode_used(mode_during_work_turn: str) -> GateResult:
    ok = mode_during_work_turn == "work"
    detail = "" if ok else f"Work-Turn lief im Modus {mode_during_work_turn!r}"
    return GateResult("work_mode_used", True, ok, detail)


def check_checkers_ran(has_checker: bool, checker_exit: int | None) -> GateResult:
    """Nur ein Pflichtgate, wenn der Task ueberhaupt einen Checker definiert."""
    if not has_checker:
        return GateResult("checkers_ran", False, True, "kein Checker fuer diesen Task definiert")
    ok = checker_exit is not None
    detail = "" if ok else "Checker wurde trotz vorhandenem checker.sh nicht ausgefuehrt"
    return GateResult("checkers_ran", True, ok, detail)


def check_forbidden_surface_untouched(
    changed_paths: list[str], forbidden_prefixes: tuple[str, ...]
) -> GateResult:
    if not forbidden_prefixes:
        return GateResult("forbidden_surface_untouched", False, True, "keine verbotene Surface definiert")
    hits = [
        p for p in changed_paths if any(fnmatch.fnmatch(p, f"{prefix}*") for prefix in forbidden_prefixes)
    ]
    ok = not hits
    detail = "" if ok else f"verbotene Pfade veraendert: {hits}"
    return GateResult("forbidden_surface_untouched", True, ok, detail)


def check_run_completed_without_error(completed: bool, error: str | None) -> GateResult:
    """Der in scripts/pi-duel behobene Kernfehler: completed=False oder ein
    gesetzter error-Wert darf NIE stillschweigend als Erfolg durchgehen, auch
    wenn success=None (kein Checker) ist."""
    ok = completed and not error
    detail = "" if ok else f"completed={completed} error={error!r}"
    return GateResult("run_completed_without_error", True, ok, detail)


def summarize(gates: list[GateResult]) -> dict:
    required_failed = [g for g in gates if g.required and not g.ok]
    return {
        "gates": [asdict(g) for g in gates],
        "all_required_passed": not required_failed,
        "failed_required": [g.name for g in required_failed],
    }
