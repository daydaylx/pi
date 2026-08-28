# Phase 1 – Abschlussreport

## Status

- Phase: 1
- Ergebnis: PASS (mit einem offenen Erhebungspunkt: GitHub-Issue-Triage)
- Nächste Phase: 2 — BLOCKED

## Umgesetzt

- Beide Pflichtkandidaten geklont und vollständig auditiert
  (`docs/gui-baseline/phase-1-gui-candidate-audit.md`):
  - A `FaqFirebase/pi-desktop` (Electron+React 19, RPC-first, Apache-2.0)
  - B `minghinmatthewlam/pi-gui` (Electron+SDK in-process, MIT)
- Unterschiede dokumentiert: RPC-Fremdprozess vs. In-Process-SDK
  (^0.80.6-Pin vs. unser gepatchter 0.84.3-Stand), Permission-Dopplung
  bei A (abschaltbar) vs. SDK-Wahrheitskonflikt bei B.
- Pflicht-Prototyp des Favoriten A gegen die echte Runtime:
  Verbindungscontract `pi --mode rpc` end-to-end verifiziert
  (Prozessstart, Session-State, Prompt, Streaming 25× message_update,
  Read-Tool-Events, agent_end/settled, strukturierte Fehler, abort).
  Evidenz: `rpc-prototype-evidence.jsonl`, `rpc-prototype-complete.jsonl`.
- Keine Core-Anpassung vorgenommen.

## Nicht umgesetzt

- Verlässliche GitHub-Issue-Triage beider Projekte (Issue-Seiten nicht
  maschinell lesbar aus dieser Umgebung) — als offener Punkt im Audit
  ausgewiesen; vor der Fork-/Integrationsentscheidung nachzuholen.
- Kandidat C (`AJSubrizi/Pi-App`) bewusst nicht auditiert (Begründung im
  Audit-Kopf); bei Ablehnung von A und B nachholen.
- Praktischer Prototyp von B (SDK-Lauf) nicht ausgeführt — B scheidet auf
  Grundlage der statischen Konfliktanalyse aus; ein SDK-Vergleichslauf
  würde eine Zweitinstallation der Runtime erfordern.

## Tests

- Prototyp-Komplettlauf:
  - Ergebnis: alle 8 Prüfpunkte PASS, 0 extension_error im sauberen Lauf
- Abort-/Shutdown-Fall:
  - Ergebnis: abort success:true; dabei stale-ctx-Fehler in setup-core/
    plan-mode/resilience bei hartem Shutdown im aktiven Turn —
    dokumentiert als Phase-3-Stabilitätsarbeit (Testmatrix D)
- Code-Regressionen: keine (kein Produktivcode berührt)

## Abschlusskriterien (Dokument 06)

- [x] A vollständig auditiert
- [x] B vollständig auditiert
- [x] Unterschiede nachvollziehbar dokumentiert
- [x] Favorit praktisch gegen daydaylx/pi getestet
- [x] keine Core-Anpassung nur für den Kandidaten
- [x] Lizenz geprüft (A: Apache-2.0, B: MIT — beide kompatibel)
- [x] Wiederverwendungsanteil realistisch bewertet (~Phase 3–4 weitgehend abgedeckt)
- [x] No-Go-Kriterien geprüft (B trifft Nr. 7 teilweise; A nur Nr. 5, mitigiert)
- [x] klare Empfehlung: **Kandidat A**
- [ ] Issue-Triage (offen, siehe oben)

## Regressionen

- keine

## Risiken

- Alpha-Status von A: API-/Verhaltensänderungen zwischen Releases möglich;
  Pin auf einen Commit + eigener Branch als Schutz.
- Permission-Dopplung: ohne Entscheidung entsteht R2-nahe Doppelwahrheit;
  Vorschlag steht im Audit (deren Extension deaktivieren).
- Stale-ctx-Fehler beim harten Shutdown im aktiven Turn (RPC): muss vor
  Phase-3-Abschluss behoben sein (GUI-Crash-Szenarien).
- `pi gui`-Startpfad existiert noch nicht; Wrapper-vs-Runtime-Erweiterung
  ist eine Phase-2/3-Entscheidung mit Packaging-Folgen.

## Technische Schulden

- Kandidaten-Klone liegen unversioniert unter `git/github.com/` (50-Commits-Shallow);
  für die Integration ist ein vollständiger Clone/Fork nötig.
- `/tmp`-Duplikat des ersten Klons konnte wegen Schutzgrenze nicht entfernt
  werden (ephemeral, harmlos).
- Evidenz-JSONLs sind Rohdaten (~38 KB) und bleiben als Beleg liegen.

## Geänderte Dateien

- neu: `git/github.com/FaqFirebase/pi-desktop/` (Clone),
  `git/github.com/minghinmatthewlam/pi-gui/` (Clone),
  `docs/gui-baseline/phase-1-gui-candidate-audit.md`,
  `rpc-prototype-evidence.jsonl`, `rpc-prototype-stderr.txt`,
  `rpc-prototype-complete.jsonl`

## Rollback

- Klone und Artefakte löschen; kein Eingriff in Runtime, Extensions oder
  Settings. Phase-0-Baseline bleibt unverändert gültig.

## Empfehlung

- GO für Phase 2 (Frontend-Protokoll) auf Basis **Kandidat A**,
  mit Vorentscheidung: pi-desktop-permissions-Extension deaktivieren,
  unser Permission-Stack bleibt fachlich maßgeblich. Freigabe durch den
  Nutzer erforderlich.

## Harte Sperre

```text
STATUS: PHASE 1 COMPLETE
NEXT: PHASE 2 BLOCKED
RECOMMENDATION: A (FaqFirebase/pi-desktop)
USER APPROVAL REQUIRED
```
