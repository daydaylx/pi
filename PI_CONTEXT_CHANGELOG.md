# Pi Context Change Log

Sicherung: `/home/d/.pi/agent/backups/pi-context-audit/20260715-232411`  
Manifest: `manifest.tsv` im Sicherungsverzeichnis; alle bestehenden Kopien
wurden gelesen und per SHA-256 verifiziert.

## `/home/d/.pi/agent/AGENTS.md`

Pfad: `/home/d/.pi/agent/AGENTS.md`  
Vorheriger Zweck: Globale Regeln, Pi-Repo-Architektur und vollständige Subagenten-Routinglogik.  
Änderung: Auf 36 Zeilen globale Schutz-, Kontext-, Session- und Delegationsgrundsätze reduziert.  
Begründung: Projektdetails und lange Workflows nicht dauerhaft injizieren.  
Risiko: Detailregeln müssen bei Bedarf aus der Dokumentation gelesen werden.  
Rückbau: Gesicherte Datei aus `files/home/d/.pi/agent/AGENTS.md` wiederherstellen.  
Verifikation: Resource-Loader lädt die Datei einmalig mit 2.626 Byte.

## `/home/d/.pi/AGENTS.md`

Pfad: `/home/d/.pi/AGENTS.md`  
Vorheriger Zweck: Wörtliches, von Pi nicht expandiertes `@AGENTS.md` und drei allgemeine Claude-Code-Regeln.  
Änderung: Kompakte Projektkarte für das Pi-Setup.  
Begründung: Globale und projektspezifische Regeln sauber trennen.  
Risiko: Gilt für alle Arbeiten unter `/home/d/.pi`.  
Rückbau: Gesicherte Datei aus `files/home/d/.pi/AGENTS.md` wiederherstellen.  
Verifikation: Resource-Loader lädt sie als letzte Projektregel mit 1.784 Byte.

## `settings.json`

Pfad: `/home/d/.pi/agent/settings.json`  
Vorheriger Zweck: Globale Pi-, Modell-, Paket-, Extension- und Compaction-Konfiguration.  
Änderung: `extensions/tool-output-guard.ts` gezielt aktiviert.  
Begründung: Subagenten-Endresultate vor Aufnahme in den Parent-Kontext begrenzen.  
Risiko: Nur übergroße `subagent`-Textresultate werden verändert. Parallel änderte der Nutzer Standardmodell und Modellfreigaben; diese Änderungen gehören nicht zum Audit-Patch.  
Rückbau: Nur den Extension-Eintrag entfernen; die Gesamtsicherung nicht blind zurückspielen, da sie die parallele Modelländerung überschreiben würde.  
Verifikation: JSON gültig; Pi-RPC startet mit `cohere/north-mini-code:free` (256K/64K) ohne Extensionfehler; Live-Request bestanden.

## `extensions/plan-mode/index.ts`

Pfad: `/home/d/.pi/agent/extensions/plan-mode/index.ts`  
Vorheriger Zweck: Plan-/Review-/Decision-/Work-Workflow mit wiederholten versteckten Phasennachrichten.  
Änderung: Nur Scaffolding vor der letzten terminalen Assistant-Antwort wird gefiltert; Toolcall-Fortsetzungen und echte Usertexte bleiben.  
Begründung: Kontextwachstum stoppen, ohne Stopregeln innerhalb eines Multi-Tool-Turns zu verlieren.  
Risiko: Neue Pi-Stopgründe müssen als terminal oder fortsetzend klassifiziert werden.  
Rückbau: Gesicherte Datei wiederherstellen.  
Verifikation: Regressionstests für ersten Work-Turn, Folgeturn, `toolUse`, terminale Antwort und Marker im Usertext bestehen.

## `extensions/shared/output-limits.ts`

Pfad: `/home/d/.pi/agent/extensions/shared/output-limits.ts`  
Vorheriger Zweck: Nicht vorhanden.  
Änderung: Gemeinsame ausgewogene 50-KiB-/2.000-Zeilen-Grenze mit sichtbarem Marker und UTF-8-sicherem Einzelzeilen-Head/Tail.  
Begründung: Fehler und Empfehlungen am Ende großer Resultate erhalten.  
Risiko: Mittelteil großer Resultate wird absichtlich entfernt.  
Rückbau: Importierende Änderungen zurückbauen und Datei löschen.  
Verifikation: ASCII-, Head/Tail- und 160-KB-Emoji-Regressionstests bestehen; tatsächliche Bytes/Zeilen stimmen.

## `extensions/tool-output-guard.ts`

Pfad: `/home/d/.pi/agent/extensions/tool-output-guard.ts`  
Vorheriger Zweck: Nicht vorhanden.  
Änderung: Ausschließlicher `tool_result`-Backstop für übergroße Subagenten-Texte.  
Begründung: Paket-`maxOutput` ist nicht im Schema und würde nur den Anfang behalten.  
Risiko: Programmatische Aufrufer mit eigenem Paket-`maxOutput` können weiterhin vorher kürzen.  
Rückbau: Settings-Eintrag und Datei entfernen.  
Verifikation: HEAD-/TAIL-Sentinels bleiben; `details` und `isError` bleiben unverändert.

## `extensions/lsp/tools.ts`

Pfad: `/home/d/.pi/agent/extensions/lsp/tools.ts`  
Vorheriger Zweck: Fünf eigene LSP-Tools mit teilweise unbegrenzten Textresultaten.  
Änderung: Alle Textresultate durchlaufen die gemeinsame Grenze; Kürzung steht in `details.truncation`.  
Begründung: Große Diagnostics, Definitionen und Hover-Texte nicht ungefiltert injizieren.  
Risiko: Sehr große Ergebnisse benötigen eine gezieltere Folgeabfrage.  
Rückbau: Gesicherte Datei wiederherstellen.  
Verifikation: Typecheck und LSP-Ausgabegrenzentest bestehen.

## `extensions/pi-tool-display/config.json`

Pfad: `/home/d/.pi/agent/extensions/pi-tool-display/config.json`  
Vorheriger Zweck: Darstellung der Toolresults ohne Truncation-Hinweis.  
Änderung: `showTruncationHints: true`.  
Begründung: Kürzung für den Nutzer sichtbar machen.  
Risiko: Nur zusätzliche UI-Hinweise.  
Rückbau: Wert auf `false` setzen oder Sicherung wiederherstellen.  
Verifikation: JSON gültig.

## `extensions/subagent/config.json`

Pfad: `/home/d/.pi/agent/extensions/subagent/config.json`  
Vorheriger Zweck: Nur UI-Widget-Konfiguration.  
Änderung: `toolDescriptionMode: compact`.  
Begründung: Dauerhafte Toolbeschreibung von etwa 6,7 KB auf 2,2 KB senken.  
Risiko: Detailhilfe muss aus Skill/Dokumentation geladen werden.  
Rückbau: Feld entfernen oder Sicherung wiederherstellen.  
Verifikation: JSON gültig; echter Subagenten-Aufruf erfolgreich.

## Agentprofile

Die folgenden zehn Dateien wurden einzeln geändert:

### `agents/architect.md`

Pfad: `/home/d/.pi/agent/agents/architect.md`  
Vorheriger Zweck: Architekturreview mit eigenem Ausgabeformat.  
Änderung: Explizite Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Chat-Isolation und kompakte Parent-Rückgabe.  
Risiko: Projektregeln werden bewusst weiter geladen.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/docs-auditor.md`

Pfad: `/home/d/.pi/agent/agents/docs-auditor.md`  
Vorheriger Zweck: Dokumentationsabgleich mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Einheitliche, begrenzte Rückgabe.  
Risiko: Keine neue Schreibberechtigung.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/oracle.md`

Pfad: `/home/d/.pi/agent/agents/oracle.md`  
Vorheriger Zweck: Modellgebundene Zweitmeinung mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Parent-Chat nicht ungeprüft erben.  
Risiko: Festes Oracle-Modell bleibt unverändert.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/planner.md`

Pfad: `/home/d/.pi/agent/agents/planner.md`  
Vorheriger Zweck: Read-only-Planung mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Planung ohne kompletten Parent-Chat.  
Risiko: Relevante Parententscheidungen müssen explizit im Task stehen oder per Fork übergeben werden.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/reviewer.md`

Pfad: `/home/d/.pi/agent/agents/reviewer.md`  
Vorheriger Zweck: Read-only-Diffreview mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Unabhängige Zweitprüfung und strukturierte Findings.  
Risiko: Keine neue Schreibberechtigung.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/scout.md`

Pfad: `/home/d/.pi/agent/agents/scout.md`  
Vorheriger Zweck: Read-only-Codebase-Erkundung mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Kompakter isolierter Handoff.  
Risiko: Keine neue Schreibberechtigung.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML; echter Fresh-Aufruf ohne Parent-Sentinel.

### `agents/security-auditor.md`

Pfad: `/home/d/.pi/agent/agents/security-auditor.md`  
Vorheriger Zweck: Sicherheitsprüfung mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Unabhängiges Audit ohne Parent-Chatkopie.  
Risiko: Projektregeln bleiben aus Sicherheitsgründen sichtbar.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/test-runner.md`

Pfad: `/home/d/.pi/agent/agents/test-runner.md`  
Vorheriger Zweck: Kontrollierte Tests mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Testlogs kompakt in den Parent zurückgeben.  
Risiko: Keine neue Schreibberechtigung.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/ui-reviewer.md`

Pfad: `/home/d/.pi/agent/agents/ui-reviewer.md`  
Vorheriger Zweck: UI/UX-Review mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Einheitliche isolierte Rückgabe.  
Risiko: Keine neue Schreibberechtigung.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

### `agents/worker.md`

Pfad: `/home/d/.pi/agent/agents/worker.md`  
Vorheriger Zweck: Eng begrenzte Umsetzung mit eigenem Ausgabeformat.  
Änderung: Fresh-/Projektkontext-/Skill-Policy und gemeinsamer Ergebnisvertrag.  
Begründung: Abgenommenen Plan über klaren Task statt gesamten Parent-Chat übergeben.  
Risiko: Umfangreiche Parententscheidungen erfordern expliziten Fork.  
Rückbau: Gleichnamige Sicherung wiederherstellen.  
Verifikation: YAML und sechs Überschriften gültig.

## `docs/runtime-matrix.md`

Pfad: `/home/d/.pi/agent/docs/runtime-matrix.md`  
Vorheriger Zweck: Runtime-Matrix mit Pi 0.80.6 als vermeintlich aktivem Wert.  
Änderung: Aktive Runtime 0.80.7 und Dev-Pin 0.80.6 getrennt.  
Begründung: Tatsächliche Runtime nicht mit Testabhängigkeit verwechseln.  
Risiko: Dokumentiert eine verbleibende Abweichung.  
Rückbau: Sicherung wiederherstellen.  
Verifikation: `pi --version` und `npm --prefix npm list` gegengeprüft.

## `docs/subagents.md`

Pfad: `/home/d/.pi/agent/docs/subagents.md`  
Vorheriger Zweck: Paketmigration, Profile und UI.  
Änderung: Fresh/Fork-Semantik, Kontextvererbung, Output-Lücke und Ergebnisvertrag ergänzt.  
Begründung: Detailregeln aus globalem Prompt auslagern.  
Risiko: Muss bei Paketupdates erneut gegen den Quellcode geprüft werden.  
Rückbau: Sicherung wiederherstellen.  
Verifikation: Quellcodeabgleich und echter Fresh-Subagententest.

## `docs/PROJECT_STATE.md`

Pfad: `/home/d/.pi/agent/docs/PROJECT_STATE.md`  
Vorheriger Zweck: Nicht vorhanden.  
Änderung: Kompakter aktueller Arbeitszustand mit elf vereinbarten Abschnitten.  
Begründung: Fortsetzbare Aufgaben nicht nur im Chat speichern.  
Risiko: Veralteter Zustand, wenn Phasenwechsel nicht gepflegt werden.  
Rückbau: Datei löschen.  
Verifikation: Unter 250 Zeilen; Endstand und letzte Prüfungen eingetragen.

## `skills/context-checkpoint/SKILL.md`

Pfad: `/home/d/.pi/agent/skills/context-checkpoint/SKILL.md`  
Vorheriger Zweck: Nicht vorhanden.  
Änderung: Bedarfsgesteuerter Workflow zum Erstellen/Aktualisieren des Projektstatus.  
Begründung: Entscheidungen, Fehler und nächste Schritte vor Compaction/Sessionwechsel erhalten.  
Risiko: Schreibender Aufruf benötigt passenden Permission-Modus.  
Rückbau: Skill-Verzeichnis löschen.  
Verifikation: Skill-Creator-Validator bestanden; Metadaten-only-Katalog und gezielte Expansion geprüft.

## `tests/run.mjs`

Pfad: `/home/d/.pi/agent/tests/run.mjs`  
Vorheriger Zweck: Zentraler Testlauf für lokale Extensions und Ressourcen.  
Änderung: Skillanzahl, Plan-Kontextgrenzen, Subagenten-Guard, LSP-Limits und UTF-8-Randfälle getestet.  
Begründung: Kontextänderungen gegen Regressionen absichern.  
Risiko: Bestehende Fake-LSP-Baseline bleibt rot.  
Rückbau: Sicherung wiederherstellen.  
Verifikation: 356 Tests bestanden; 26 bekannte Fake-LSP-Fehler.

## Berichte

### `PI_CONTEXT_AUDIT.md`

Pfad: `/home/d/.pi/agent/PI_CONTEXT_AUDIT.md`  
Vorheriger Zweck: Nicht vorhanden.  
Änderung: Ist-Zustand, Inventar, Konflikte, Extension-Matrix, Änderungen und Risiken dokumentiert.  
Begründung: Nachvollziehbare Bestandsaufnahme ohne Secrets.  
Risiko: Provider- und Paketangaben altern.  
Rückbau: Datei löschen.  
Verifikation: Gegen Runtime, Settings, Loader, Paketquellen und Tests abgeglichen.

### `PI_CONTEXT_ARCHITECTURE.md`

Pfad: `/home/d/.pi/agent/PI_CONTEXT_ARCHITECTURE.md`  
Vorheriger Zweck: Nicht vorhanden.  
Änderung: Zielarchitektur, Sessionstrategie, Compact-Prompt und Tool-/Subagentenregeln dokumentiert.  
Begründung: Ausführliche Referenz bedarfsgesteuert statt im globalen Prompt.  
Risiko: Bei Core- oder Extensionwechsel erneut prüfen.  
Rückbau: Datei löschen.  
Verifikation: Mit aktuellem Pi-0.80.7-Verhalten und Live-Tests abgeglichen.

### `PI_CONTEXT_CHANGELOG.md`

Pfad: `/home/d/.pi/agent/PI_CONTEXT_CHANGELOG.md`  
Vorheriger Zweck: Nicht vorhanden.  
Änderung: Dieses dateiweise Änderungs- und Rückbauprotokoll.  
Begründung: Vollständigen Rückbau und Auditierbarkeit ermöglichen.  
Risiko: Keines für Laufzeit.  
Rückbau: Datei löschen.  
Verifikation: Gegen `git status`, Diff und Sicherungsmanifest abgeglichen.

## UI-Folgeänderungen vom 16. Juli 2026

Sicherung: `/home/d/.pi/agent/backups/20260716-002807-ui-redesign`
Manifest: `manifest.sha256`; alle neun Nutzdateien wurden erfolgreich geprüft.

### `zentui.json`

Pfad: `/home/d/.pi/agent/zentui.json`  
Vorheriger Zweck: Reduziertes Agent-Layout ohne Git-, Kontext-, Token- oder Kosten-Segmente.  
Änderung: Standard-/Cockpit-Layout mit dreigeteiltem Footer, Kontext-Gauge, expliziten Status-Platzierungen, begrenztem Vollpfad und 15-Sekunden-Projektrefresh; Runtime bleibt aus Dichtegründen aus und unbekannte Extension-Statuswerte sind standardmäßig verborgen.  
Begründung: Deutlich stärkere Informationshierarchie mit dem bereits gepinnten UI-Eigentümer.  
Risiko: Etwas höhere visuelle Dichte und ein periodischer read-only Git-Refresh.  
Rückbau: Gesicherte `zentui.json` wiederherstellen.  
Verifikation: JSON und Konfigurationsregressionen bestanden; interaktiver Start
und `/reload` bei 80 sowie Start bei 120 Spalten ohne Extensionfehler.

### `settings.json`

Pfad: `/home/d/.pi/agent/settings.json`  
Vorheriger Zweck: Aktivierte zusätzlich den lokalen `git-header`.  
Änderung: Nur den `git-header`-Eintrag deaktiviert; Datei und Paket-Caches bleiben erhalten.  
Begründung: Doppeltes Header-/Git-Eigentum und unnötige Git-Prozesse vermeiden.  
Risiko: Kein permanenter Header; Git-Informationen stehen im Footer.  
Rückbau: `+extensions/git-header.ts` wieder ergänzen.  
Verifikation: JSON gültig und Extension-Auswahl getestet.

### `extensions/activity-status.ts`

Pfad: `/home/d/.pi/agent/extensions/activity-status.ts`  
Vorheriger Zweck: Working-Indikator und zusätzliches Zurücksetzen des Hidden-Thinking-Labels.  
Änderung: Hidden-Thinking-Label-Zugriffe entfernt.  
Begründung: `activity-status` besitzt nur Working-Zustand; `thinking-view` besitzt das Thinking-Label.  
Risiko: Bei deaktiviertem `thinking-view` fällt das Label auf Pi-Core zurück.  
Rückbau: Gesicherte Datei wiederherstellen.  
Verifikation: Activity- und Thinking-Lifecycle-Tests bestanden.

### `tests/run.mjs`

Pfad: `/home/d/.pi/agent/tests/run.mjs`  
Vorheriger Zweck: Prüfte das alte Agent-Layout und die frühere Header-Ausnahme.  
Änderung: Cockpit-Layout, Statusplatzierungen, deaktivierten Git-Header und eindeutiges Hidden-Label-Eigentum abgesichert.  
Begründung: UI-Eigentümerwechsel reproduzierbar halten.  
Risiko: Keines für die Laufzeit.  
Rückbau: Gesicherte Datei wiederherstellen.  
Verifikation: 356 Tests bestanden; unverändert 26 bekannte Fake-LSP-Fehler.

### Externe UI-Kandidaten

Pfad: keine aktive Datei; Quellcode nur unter `/tmp` geprüft.  
Vorheriger Zweck: Geplanter Full-UI-Ersatz.  
Änderung: `pi-droid-styling` und Vera bewusst nicht global installiert.  
Begründung: Tool-Semantik, Trust-Bypass, private Monkey-Patches und mangelhafte Versions-/Smoke-Verifikation.  
Risiko: Der sichere Cockpit-Umbau ist visuell weniger radikal als ein Full-UI-Fork.  
Rückbau: Nicht erforderlich.  
Verifikation: Zwei unabhängige Quellcode-/Kompatibilitätsaudits und isolierter Vera-Start.
