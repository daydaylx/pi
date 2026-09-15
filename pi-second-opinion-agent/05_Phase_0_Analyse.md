# Phase-0-Analyse – Pi Second-Opinion Service

Stand: 2026-09-15  
Status: Phase 0 abgeschlossen; **Stop-Gate 0 offen**  
Produktivcode wurde in dieser Phase nicht verändert.

## 1. Ausgangszustand

| Punkt                 | Befund                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Repository            | `/home/d/.pi/agent` (Pi-Setup); das Auftragspaket liegt unter `pi-second-opinion-agent/`                          |
| Remote                | `origin` ist konfiguriert; die konkrete URL wird aus Datenschutzgründen hier nicht wiederholt                     |
| Branch                | `main`                                                                                                            |
| Base-/HEAD-SHA        | `56a28104dc4c063ab949e3c5c90f4321b15f1b59`                                                                        |
| Worktree              | `?? pi-second-opinion-agent/`; dies sind die vorgegebenen, noch unversionierten Auftragstexte und werden erhalten |
| Node / npm            | `v22.23.2` / `10.9.8`                                                                                             |
| Pi-Runtime            | `@earendil-works/pi-coding-agent 0.84.3`                                                                          |
| TypeScript / Prettier | `7.0.2` / `3.9.6`                                                                                                 |
| relevante Pakete      | `pi-subagents` auf `f59fc0d26bf055632363e9a4ca778ab1f09b5252`, `pi-web-access 0.24.2`                             |

### Baseline-Prüfungen

- `functions.verify({ check: "typecheck" })`: bestanden.
- `functions.verify({ check: "test" })`: bestanden; die Baseline-Suiten meldeten unter anderem 1.527 Runtime-, 143 UI-, 735 Workflow-, 182 LSP- und 22 Diff-Tests sowie die übrigen registrierten Suiten ohne Fehler.
- Ausführbare Projektkommandos: `npm run typecheck`, `npm test`, `npm run verify`; die kanonische Gesamtprüfung ist für den Implementierungsstand über `project_check({ profile: "verify" })` auszuführen.
- Noch nicht ausgeführt: keine produktbezogenen Second-Opinion-Tests, weil es in Phase 0 keinen Produktivcode gibt.

## 2. Relevante Architekturpfade

### Provider und Modellregistrierung

- **`npm/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts`** stellt `ModelRegistry.find`, `getAvailable`, `getApiKeyAndHeaders` und `complete` bereit.
  - Verantwortung: vorhandene Modell-/Providerauswahl und authentifizierter Provider-Aufruf.
  - Aufrufer: `ExtensionContext.modelRegistry`; aktuell z. B. OpenRouter-Doctor.
  - Seiteneffekte: `complete` verursacht den externen Modellcall; Registry-Leseoperationen selbst rufen keinen Inference-Call aus.
  - Wiederverwendung: **ja**, bevorzugter Core-Pfad.
  - Risiko: Modellroute, Authentifizierung und Retry-/Timeout-Semantik müssen für den Second-Opinion-Call explizit begrenzt werden.

- **`settings.json`** enthält `defaultProvider`, `defaultModel`, `enabledModels`, Provider-/Retry-Konfiguration und aktive Extensions. Der Hauptagent nutzt derzeit `openai-codex/gpt-5.6-luna`; als bereits konfigurierter anderer Modelltyp ist unter anderem `anthropic/claude-sonnet-5` vorhanden.
  - Verantwortung: zentrale Benutzerkonfiguration und Runtime-Aktivierung.
  - Wiederverwendung: **teilweise**; Second Opinion darf keine parallele Providerregistrierung oder zweite Modellkonfiguration einführen.
  - Risiko: `settings.json` ist eine nutzernahe Konfigurationsdatei; Änderungen müssen minimal sein und bestehende Einstellungen erhalten.

- **`Model<TApi>` in `pi-ai`** enthält Provider, vollständige Modell-ID, API, Limits und Kosten, aber kein explizites Modellfamilienfeld. Die Spezifikation verbietet eine unsichere Familienheuristik.
  - Konsequenz: Phase 1 braucht eine explizite, zentral validierte Familienzuordnung für Haupt- und Opinion-Modell oder eine gleichwertige Registry-Konfiguration.

### Tool-loser Modellaufruf

- `ModelRegistry.complete(model, context, options)` akzeptiert einen `Context` mit `systemPrompt`, `messages` und optional `tools`.
- Ein `Context` ohne `tools` ist der geeignete primitive Pfad für Variante A; der Call läuft nicht über einen Agentenloop und erhält keine registrierten Pi-Tools.
- Die Runtime besitzt zusätzlich `ModelRuntime.completeSimple` und `streamSimple`, aber diese sind nicht direkt Bestandteil des öffentlichen `ExtensionContext`. Ein direkter interner Zugriff wäre daher unnötig fragil.
- **`extensions/openrouter-doctor/`** enthält mit `http.ts` und den Diagnosechecks einen eigenen direkten HTTP-Pfad, aber mit Prüf-/Retry-/Circuit-Breaker-Semantik und OpenRouter-spezifischer Ausgabe. Er ist kein geeigneter Second-Opinion-Service.

### Subagenten und Rechte

- **`agents/{investigator,debugger,verifier}.md`**, `extensions/subagent/config.json` und das gepinnte `pi-subagents`-Paket bilden die bestehende Subagenten-Infrastruktur.
  - Verantwortung: Rollen, Delegation, Laufstatus und Verifier-Verträge.
  - Seiteneffekte: je nach Rolle Toolausführung, Laufstatus und ggf. externe Modellcalls.
  - Wiederverwendung für Second Opinion: **nein**.
  - Risiko: implizite Tools, Agentenloop, Session-/Kontextübernahme und Vermischung mit Verifier-/Gate-Semantik. Das ist eine ausdrückliche No-Go-Grenze der Spezifikation.

### Approval und Nutzerinteraktion

- **`extensions/ask-user.ts`** registriert `ask_user`, validiert das 2–4-Optionen-Schema und rendert über `ctx.ui.custom` eine TUI-Entscheidungskarte.
  - Verantwortung: bestehende Nutzerentscheidung; Antwort wird als Toolresultat zurückgegeben.
  - Aufrufer: Hauptagent über das registrierte Tool.
  - Seiteneffekte: blockierende TUI-Auswahl; keine eigene Provideroperation.
  - Wiederverwendung: **für Phase 2 teilweise**; der Core darf keinen zweiten Dialog bauen.
  - Risiko: `ctx.mode !== "tui"` beendet den Aufruf aktuell mit einer klaren Nichtverfügbarkeit. GUI/RPC besitzen damit heute keinen vollständigen Approval-Pfad.

- `ExtensionUIContext.custom` ist ein vorhandener interaktiver TUI-Mechanismus. Für Phase 1 kann ein agenteninitiiertes Tool einen separaten Approval-Presenter darauf aufbauen; der eigentliche Call muss zusätzlich am Service technisch ein gültiges, snapshotgebundenes Approval-Artefakt verlangen.

### TUI, GUI und Protokoll

- **`extensions/aurora-ui/`** ist Besitzer der Terminaldarstellung und beobachtet Kernzustände; es soll keine Providercalls selbst starten.
- **`extensions/frontend-protocol/`** (`state-contract.ts`, `commands.ts`, `events.ts`) und **`extensions/frontend-bridge/`** bilden den Core-/GUI-Vertrag.
- **`docs/scope-cli-tui-vs-gui.md`** trennt TUI und Electron-GUI ausdrücklich. Die GUI kann den vorhandenen TUI-`ask_user`-Dialog nicht direkt nutzen.
- **Phase-1-Entscheidung:**
  - TUI: **unterstützt**.
  - GUI: **sicher deaktiviert**; keine Teilintegration ohne vollständigen Approval-/Fehler-/Resume-Vertrag.
  - sonstige Clients (`rpc`, `json`, `print`): **sicher deaktiviert**; kein stiller Call und keine halb gerenderte Approval-Aktion.
- Phase 2 darf erst nach Nutzennachweis und einem eigenen Bridge-/Protokollbeschluss begonnen werden.

### Session- und Eventzustände

- `ExtensionAPI.appendEntry` persistiert benutzerdefinierte Sessioneinträge, die nicht in den LLM-Kontext eingehen.
- `session_start`, `session_shutdown`, `session_tree` und die Agent-/Turn-Events sind vorhanden; `extensions/resilience/index.ts` zeigt das Muster für epochgebundene Zustände, Abbruch und sichere Sessionmarker.
- Für Phase 1 wird ein kleiner, request-/decisiongebundener In-Memory-Zustand mit nicht-inhaltlicher Sessionmarkierung benötigt. Ein nach Sessionende blind wiederholter Pending-Call ist verboten.
- Verifier-, Plan- und Gate-Zustände bleiben getrennt; `extensions/setup-core/`, `extensions/plan-mode/` und `extensions/permissions/` dürfen keine Opinion-Autorität erhalten.

### Kontext, Dateien und Snapshots

- **`extensions/shared/permission-policy.ts`** exportiert `resolvePathScope`, `isSensitiveReference` und `decideFileAccess`; die Implementierung behandelt Workspace-Grenzen, Symlinks und bekannte sensitive Pfadsegmente.
  - Wiederverwendung: **teilweise** für Pfad-/Referenzvorprüfung.
  - Lücke: `decideFileAccess` ist eine Tool-/Permission-Entscheidung und kein vollständiger fail-closed Payload-Safety-Guard. Für Second Opinion braucht es zusätzlich einen rein lokalen Guard ohne Bestätigungs-Bypass.

- **`shared/workspace-snapshot.mjs`** liefert einen versionierten Workspace-/Git-Snapshot.
  - Wiederverwendung: **teilweise** für Workspace-Fingerprints.
  - Lücke: es baut kein exaktes, byte-/bereichsbezogenes Context Manifest für einzelne freizugebende Dateien. Ein Manifest-Hash über die tatsächlich extrahierten Inhalte muss neu, lokal und deterministisch gebaut werden.

- **`extensions/diff-viewer/`** kann sichere workspace-relative Diff-Daten anzeigen; es ist kein allgemeiner Bereichs- oder Payload-Builder.
- **`extensions/lsp/`** liest validierte Dokumente, ist aber wegen Prozess-/LSP-Lifecycle und seiner anderen Semantik nicht als Second-Opinion-Reader vorgesehen.
- **`pi-ai` `estimateContextTokens` / `estimateTextTokens`** ist als bestehende konservative Token-Schätzung verfügbar. Der vollständige Opinion-Context einschließlich Systemprompt und Schema muss damit vor Approval gezählt werden.
- Fehlende Schutzmechanismen, die Phase 1 eigenständig liefern muss: Binärerkennung, exakte Bereichsextraktion, Inhaltsprüfung auf Token-/Authorization-/Private-Key-Muster, Manifest-/Payload-Gleichheit und stale-context-Prüfung zwischen Approval und Versand.

### Telemetrie

- **`extensions/resilience/`** persistiert bereits redigierte technische Sessionmarker (Fehlerphase, Provider, Modell-/Context-Metadaten) und zeigt die vorhandene Event-/Epoch-Konvention.
- Es gibt keine fertige Second-Opinion-Telemetrie. Phase 1 muss ausschließlich erlaubte Metadaten erfassen und Fragen, Dateipfade, Code, Secrets und Rohantworten ausschließen.
- Ein `appendEntry`-Eintrag darf daher nur opaque IDs, Status, Route, Token-/Latenzwerte und Zähler enthalten.

### Verifier und Gates

- **`extensions/setup-core/verification-status.ts`**, **`extensions/setup-core/verify-profiles.ts`**, **`extensions/permissions/verifier-policy.ts`** und **`extensions/permissions/verifier-required-paths.ts`** gehören zur technischen Verifikation.
- Diese Pfade prüfen bzw. erzwingen Verifier-/Workspace-Gates und dürfen vom Opinion-Service weder aufgerufen noch beeinflusst werden.
- Die Second Opinion ist ausdrücklich beratend und kein Verifier.

## 3. Architekturvarianten

### Variante A – primitive tool-lose Modelloperation (empfohlen)

Ein neuer, zentraler `SecondOpinionService` baut Request, Manifest, Safety-Guard, Budget, Approval-Artefakt, Providerroute und Response-Validierung. Er verwendet `ctx.modelRegistry.complete` mit einem expliziten `Context` ohne `tools`.

- Code-/Zustandskomplexität: niedrig bis mittel, zentral begrenzbar.
- Angriffsfläche: klein; keine Toolregistrierung und kein Agentenloop.
- Testbarkeit: hoch; Provider kann über einen Fake-Adapter ersetzt werden.
- Provider-Wiederverwendung: hoch; vorhandene Registry/Auth bleiben Eigentümer.
- TUI-/GUI-Kopplung: gering im Core; Adapter entscheidet Verfügbarkeit.
- Wartbarkeit: gut, wenn Snapshot, Safety und Exactly-once nicht in UI-Code dupliziert werden.

### Variante B – vorhandene Agenteninfrastruktur mit entzogenem Toolset

Nicht empfohlen und für den MVP nicht zulässig. Das bestehende System ist auf Agentenläufe, Subagentenrollen, Sessionkontext und Toolrechte ausgerichtet. Ein nachträgliches „tools leer“ würde nicht beweisen, dass Agentenloop, implizite Kontextübernahme, Plan-/Gate-Zugriffe und Retry-/Fallbackpfade vollständig verschwunden sind.

- Code-/Zustandskomplexität: hoch.
- Angriffsfläche: unnötig groß.
- Testbarkeit: schlechter, da Runtime-/Subagentenverhalten mitgetestet werden müsste.
- Gefahr ungewollter Rechte: hoch.
- TUI-/GUI-Kopplung: höher.
- Wartbarkeit: schlechter und widerspricht dem Nicht-Ziel „keine zweite Agentenplattform“.

## 4. Voraussichtliche Änderungssurface für Phase 1

Noch keine dieser Änderungen ist freigegeben oder umgesetzt. Nach `Go für Phase 1` ist voraussichtlich zu ändern:

- neue zentrale Second-Opinion-Module unter `extensions/second-opinion/` für Typen, Konfiguration, Request-/Manifest-/Safety-/Budget-Logik, Service und TUI-Adapter;
- Aktivierung der Extension beziehungsweise der minimalen zentralen Konfiguration in `settings.json`, ohne bestehende Nutzereinstellungen zu überschreiben; Standard bleibt `enabled: false`;
- neue Fake-Provider-/Service-Tests und eine registrierte Testsuite unter `tests/`;
- eventuell ein kleiner gemeinsamer Test-Harness-Adapter für den Provider, falls der vorhandene Runtime-Harness keinen direkten Fake-Call unterstützt.

Nicht Teil von Phase 1:

- `extensions/ask-user.ts`-Schemaänderung,
- GUI-/Electron-Änderungen,
- Frontend-Protocol-/Bridge-Erweiterung,
- Verifier-/Plan-/Gate-Änderungen,
- Follow-up-Requests oder automatische Kontextnachladung.

## 5. Neue Typen und Verträge für Phase 1

Die Implementierung muss mindestens diese schmalen, validierbaren Verträge einführen:

- `OpinionRequest` mit `request_id`, `decision_id`, `trigger_source`, konkreter Frage, Grund, erwartetem Nutzen, Kategorie, Constraints, optionalen neutralen Optionen und `context_refs`;
- `ContextReference`, `ContextManifestEntry` und eingefrorener `ApprovalSnapshot`;
- `OpinionResult` mit den erlaubten Statuswerten und dem strukturierten `completed`-Ergebnis;
- opaque request-/decisiongebundener Zustands-/Deduplizierungsdatensatz;
- zentral validierte Konfiguration mit `enabled: false`, `require_different_family: true`, `max_calls_per_decision: 1`, `max_input_tokens: 8000`, `max_output_tokens: 700`, `timeout_ms: 45000` und ohne Follow-up.

Die Modellfamilie muss explizit konfiguriert oder aus einer belastbaren Registry-Metadatenquelle gelesen werden; eine Namenssubstring-Heuristik ist nicht ausreichend.

## 6. Sicherheits- und Datenabflussbefunde

Positiv wiederverwendbar:

- kanonische Workspace-/Symlink-Prüfungen in der Permission-Policy,
- vorhandene Provider-/Auth-Registry,
- konservative Token-Schätzung in `pi-ai`,
- Session-/Epoch-Muster in Resilience,
- TUI-Approval-Komponente `ctx.ui.custom`.

Noch zu bauen beziehungsweise strikt zu prüfen:

- fail-closed Inhaltsprüfung für Secrets, private Schlüssel, Tokens und Authorization-Muster;
- Binär- und Lesbarkeitsprüfung;
- exakte, begrenzte Codebereiche ohne stilles Abschneiden;
- Byte-/Token-/Snapshot-Manifest des tatsächlich versendeten Payloads;
- atomare Gleichheit von genehmigtem und versendetem Snapshot;
- ein technischer Approval-Nachweis, ohne den kein Provideradapter aufgerufen wird;
- kein Retry, kein Fallback und kein zweiter Reparatur-Call;
- Telemetrie-Redaktion ohne Frage, Code, Pfad oder Rohantwort.

## 7. Zustands- und Fehlerrisiken

- `request_id`-Deduplizierung allein genügt nicht: `decision_id` muss zusätzlich maximal einen Pending-/Call-Verbrauch zulassen.
- Sessionende, Timeout und verspätete Providerantwort dürfen keinen neuen Call und keine automatische Entscheidung erzeugen.
- Änderungen an referenzierten Dateien zwischen Preview und Versand müssen `stale_context` ergeben.
- Provider-/Modellnichtverfügbarkeit muss `unavailable` ergeben; es gibt keinen stillen Wechsel auf Hauptmodell, gleiche Familie oder anderen Provider.
- Eine ungültige Modellantwort wird `invalid_response`; kein Reparatur-Call und keine autoritative Darstellung.
- Fehler öffnen die normale Benutzerentscheidung wieder und blockieren nicht den Hauptworkflow.

## 8. Teststrategie

Der MVP braucht einen Fake-Provider, der Callzahl, finalen Payload, `tools`-Feld, Timeout/Fehler und Antwort kontrolliert aufzeichnet. Die Pflichtmatrix aus `03_Test_und_Evaluationsplan.md` wird in Unit-/Integrationstests für Request, Approval, Manifest, Secret-/Pfadschutz, Budget, Provider, Response und Telemetrie abgebildet.

Minimal zusätzlich:

- Regressionstest, dass ein direkter Service-Aufruf ohne Approval keinen Fake-Provider erreicht;
- exact-once-Tests für doppelte Approval-/Eventzustellung und Sessionresume;
- stale-context-Test zwischen Preview und Versand;
- Negativtests für `.env`, Private Key, Tokenmuster, externe Pfade, Symlink, Binärdaten und Full-Session-Dump;
- Test, dass `Context.tools` nicht gesetzt beziehungsweise leer bleibt;
- Test, dass kein Retry/Fallback und kein zweiter Response-Reparaturcall erfolgt;
- Telemetrietest auf Ausschluss von Frage, Pfad, Code, Secret und Rohantwort.

Die bestehende Baseline ist grün; nach Phase 1 sind zusätzlich Typecheck, relevante Tests, Format-/Deadcode-Prüfungen und `project_check({ profile: "verify" })` auszuführen.

## 9. Komplexitätsbewertung

Erwartet wird ein kleiner, zentraler Core mit einem TUI-Adapter und Fake-Provider-Tests. Die Änderung bleibt nur dann vertretbar, wenn kein zweiter Agentenrunner, keine zweite Dialoginfrastruktur und keine GUI-Teilimplementierung entstehen. Die größten Risiken liegen nicht im Providercall, sondern in Snapshot-/Approval-Exactly-once, Inhalts-Safety und der expliziten Modellfamilienkonfiguration.

## 10. Offene Entscheidungen

1. Welcher vollständige Opinion-`provider_id`/`model_id` soll für Phase 1 verwendet werden und welche expliziten Familienmetadaten gelten für Haupt- und Opinion-Modell?
2. Darf die Aktivierung in `settings.json` ergänzt werden, sofern das Feature standardmäßig deaktiviert bleibt und vorhandene Nutzereinstellungen unverändert bleiben?
3. Ist die Festlegung „Phase 1 nur TUI; GUI/RPC/print/json sicher deaktiviert“ akzeptiert?
4. Soll die Phase-1-Konfiguration in die bestehende Setup-Konfiguration oder als klar abgegrenzter, zentral validierter Block unter der neuen Extension integriert werden? Eine zweite Provider-/Konfigurationsdatei ist ausgeschlossen.
5. Soll ein fehlender konfigurierter Opinion-Provider nur `unavailable` liefern, oder soll die Extension bis zu einer gültigen Konfiguration gar nicht aktiviert werden? Die Spezifikation verlangt in beiden Fällen keinen Call und keinen Fallback.

## 11. Ergebnis und Stop-Gate 0

**Empfehlung: CONDITIONAL GO für Phase 1.** Variante A ist technisch plausibel und die vorhandene Runtime bietet einen geeigneten tool-losen Providerpfad. Die Implementierung darf dennoch erst beginnen, wenn die offenen Konfigurations-/Oberflächenentscheidungen bestätigt und der Auftrag ausdrücklich mit **„Go für Phase 1“** freigegeben wurde.

Bis dahin bleibt das Feature unimplementiert und inaktiv. Insbesondere werden `ask_user`, GUI/Bridge, Verifier, Plan und Gates nicht vorgezogen geändert.
