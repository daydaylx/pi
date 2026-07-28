# Repository Audit

Stand: 2026-07-25
Geprüfter Commit: `8beb484d47d85f3312243982be7370ba83c1ac60`

## Executive Summary

Geprüft wurde der gesamte versionierte Stand mit 173 Dateien sowie relevante
lokale, nicht versionierte Steuerdateien. Der Audit selbst wurde zunächst
read-only durchgeführt.

Klassifikation:

- **Bestätigt:** direkt im Code, in Konfigurationen oder durch ausgeführte
  Prüfungen belegt.
- **Wahrscheinlich:** aus bestätigten Fakten abgeleitete Auswirkung.
- **Vermutung:** nicht ausreichend belegt; nicht als Befund verwendet.
- **Nicht nachweisbar:** mit dem Repository und der lokalen Umgebung nicht
  prüfbar.

Das Projekt ist ein überdurchschnittlich sorgfältig gebautes Pi-Agent-Setup mit
striktem TypeScript, umfangreichen Zustands- und Sicherheitsmechanismen sowie
963 erfolgreichen Prüfassertionen. Es ist jedoch noch nicht uneingeschränkt
übergabefähig: Die Permission-Policy lässt Shell-Variablenexpansionen an
mehreren Sicherheitsgrenzen vorbei, die dokumentierte Root-`package.json` ist
nicht versioniert, zwei transitive Dependencies haben bekannte Advisories und
zentrale Workflow-/Testdateien sind sehr groß.

## Gesamtbewertung (0–10)

**6,1/10**

| Bereich | Gewicht | Bewertung | Begründung |
|---|---:|---:|---|
| Architektur | 20 % | 7,0 | Klare Module, keine Importzyklen; Plan-Orchestrator zu groß |
| Codequalität/Wartbarkeit | 20 % | 6,0 | Gute Typisierung und defensive Logik; God Function und Testmonolith |
| Sicherheit | 20 % | 4,5 | Viele Schutzmaßnahmen, aber relevanter Policy-Bypass und Dependency-Risiken |
| Tests/Produktionsreife | 15 % | 6,5 | 963/0 und strict typecheck; Integrationslücken und defekter Fresh-Checkout-Vertrag |
| UX | 10 % | 7,0 | Responsive TUI, gute Navigation; Accessibility nur teilweise belegt |
| Performance/Skalierung | 10 % | 6,0 | Mehrere Bounds vorhanden; Diff und LSP-Cache bleiben unbeschränkt |
| Dokumentation/DevEx | 5 % | 6,0 | Viel Dokumentation; mehrere veraltete Statusangaben |

## Stärken

- **Bestätigt:** `strict: true`, `noEmit`, ES2022 und klar definierte
  Importpfade in [`tsconfig.json`](../tsconfig.json).
- **Bestätigt:** `npm run verify` ist erfolgreich: Typecheck grün,
  **963 bestanden, 0 fehlgeschlagen**.
- **Bestätigt:** keine TypeScript-Importzyklen im analysierten Modulgraphen.
- **Bestätigt:** Plan-State verwendet Revisionen, CAS, Locks,
  Execution-Identitäten und konservative Migrationen.
- **Bestätigt:** LSP besitzt Timeouts, Server-Pooling, Idle-Shutdown und
  Dokumentgrenzen.
- **Bestätigt:** der Installer arbeitet per Allowlist, standardmäßig als Dry-Run
  und verweigert Symlinks; siehe
  [`install-user.mjs`](../scripts/install-user.mjs#L13).
- **Bestätigt:** unbekannte Tools und mehrere gefährliche Befehlsgruppen werden
  explizit behandelt.
- **Bestätigt:** responsive TUI-Layouts, Tastaturnavigation, Fallback-UI und
  Session-Cleanup sind implementiert.
- **Bestätigt:** direkte Dependencies sind exakt gepinnt und die normale CI
  besitzt nur Leserechte.

## Schwächen

- **Bestätigt, hoch:** Shell-Parameterexpansionen wie `$HOME` und `$PWD`
  werden von der Permission-Policy nicht aufgelöst oder blockiert.
- **Bestätigt, hoch:** Die README verlangt Root-`npm`-Kommandos, aber
  `package.json` ist im geprüften Commit nicht versioniert und lokal über
  `.git/info/exclude` ausgeblendet.
- **Bestätigt, hoch:** `plan-mode/index.ts` enthält eine etwa 3.564 Zeilen
  lange Extension-Funktion.
- **Bestätigt:** `tests/run.mjs` ist ein 9.834-Zeilen-Monolith ohne
  Coverage-Messung.
- **Bestätigt:** aktive Diff-Viewer-Integration ist im kombinierten
  Extension-Test nicht enthalten.
- **Bestätigt:** zwei transitive Dependencies sind laut aktuellem `npm audit`
  verwundbar.
- **Bestätigt:** Statusdokumentation enthält veraltete Test-, Versions- und
  Arbeitsstandsangaben.

## Repository Discovery

| Aspekt | Ergebnis |
|---|---|
| Projektart | Pi-Coding-Agent-Konfiguration und TypeScript-Extension-Suite |
| Tech Stack | Node.js 22.22.2, TypeScript 7.0.2, Pi Extension API, Pi TUI, TypeBox, jiti |
| Framework | Ereignisbasierte Pi-Extensions; kein Web- oder Server-Framework gefunden |
| Buildsystem | TypeScript-Check ohne Artefakterzeugung; TS wird zur Laufzeit geladen |
| Dependency Management | npm, Lockfile, exakt gepinnte direkte Dependencies |
| Testsystem | Eigenes Node-Testharness in `tests/run.mjs`; Fake-LSP plus optionaler Real-Smoke |
| CI/CD | GitHub Actions: Verify bei Push/PR, separater wöchentlicher/manueller LSP-Smoke |
| Einstiegspunkt | Aktive Extensions aus [`settings.json`](../settings.json#L46) |
| Installation | Allowlist-basierter User-Installer |
| Dokumentation | README plus 21 versionierte Dateien unter `docs/` |
| Umfang | 173 versionierte Dateien, rund 47.561 Zeilen; rund 17.973 TS-Zeilen in Extensions |

Wichtige Bereiche:

```text
extensions/   Produktcode und Extension-Einstiegspunkte
tests/        Zentrales Harness, LSP-Smoke, Fixtures
npm/          Versioniertes Manifest und Lockfile
docs/         Architektur, Betrieb, Status, historische Pläne
benchmarks/   Aufgaben, Harness, Schema und Pilotresultat
scripts/      Installer
schemas/      Konfigurationsverträge
themes/       Aurora-Night-Designsystem
.github/      Verify- und LSP-Smoke-Workflows
```

Aktive Extensions:

1. Setup Core
2. Plan Mode
3. Mode Permissions
4. Ask User
5. LSP
6. Tool Output Guard
7. Aurora UI
8. Diff Viewer

### Die 30 wichtigsten Dateien

| # | Datei | Bedeutung |
|---:|---|---|
| 1 | [`settings.json`](../settings.json) | Laufzeitaktivierung, Default-Modell und Extension-Reihenfolge |
| 2 | [`setup.json`](../setup.json) | Zentrale validierte Produktkonfiguration |
| 3 | [`npm/package.json`](../npm/package.json) | Kanonische Build-, Test- und Dependency-Definition |
| 4 | [`npm/package-lock.json`](../npm/package-lock.json) | Exakter transitiver Dependency-Graph |
| 5 | [`tsconfig.json`](../tsconfig.json) | Strikter Compilervertrag |
| 6 | [`README.md`](../README.md) | Architektur-, Installations- und Betriebsvertrag |
| 7 | [`scripts/install-user.mjs`](../scripts/install-user.mjs) | Deployment-Grenze und Allowlist |
| 8 | [`extensions/setup-core/index.ts`](../extensions/setup-core/index.ts) | Setup-Lifecycle, Tools und Doctor |
| 9 | [`extensions/setup-core/config.ts`](../extensions/setup-core/config.ts) | Config-Merge, Validierung und Trust |
| 10 | [`extensions/plan-mode/index.ts`](../extensions/plan-mode/index.ts) | Zentrale Workflow-Orchestrierung |
| 11 | [`extensions/plan-mode/state.ts`](../extensions/plan-mode/state.ts) | Sidecar, Revisionen, Locks und CAS |
| 12 | [`extensions/plan-mode/utils.ts`](../extensions/plan-mode/utils.ts) | Plan-Parsing, Persistenz und Archivierung |
| 13 | [`extensions/mode-permissions.ts`](../extensions/mode-permissions.ts) | Integration der Berechtigungsmodi |
| 14 | [`extensions/shared/permission-policy.ts`](../extensions/shared/permission-policy.ts) | Zentrale Sicherheitsentscheidung für Tools und Shell |
| 15 | [`extensions/shared/context-ledger.ts`](../extensions/shared/context-ledger.ts) | Dauerhafter Kontext und Konsolidierung |
| 16 | [`extensions/setup-core/verification-gate.ts`](../extensions/setup-core/verification-gate.ts) | Abschluss- und Verifikationsbewertung |
| 17 | [`extensions/setup-core/verify-profiles.ts`](../extensions/setup-core/verify-profiles.ts) | Projektlokale Prüfprofile |
| 18 | [`extensions/setup-core/task-contract.ts`](../extensions/setup-core/task-contract.ts) | Scope- und Acceptance-Vertrag |
| 19 | [`extensions/setup-core/recovery-check.ts`](../extensions/setup-core/recovery-check.ts) | Wiederaufnahme unterbrochener Arbeit |
| 20 | [`extensions/lsp/index.ts`](../extensions/lsp/index.ts) | LSP-Einstieg, Trust und Steuerung |
| 21 | [`extensions/lsp/config.ts`](../extensions/lsp/config.ts) | LSP-Konfigurationsauflösung |
| 22 | [`extensions/lsp/client.ts`](../extensions/lsp/client.ts) | LSP-Protokoll-Lifecycle |
| 23 | [`extensions/lsp/transport.ts`](../extensions/lsp/transport.ts) | JSON-RPC-Framing und Timeouts |
| 24 | [`extensions/lsp/registry.ts`](../extensions/lsp/registry.ts) | Server-Pooling und Idle-Shutdown |
| 25 | [`extensions/lsp/documents.ts`](../extensions/lsp/documents.ts) | Dateigrenzen, Sync und Diagnosen |
| 26 | [`extensions/lsp/tools.ts`](../extensions/lsp/tools.ts) | Öffentliche LSP-Tools und Cache |
| 27 | [`extensions/aurora-ui/index.ts`](../extensions/aurora-ui/index.ts) | TUI-Eigentümer, Layout und Lifecycle |
| 28 | [`extensions/aurora-ui/state.ts`](../extensions/aurora-ui/state.ts) | UI-Event- und Zustandsvertrag |
| 29 | [`extensions/diff-viewer/index.ts`](../extensions/diff-viewer/index.ts) | Aktiver Edit-/Write-Beobachter |
| 30 | [`tests/run.mjs`](../tests/run.mjs) | Primärer Regressionstest mit 963 Assertions |

## Architektur

### Gesamtarchitektur

**Bestätigt:** Das System ist ein modularer, ereignisbasierter
In-Process-Plugin-Monolith. Die Extensions kommunizieren über Pi-Hooks,
gemeinsame Statusmodule und einen internen Event-Bus.

**Bestätigt:** Die Modulgrenzen sind überwiegend sinnvoll:

- `setup-core`: Konfiguration, Verifikation, Recovery und Diagnose
- `plan-mode`: Workflow und persistenter Plan-State
- `mode-permissions`: Policy-Anbindung
- `lsp`: Protokoll, Serververwaltung und Tools
- `aurora-ui`: TUI und responsives Rendering
- `diff-viewer`: Änderungserfassung und Darstellung
- `shared`: querschneidende Verträge und UI-Bausteine

**Bestätigt:** Es existieren keine Importzyklen. Höchste ausgehende Kopplung
haben `mode-permissions`, `lsp/index`, `plan-mode/index` und
`setup-core/index`.

**Bestätigt:** Die Shared-Schicht ist nicht vollständig domänenneutral:
`shared/context-ledger.ts` kennt Plan-Mode-Strukturen. Das erzeugt derzeit
keinen Zyklus, erschwert aber eine spätere unabhängige Extraktion.

| Kriterium | Bewertung |
|---|---:|
| Architektur | 7/10 |
| Modularität | 7/10 |
| Lesbarkeit | 6/10 |
| Wartbarkeit | 6/10 |
| Erweiterbarkeit | 7/10 |

## Codequalität

| Priorität | Status | Befund und Beleg |
|---|---|---|
| Hoch | Bestätigt | **God Function:** Der Default-Export in [`plan-mode/index.ts`](../extensions/plan-mode/index.ts#L266) reicht bis zum Dateiende bei Zeile 3829 und enthält zahlreiche verschachtelte Handler und Zustände. |
| Hoch | Bestätigt | **Testmonolith:** [`tests/run.mjs`](../tests/run.mjs#L84) besitzt 9.834 Zeilen und ein eigenes globales Assertion-System. Fehlerisolation und parallele Ausführung sind dadurch erschwert. |
| Hoch | Bestätigt | **Diff-Viewer-Testlücke:** Der aktive Einstiegspunkt wird nicht geladen; das Harness importiert nur Algorithmus, Git-Fallback und Tracker in [`run.mjs`](../tests/run.mjs#L142). Auch der kombinierte Produktstack bei Zeile 7585 lässt Diff Viewer aus. |
| Mittel | Bestätigt | **Dormanter Testzweig:** Der aktuelle Aurora-Pfad beendet den Abschnitt bei [`run.mjs:756`](../tests/run.mjs#L756); nachfolgende Legacy-Catppuccin-/Zentui-Prüfungen werden im aktuellen Produktzustand nicht ausgeführt. |
| Mittel | Bestätigt | **Doppelte Diff-Logik:** Inline-Highlights werden separat in [`diff-algorithm.ts`](../extensions/diff-viewer/diff-algorithm.ts#L118) und [`git-diff.ts`](../extensions/diff-viewer/git-diff.ts#L100) berechnet. |
| Mittel | Bestätigt | **Unvollständige LSP-Validierung:** Nur `args` wird streng validiert. `command`, `enabled`, `rootMarkers` und weitere Felder werden ungeprüft übernommen; siehe [`lsp/config.ts`](../extensions/lsp/config.ts#L64) und den Cast in [`lsp/index.ts`](../extensions/lsp/index.ts#L144). |
| Mittel | Bestätigt | **Boolean-Coercion:** `"false"` wird bei `required` und `trustRequired` zu `true`, weil [`verify-profiles.ts`](../extensions/setup-core/verify-profiles.ts#L228) `Boolean(...)` statt einer Typprüfung verwendet. |
| Mittel | Bestätigt | **Setup-Doctor-Widerspruch:** Tests erlauben, dass Default- und Primary-Modell verschieden sind ([`run.mjs`](../tests/run.mjs#L599)); der Doctor meldet diese Abweichung als Fehler ([`setup-core/index.ts`](../extensions/setup-core/index.ts#L209)). |
| Niedrig | Wahrscheinlich | `isGitAvailable`, `gitDiffForFile` und `gitDiffAll` werden außerhalb ihrer Deklarationen in [`git-diff.ts`](../extensions/diff-viewer/git-diff.ts#L17) nicht referenziert. Sie sind wahrscheinlich tote Exporte, sofern sie keine bewusst öffentliche API bilden. |
| Niedrig | Bestätigt | Keine echten `TODO:`, `FIXME:`, `HACK:` oder `XXX:`-Marker im aktiven Produktcode gefunden. Die vorhandenen „Todo“-Treffer gehören fachlich zum Planworkflow. |

Positive Codequalität:

- defensive Fehlerbehandlung ist in LSP, Plan-State und Installer verbreitet;
- Ressourcen werden explizit beendet;
- Pfad- und Symlinkprüfungen sind an mehreren Grenzen vorhanden;
- direkte Dependencies sind exakt gepinnt;
- TypeScript ist strikt und fehlerfrei.

## Sicherheit

### Wesentlicher Befund: Permission-Policy-Bypass

**Bestätigt, hoch:** Der Shell-Parser blockiert Command Substitution, Redirects
und Verkettungen, aber keine normale Parameterexpansion; siehe
[`permission-policy.ts`](../extensions/shared/permission-policy.ts#L301). Die
Pfadprüfung behandelt `$HOME/...` und `$PWD/...` anschließend wie gewöhnliche
relative Tokens ([Zeile 411](../extensions/shared/permission-policy.ts#L411)).

Eine reine Policy-Auswertung – die Befehle wurden nicht ausgeführt – ergab:

| Modus/Befehl | Entscheidung |
|---|---|
| `read-bash: cat $HOME/.config/pi/settings.json` | `allow` |
| `read-bash: cat $PWD/../../etc/passwd` | `allow` |
| `read-bash: echo $AWS_ACCESS_KEY_ID` | `allow` |
| `full-access: touch $HOME/pi-policy-audit` | `allow` |
| `full-access: cp README.md $HOME/pi-policy-audit` | `allow` |

Damit können die zugesagten Projektgrenzen für Reads und Bestätigungspflichten
für externe Writes umgangen werden. Ob ein Modell oder Nutzer diese Lücke
praktisch ausnutzt, ist **nicht nachweisbar**; die fehlerhafte
Policy-Entscheidung selbst ist bestätigt.

### Weitere Sicherheitsbefunde

| Bereich | Status | Ergebnis |
|---|---|---|
| Secrets im aktuellen Tree | Bestätigt | Zielgerichteter Scan fand keine realen Private Keys, AWS-IDs, GitHub-/Slack-/OpenAI-Tokens. Ein Treffer war ein synthetischer Testwert. |
| Vollständiger History-/Entropy-Scan | Nicht nachweisbar | Kein dedizierter Secret Scanner installiert; ignorierte `auth.json` wurde bewusst nicht gelesen. |
| Authentication | Nicht nachweisbar | Authentifizierung gehört zur externen Pi-Laufzeit; keine eigene Auth-Implementierung im Repository. |
| Input Validation | Bestätigt | LSP-Profilvalidierung, Verify-Boolean-Werte und Ledger-Metadaten sind unvollständig validiert. |
| Verify-CWD | Bestätigt | [`resolveProfileCwd`](../extensions/setup-core/verify-profiles.ts#L112) begrenzt lexikalisch, aber nicht mittels `realpath`; Symlink-Escapes werden nicht erkannt. Das Profil ist bereits trust-gebunden. |
| Context Ledger | Bestätigt | Kommentar verspricht das Entfernen absoluter Systempfade, die Regex-Liste prüft diese jedoch nicht; siehe [`context-ledger.ts`](../extensions/shared/context-ledger.ts#L106). |
| Ledger-Schema | Bestätigt | Schema verlangt `lastTrigger` und Hashformate ([Schema](../schemas/context-ledger.schema.json#L8)); Parser prüft nur Version und `lastCheckpoint` ([Parser](../extensions/shared/context-ledger.ts#L206)). |
| XSS/CSRF/SQL Injection | Nicht anwendbar | Im Repository wurde keine Web-, HTTP-, HTML- oder Datenbankausführungsschicht gefunden. Externe Pi-Komponenten wurden nicht auditiert. |
| CI-Berechtigungen | Bestätigt positiv | Workflows besitzen nur `contents: read`; siehe [`verify.yml`](../.github/workflows/verify.yml#L8). |
| Supply Chain | Bestätigt | Actions werden als mutable Major-Tags `@v4`, nicht per Commit-SHA referenziert. |
| Security Gate | Bestätigt | Normale CI enthält weder `npm audit`, SAST, Secret Scan noch Dependency-Review. |

### Dependency-Risiken

`npm audit` und `npm audit --omit=dev` melden zwei transitive Risiken:

- **Hoch:** `brace-expansion@5.0.6` im Pi-Abhängigkeitsbaum, sichtbar in
  [`package-lock.json`](../npm/package-lock.json#L1560). Betroffen von
  exponentieller Laufzeit beziehungsweise unbeschränkter Expansion/OOM:
  [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp),
  [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg).
- **Mittel:** verschachteltes `protobufjs@7.6.4` in
  [`package-lock.json`](../npm/package-lock.json#L2131), betroffen von einer
  Endlosschleife beim Parsen präparierter `.proto`-Optionen:
  [GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww).

Eine sichere konkrete Pi-Zielversion ist ohne Upgrade- und
Kompatibilitätstest **nicht nachweisbar**.

## UX

| Kriterium | Bewertung | Evidenz |
|---|---:|---|
| Navigation | 8/10 | Pfeile, Enter, Escape, Backspace, Home/End, Paging, deaktivierte Einträge und Breadcrumbs in [`menu-ui.ts`](../extensions/shared/menu-ui.ts#L141) |
| Konsistenz | 7/10 | Gemeinsame Menükomponente und Aurora-State; einzelne englische Diagnosemeldungen und Doctor-Widerspruch |
| Layout | 8/10 | Compact/Standard/Comfortable sowie Viewport- und Scrolllogik in [`menu-ui.ts`](../extensions/shared/menu-ui.ts#L58) |
| Responsiveness | 8/10 | Aurora verwendet Narrow/Normal/Wide bei 72/120 Spalten; siehe [`aurora-ui/index.ts`](../extensions/aurora-ui/index.ts#L43) |
| Designsystem | 7/10 | Zentrales Aurora-Night-Theme, semantische Farbnamen und gemeinsame UI-Bausteine |
| Nutzerfluss | 7/10 | Explizite Workflowphasen und Capability-Grenzen; Setup-Doctor kann aktuell einen erlaubten Zustand als Fehler melden |
| Verständlichkeit | 7/10 | Status ist meist mit Text und nicht nur Farbe kodiert; umfangreiche Hinweise und Fallbacks |
| Accessibility | 5/10 | Tastaturbedienung gut; Screenreader- und reale Terminalprüfung nicht vorhanden |

Statische Kontrastberechnung aus
[`aurora-night.json`](../themes/aurora-night.json):

- `text` auf `navy`: 15,25:1
- `muted` auf `navy`: 6,27:1
- `dim` auf `navy`: 3,42:1
- `dim` auf `surface`: 3,10:1

`dim` wird unter anderem für Footer und Scrollhinweise verwendet
([`menu-ui.ts`](../extensions/shared/menu-ui.ts#L202)). Damit liegt es bei
normalgroßer Schrift unter dem WCAG-2.2-AA-Richtwert von 4,5:1. Die
tatsächliche Darstellung hängt zusätzlich vom Terminal ab und wurde nicht
visuell geprüft.
[W3C WCAG 2.2 – Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## Performance

### Bestätigte positive Maßnahmen

- Myers- und Inline-Diff besitzen Komplexitätsschwellen.
- LSP nutzt Timeouts, Idle-Shutdown und Server-Pooling.
- Aurora startet Animation nur im kontextuellen Modus und räumt Timer bei
  Sessionende auf ([`aurora-ui/index.ts`](../extensions/aurora-ui/index.ts#L143)).
- Toolausgaben und mehrere interne Buffer sind begrenzt.

### Bestätigte Risiken

1. [`diff-viewer/index.ts`](../extensions/diff-viewer/index.ts#L19) liest die
   komplette Zieldatei mit `cat`.
2. Wird die Diff-Schwelle überschritten, erzeugt
   [`diff-algorithm.ts`](../extensions/diff-viewer/diff-algorithm.ts#L12)
   weiterhin eine Delete- und Insert-Operation für jede Zeile. Die Schwelle
   begrenzt den Algorithmus, nicht Eingabe, Ausgabe oder Speicher.
3. Der Workspace-Symbol-Cache in
   [`lsp/tools.ts`](../extensions/lsp/tools.ts#L627) besitzt TTLs, entfernt
   abgelaufene Einträge aber nie. Viele unterschiedliche Queries wachsen für
   die Lebensdauer der Extension weiter.

**Nicht nachweisbar:** reale Antwortzeiten, Peak Memory, Langzeitverhalten und
Durchsatz. Es existiert keine abgeschlossene 30-Läufe-Baseline und kein
Profilingbericht.

## Wartbarkeit

### Technische Schulden

#### Kritisch

- Keine eindeutig kritische Schuld bestätigt.

#### Hoch

- Shell-Variablen-Bypass der Permission-Policy.
- Root-`package.json` fehlt im Commit trotz dokumentierter Root-Kommandos.
- Verwundbare transitive Dependencies.
- 3.564-Zeilen-Plan-Orchestrator.
- Aktive Diff-Viewer-Integration ohne vollständigen Stacktest und ohne harte
  Input-/Output-Grenze.

#### Mittel

- 9.834-Zeilen-Testmonolith und aktuell unerreichbarer Legacy-Testzweig.
- Unvollständige LSP-Konfigurationsvalidierung.
- Falsche Boolean-Coercion in Verify-Profilen.
- Setup-Doctor-Modellregel widerspricht Tests und Konfiguration.
- Unbeschränkter Workspace-Symbol-Cache.
- Ledger-Sanitization und Meta-Parser weichen von Kommentar beziehungsweise
  Schema ab.
- Veraltete Projektstatusdokumentation.
- Kein Security-/Coverage-Gate in CI.
- GitHub Actions nicht per SHA gepinnt.

#### Niedrig

- Wahrscheinlich ungenutzte Git-Diff-Exports.
- Doppelte Inline-Diff-Implementierung.
- Gemischte deutsche und englische Diagnosemeldungen.
- Niedriger Kontrast für sekundäre `dim`-Texte.
- Historische und aktive Planungsdokumente erhöhen Navigations- und Driftkosten.

### Projektbewertung

| Kriterium | Bewertung | Begründung |
|---|---:|---|
| Produktionsreife | 6/10 | Tests grün und defensive Zustandslogik; Policy-, Packaging- und Dependency-Risiken verhindern höhere Wertung |
| Entwicklerfreundlichkeit | 6/10 | Gute README und ein `verify`-Befehl; Root-Befehl im Fresh Checkout nicht auslieferbar |
| Skalierbarkeit | 6/10 | Für Single-User-TUI angemessen; Diff-, Cache- und Orchestratorgrenzen fehlen |
| Architekturqualität | 7/10 | Klare Module und keine Zyklen; zentrale Workflowdatei zu dominant |
| Wartbarkeit | 6/10 | Strikte Typisierung und Tests, aber große Dateien und inkonsistente Verträge |
| Dokumentation | 6/10 | Umfangreich, jedoch teilweise veraltet und redundant |

Ein konkretes Dokumentationsbeispiel:
[`PROJECT_STATE.md`](PROJECT_STATE.md#L44) nennt noch 599 Tests und
Umgebungsfehler, während aktuell 963/0 erreicht werden. Dasselbe Dokument
bestätigt die unversionierte Root-`package.json`.

## Risiken

| Risiko | Eintritt | Auswirkung | Einstufung |
|---|---|---|---|
| Externe Reads/Writes über Shell-Variablen ohne vorgesehene Bestätigung | Mittel | Hoch | Hoch |
| Fresh-Checkout kann dokumentierten Root-Workflow nicht ausführen | Hoch | Hoch | Hoch |
| DoS/OOM über verwundbare transitive Parser/Expansion | Niedrig–Mittel | Hoch | Hoch |
| Regression im aktiven Diff-Viewer bleibt vom Stacktest unentdeckt | Mittel | Mittel–Hoch | Hoch |
| Workflowänderungen verursachen Seiteneffekte in 3.564-Zeilen-Closure | Mittel | Hoch | Hoch |
| Speicherwachstum durch Symbolqueries | Niedrig–Mittel | Mittel | Mittel |
| Falsche Projektprofile durch schwache Typvalidierung | Mittel | Mittel | Mittel |
| Falsche Betriebsentscheidungen durch veraltete Statusdokumente | Mittel | Mittel | Mittel |
| Reale LSP-Kompatibilität driftet unbemerkt | Mittel | Mittel | Mittel |
| Accessibility-Probleme in tatsächlichen Terminals | Nicht nachweisbar | Mittel | Mittel |

## Top 20 Maßnahmen

Nach erwartetem ROI sortiert. Aufwand und Mehrwert sind auditorische
Schätzungen, keine gemessenen Fakten.

| # | Priorität | Maßnahme | Nutzen | Aufwand | Änderungsrisiko | Erwarteter Mehrwert |
|---:|---|---|---|:---:|---|---|
| 1 | P0 | Parameter-/Variablenexpansion in Shell-Policy blockieren oder kontrolliert auflösen | Schließt bestätigten Sicherheits-Bypass | M | Mittel | Sehr hoch |
| 2 | P0 | Regressionstests für `$HOME`, `$PWD`, `${…}` und Env-Ausgabe ergänzen | Verhindert Wiederkehr des Bypass | S | Niedrig | Sehr hoch |
| 3 | P0 | Eine versionierte Root-Paketstrategie festlegen: Manifest tracken oder alle Doku-/Installerbefehle auf `npm --prefix npm` umstellen | Repariert Fresh-Checkout und Übergabe | S | Niedrig | Sehr hoch |
| 4 | P0 | Pi-/Lockfile-Upgrade durchführen und beide Advisories verifizieren | Entfernt bekannte Dependency-Risiken | M | Mittel | Sehr hoch |
| 5 | P1 | Diff-Viewer-Einstiegspunkt in den kombinierten Produktstacktest aufnehmen | Deckt aktive Runtime-Integration ab | M | Niedrig | Hoch |
| 6 | P1 | Maximale Dateigröße, Hunkzahl und Preview-Ausgabe im Diff Viewer definieren | Verhindert Speicher-/UI-Überlastung | M | Mittel | Hoch |
| 7 | P1 | Setup-Doctor-Vertrag für Default- vs. Primary-Modell vereinheitlichen | Beseitigt bestätigten Fehlalarm | S | Niedrig | Hoch |
| 8 | P1 | Verify-Profil-Booleans strikt validieren und Symlink-CWD prüfen | Stärkt Konfigurationsgrenzen | S–M | Niedrig | Hoch |
| 9 | P1 | Vollständige Runtime-Validierung für `.pi/lsp.json` einführen | Verhindert fehlerhafte Serverstarts | M | Mittel | Hoch |
| 10 | P1 | `PROJECT_STATE.md` und Ledger-Verantwortlichkeiten aktualisieren | Verhindert falsche Übergabeinformationen | S | Niedrig | Hoch |
| 11 | P1 | `npm audit`/Dependency-Review als CI-Gate ergänzen | Frühzeitige Supply-Chain-Erkennung | S | Niedrig | Hoch |
| 12 | P2 | GitHub Actions auf Commit-SHAs pinnen | Reduziert Workflow-Supply-Chain-Risiko | S | Niedrig | Mittel–hoch |
| 13 | P2 | Workspace-Symbol-Cache mit LRU/Max-Entries und aktivem Cleanup begrenzen | Verhindert Langzeitwachstum | S | Niedrig | Mittel–hoch |
| 14 | P2 | `tests/run.mjs` nach Domänen aufteilen | Schnellere Diagnose und bessere Ownership | L | Mittel | Mittel–hoch |
| 15 | P2 | `plan-mode/index.ts` in Workflow-Controller, UI, Commands und Settlement zerlegen | Senkt Änderungs- und Regressionrisiko | XL | Hoch | Hoch langfristig |
| 16 | P2 | Legacy-Testzweig separieren oder entfernen | Beseitigt unerreichbare Tests und Missverständnisse | M | Niedrig | Mittel |
| 17 | P2 | Inline-Diff-Logik zentralisieren und ungenutzte Git-Exports klären | Reduziert Duplikation | S | Niedrig | Mittel |
| 18 | P2 | `dim`-Palette für informativen Text kontrastreicher gestalten | Verbessert Accessibility | S | Niedrig | Mittel |
| 19 | P2 | Coverage-Erfassung und Mindestwerte pro aktivem Extension-Einstieg ergänzen | Macht Testlücken messbar | M | Mittel | Mittel |
| 20 | P3 | 30-Läufe-Benchmark sowie CPU-/Memory-Profiling abschließen | Liefert belastbare Performancebasis | XL | Niedrig | Mittel langfristig |

## Quick Wins (<30 Minuten)

- `PROJECT_STATE.md` auf 963/0 und aktuelle Versionen korrigieren.
- Root-Paketstrategie dokumentarisch eindeutig machen.
- Setup-Doctor-Regel für unterschiedliche Default-/Primary-Modelle
  korrigieren.
- Verify-Boolean-Werte strikt auf `boolean` prüfen.
- Maximalgröße für den Workspace-Symbol-Cache festlegen.
- Sekundäre `dim`-Farbe kontrastreicher wählen.
- Wahrscheinlich ungenutzte Git-Diff-Exports als öffentlich oder intern
  kennzeichnen.

## Maßnahmen (<1 Tag)

- Permission-Policy gegen alle Formen von Shell-Parameterexpansion härten und
  Regressionstests ergänzen.
- Diff Viewer in den aktiven Extension-Stacktest aufnehmen.
- Diff-Preview nach Bytes, Zeilen und Hunks begrenzen.
- LSP-Config vollständig zur Laufzeit validieren.
- Ledger-Meta-Parser an das vorhandene JSON-Schema angleichen.
- `npm audit` und Dependency-Review in CI aufnehmen.
- Actions auf geprüfte Commit-SHAs pinnen.
- Reale LSP-Smokes in einer vorbereiteten CI-Umgebung ausführen.

## Maßnahmen (<1 Woche)

- Dependency-/Pi-Upgrade inklusive vollständigem Verify und LSP-Smoke.
- Testharness nach Produktdomänen aufteilen.
- Legacy-/Rollback-Tests in eine explizite separate Suite überführen.
- Diff-Logik konsolidieren.
- Coverage-Berichte für alle acht aktiven Entry Points etablieren.
- Accessibility-Prüfung in mehreren Terminals und bei schmalen Viewports
  durchführen.
- Context-Ledger-Sanitization und dokumentierten Sicherheitsvertrag
  harmonisieren.

## Langfristige Refactorings

- Plan-Mode in einen testbaren Workflow-State-Machine-Kern und dünne
  Pi-Adapter zerlegen.
- Gemeinsame Schicht domänenneutral machen; Plan-spezifische Ledger-Adapter
  aus `shared` herausziehen.
- Konfigurationen einheitlich schema-first validieren.
- Testarchitektur mit isolierten Suites, Fixtures, Coverage und echten
  Entry-Point-Smokes etablieren.
- Benchmark-Baseline, Memory-Profiling und langfristige Session-Tests
  automatisieren.

## Abschlussbewertung

Das Repository ist technisch ernsthaft entwickelt und deutlich mehr als ein
Prototyp. Besonders Zustandskonsistenz, Lifecycle-Cleanup,
TypeScript-Striktheit, Trust-Gates und die Breite des Testharness wirken
professionell. Es fehlt jedoch noch die letzte Schicht aus auslieferbarem
Fresh-Checkout, belastbarer Sicherheitsgrenze, Dependency-Hygiene und
modularer Wartbarkeit.

Ausgeführte Prüfungen:

- `npm run verify`: **963 bestanden, 0 fehlgeschlagen**
- TypeScript `strict`/`noEmit`: erfolgreich
- `git diff --check`: erfolgreich
- Shell- und MJS-Syntaxchecks: erfolgreich
- LSP-Smoke: `ok=0, skip=2, fail=0`; echte Server nicht installiert
- `npm audit`: zwei bestätigte Advisories

### Übergabe an ein professionelles Entwicklerteam

#### Was wäre der erste Eindruck?

Ein ambitioniertes, gut durchdachtes und ungewöhnlich defensiv programmiertes
Agenten-Setup. Nach kurzer Zeit würden jedoch Fragen zum fehlenden
Root-Manifest, zur sehr großen Plan-Mode-Datei und zur Verlässlichkeit der
Permission-Policy entstehen.

#### Was wirkt professionell?

- strikte Typisierung und grünes 963-Assertion-Harness;
- klare Extension-Grenzen ohne Importzyklen;
- CAS-, Lock-, Epoch- und Hash-Schutz im Workflow;
- explizite Trust- und Capability-Modelle;
- Allowlist-Installer und saubere Lifecycle-Behandlung;
- separate deterministische und reale LSP-Teststrategien;
- umfangreiche Betriebs- und Architekturdokumentation.

#### Was wirkt unfertig?

- dokumentierte Root-Kommandos hängen von einer ignorierten lokalen Datei ab;
- echte LSP-Smokes sind lokal nicht ausführbar und in CI nicht
  merge-blockierend;
- aktive Diff-Viewer-Integration ist nicht vollständig getestet;
- Benchmark-Baseline ist vorbereitet, aber nicht durchgeführt;
- Projektstatus und Versionsangaben sind veraltet;
- Security- und Coverage-Gates fehlen;
- zentrale Plan- und Testdateien sind noch nicht teamgerecht modularisiert.

#### Welche drei Entscheidungen sollten sofort geändert werden?

1. Shell-Parameterexpansion darf niemals ungeprüft eine Permission-Grenze
   passieren.
2. Es muss genau eine versionierte, reproduzierbare Paket-/Command-Quelle
   geben; der aktuelle ignorierte Root-Facade-Vertrag ist aufzugeben.
3. Sicherheits- und aktive Entry-Point-Integrationstests müssen Teil des
   normalen PR-Gates werden, einschließlich Dependency-Audit und Diff Viewer.
