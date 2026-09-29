"""Usage-Auswertung fuer das Pi-vs-Codex-Duell.

Nutzt die vorhandenen Logs statt eigener Instrumentierung:
- Pi Main:   `pi --print --mode json` (turn_end.message.usage je Turn)
- Codex:     `codex exec --json` (turn.completed.usage ist eine laufende Summe,
             deshalb zaehlt nur das letzte)
- Pi Subagenten/Verifier: `~/.pi/agent/run-history.jsonl` (pi-subagents,
             recordRun()), gefiltert nach Worktree-cwd und Zeitfenster.

Fehlende Werte bleiben None und werden nie geschaetzt.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


TOKEN_KEYS = ("input_fresh", "input_cache_read", "input_cache_write", "output", "reasoning")


def _num(value):
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _events(text: str):
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(ev, dict):
            yield ev


def _empty() -> dict:
    return {
        **{k: None for k in TOKEN_KEYS},
        "total_tokens": None,
        "cost": None,
        "model_calls": None,
        "tool_calls": 0,
        "shell_calls": 0,
        "tool_errors": 0,
        "tools": {},
    }


def _finish(out: dict) -> dict:
    parts = [out[k] for k in ("input_fresh", "input_cache_read", "input_cache_write", "output")]
    out["total_tokens"] = None if None in parts else sum(parts)
    return out


def parse_pi(text: str) -> dict:
    """Pi-Main-Usage aus dem JSON-Stream (nur Hauptagent, ohne Subagenten)."""
    out = _empty()
    totals = {k: 0 for k in TOKEN_KEYS}
    cost = 0.0
    cost_found = usage_found = False
    turns = 0
    for ev in _events(text):
        etype = ev.get("type")
        if etype == "tool_execution_start":
            name = ev.get("toolName") or ev.get("tool") or "?"
            out["tool_calls"] += 1
            out["tools"][name] = out["tools"].get(name, 0) + 1
            if name in ("bash", "shell"):
                out["shell_calls"] += 1
        elif etype == "message_end":
            msg = ev.get("message") or {}
            if msg.get("role") == "toolResult" and msg.get("isError"):
                out["tool_errors"] += 1
        elif etype == "turn_end":
            turns += 1
            usage = (ev.get("message") or {}).get("usage")
            if not isinstance(usage, dict):
                continue
            vals = [_num(usage.get(k)) for k in ("input", "cacheRead", "cacheWrite", "output")]
            if None in vals:
                continue
            usage_found = True
            for key, val in zip(("input_fresh", "input_cache_read", "input_cache_write", "output"), vals):
                totals[key] += val
            totals["reasoning"] += _num(usage.get("reasoning")) or 0
            total_cost = (usage.get("cost") or {}).get("total")
            if isinstance(total_cost, (int, float)):
                cost += total_cost
                cost_found = True
    out["model_calls"] = turns or None
    if usage_found:
        out.update(totals)
        out["cost"] = cost if cost_found else None
    return _finish(out)


def parse_codex(text: str) -> dict:
    """Codex-Usage aus `codex exec --json`; Kosten meldet Codex nicht."""
    out = _empty()
    last = None
    turns = 0
    for ev in _events(text):
        etype = ev.get("type")
        if etype == "turn.completed":
            turns += 1
            if isinstance(ev.get("usage"), dict):
                last = ev["usage"]
        elif etype == "item.completed":
            item = ev.get("item") or {}
            itype = item.get("type")
            if itype == "command_execution":
                out["tool_calls"] += 1
                out["shell_calls"] += 1
                out["tools"]["command_execution"] = out["tools"].get("command_execution", 0) + 1
                if item.get("exit_code") not in (0, None):
                    out["tool_errors"] += 1
            elif itype in ("file_change", "mcp_tool_call", "web_search"):
                out["tool_calls"] += 1
                out["tools"][itype] = out["tools"].get(itype, 0) + 1
    out["model_calls"] = turns or None
    if last is not None:
        inp = _num(last.get("input_tokens"))
        cached = _num(last.get("cached_input_tokens"))
        write = _num(last.get("cache_write_tokens") or last.get("cache_creation_input_tokens")) or 0
        output = _num(last.get("output_tokens"))
        if None not in (inp, cached, output) and cached + write <= inp:
            out.update({
                "input_fresh": inp - cached - write,
                "input_cache_read": cached,
                "input_cache_write": write,
                "output": output,
                "reasoning": _num(last.get("reasoning_output_tokens")),
            })
    return _finish(out)


def _empty_nested() -> dict:
    return {"calls": 0, "tokens": 0, "cost": None, "wall_ms": 0, "by_agent": {}}


def run_history_usage(workdir, start_ts: float, end_ts: float, path: Path | None = None) -> dict:
    """Subagenten- und Verifier-Verbrauch eines Pi-Laufs.

    `nested` enthaelt jeden Subagentenlauf inkl. Verifier; `verifier` ist eine
    Teilmenge davon und darf nie zusaetzlich zu `nested` addiert werden.
    """
    path = path or Path(os.environ.get("DUEL_RUN_HISTORY", os.path.expanduser("~/.pi/agent/run-history.jsonl")))
    root = os.path.normpath(str(workdir))
    nested, verifier = _empty_nested(), _empty_nested()
    if path.is_file():
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                cwd, ts = entry.get("cwd"), entry.get("ts")
                if not isinstance(cwd, str) or not isinstance(ts, (int, float)):
                    continue
                cwd = os.path.normpath(cwd)
                if not (cwd == root or (cwd + os.sep).startswith(root + os.sep)):
                    continue
                if not (start_ts <= ts <= end_ts):
                    continue
                tokens = entry.get("tokens") or {}
                n = sum(_num(tokens.get(k)) or 0 for k in ("input", "cacheRead", "cacheWrite", "output"))
                cost = entry.get("cost")
                wall = _num(entry.get("duration")) or 0
                agent = entry.get("agent") or "?"
                targets = [nested] + ([verifier] if agent == "verifier" else [])
                for bucket in targets:
                    bucket["calls"] += 1
                    bucket["tokens"] += n
                    bucket["wall_ms"] += wall
                    if isinstance(cost, (int, float)):
                        bucket["cost"] = (bucket["cost"] or 0.0) + cost
                per = nested["by_agent"].setdefault(agent, {"calls": 0, "tokens": 0})
                per["calls"] += 1
                per["tokens"] += n
    return {"nested": nested, "verifier": verifier}


def pi_total(main: dict, hist: dict) -> dict:
    """Pi Gesamt = Main + Subagenten (Verifier ist darin enthalten)."""
    nested, verifier = hist["nested"], hist["verifier"]
    main_tokens = main["total_tokens"]
    total = None if main_tokens is None else main_tokens + nested["tokens"]
    main_cost = main["cost"]
    cost = None
    if main_cost is not None and (nested["cost"] is not None or nested["calls"] == 0):
        cost = main_cost + (nested["cost"] or 0.0)
    return {
        "main_tokens": main_tokens,
        "subagent_tokens": nested["tokens"] - verifier["tokens"],
        "subagent_calls": nested["calls"] - verifier["calls"],
        "verifier_tokens": verifier["tokens"],
        "verifier_calls": verifier["calls"],
        "total_tokens": total,
        "cost": cost,
        "by_agent": nested["by_agent"],
        "verifier_share": (verifier["tokens"] / total) if total else None,
    }


def final_text(harness: str, text: str) -> str | None:
    """Letzte Assistenten-Textnachricht aus dem Log (fuer result.md)."""
    last = None
    for ev in _events(text):
        if harness == "codex":
            item = ev.get("item") or {}
            if ev.get("type") == "item.completed" and item.get("type") == "agent_message" and item.get("text"):
                last = item["text"]
        elif ev.get("type") == "turn_end":
            msg = ev.get("message") or {}
            parts = [p.get("text") for p in (msg.get("content") or []) if isinstance(p, dict) and p.get("type") == "text" and p.get("text")]
            if msg.get("role") == "assistant" and parts:
                last = "\n".join(parts)
    return last
