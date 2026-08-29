# Testmatrix

## A – Core-Regressionsschutz

| Test | TUI | GUI | Pflicht |
|---|---:|---:|---:|
| Pi startet | ✓ | ✓ | Ja |
| Session erstellen | ✓ | ✓ | Ja |
| Session fortsetzen | ✓ | ✓ | Ja |
| Prompt senden | ✓ | ✓ | Ja |
| Streaming | ✓ | ✓ | Ja |
| Tool read | ✓ | ✓ | Ja |
| Tool search | ✓ | ✓ | Ja |
| Tool edit | ✓ | ✓ | Ja |
| Tool shell | ✓ | ✓ | Ja |
| Cancel | ✓ | ✓ | Ja |
| Provider-Fehler | ✓ | ✓ | Ja |

## B – State-Parität

| State | Core Quelle | Aurora | GUI |
|---|---|---:|---:|
| Workflow | Core | prüfen | prüfen |
| Task | Core | prüfen | prüfen |
| Verification | Core | prüfen | prüfen |
| Changes | Core | prüfen | prüfen |
| Subagents | Core | prüfen | prüfen |
| Model | Core | prüfen | prüfen |
| Thinking | Core | prüfen | prüfen |
| Permissions | Core | prüfen | prüfen |
| Context | Core | prüfen | prüfen |
| LSP | Core | prüfen | prüfen |

## C – Shortcut-Parität

Für jeden Kernshortcut:

1. Trigger in TUI.
2. fachliche Aktion protokollieren.
3. Trigger in GUI.
4. fachliche Aktion vergleichen.
5. bei OS-Konflikt dokumentieren.

## D – Failure Cases

Pflichtfälle:

- GUI startet, Pi fehlt.
- Pi startet, RPC antwortet nicht.
- Pi stirbt während Streaming.
- Provider 401/403/429.
- Tool schlägt fehl.
- Verification schlägt fehl.
- Subagent hängt.
- Session kann nicht geladen werden.
- GUI wird während aktivem Turn geschlossen.
- erneuter Start nach Crash.

## E – UX

Qualitativ prüfen:

- Chat bleibt lesbar.
- Tool-Lärm ist reduziert.
- Statusflächen sind verständlich.
- keine redundanten Anzeigen.
- zentrale Aktion max. wenige Schritte entfernt.
- Keyboard-only möglich.
- Mouse-only für Standardfälle möglich.

## F – Performance

Messen:

- GUI-Startzeit
- idle RAM
- aktive Session RAM
- CPU idle
- CPU streaming
- Render-Verzögerung bei langer Session

Keine Optimierung ohne Messwert.
