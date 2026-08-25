# 019 — Dashboard-Modi und Phase/Verifikations-Präzedenz

## Kontext

Das Optimierungspaket in `pi-tui-optimization-package/` belegte drei
Korrektheits- und drei Kostenprobleme der Aurora-TUI:

1. **Widersprüchliche Zustände:** `determineTaskPhase()` leitete die Phase aus
   dem letzten groben Verifikationsstatus ab, während das sichtbare Urteil
   (`projectVerificationState()`) zusätzlich Staleness kannte. Ein Edit nach
   erfolgreicher Prüfung erzeugte `ABGESCHLOSSEN` neben `OFFEN`; ein
   fehlgeschlagener Check stellte laufende Beseitigungsarbeit als `PRÜFEN` dar.
2. **Permanente Höhe:** Das Dashboard baute vier gerahmte Panels (Aufgabe,
   Aktivität, Änderungen, Prüfungen); das Idle-Aktivitätspanel behauptete
   dauerhaft „Bereit“.
3. **Doppelungen:** Routine-„verified“ im Footer parallel zum Panel,
   Fünfstufen-Fortschrittsbalken trotz nur inferierter Phase, `ARBEITET`
   plus `LÄUFT · Xs` in angrenzenden Zeilen, Beschreibungen unter jedem
   Menüeintrag plus Detailregion.

## Entscheidung

**Phase und Verifikation werden getrennt hergeleitet und teilen genau eine
Staleness-Definition** (`verificationIsStale()` in `task-projection.ts`):
Workspace-Mutation seit dem Check oder ein laufender Edit-/Prüf-Task. Die
Präzedenz lautet: Planungsmodus bleibt Planung; nur ein real laufendes
Verifikationstool zeigt `verify`; aktive Arbeit bleibt `work`, auch nach einem
früheren Fehlschlag; `done` erfordert Idle plus aktuellen (`READY`) Check.
Ein früherer Fehlschlag allein darf nie „läuft gerade eine Prüfung“ behaupten.

**Das Dashboard bekommt einen Modus mit einem Besitzer**: `ui.dashboard`
(`auto|compact|expanded|hidden`, Default `auto`) im zentralen
Setup-Schema (`setup.json`, validiert in `setup-core/config.ts`, dokumentiert in
`schemas/setup.schema.json`). Umschaltung ausschließlich über `/dashboard`,
das im Super+Q-Command-Center liegt; kein neuer Shortcut. `persistUiPreference()`
schreibt die Wahl in die globale setup.json zurück und meldet Fehler statt sie
stillschweigend zu verwerfen.

**Auto ist die responsive permanente Standardansicht**
(`renderAutoDashboard()`): Eine frische Sitzung zeigt zunächst den Startscreen;
danach bleibt eine kompakte Sitzungsübersicht mit Aufgabe, Aktivität,
Änderungen und Prüfung auch im Leerlauf sichtbar. Fehlgeschlagene bzw.
veraltete Prüfungen stehen vor Routinedaten. Kleine Terminals bekommen
höchstens zwei ungerahmte Zeilen mit sichtbarem Risiko. `compact` bleibt hart
≤2 Zeilen, `hidden` gibt den Platz komplett zurück, ohne Runtime-State zu
deaktivieren; `expanded` behält die Paneldarstellung innerhalb eines getesteten
Höhenbudgets (~40 % der Terminalzeilen).

**Informationsbesitz:** Routine-`verified` gehört jeder sichtbaren
Dashboardansicht, die eine Prüfzeile ausgibt — der Footer unterdrückt es dort
(`dashboardVisible`), failed/stale bleiben kritische Footer-Risiken. Im
zweizeiligen Auto-Fallback mit laufender Arbeit beansprucht Aktivität diese
Zeile; der Footer zeigt den Routineerfolg dann weiterhin. Der Fortschrittsbalken
existiert nur noch im Expanded-Modus.
Bei genau einem laufenden Tool unterdrückt die Toolzeile den reinen
`LÄUFT · Xs`-Suffix, den das Heading bereits trägt. Stille Tools melden sich
neutral (`STILL AKTIV`, danach `Xs ohne neue Ausgabe`) ohne Warnton; nur echte
Fehler tragen Warn-/Errorton.

**Menüs:** eine Listenzeile pro Eintrag, Beschreibung nur in der Detailregion
(jetzt auch im Standard-Layout), ein dekoratives Leerelement weniger, und ein
Fuzzy-Filter: Tippen editiert ihn, Backspace löscht zeichenweise, Esc löscht
erst und schließt dann; Buchstaben-Shortcuts greifen nur bei leerem Filter;
j/k-Navigation bleibt davon unberührt.

**Renderleistung — gemessen, nicht angenommen:** Die Phase-0-Diagnostik
(`dev-diagnostics.ts`, aktivierbar über `PI_AURORA_DIAG=1`) misst Renderanzahl,
Dauer, Tick-Intervall und Dashboard-Zeilen. Ein Benchmark über 400 Frames bei
aktivem Turn mit vier Tools misst ~0,9 ms pro vollständigem Widget-Frame
(`[render-measure]`-Ausgabe in der Runtime-Suite). Das liegt um den Faktor 100
unter dem 100-ms-Tick-Budget; deshalb bleiben Ticker bei 100 ms und Frame-Caching
ungebaut — eine Optimierung wäre hier unbelegte Komplexität.

## Konsequenzen

- Kein generiertes View-Model kann `done` mit `UNVERIFIED`/`NOT_READY`
  kombinieren; Regressionstests decken die komplette Zustandsmatrix samt
  Invariante ab (`tests/suites/runtime/aurora-ui.mjs`).
- Normalsitzungen verbrauchen im Auto-Modus dauerhaft höchstens sieben
  Dashboard-Zeilen; schmale Terminals fallen auf zwei ungerahmte Zeilen zurück,
  statt die Sitzungsorientierung vollständig auszublenden.
- Die `/dashboard`-Umschaltung schreibt die globale setup.json — Tests
  redirectieren `PI_CODING_AGENT_DIR` auf ein Wegwerfverzeichnis und pinnen
  modusabhängige Assertions explizit.
- Bewusst nicht umgesetzt: Receipt-Kompaktierung für web/subagent (Renderer
  gehören externen Paketen) sowie verify/project_check (Exit-Codes und
  Truncation-Hinweise sind Prüfevidenz); siehe den Header von
  `extensions/compact-tools/index.ts`.
