#!/usr/bin/env python3
"""Failure-Klassifikation einer Ergebniszeile (Taxonomie aus dem Benchmark-Auftrag).

Klassen: PASS, CANDIDATE_FAILURE, POLICY_GATE_FAILURE, VERIFICATION_FAILURE,
INFRASTRUCTURE_FAILURE, PROVIDER_FAILURE, HARNESS_FAILURE.

Ein Provider-Abbruch (Pi: ``auto_retry_end`` mit ``success=false``, Codex:
``turn.failed``) bei nicht sauberem Kandidaten ist ``PROVIDER_FAILURE`` mit dem
Grund ``infrastructure_interrupted_with_invalid_candidate``: weder normaler
FAIL noch Kandidatenfehler -- der Lauf ist ungueltig und nicht vergleichbar.
"""

from __future__ import annotations

import json

PASS = "PASS"
CANDIDATE_FAILURE = "CANDIDATE_FAILURE"
POLICY_GATE_FAILURE = "POLICY_GATE_FAILURE"
VERIFICATION_FAILURE = "VERIFICATION_FAILURE"
INFRASTRUCTURE_FAILURE = "INFRASTRUCTURE_FAILURE"
PROVIDER_FAILURE = "PROVIDER_FAILURE"
HARNESS_FAILURE = "HARNESS_FAILURE"

INTERRUPTED_INVALID = "infrastructure_interrupted_with_invalid_candidate"

_TEST_GATES = {"required_tests_passed", "checkers_ran"}


def iter_events(text: str):
    for line in (text or "").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            yield event


def provider_signals(events) -> dict:
    """Sammelt Provider-Abbruchsignale. ``failed``: endgueltiger Abbruch."""
    evidence: list[str] = []
    recovery_pending = False
    for ev in events:
        etype = ev.get("type")
        if etype == "auto_retry_end" and ev.get("success") is False:
            evidence.append(f"auto_retry_end success=false attempt={ev.get('attempt')} "
                            f"finalError={str(ev.get('finalError'))[:120]}")
        elif etype == "turn.failed":
            error = ev.get("error") or {}
            message = error.get("message") if isinstance(error, dict) else error
            evidence.append(f"turn.failed {str(message)[:120]}")
        elif etype == "entry_appended":
            entry = ev.get("entry") or {}
            if entry.get("customType") == "resilience.recovery-required":
                recovery_pending = True
                evidence.append("resilience.recovery-required")
    return {"failed": bool(evidence), "recovery_pending": recovery_pending, "evidence": evidence}


def classify_failure(
    *,
    success,
    completed,
    error=None,
    failed_gates=(),
    checker_exit=None,
    tool_error_categories=(),
    provider=None,
    harness_exception=False,
) -> dict:
    """Liefert ``{failure_class, failure_reason, failure_evidence}``."""
    failed_gates = list(failed_gates or [])
    provider = provider or {}
    open_task = success is None and bool(completed) and not failed_gates and not error
    clean = (bool(success) and bool(completed) and not failed_gates and not error) or open_task

    if provider.get("failed") and not clean:
        return {
            "failure_class": PROVIDER_FAILURE,
            "failure_reason": INTERRUPTED_INVALID,
            "failure_evidence": list(provider.get("evidence") or []),
        }
    if clean:
        return {"failure_class": PASS,
                "failure_reason": "no_checker_open_task" if open_task else None,
                "failure_evidence": []}

    policy = [g for g in failed_gates if g not in _TEST_GATES]
    if policy:
        return {"failure_class": POLICY_GATE_FAILURE,
                "failure_reason": "required_gate_failed", "failure_evidence": policy}
    if failed_gates or (checker_exit not in (None, 0)):
        evidence = failed_gates or [f"checker_exit={checker_exit}"]
        return {"failure_class": VERIFICATION_FAILURE,
                "failure_reason": "checker_or_tests_failed", "failure_evidence": evidence}
    if harness_exception:
        return {"failure_class": HARNESS_FAILURE,
                "failure_reason": "harness_exception", "failure_evidence": [str(error)[:200]]}
    if "infrastructure" in set(tool_error_categories or ()):
        return {"failure_class": INFRASTRUCTURE_FAILURE,
                "failure_reason": "tool_infrastructure_error", "failure_evidence": []}
    return {"failure_class": CANDIDATE_FAILURE,
            "failure_reason": "candidate_incomplete_or_failed",
            "failure_evidence": [str(error)[:200]] if error else []}
