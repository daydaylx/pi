#!/usr/bin/env python3
"""Getrennte Feldnamen fuer die drei Verifikationskonzepte in Ergebniszeilen.

* ``verification_gate_*``   -- harte Sperre/Pflichtcheck im Kandidatenlauf
  (``project_check``, Hard-Verifier-Pfade), erkennbar an Toolfehlern der
  Kategorie ``verification/*``.
* ``model_verifier_*``      -- Verifier-Subagent (run-history ``agent ==
  "verifier"``); bisher ``verifier_*``.
* ``benchmark_checker_*``   -- unabhaengiger ``checker.sh`` des Tasks; bisher
  ``checker_*``.

Die alten Namen bleiben additiv in der Zeile erhalten. ``row_naming_fields``
leitet die neuen Namen auch aus aelteren Zeilen ab (Lese-Alias); die
run-history-Quellfelder des pi-subagents-Forks (``verifierDecision`` ...) bleiben
unveraendert.
"""

from __future__ import annotations

LEGACY_COMPARABLE_REASONS = {
    "baseline_failing_candidate_verifier_blocked": "baseline_failing_verification_gate_blocked",
}

_CHECKER_FIELDS = {
    "checker_exit": "benchmark_checker_exit",
    "checker_stdout": "benchmark_checker_stdout",
    "checker_stderr": "benchmark_checker_stderr",
    "checker_wall_time_s": "benchmark_checker_wall_time_s",
}

_MODEL_VERIFIER_KEYS = (
    "verifier_calls", "verifier_tokens", "verifier_cost",
    "verifier_fresh_input", "verifier_cache_read", "verifier_output",
    "verifier_wall_time", "verifier_model", "verifier_reasoning",
    "verifier_internal_tool_calls", "verifier_decision", "verifier_trigger",
    "verifier_skip_reason",
)


def model_verifier_name(legacy_key: str) -> str:
    return "model_" + legacy_key


def normalize_comparable_reason(reason):
    return LEGACY_COMPARABLE_REASONS.get(reason, reason)


def add_model_verifier_aliases(stats: dict) -> dict:
    """Ergaenzt ``model_verifier_*`` neben den vorhandenen ``verifier_*``-Keys."""
    for key in _MODEL_VERIFIER_KEYS:
        if key in stats:
            stats[model_verifier_name(key)] = stats[key]
    return stats


def row_naming_fields(row: dict) -> dict:
    """Neue Feldnamen einer (auch alten) Ergebniszeile. Fehlende Quellen -> None."""
    out = {new: row.get(old) for old, new in _CHECKER_FIELDS.items()}

    errors = row.get("tool_error_details")
    if errors is None:
        out["verification_gate_blocked"] = None
        out["verification_gate_errors"] = None
    else:
        categories = [str(e.get("error_category") or "") for e in errors]
        out["verification_gate_blocked"] = any(c == "verification/baseline" for c in categories)
        out["verification_gate_errors"] = sum(1 for c in categories if c.startswith("verification"))

    source = row.get("subagent_telemetry") or row.get("telemetry") or {}
    for key in _MODEL_VERIFIER_KEYS:
        if key in source:
            out[model_verifier_name(key)] = source[key]
    return out


def with_new_field_names(row: dict) -> dict:
    """Kopie der Zeile; vorhandene neue Felder haben Vorrang vor abgeleiteten."""
    merged = dict(row_naming_fields(row))
    merged.update({k: v for k, v in row.items()})
    if "comparable_reason" in merged:
        merged["comparable_reason"] = normalize_comparable_reason(merged["comparable_reason"])
    return merged
