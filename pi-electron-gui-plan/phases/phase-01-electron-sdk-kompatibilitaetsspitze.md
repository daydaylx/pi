# Phase 01 – Electron-/SDK-Kompatibilitätsspitze

## Ziel

Mit einem begrenzten technischen Spike nachweisen, dass Electron Main die vorhandene Pi-Runtime ohne private TUI-Kopplung und ohne zweite Pi-Version betreiben kann.

## Aufgaben

1. Minimalen Electron-Main-Prozess nur für den Spike einrichten.
2. Exakt die vorhandene Pi-SDK-Version importieren.
3. `AgentSessionRuntime` für ein Testprojekt starten.
4. Aktive globale und projektbezogene Extensions laden.
5. Testprompt auslösen und Streaming-Events beobachten.
6. Project Trust, Permission-Anfrage und Ask User technisch durchreichen.
7. Projekt- und Sessionwechsel testen.
8. Changes-, Verification- und Subagent-Ereignisse auf Verfügbarkeit prüfen.
9. Abweichungen zwischen SDK und RPC dokumentieren.
10. Prüfen, ob bestehende Extensions TUI-spezifische UI-Methoden voraussetzen.

## Spike-Grenzen

- keine fertige Oberfläche
- kein dauerhaftes Designsystem
- kein Produktions-Packaging
- keine Behebung durch Patchen privater TUI-Renderer
- keine neue Workflow- oder Verification-Logik

## Entscheidungsoptionen

- SDK im Electron Main: bevorzugt
- SDK in kontrolliertem Node-Worker: nur bei nachgewiesenem Stabilitätsnutzen
- Pi RPC: dokumentierter Fallback, falls SDK-Integration objektiv scheitert

## Erforderliche Tests

- Prompt und Text-Streaming
- Tool-Event
- Permission-Dialog
- Ask-User-Dialog
- Sessionwechsel
- Projektwechsel
- Extension-Reload
- Verification-Event
- Abbruch laufender Aktion

## Abschlusskriterien

- [ ] Electron verwendet dieselbe Pi-Paketversion wie die TUI.
- [ ] `AgentSessionRuntime` kann erzeugt und kontrolliert geschlossen werden.
- [ ] Prompt, Streaming und mindestens ein Tool-Aufruf funktionieren.
- [ ] Aktive Extensions werden ohne private TUI-Renderer geladen.
- [ ] Permission- und Ask-User-Anfragen sind technisch erreichbar.
- [ ] Projekt- und Sessionwechsel sind grundsätzlich möglich.
- [ ] Changes- und Verification-Daten besitzen eine belegte Quelle.
- [ ] Es entsteht keine zweite fachliche Runtime.
- [ ] SDK- und RPC-Lücken sind schriftlich festgehalten.
- [ ] Architekturentscheidung für Phase 02 lautet nachvollziehbar SDK, Worker oder RPC.

## Gate

`NO-GO`, wenn vollständige Funktion nur durch eine abweichende Pi-Version, private TUI-Patches oder eine zweite Agentlogik möglich wäre.

