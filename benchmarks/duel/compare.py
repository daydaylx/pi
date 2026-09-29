"""Diff-Analyse und comparison.md für das Pi-vs-Codex-Duell.

Erzeugt nur Fakten (Zahlen, Dateimengen, Verhaeltnisse). Bewertung der
Loesungsqualitaet bleibt bewusst ein manueller Schritt: die qualitativen
Abschnitte werden als Platzhalter angelegt. Keine Punkte, keine Siegerwertung.
"""

from __future__ import annotations

import json
from pathlib import Path

PENDING = "_noch nicht bewertet (nach dem Lauf im Gespräch ausfüllen)_"


def diff_stats(patch: str) -> dict:
    files: dict[str, dict] = {}
    current = None
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            current = line.split(" b/", 1)[-1]
            files[current] = {"added": 0, "removed": 0, "new": False, "deleted": False}
        elif current and line.startswith("new file mode"):
            files[current]["new"] = True
        elif current and line.startswith("deleted file mode"):
            files[current]["deleted"] = True
        elif current and line.startswith("+") and not line.startswith("+++"):
            files[current]["added"] += 1
        elif current and line.startswith("-") and not line.startswith("---"):
            files[current]["removed"] += 1
    added = sum(f["added"] for f in files.values())
    removed = sum(f["removed"] for f in files.values())
    return {
        "files": files,
        "added": added,
        "removed": removed,
        "lines": added + removed,
        "tests_touched": sorted(p for p in files if "test" in p.lower()),
    }


def _n(value) -> str:
    return "nicht messbar" if value is None else f"{value:,}".replace(",", ".")


def _cost(value) -> str:
    return "nicht verfügbar" if value is None else f"${value:.4f}"


def _secs(value) -> str:
    return "?" if value is None else f"{value:.0f} s"


def _ratio(a, b, label: str) -> str | None:
    if not a or not b:
        return None
    return f"Pi {label}: {a / b:.2f}x Codex"


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_arm(arm_dir: Path) -> dict:
    patch = arm_dir / "diff.patch"
    return {
        "usage": _load(arm_dir / "usage.json") or {},
        "error": _load(arm_dir / "error.json"),
        "stats": diff_stats(patch.read_text(encoding="utf-8", errors="replace") if patch.is_file() else ""),
    }


def render(duel_dir: Path) -> str:
    meta = _load(duel_dir / "metadata.json") or {}
    pi, cx = load_arm(duel_dir / "pi"), load_arm(duel_dir / "codex")
    pu, cu = pi["usage"], cx["usage"]
    pmain, ptot = pu.get("main") or {}, pu.get("total") or {}
    cmain = cu.get("main") or {}
    pf, cf = set(pi["stats"]["files"]), set(cx["stats"]["files"])
    prompt = (duel_dir / "prompt.md").read_text(encoding="utf-8", errors="replace") if (duel_dir / "prompt.md").is_file() else ""

    facts = [
        r for r in (
            _ratio(pu.get("duration_s"), cu.get("duration_s"), "Laufzeit"),
            _ratio(ptot.get("total_tokens"), cmain.get("total_tokens"), "Gesamttokens"),
            _ratio(pi["stats"]["lines"], cx["stats"]["lines"], "Diff-Zeilen"),
            _ratio(pmain.get("tool_calls"), cmain.get("tool_calls"), "Tool Calls"),
        ) if r
    ]
    if ptot.get("verifier_share") is not None:
        facts.append(f"Verifier-Anteil am Pi-Gesamtverbrauch: {ptot['verifier_share']:.0%}")
    facts.append(f"Pi-Subagenten (ohne Verifier): {ptot.get('subagent_calls', 0)}, Verifier-Läufe: {ptot.get('verifier_calls', 0)}")

    def arm_files(label, stats):
        rows = [f"- `{p}` (+{s['added']}/-{s['removed']}{', neu' if s['new'] else ''}{', gelöscht' if s['deleted'] else ''})"
                for p, s in sorted(stats["files"].items())]
        return f"### {label}\n" + ("\n".join(rows) if rows else "_keine Änderungen_")

    errors = [f"- {name}: {arm['error'].get('error')}" for name, arm in (("Pi", pi), ("Codex", cx)) if arm["error"]]
    by_agent = ptot.get("by_agent") or {}
    agents = ", ".join(f"{a}: {v['calls']}x/{_n(v['tokens'])} Tokens" for a, v in sorted(by_agent.items())) or "keine"

    return f"""# Pi vs Codex – Duel {meta.get('id', duel_dir.name)}

## Aufgabe

{prompt.strip() or PENDING}

## Ausgangszustand

- Repository: `{meta.get('repo')}`
- Branch: `{meta.get('branch')}`
- Commit: `{meta.get('base_sha')}`
- Arbeitsbaum: {meta.get('worktree_status')}
- Prompt-SHA256: `{meta.get('prompt_sha256')}`
- Zeitpunkt: {meta.get('created_at')}

## Konfiguration

### Pi
- Modell / Thinking: {pu.get('model') or 'Pi-Default'} / {pu.get('thinking') or 'Pi-Default'}
- Version: {pu.get('version')}
- Extensions, Subagenten, Verifier: reale Konfiguration aus `~/.pi/agent` (nicht angepasst)

### Codex
- Modell / Thinking: {cu.get('model') or 'Codex-Default'} / {cu.get('thinking') or 'Codex-Default'}
- Version: {cu.get('version')}
- Konfiguration: reale `~/.codex/config.toml` (nicht angepasst)

## Laufzeit

- Pi: {_secs(pu.get('duration_s'))}
- Codex: {_secs(cu.get('duration_s'))}

## Tokenverbrauch

- Pi Main: {_n(ptot.get('main_tokens'))}
- Pi Subagents (ohne Verifier): {_n(ptot.get('subagent_tokens'))} ({ptot.get('subagent_calls', 0)} Läufe)
- Pi Verifier: {_n(ptot.get('verifier_tokens'))} ({ptot.get('verifier_calls', 0)} Läufe)
- **Pi Gesamt: {_n(ptot.get('total_tokens'))}**
- Pi Subagenten je Typ: {agents}
- **Codex Gesamt: {_n(cmain.get('total_tokens'))}**

Hinweis: Subagenten/Verifier stammen aus `run-history.jsonl` (cwd-/Zeitfenster-Zuordnung). Werte nur, wo gemessen; kein Schätzwert.

## Kosten

- Pi: {_cost(ptot.get('cost'))}
- Codex: {_cost(cmain.get('cost'))} (Codex meldet keine Kosten)

## Tool-Nutzung

- Pi Main: {pmain.get('tool_calls', 0)} Calls, davon Shell {pmain.get('shell_calls', 0)}, Fehler {pmain.get('tool_errors', 0)}, Modellaufrufe {_n(pmain.get('model_calls'))} (Subagenten-interne Tool Calls nicht enthalten)
- Codex: {cmain.get('tool_calls', 0)} Calls, davon Shell {cmain.get('shell_calls', 0)}, Fehler {cmain.get('tool_errors', 0)}, Modellaufrufe {_n(cmain.get('model_calls'))}

## Geänderte Dateien

- Beide: {', '.join(f'`{p}`' for p in sorted(pf & cf)) or '–'}
- Nur Pi: {', '.join(f'`{p}`' for p in sorted(pf - cf)) or '–'}
- Nur Codex: {', '.join(f'`{p}`' for p in sorted(cf - pf)) or '–'}
- Diff-Größe: Pi +{pi['stats']['added']}/-{pi['stats']['removed']}, Codex +{cx['stats']['added']}/-{cx['stats']['removed']}
- Testdateien angefasst: Pi {', '.join(pi['stats']['tests_touched']) or '–'}; Codex {', '.join(cx['stats']['tests_touched']) or '–'}

{arm_files('Pi', pi['stats'])}

{arm_files('Codex', cx['stats'])}

## Auffällige Fakten

{chr(10).join('- ' + f for f in facts)}
{chr(10).join(errors)}

## Lösungsstrategie Pi

{PENDING}

## Lösungsstrategie Codex

{PENDING}

## Unterschiede

{PENDING}

## Tests

{PENDING}

## Fehler / übersehene Punkte

{PENDING}

## Ergebnisqualität

{PENDING}

## Effizienz

{PENDING}

## Auffälliger Pi-Overhead

{PENDING}

## Auffällige Codex-Schwächen

{PENDING}

## Erkenntnisse für zukünftige Pi-Änderungen

{PENDING}

_Ein einzelner Lauf ist ein Hinweis, kein Auftrag für eine Architekturänderung._
"""


def write(duel_dir: Path) -> Path:
    out = duel_dir / "comparison.md"
    out.write_text(render(duel_dir), encoding="utf-8")
    return out
