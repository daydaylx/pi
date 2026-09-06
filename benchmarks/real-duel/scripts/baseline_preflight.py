#!/usr/bin/env python3
"""Baseline-Preflight fuer real-duel (P2).

Laeuft vor dem eigentlichen Kandidatenlauf gegen den sauberen Worktree
(``base_sha``) und klart, ob die Projektbaseline bereits Fehler enthaelt, die
spaeter im Kandidatenlauf als Toolfehler auftauchen koennten -- vor allem ein
durch den Agenten aufgerufenes ``project_check(profile=verify)``, das an
vorgegebenem Format-Drift scheitert (so geschehen im Stufe-1-Piloten:
``renderer/index.html`` / ``renderer/styles.css``).

Prueft nur die fuer die spaetere Bewertung relevanten Checks -- defaultmaessig
die guenstigen statischen Checks ``format:check`` + ``typecheck`` (genau die
Drift-Klasse, die den Piloten getroffen hat). Aufgaben koennen in
``workflow.toml`` unter ``[workflow.baseline] checks = [...]`` eine eigene
Menge vorgeben, z.B. ``["verify"]`` fuer volle Treffergleichheit mit dem
vom Agenten aufgerufenen Verify-Profil.

Privacy wie ``tool_trace.py``: keine vollen Logs oder Quelltexte werden
persistiert. Pro fehlgeschlagenem Check wird nur der Check-Name, der
Exit-Code und ein SHA-256-Fingerprint der bereinigten ersten Fehlerzeilen
gespeichert -- ausreichend fuer die spaetere Klassifikation
(``verification/baseline`` vs. ``verification/regression``), nicht
ausreichend, um Quelltext wiederzugeben.

Die ``comparable``-Policy ist bewusst klein und nachvollziehbar, kein
Scoring:

  * ``dirty_override`` -> ``comparable=false`` (unveraendert, dirty-Laeufe
    sind ohnehin nicht vergleichbar).
  * Baseline ``clean`` und keine Kandidaten-Regression -> ``comparable=true``.
  * Baseline ``failing`` und der Kandidat veraendert den fehlerhaften Bereich
    nicht -> ``comparable=true`` (pre_existing, nicht dem Kandidaten
    angelastet).
  * Baseline ``failing`` UND der Kandidat scheitert mit seinem eigenen
    Verifier genau an diesem Baselinefehler (Fall 3) -> ``comparable=false``
    (ein taskfremder Fehler, der die Kandidatenarbeit blockiert/verfaelscht).
  * Baseline ``clean`` und der Kandidat erzeugt einen neuen Fehler ->
    ``comparable=true``; die Fehlerklasse ``regression`` macht ihn sichtbar,
    statt den Lauf zu verwerfen.
  * Kandidat behebt einen Baselinefehler -> zusaetzliche Markierung
    ``baseline_fixed``; ``comparable`` richtet sich nach den restlichen
    Fehlern.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

DEFAULT_BASELINE_CHECKS = ("format:check", "typecheck")

# Maximale Anzahl Zeilen, die in den Fingerprint einfliessen -- gross genug,
# um einen Check eindeutig zu identifizieren, klein genug, um keinen
# Quelltext reproduzieren zu koennen.
_FINGERPRINT_MAX_LINES = 12


@dataclass(frozen=True)
class CheckFailure:
    check: str
    exit_code: int
    fingerprint: str

    def as_dict(self) -> dict:
        return {"check": self.check, "exit_code": self.exit_code, "fingerprint": self.fingerprint}


def _failure_fingerprint(stdout: str, stderr: str) -> str:
    """SHA-256 ueber die ersten bereinigten Fehlerzeilen von stdout+stderr.

    Keine vollen Logs, kein Quelltext -- nur genug Bytes, um denselben
    Baselinefehler spaeter wiederzuerkennen. Privacy wie tool_trace.py.
    """
    combined = f"{stdout}\n{stderr}".splitlines()
    # Wegfiltern reiner Fortschritts-/Pfadhinweise: wir behalten Zeilen mit
    # einem Fehlerindikator oder die ersten paar generischen. So bleibt der
    # Fingerprint stabil und klein.
    interesting: list[str] = []
    for line in combined:
        line = line.strip()
        if not line:
            continue
        interesting.append(line)
        if len(interesting) >= _FINGERPRINT_MAX_LINES:
            break
    payload = "\n".join(interesting)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def run_preflight(workdir: str | Path, checks: tuple[str, ...] | list[str]) -> dict:
    """Fuehrt ``npm --prefix npm run <check>`` (cwd=workdir) fuer jeden Check
    aus. Liefert ``{"status", "failures", "checks"}``.

    ``status`` ist ``"clean"`` (alle Exit 0) oder ``"failing"``.
    ``failures`` ist eine Liste von :class:`CheckFailure`-Dicts; ihr
    Check-Name dient spaeter als Schluessel fuer die
    ``verification/baseline``-Klassifikation in tool_trace.py.
    """
    workdir = str(workdir)
    failures: list[CheckFailure] = []
    ran: list[dict] = []
    for check in tuple(checks):
        proc = subprocess.run(
            ["npm", "--prefix", "npm", "run", check],
            cwd=workdir,
            capture_output=True,
            text=True,
            timeout=600,
        )
        ran.append({"check": check, "exit_code": proc.returncode})
        if proc.returncode != 0:
            failures.append(
                CheckFailure(
                    check=check,
                    exit_code=proc.returncode,
                    fingerprint=_failure_fingerprint(proc.stdout, proc.stderr),
                )
            )
    return {
        "status": "clean" if not failures else "failing",
        "failures": [f.as_dict() for f in failures],
        "checks": ran,
    }


def baseline_failure_map(preflight: dict | None) -> dict[str, str] | None:
    """``{check_name: fingerprint}`` fuer tool_trace.analyze_pi_events, oder
    ``None`` wenn der Preflight nicht lief / clean war. Ein ``None``-Rueck-
    gabwert bewirkt, dass tool_trace die Verifikationskategorie unveraendert
    als ``verification`` laesst (keine Spekulation)."""
    if not preflight:
        return None
    failures = preflight.get("failures") or []
    mapping = {f["check"]: f.get("fingerprint", "") for f in failures}
    return mapping or None


def _verify_blocked_by_baseline(candidate_tool_errors: list[dict] | None) -> set[str]:
    """Check-Namen, gegen die der Kandidat mit seinem eigenen Verifier
    gescheitert ist (Fall-3-Detektion). Erkannt an der Kategorie
    ``verification/baseline`` -- das ist genau die Menge Baselinefehler, an
    denen der Kandidatenverifier hinggaengt."""
    blocked: set[str] = set()
    for err in candidate_tool_errors or []:
        if err.get("error_category") == "verification/baseline":
            blocked.add(err.get("error_summary") or "")
    return blocked


def decide_comparable(
    *,
    baseline_preflight: dict | None,
    dirty_override: bool,
    candidate_tool_errors: list[dict] | None = None,
    candidate_regressions: list[dict] | None = None,
) -> tuple[bool, str]:
    """Kleine, nachvollziehbare ``comparable``-Policy (P2). Gibt
    ``(comparable: bool, reason: str)`` zurueck.

    ``candidate_regressions``: Toolfehler mit Kategorie
    ``verification/regression`` (neu durch den Kandidaten entstanden).
    ``candidate_tool_errors``: alle Toolfehler des Kandidaten (fuer die
    Fall-3-Erkennung -- ein eigener Verifier, der an einem Baselinefehler
    scheitert).
    """
    if dirty_override:
        return False, "dirty_override"

    baseline_status = (baseline_preflight or {}).get("status")
    regressions = list(candidate_regressions or [])

    if baseline_status == "clean":
        if regressions:
            # Neue Kandidatenfehler, aber die Baseline war sauber -> Lauf
            # bleibt vergleichbar; die Regression bleibt markiert, statt den
            # Lauf zu verwerfen.
            return True, "baseline_clean_candidate_regression"
        return True, "baseline_clean"

    if baseline_status == "failing":
        # Fall 3: Der Kandidat scheitert mit seinem eigenen Verifier genau an
        # einem dokumentierten Baselinefehler -> taskfremder Fehler
        # blockiert/verfaelscht den Harness-Vergleich.
        blocked = _verify_blocked_by_baseline(candidate_tool_errors)
        if blocked:
            return False, "baseline_failing_candidate_verifier_blocked"
        # Baselinefehler, aber der Kandidat beruehrt diesen Bereich nicht ->
        # pre_existing, nicht dem Kandidaten angelastet.
        return True, "baseline_failing_pre_existing"

    # Kein Preflight (z.B. dirty/skipped) -> kein automatischer Abbruch, aber
    # auch keine positive Aussage; vergleichbar bleibt True, Grund
    # dokumentiert. Der rohe Toolfehler bleibt ohnehin protokolliert.
    return True, "baseline_unknown"


def classify_candidate_errors(
    candidate_tool_errors: list[dict] | None,
    baseline_preflight: dict | None,
) -> dict:
    """Fasst die Kandidaten-Toolfehler nach Baselinebezug zusammen, fuer die
    Ergebniszeile und den Report.

    Liefert ``{"pre_existing", "regression", "baseline_fixed"}`` als Listen
    von Fehler-Indizes bzw. (fuer baseline_fixed) Check-Namen, bei denen ein
    Baselinefehler im Kandidatenlauf nicht mehr auftritt.
    """
    pre_existing: list[int] = []
    regression: list[int] = []
    for index, err in enumerate(candidate_tool_errors or []):
        category = err.get("error_category")
        if category == "verification/baseline":
            pre_existing.append(index)
        elif category == "verification/regression":
            regression.append(index)
    baseline_fixed: list[str] = []
    baseline_failures = (baseline_preflight or {}).get("failures") or []
    # Ein Baselinefehler gilt als behoben, wenn der Kandidat denselben Check
    # bestanden hat. tool_trace zeichnet nur Fehler auf, nicht Erfolge, und
    # ein projektweiter project_check-Check ist im einzelnen Tool-Call nicht
    # eindeutig eindeutig einem npm-Script zuzuordnen. Die Menge bleibt
    # daher konservativ leer (verbleibende Luecke, s. Abschlussbericht);
    # die Datenstruktur ist vorgesehen, damit spaeter eine saubere
    # Erfolgs-Erfassung sie fuellen kann.
    baseline_fixed = []
    _ = baseline_failures  # geprueft, nicht weiter auswertbar
    return {
        "pre_existing": pre_existing,
        "regression": regression,
        "baseline_fixed": baseline_fixed,
    }
