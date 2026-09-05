"""Optionale Workflow-Erweiterung fuer real-duel-Tasks.

Ein Task-Verzeichnis besteht bisher aus `instruction.md` (Pflicht) und
optional `checker.sh`. Diese Datei fuegt eine weitere, ebenfalls optionale
Datei hinzu: `workflow.toml`. Fehlt sie, verhaelt sich ein Task exakt wie vor
dieser Erweiterung -- work-only, keine zusaetzlichen Gates. Bestehende Tasks
(`smoke-01-marker-file`, `real-01-tui-warm-theme`, `real-02-gui-ux-redesign`)
brauchen also keine Aenderung.

Format (alle Felder optional, Defaults siehe WorkflowTaskConfig):

    [workflow]
    supported = ["work-only", "plan-work"]
    plan_mode = "detailed_plan"          # oder "simple_plan"
    approval_text = "..."                # Default: der im Arbeitsauftrag
                                          # festgelegte gemeinsame Freigabetext

    [workflow.followups]
    # erlaubte Rueckfragen -> feste Antworten. Jede Rueckfrage, die waehrend
    # der Planungsphase gestellt wird und hier NICHT aufgefuehrt ist, ist ein
    # Gate-Fehler (siehe plan_work_gates.py) statt einer stillschweigend vom
    # Treiber erfundenen Antwort.
    "Frage-Text exakt wie gestellt" = "feste Antwort"

    [workflow.surface]
    expected = ["pfad/praefix", ...]
    forbidden = ["pfad/praefix", ...]

    [workflow.acceptance]
    criteria = ["...", "..."]
"""

from __future__ import annotations

import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

# Der im Arbeitsauftrag festgelegte gemeinsame semantische Freigabevertrag.
# Bei Pi ist dies NICHT der Text, den `/plan-approve` tatsaechlich als
# Work-Turn-Prompt verschickt (das bleibt Pis eigener PLAN_EXECUTION_PROMPT,
# siehe extensions/plan-mode/events.ts) -- er ist der gemeinsame Vertrag, den
# beide Kandidaten inhaltlich erfuellen sollen, und bei Codex der tatsaechlich
# uebertragene Resume-Prompt.
CANONICAL_APPROVAL_TEXT = (
    "Der erstellte Plan ist freigegeben. Setze ihn jetzt vollstaendig um, "
    "fuehre die vorgesehenen Pruefungen aus und berichte verbleibende "
    "Abweichungen."
)

SUPPORTED_WORKFLOWS = ("work-only", "plan-work")
PLAN_MODES = ("simple_plan", "detailed_plan")


@dataclass(frozen=True)
class WorkflowTaskConfig:
    supported_workflows: tuple[str, ...] = ("work-only",)
    plan_mode: str = "detailed_plan"
    approval_text: str = CANONICAL_APPROVAL_TEXT
    followups: dict[str, str] = field(default_factory=dict)
    expected_surface: tuple[str, ...] = ()
    forbidden_surface: tuple[str, ...] = ()
    acceptance_criteria: tuple[str, ...] = ()
    has_explicit_config: bool = False

    def supports(self, workflow: str) -> bool:
        return workflow in self.supported_workflows


def _as_str_tuple(value, field_name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValueError(f"workflow.toml: '{field_name}' muss eine Liste von Strings sein.")
    return tuple(value)


def load(task_dir: Path) -> WorkflowTaskConfig:
    """Laedt workflow.toml aus task_dir, oder die reinen Work-only-Defaults."""
    path = task_dir / "workflow.toml"
    if not path.exists():
        return WorkflowTaskConfig()

    data = tomllib.loads(path.read_text(encoding="utf-8"))
    wf = data.get("workflow", {})
    if not isinstance(wf, dict):
        raise ValueError(f"{path}: [workflow] fehlt oder ist kein Tabelle.")

    supported = tuple(wf.get("supported", ["work-only"]))
    unknown = [w for w in supported if w not in SUPPORTED_WORKFLOWS]
    if unknown:
        raise ValueError(
            f"{path}: unbekannte Workflows {unknown!r}, erlaubt: {SUPPORTED_WORKFLOWS}"
        )

    plan_mode = wf.get("plan_mode", "detailed_plan")
    if plan_mode not in PLAN_MODES:
        raise ValueError(f"{path}: plan_mode muss einer von {PLAN_MODES} sein, nicht {plan_mode!r}")

    approval_text = wf.get("approval_text", CANONICAL_APPROVAL_TEXT)
    followups = wf.get("followups", {})
    if not isinstance(followups, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in followups.items()
    ):
        raise ValueError(f"{path}: [workflow.followups] muss eine Tabelle von String->String sein.")

    surface = wf.get("surface", {})
    expected_surface = _as_str_tuple(surface.get("expected"), "surface.expected")
    forbidden_surface = _as_str_tuple(surface.get("forbidden"), "surface.forbidden")

    acceptance = wf.get("acceptance", {})
    acceptance_criteria = _as_str_tuple(acceptance.get("criteria"), "acceptance.criteria")

    return WorkflowTaskConfig(
        supported_workflows=supported,
        plan_mode=plan_mode,
        approval_text=approval_text,
        followups=dict(followups),
        expected_surface=expected_surface,
        forbidden_surface=forbidden_surface,
        acceptance_criteria=acceptance_criteria,
        has_explicit_config=True,
    )


if __name__ == "__main__":
    # Kleiner manueller Selbsttest: python3 workflow_task.py <task-dir>
    if len(sys.argv) != 2:
        sys.exit(f"usage: {sys.argv[0]} <task-dir>")
    cfg = load(Path(sys.argv[1]))
    print(cfg)
