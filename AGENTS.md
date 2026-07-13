# Globale Agent-Regeln

Diese Regeln gelten für alle Pi-Sitzungen.

## Schutzregeln (nicht verhandelbar)

- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen Auftrag
  ausführen.
- Neue Projektabhängigkeiten oder Systempakete nur nach vorheriger Zustimmung
  hinzufügen oder installieren.
- Änderungen auf den konkreten Auftrag begrenzen. Keine großflächigen
  Refactorings, Umbenennungen oder Formatierungen ohne eigenen Auftrag.
- Bestehende und nicht zum Auftrag gehörende Nutzeränderungen erhalten.
- Secrets, Zugangsdaten, Auth-Dateien, Umgebungsvariablen und SSH-Schlüssel
  weder offenlegen noch in Logs, Dokumentation oder Versionskontrolle
  übernehmen.
- Änderungen mit den relevanten Tests und statischen Prüfungen verifizieren;
  Fehler und nicht ausführbare Prüfungen ausdrücklich nennen.
- Den aktuell gewählten Workflow- und Permission-Modus respektieren. Diese
  Datei erzwingt keinen zusätzlichen Planmodus.

## Verhaltensregeln

- Projektbezogene Anweisungen ergänzen diese Regeln, heben aber Schutzregeln
  nicht stillschweigend auf.

## Repository-spezifische Architektur

- Zentui besitzt den einzigen globalen Editor, Footer und User-Message-Chrome.
- `pi-tool-display` besitzt die Built-in-Renderer `read`, `grep`, `find`,
  `ls`, `bash`, `edit` und `write`.
- Lokale Extensions dürfen Verhalten, Sicherheitsentscheidungen und temporäre
  Dialoge bereitstellen, aber keine Header, Footer, Editoren, permanenten
  Widgets oder Sidebars registrieren.
- Nach Änderungen ist `npm --prefix npm run verify` auszuführen. Externe
  Paketversionen bleiben exakt gepinnt und werden nicht als `latest` oder
  Bereich referenziert.

## Subagenten-Delegation

- Die Entscheidung, eine Aufgabe an das `subagent`-Tool zu delegieren, trifft
  der Haupt-Agent eigenständig; eine ausdrückliche Nutzeranfrage ist nicht
  erforderlich.
- **Delegieren, wenn mindestens eines zutrifft:**
  - mehrere Dateien/Verzeichnisse müssen unabhängig durchsucht werden
  - eine spezialisierte Prüfung ist nötig (Architektur, Sicherheit, UI/UX,
    Dokumentationsabgleich, Tests)
  - eine unabhängige Zweitprüfung reduziert ein reales Fehlerrisiko klar
  - ein bereits abgenommener, eng begrenzter Plan soll umgesetzt werden
  - Teilaufgaben lassen sich sinnvoll parallel ausführen
- **Nicht delegieren, wenn mindestens eines zutrifft:**
  - triviale, lokal begrenzte Ein-Datei-Änderung oder Typo-Fix
  - kurze Erklärung oder Nachfrage ohne Recherchebedarf
  - rein mechanischer Kleinstfix
  - der Prozessstart-Overhead übersteigt erkennbar den Nutzen
- Passende Profile (`agents/*.md`) je Aufgabentyp:
  - breite Codebase-Exploration über mehrere Dateien/Verzeichnisse → `scout`
  - Umsetzungsplan für eine komplexe Änderung → `planner`
  - Architektur-/Alternativenbewertung vor größeren Entscheidungen → `architect`
  - Umsetzung eines bereits abgenommenen, eng begrenzten Plans → `worker`
  - Review eines Diffs auf Bugs, Regressionen, Scope-Drift → `reviewer`
  - Sicherheitsaudit vor Abschluss riskanter Änderungen → `security-auditor`
  - kontrolliertes Ausführen von Tests/Static-Checks → `test-runner`
  - Dokumentationsabgleich mit dem aktuellen Code → `docs-auditor`
  - UI/UX-Review → `ui-reviewer`
  - Zweitmeinung zu riskanten Plänen oder widersprüchlichen Reviews → `oracle`
- Unabhängige Teilaufgaben parallel delegieren (`tasks[]`, max. 8 gleichzeitig,
  Standardkonkurrenz 4), abhängige Arbeitsschritte sequenziell verketten (`chain[]`).
- Subagenten-Ergebnisse sind Vorschläge, keine Freigaben; der Haupt-Agent
  bewertet sie und trifft die finale Entscheidung.

Diese Liste ist die einzige verbindliche Quelle für Delegationskriterien und
Agentenzuordnung. Andere Prompts (Plan-/Skill-Modus u. Ä.) verweisen nur
hierher, statt eigene Agentenlisten oder Regeln zu wiederholen.

### Synthese von Subagenten-Ergebnissen

Der Haupt-Agent fasst Subagenten-Ergebnisse nicht ungefiltert weiter, sondern
synthetisiert sie zu einer eigenständigen, verständlichen Abschlussantwort.
Nach mindestens einem Subagenten-Aufruf enthält die sichtbare Antwort, soweit
zutreffend:

- die wichtigsten Ergebnisse oder durchgeführten Änderungen
- relevante Belege, Dateien oder Fundstellen (Datei:Zeile statt bloßer
  Behauptung)
- erkannte Risiken, Fehler oder offene Punkte
- Ergebnisse von Tests und Verifikation
- eine klare Schlussfolgerung bzw. den nächsten sinnvollen Schritt

Bei paralleler Delegation (`tasks[]`) werden Widersprüche zwischen den
Teilergebnissen ausdrücklich benannt und gewichtet, nicht stillschweigend
durch die zuletzt gelesene Meinung ersetzt.

Nicht tun: Subagenten-Rohausgaben unverändert wiederholen, interne
Gedankengänge/Reasoning der Subagenten offenlegen, oder die Antwort bei
einfachen Ergebnissen unnötig in die Länge ziehen. Eine reine Meldung wie
„erledigt“ oder „keine Probleme gefunden“ reicht nicht, wenn der Subagent
verwertbare Ergebnisse geliefert hat.

### Delegations-Selbstcheck

Vor jedem nicht-trivialen Schritt kurz prüfen, damit Delegation nicht
versehentlich unterbleibt:

1. **Abgrenzbar?** Lässt sich der Schritt als eigenständige, überprüfbare
   Teilaufgabe abgrenzen?
2. **Profilpassend?** Passt er zum Profil eines vorhandenen Subagenten
   (`agents/*.md`)?

Beide ja → das `subagent`-Tool an passender Stelle aufrufen (parallel via
`tasks[]`, sequenziell via `chain[]`). Wenn das Tool fehlt oder keine passenden
Agenten gefunden werden, dies sichtbar als Diagnose/Blocker melden und auf
`/tools`, `/subagents-doctor` und die Tool-Action `{action: "list"}` verweisen.
Nicht stillschweigend so tun, als sei delegiert worden.

Ergänzt die Regeln oben und hebt keine Schutzregel auf.
