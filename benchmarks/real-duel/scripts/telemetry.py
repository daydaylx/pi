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

# candidates/pi-real.toml setzt bewusst isolate_home=false -- Pis agentDir
# (und damit run-history.jsonl) loest deshalb immer auf ~/.pi/agent auf,
# unabhaengig vom jeweiligen Worktree. Die Datei ist also GLOBAL ueber alle
# Pi-Sitzungen auf der Maschine geteilt, nicht pro Lauf isoliert -- deshalb
# ist die cwd-/Zeitfenster-Filterung unten zwingend, nicht optional.
RUN_HISTORY_PATH = os.path.expanduser("~/.pi/agent/run-history.jsonl")

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


def _iter_run_history_entries():
    """Liest run-history.jsonl zeilenweise (JSONL, kann waehrend des Laufs
    weiterwachsen -- fehlerhafte/unvollstaendige letzte Zeilen werden
    uebersprungen statt den ganzen Lauf abzubrechen)."""
    if not os.path.isfile(RUN_HISTORY_PATH):
        return
    with open(RUN_HISTORY_PATH, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def subagent_stats_from_run_history(workdir, start_ts, end_ts):
    """Phase 3: aggregiert Subagenten-/Verifier-Telemetrie fuer einen
    Kandidatenlauf aus run-history.jsonl (siehe pi-subagents/src/runs/shared/
    run-history.ts -- recordRun() schreibt dort inzwischen cwd/tokens/cost).
    Nur Eintraege, deren cwd unterhalb von workdir liegt UND deren ts
    (Unix-Sekunden) innerhalb [start_ts, end_ts] liegt, gehoeren zu diesem
    Lauf -- die Datei ist global, s. Kommentar bei RUN_HISTORY_PATH oben.
    Gibt ein Dict mit subagent_calls/subagent_tokens/subagent_cost und
    verifier_calls/verifier_tokens/verifier_cost zurueck (0 statt None, wenn
    keine passenden Eintraege gefunden wurden -- ein Lauf ohne Subagenten ist
    ein gueltiges, gemessenes Ergebnis, kein fehlender Wert)."""
    workdir_prefix = os.path.normpath(str(workdir)) + os.sep
    total_calls = total_tokens = 0
    total_cost = 0.0
    total_cost_found = False
    verifier_calls = verifier_tokens = 0
    verifier_cost = 0.0
    verifier_cost_found = False

    for entry in _iter_run_history_entries():
        cwd = entry.get("cwd")
        ts = entry.get("ts")
        if not cwd or ts is None:
            continue
        cwd_norm = os.path.normpath(cwd)
        if not (cwd_norm == os.path.normpath(str(workdir)) or (cwd_norm + os.sep).startswith(workdir_prefix)):
            continue
        if not (start_ts <= ts <= end_ts):
            continue

        tokens = entry.get("tokens") or {}
        entry_tokens = sum(
            v for v in (
                tokens.get("input"), tokens.get("output"),
                tokens.get("cacheRead"), tokens.get("cacheWrite"),
            ) if isinstance(v, (int, float))
        )
        entry_cost = entry.get("cost")

        total_calls += 1
        total_tokens += entry_tokens
        if isinstance(entry_cost, (int, float)):
            total_cost += entry_cost
            total_cost_found = True

        if entry.get("agent") == "verifier":
            verifier_calls += 1
            verifier_tokens += entry_tokens
            if isinstance(entry_cost, (int, float)):
                verifier_cost += entry_cost
                verifier_cost_found = True

    return {
        "subagent_calls": total_calls,
        "subagent_tokens": total_tokens,
        "subagent_cost": total_cost if total_cost_found else None,
        "verifier_calls": verifier_calls,
        "verifier_tokens": verifier_tokens,
        "verifier_cost": verifier_cost if verifier_cost_found else None,
    }


def normalize_pi(transcript_text):
    """transcript_text: raw stdout captured from `pi --print --mode json ...`."""
    pi_adapter, _ = _load_adapters()
    _, turns, _tail, token_usage = pi_adapter._parse_json_with_usage(transcript_text)

    out = _empty_neutral()
    # Request/tool counts are observable even when a provider failed before
    # returning usage. Keep those counts, but leave every token field unset.
    calls, errors = _pi_tool_stats(transcript_text)
    out["model_calls"] = turns
    out["tool_calls"] = calls
    out["tool_errors"] = errors
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
    return out


def normalize_codex(transcript_text):
    """transcript_text: raw stdout captured from `codex exec --json ...`."""
    _, codex_adapter = _load_adapters()
    _, turns, _tail, token_usage = codex_adapter._parse_json_with_usage(transcript_text)

    out = _empty_neutral()
    calls, errors = _codex_tool_stats(transcript_text)
    out["model_calls"] = turns
    out["tool_calls"] = calls
    out["tool_errors"] = errors
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
    return out


_DIFFABLE_NUMERIC_KEYS = (
    "input_fresh", "input_cache_read", "input_cache_write",
    "output", "reasoning", "processed_input", "model_calls",
    "tool_calls", "tool_errors", "cost",
)


def split_codex_plan_work(plan_transcript_text: str, work_transcript_text: str) -> dict:
    """Codex' `turn.completed.usage` ist laut Docstring oben eine laufende
    Summe ueber die Session (empirisch fuer Einzel-Turns verifiziert, NICHT
    verifiziert fuer einen `resume`-Aufruf ueber zwei getrennte Prozesse --
    das ist Teil der Stufe-1-Pilot-Verifikation). Falls das zutrifft, ist die
    Work-Phase-Telemetrie die Differenz zwischen dem kumulativen Stand nach
    der Work-Phase und dem nach der Plan-Phase. Ergibt eine Differenz einen
    negativen Wert, ist die Annahme fuer diesen Lauf widerlegt --
    `consistent=False` macht das sichtbar, statt eine falsche Zahl zu melden.
    """
    plan_stats = normalize_codex(plan_transcript_text)
    work_cumulative = normalize_codex(work_transcript_text)

    if plan_stats.get("token_basis") is None or work_cumulative.get("token_basis") is None:
        return {
            "plan_phase": plan_stats,
            "work_phase_cumulative": work_cumulative,
            "work_phase_delta": _empty_neutral(),
            "consistent": False,
            "inconsistency_reason": "token_basis fehlt in mindestens einer Phase",
        }

    delta = dict(work_cumulative)
    negative_keys = []
    for key in _DIFFABLE_NUMERIC_KEYS:
        p = plan_stats.get(key)
        w = work_cumulative.get(key)
        if p is None or w is None:
            delta[key] = None
            continue
        diff = w - p
        if diff < 0:
            negative_keys.append(key)
        delta[key] = diff

    return {
        "plan_phase": plan_stats,
        "work_phase_cumulative": work_cumulative,
        "work_phase_delta": delta,
        "consistent": not negative_keys,
        "inconsistency_reason": (
            f"negative Delta bei: {negative_keys} -- Annahme 'kumulativ ueber "
            "Session' fuer diesen Lauf widerlegt, work_phase_cumulative statt "
            "work_phase_delta verwenden" if negative_keys else None
        ),
    }


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
