"""Codex Plan->Work-Treiber: kleinste transparente Entsprechung zu Pis
Planmodus, KEIN aequivalenter Mechanismus.

Codex (codex-cli 0.149.1) besitzt keinen hash-gebundenen Plan-/Freigabe-
Mechanismus. Das eigene `update_plan`-Tool ist ein Fortschritts-/TODO-Tool
innerhalb eines beliebigen Turns, keine Modus-/Freigabegrenze. Es gibt aber:

  - `codex exec -s read-only`: eine ECHTE technische Schreibsperre
    (OS-Sandbox), keine reine Prompt-Konvention. Kein `-a/--ask-for-approval`
    auf `codex exec` -- empirisch verifiziert (`codex exec --help`), dieses
    Flag existiert auf diesem Subcommand nicht. Ohne `--approve-for-me` gilt
    laut Doku: verweigerte Aktionen werden dem Modell direkt zurueckgemeldet,
    kein Approval-Dialog, kein Haengenbleiben -- das ist der zentrale
    Pruefpunkt im Stufe-1-Pilot.
  - `codex exec resume <session-id> ...`: nicht-interaktive Fortsetzung
    derselben, auf Platte persistierten Session -- anders als bei Pi lebt der
    Sitzungszustand hier NICHT nur im Prozessspeicher, ein neuer Prozess kann
    dieselbe Session fortsetzen. `codex exec resume` hat einen SCHMALEREN
    Flag-Satz als `codex exec` selbst -- empirisch verifiziert
    (`codex exec resume --help`): kein `-s/--sandbox`, kein
    `--approve-for-me`. Sandbox/Approval fuer den Work-Turn muessen ueber
    `-c sandbox_mode=...`/`-c approval_mode=...` gesetzt werden (Schluessel
    aus `~/.codex/config.toml` uebernommen, dort `approval_mode` -- NICHT
    `approval_policy`). Der genaue Override-WERT (`"never"` vs. ein anderer
    gueltiger Enum-Wert dieser Codex-Version) ist nicht dokumentiert
    bestaetigt und muss im Pilot geprueft werden.

Nachgebaut wird die Zwei-Phasen-Form ohne die Kernsicherung, die Pi hat: Es
gibt keine kryptographische Bindung der Freigabe an den exakten Plantext.
Turn 2 ist einfach der naechste Turn in derselben Session. Das MUSS im
Ergebnisbericht als Harness-Unterschied ausgewiesen werden, niemals als
gleichwertiger Mechanismus.

Wichtiger Nebeneffekt von `approval_mode=never` im Work-Turn: es lehnt jede
Sandbox-Eskalation (Netzwerk, Paketinstallation) ab, statt sie wie
`--approve-for-me` automatisch zu pruefen -- strenger, nicht gleichwertig.
Aufgaben fuer Codex-Plan->Work muessen deshalb ohne Netzwerk-/
Installationsbedarf auskommen.

Unverifiziert bis zum ersten echten Testlauf (Stufe 1, technischer Pilot):
  - Exakter Feldname der Session-/Thread-ID im `--json`-Eventstrom (dieses
    Modul sucht mehrere plausible Namen, siehe _extract_session_id).
  - Ob der `read-only`-Sandbox tatsaechlich JEDEN Schreibversuch verhindert
    (inkl. eines etwaigen Patch-/apply_patch-Wegs, nicht nur Shell-Befehle)
    und ob der Plan-Turn ohne `--approve-for-me` tatsaechlich nicht haengt.
  - Der exakte Override-Wert fuer `approval_mode` (siehe oben).
  - Ob `turn.completed.usage` bei einem `resume`-Aufruf kumulativ ueber die
    GESAMTE Session ist (dann muesste die Work-Phase-Telemetrie die
    Plan-Phase-Telemetrie abziehen) oder nur den neuen Turn zaehlt -- die
    bestehende scripts/telemetry.py-Dokumentation nimmt ersteres an
    (`normalize_codex` nutzt bewusst nur das letzte turn.completed), das gilt
    hier defensiv genauso, mit einer Plausibilitaetspruefung gegen negative
    Deltas.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

_SESSION_ID_KEYS = (
    "session_id",
    "sessionId",
    "thread_id",
    "threadId",
    "conversation_id",
    "conversationId",
)


def _extract_session_id(transcript_lines: list[str]) -> str | None:
    def search(obj) -> str | None:
        if not isinstance(obj, dict):
            return None
        for key in _SESSION_ID_KEYS:
            value = obj.get(key)
            if isinstance(value, str) and value:
                return value
        for nested_key in ("msg", "item", "data"):
            nested = obj.get(nested_key)
            found = search(nested)
            if found:
                return found
        return None

    for line in transcript_lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        found = search(obj)
        if found:
            return found
    return None


@dataclass
class CodexPlanPhaseResult:
    session_id: str
    plan_text: str
    transcript_path: Path
    returncode: int


@dataclass
class CodexWorkPhaseResult:
    transcript_path: Path
    returncode: int
    last_message: str
    session_id_after: str | None


PLAN_ONLY_FRAMING = (
    "Untersuche dieses Repository und erstelle AUSSCHLIESSLICH einen Plan fuer "
    "die folgende Aufgabe. Aendere KEINE Dateien -- du laeufst in einer "
    "read-only-Sandbox, Schreibversuche werden ohnehin verworfen. Beschreibe "
    "konkret: betroffene Dateien, Vorgehen in Schritten, Verifikationsschritte, "
    "Risiken und Nicht-Ziele.\n\nAufgabe:\n"
)


def run_plan_phase(
    *,
    cwd: str,
    model: str,
    instruction: str,
    output_dir: Path,
    timeout: float,
) -> CodexPlanPhaseResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    transcript_path = output_dir / "codex_plan_transcript.jsonl"
    last_message_path = output_dir / "codex_plan_last_message.txt"
    prompt = PLAN_ONLY_FRAMING + instruction

    cmd = [
        "codex",
        "exec",
        "--json",
        "-s",
        "read-only",
        "-m",
        model,
        "-o",
        str(last_message_path),
        prompt,
    ]
    with open(transcript_path, "w", encoding="utf-8") as tf:
        result = subprocess.run(
            cmd, cwd=cwd, stdout=tf, stderr=subprocess.PIPE, text=True, timeout=timeout
        )

    lines = transcript_path.read_text(encoding="utf-8").splitlines()
    session_id = _extract_session_id(lines)
    if session_id is None:
        raise RuntimeError(
            f"Codex: Session-/Thread-ID nicht im --json-Strom gefunden "
            f"({transcript_path}). Eventformat pruefen -- Feldname evtl. geaendert."
        )

    plan_text = last_message_path.read_text(encoding="utf-8") if last_message_path.exists() else ""
    if result.returncode != 0:
        raise RuntimeError(
            f"codex exec (Plan-Phase) beendet mit returncode={result.returncode}: "
            f"{result.stderr[-2000:]}"
        )

    return CodexPlanPhaseResult(
        session_id=session_id,
        plan_text=plan_text,
        transcript_path=transcript_path,
        returncode=result.returncode,
    )


def run_approval_and_work(
    *,
    cwd: str,
    model: str,
    session_id: str,
    approval_text: str,
    output_dir: Path,
    timeout: float,
) -> CodexWorkPhaseResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    transcript_path = output_dir / "codex_work_transcript.jsonl"
    last_message_path = output_dir / "codex_work_last_message.txt"

    cmd = [
        "codex",
        "exec",
        "resume",
        session_id,
        "--json",
        "-c",
        "sandbox_mode=workspace-write",
        "-c",
        "approval_mode=never",
        "-m",
        model,
        "-o",
        str(last_message_path),
        approval_text,
    ]
    with open(transcript_path, "w", encoding="utf-8") as tf:
        result = subprocess.run(
            cmd, cwd=cwd, stdout=tf, stderr=subprocess.PIPE, text=True, timeout=timeout
        )

    last_message = last_message_path.read_text(encoding="utf-8") if last_message_path.exists() else ""
    work_lines = transcript_path.read_text(encoding="utf-8").splitlines()
    return CodexWorkPhaseResult(
        transcript_path=transcript_path,
        returncode=result.returncode,
        last_message=last_message,
        session_id_after=_extract_session_id(work_lines),
    )
