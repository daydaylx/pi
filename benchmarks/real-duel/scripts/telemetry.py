#!/usr/bin/env python3
"""Normalisierte Pi-/Codex-Telemetrie fuer real-duel (Phase 2).

Entscheidungsregel eingehalten: GENAU EINE primaere Telemetriequelle pro
Harness, kein Parallelbetrieb von drei Parsern. Fuer beide Harnesses ist das
OpenBenchs eigener, gegen die real installierten CLI-Versionen (Pi 0.84.4,
Codex 0.149.1) validierter Parser
(`obench.adapters.pi._parse_json_with_usage`,
`obench.adapters.codex._parse_json_with_usage`) -- direkt importiert statt
neu geschrieben ("uebernehmen statt neu bauen"). Empirisch gegen echte
real-duel-Smoke-Transkripte verifiziert (2026-09-05): Pis
input+cacheRead+cacheWrite+output == totalTokens haelt fuer alle 3
beobachteten Turns; Codex' turn.completed.usage ist bereits eine laufende
Summe ueber die Session -- deshalb nimmt der Parser bewusst NUR das letzte
turn.completed (last_usage), keine Summierung ueber mehrere Turns.

KEIN Import aus harbor-bench/ -- Legacy-Telemetriecode (postprocess/
schema.py, pi_normalizer.py, codex_normalizer.py) bleibt ausschliesslich im
Archiv-Tag `benchmark-legacy-v1-v3-2026-09-04`, siehe REAL_DUEL_AUDIT.md
Abschnitt 2 fuer die Bewertung der drei moeglichen Quellen (OpenBench-
Adapter, Legacy v3, P5-mjs-Skripte) und die Begruendung fuer diese Wahl.

Tool-Call-/Tool-Error-Zaehlung ist NICHT Teil von OpenBenchs Parser
(der zaehlt nur Token/Turns) -- das ist eigener, kleiner Code hier, der die
Transkript-Events fuer beide Harnesses separat auswertet (Vokabular
unterscheidet sich strukturell: Pi tool_execution_start/end +
toolResult.isError, Codex item.completed.command_execution.exit_code).

`retries` bleibt bewusst None: es gibt in keinem der beiden Transkripte ein
verlaessliches, direkt beobachtbares Retry-Signal (das waere Spekulation,
keine Messung) -- offene Luecke, dokumentiert statt erraten.

Subagenten-/Verifier-/Compaction-Felder (Pi-spezifisch) sind im Schema
vorgesehen, aber in dieser Phase NICHT populiert: der Smoke-Task loest weder
Subagenten noch Compaction aus, es gibt also keine echten Daten zum
Validieren. Quelle waere `pi-subagents`' eigene
`{runId}_{agent}_meta.json`-Dateien (analog zum archivierten
`postprocess/subagents.py`), NICHT das Haupttranskript -- Verdrahtung folgt
in Phase 3 gegen eine echte Aufgabe, die diese Pfade tatsaechlich durchlaeuft.
"""

import json
import os
import sys

OPENBENCH_HOME = os.path.expanduser("~/.local/share/real-duel/openbench")

NEUTRAL_SCHEMA_KEYS = (
    "input_fresh", "input_cache_read", "input_cache_write",
    "output", "reasoning", "processed_input",
    "model_calls", "tool_calls", "tool_errors", "retries",
    "cost", "cost_source", "token_basis", "usage_raw",
    # Pi-spezifisch, siehe Docstring -- bewusst unpopuliert in Phase 2.
    "subagent_calls", "subagent_tokens", "subagent_cost",
    "verifier_calls", "verifier_tokens", "verifier_cost",
    "compactions",
)


def _empty_neutral() -> dict:
    result: dict = {k: None for k in NEUTRAL_SCHEMA_KEYS}
    return result


def _load_adapters():
    if OPENBENCH_HOME not in sys.path:
        sys.path.insert(0, OPENBENCH_HOME)
    from obench.adapters import pi as pi_adapter  # noqa: E402
    from obench.adapters import codex as codex_adapter  # noqa: E402
    return pi_adapter, codex_adapter


def _iter_events(transcript_text):
    for line in transcript_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def _pi_tool_stats(transcript_text):
    starts = errors = 0
    for ev in _iter_events(transcript_text):
        if ev.get("type") == "tool_execution_start":
            starts += 1
        if (ev.get("type") == "message_end"
                and (ev.get("message") or {}).get("role") == "toolResult"
                and ev["message"].get("isError")):
            errors += 1
    return starts, errors


def _codex_tool_stats(transcript_text):
    calls = errors = 0
    for ev in _iter_events(transcript_text):
        if ev.get("type") != "item.completed":
            continue
        item = ev.get("item") or {}
        if item.get("type") != "command_execution":
            continue
        calls += 1
        exit_code = item.get("exit_code")
        if exit_code not in (0, None):
            errors += 1
    return calls, errors


def normalize_pi(transcript_text):
    """transcript_text: raw stdout captured from `pi --print --mode json ...`."""
    pi_adapter, _ = _load_adapters()
    _, turns, _tail, token_usage = pi_adapter._parse_json_with_usage(transcript_text)

    out = _empty_neutral()
    if token_usage.get("token_basis") is None:
        out["cost_source"] = "unavailable"
        return out

    fresh = token_usage.get("tokens_input_uncached")
    cache_read = token_usage.get("tokens_cache_read")
    cache_write = token_usage.get("tokens_cache_write")
    output = token_usage.get("tokens_output")
    reasoning = token_usage.get("tokens_reasoning")

    cost_total = 0.0
    cost_found = False
    for usage in (token_usage.get("usage_raw") or []):
        cost = (usage or {}).get("cost") or {}
        total = cost.get("total")
        if isinstance(total, (int, float)):
            cost_total += total
            cost_found = True

    out.update({
        "input_fresh": fresh,
        "input_cache_read": cache_read,
        "input_cache_write": cache_write,
        "output": output,
        "reasoning": reasoning,
        "processed_input": (fresh + cache_read + cache_write
                             if None not in (fresh, cache_read, cache_write) else None),
        "model_calls": turns,
        "cost": cost_total if cost_found else None,
        "cost_source": "pi_usage_cost_field" if cost_found else "unavailable",
        "token_basis": token_usage.get("token_basis"),
        "usage_raw": token_usage.get("usage_raw"),
    })
    calls, errors = _pi_tool_stats(transcript_text)
    out["tool_calls"] = calls
    out["tool_errors"] = errors
    return out


def normalize_codex(transcript_text):
    """transcript_text: raw stdout captured from `codex exec --json ...`."""
    _, codex_adapter = _load_adapters()
    _, turns, _tail, token_usage = codex_adapter._parse_json_with_usage(transcript_text)

    out = _empty_neutral()
    if token_usage.get("token_basis") is None:
        out["cost_source"] = "unavailable"
        return out

    fresh = token_usage.get("tokens_input_uncached")
    cache_read = token_usage.get("tokens_cache_read")
    cache_write = token_usage.get("tokens_cache_write")
    output = token_usage.get("tokens_output")
    reasoning = token_usage.get("tokens_reasoning")

    out.update({
        "input_fresh": fresh,
        "input_cache_read": cache_read,
        "input_cache_write": cache_write,
        "output": output,
        "reasoning": reasoning,
        "processed_input": (fresh + cache_read + cache_write
                             if None not in (fresh, cache_read, cache_write) else None),
        "model_calls": turns,
        # Codex meldet in turn.completed keine Kosten (anders als Pi) -- keine
        # eigene Kostenschaetzung (z.B. per Preistabelle) in dieser Phase, um
        # keine Schaetzung als gemessenen Wert auszugeben.
        "cost": None,
        "cost_source": "unavailable",
        "token_basis": token_usage.get("token_basis"),
        "usage_raw": token_usage.get("usage_raw"),
    })
    calls, errors = _codex_tool_stats(transcript_text)
    out["tool_calls"] = calls
    out["tool_errors"] = errors
    return out


NORMALIZERS = {"pi-real": normalize_pi, "codex-real": normalize_codex}


def normalize(harness_name, transcript_text):
    fn = NORMALIZERS.get(harness_name)
    if fn is None:
        raise ValueError(f"kein Normalizer fuer Harness {harness_name!r}")
    return fn(transcript_text)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in NORMALIZERS:
        sys.exit(f"usage: {sys.argv[0]} {{pi-real|codex-real}} <transcript-path>")
    with open(sys.argv[2], encoding="utf-8") as fh:
        text = fh.read()
    print(json.dumps(normalize(sys.argv[1], text), indent=2))
