# P0 – Verifier-Contract und `timeoutMs`

## Befund

In Real-Duel #002 versuchte Pi, an den Verifier-Subagenten zu delegieren.
Der Aufruf wurde blockiert, weil ein nicht erlaubter Parameter `timeoutMs`
verwendet wurde.

Quelle: https://github.com/daydaylx/pi/blob/e30c7f5335c290ec2871c8a2af186a4bb0096d98/benchmarks/real-duel/reports/real-02-gui-ux-redesign.md

## Risiko

- der Verifier fällt genau dann aus, wenn er Sicherheit erzeugen soll.
- zusätzlicher Toolcall ohne Nutzen.
- unnötige Recovery-Schleifen.
- Benchmark misst Contract-Drift statt Agentenleistung.

## Arbeitsauftrag

Führe eine Contract-Analyse der Verifier-Delegation durch und beseitige jede
Diskrepanz zwischen Schema, Prompting und aufrufender Logik.

### Analyse

1. Ermittle das kanonische Subagent-/Verifier-Tool-Schema.
2. Suche repo-weit nach:
   - `timeoutMs`
   - Verifier-Beispielaufrufen
   - Tool-Wrappern
   - Skills
   - `AGENTS.md`
   - `APPEND_SYSTEM.md`
   - Permission-/Workflow-Regeln
3. Identifiziere, wo der ungültige Parameter in den Aufruf gelangt.
4. Prüfe, ob weitere Parameter nur dokumentiert, aber nicht erlaubt sind.
5. Prüfe Recovery:
   - Verifier nicht verfügbar
   - Tool-Aufruf denied
   - Schemafehler
   - Verifier-Lauf schlägt selbst fehl

### Umsetzung

- genau eine kanonische Schemaquelle.
- Beispiele/Prompts daraus ableiten oder gegen sie testen.
- ungültige Parameter entfernen.
- definierter Fallback auf lokale Projektverifikation, wenn Verifier nicht
  erfolgreich gestartet werden kann.
- Fehler darf nicht als erfolgreiche Verifikation gelten.

### Tests

- gültiger Verifier-Aufruf
- absichtlich ungültiger Parameter
- Permission denied
- Verifier nicht verfügbar
- Verifier schlägt fehl
- erfolgreicher Fallback
- keine doppelte Verifikation ohne Grund

### Abschlusskriterien

- kein `timeoutMs`-Contractfehler mehr.
- alle dokumentierten Verifier-Beispiele passen zum tatsächlichen Schema.
- Fallback-Verhalten ist deterministisch und getestet.
