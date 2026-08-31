# ENVIRONMENT — P6-TERRA-SUBAGENTS

System, Node, Git-Commit, Codex-CLI-Version (`0.149.1`, gepinnt) und Auth-Verfahren sind identisch zu `../p5-luna/ENVIRONMENT.md` — dort im Detail dokumentiert, hier nicht wiederholt.

## Abweichungen zu P5

| Feld                | P5-LUNA-HARNESS                         | P6-TERRA-SUBAGENTS                             |
| ------------------- | --------------------------------------- | ---------------------------------------------- |
| Modell              | `gpt-5.6-luna`                          | `gpt-5.6-terra`                                |
| Pi-Verifier         | deaktiviert                             | `anthropic/claude-sonnet-5` @ `max`            |
| Pi-Settings-Overlay | ja                                      | **keiner** — echte `settings.json` unverändert |
| Codex-Modell-Flag   | `-m gpt-5.6-luna -c model=gpt-5.6-luna` | `-m gpt-5.6-terra -c model=gpt-5.6-terra`      |

## Verifizierte Rollenauflösung (aus echten Läufen)

- Pi: `main`/`investigator` → `openai-codex/gpt-5.6-terra` @ `high`; `debugger` → `openai-codex/gpt-5.6-terra` @ `max`; `verifier` → `anthropic/claude-sonnet-5` @ `max` (nie aufgerufen in diesem Piloten — beide Aufgaben zu einfach für Pis Delegationskriterien).
- Codex: `main` → `gpt-5.6-terra` @ `high` (kein `multi_agent`-Thread in irgendeinem Lauf ausgelöst).

## Bekannte Confounder

Gleiche wie in P5 (Netzwerk-Isolations-Asymmetrie, Pis Skill-Auto-Loading außerhalb des Worktrees) — siehe `../p5-luna/METHODOLOGY.md`. In diesem Piloten nicht explizit erneut geprüft, da dieselbe zugrundeliegende Infrastruktur (nur andere Modell-/Rollenkonfiguration) wiederverwendet wird.
