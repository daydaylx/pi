# Pi GUI – Arbeitsauftragspaket

## Zweck

Dieses Paket definiert die kontrollierte Einführung einer echten Desktop-GUI für `daydaylx/pi`, ohne den fachlichen Pi-Unterbau zu ersetzen.

Das Ziel ist **nicht**, Pi in eine andere Agentenplattform umzubauen. Das Ziel ist:

- `pi` bleibt die bestehende TUI/CLI mit Aurora.
- `pi gui` wird eine zusätzliche Desktop-Oberfläche.
- Pi-Core, Harness, Tools, Extensions, Modelle, Provider, Sessions, Workflows, Permissions, Verifikation und Subagenten bleiben die fachliche Quelle der Wahrheit.
- Bestehende Shortcuts und Menülogik bleiben möglichst erhalten.
- Die GUI darf optisch und strukturell deutlich anders aussehen.
- Frontend-spezifische Darstellung darf neu gebaut werden.
- Fachliche Entscheidungen dürfen nicht in die GUI dupliziert werden.

## Harte Arbeitsregel

**Nach jeder Phase MUSS gestoppt werden.**

Die nächste Phase darf erst begonnen werden, wenn:

1. alle Abschlusskriterien der aktuellen Phase erfüllt sind,
2. die geforderten Nachweise vorliegen,
3. offene Risiken dokumentiert wurden,
4. ein kurzer Phase-Report erstellt wurde,
5. der Nutzer die Fortsetzung ausdrücklich freigegeben hat.

Ohne explizite Freigabe darf **nicht** weitergearbeitet werden.

Beispiele für gültige Freigaben:

- `Phase 1 freigegeben`
- `Weiter mit Phase 2`
- `Go für Phase 3`

Nicht ausreichend:

- automatische Annahme,
- implizite Zustimmung,
- erfolgreicher Testlauf allein,
- "sieht gut aus",
- Agenten-eigene Entscheidung.

## Empfohlene GUI-Basis

Primärer Kandidat für den ersten Audit:

- `FaqFirebase/pi-desktop` – Electron/React/TypeScript, RPC-basierte Pi-Anbindung.

Sekundärer Vergleichskandidat:

- `minghinmatthewlam/pi-gui` – Electron/React/TypeScript, stärker SDK-orientiert.

Es darf **nicht** vor Phase 1 festgelegt werden, welcher Kandidat verwendet wird.

## Dokumente

- `01_ARBEITSAUFTRAG.md` – Master-Arbeitsauftrag
- `02_ZIELARCHITEKTUR.md` – technische Zielarchitektur
- `03_UMSETZUNGSREGELN.md` – harte Implementierungsregeln
- `04_GO_NO_GO_KRITERIEN.md` – Abbruch- und Auswahlkriterien
- `05_PHASE_0_BASELINE_AUDIT.md`
- `06_PHASE_1_GUI_CANDIDATE_AUDIT.md`
- `07_PHASE_2_FRONTEND_PROTOCOL.md`
- `08_PHASE_3_MINIMAL_GUI_INTEGRATION.md`
- `09_PHASE_4_SHORTCUT_MENU_PARITY.md`
- `10_PHASE_5_CORE_STATES.md`
- `11_PHASE_6_UX_POLISH.md`
- `12_PHASE_7_HARDENING_PACKAGING.md`
- `13_PHASE_8_MIGRATION_DECISION.md`
- `14_TESTMATRIX.md`
- `15_FREIGABE_TEMPLATE.md`

## Nicht-Ziel

Nicht Teil dieses Auftrags:

- Pi-Core auf Electron portieren.
- Aurora vorschnell entfernen.
- bestehende Shortcuts neu erfinden.
- Agentenlogik in React nachbauen.
- Verification-Logik im Frontend duplizieren.
- separate GUI-eigene Modell-/Permission-/Workflow-Wahrheiten schaffen.
- aus `pi gui` sofort den Standardmodus machen.
