# Pi Core CLI/TUI — Aurora Setup

Pi is the core CLI/TUI agent runtime setup. Dieses Repository enthält die lokale
Pi-Konfiguration für Aurora, Berechtigungen, LSP, Verification und Resilience.
Externe Frontends können den Pi-Core über die versionierte Schnittstelle
`bin/pi-frontend` verwenden.

## Installation oder Aktualisierung

Zuerst die geplante Synchronisation prüfen:

```bash
npm run install:user
```

Danach die Konfiguration anwenden:

```bash
npm run install:user -- --apply
```

Standardziel ist `~/.pi/agent`; ein anderes Ziel wird mit `--target <pfad>`
angegeben. Die Synchronisation enthält auch `APPEND_SYSTEM.md` (phasenbasierte
Kommunikationsregeln) und `prompts/`, damit Checkout und Installation dieselbe
aktive Konfiguration verwenden. Nach der Synchronisation die Abhängigkeiten im
Zielverzeichnis installieren:

```bash
npm install --ignore-scripts --prefix ~/.pi/agent/npm
npm --prefix ~/.pi/agent run build
```

Nach einem Pi-Runtime-Update die lokalen Runtime-Patches gemäß
`docs/RUNTIME_PATCHES.md` prüfen und gegebenenfalls erneut anwenden.

Der Profil-Launcher wird mit den übrigen Setup-Dateien kopiert. Der optionale
PATH-Wechsel ist getrennt und sicherheitshalber ausdrücklich:

```bash
npm run install:user -- --dry-run --link-cli
npm run install:user -- --apply --link-cli
```

`--link-cli` legt `~/.local/bin/pi` und `~/.local/bin/pis` an. Es ersetzt
`pi` nur, wenn der vorhandene Symlink auf die Pi-Runtime im gewählten
Agent-Verzeichnis zeigt. Normale Dateien oder fremde Symlinks bleiben
unangetastet und führen zu einem Fehler.

Externe Frontends starten `bin/pi-frontend` und verwenden ausschließlich die in
`docs/frontend-api.md` dokumentierte, versionierte JSONL-Schnittstelle.

## Pi System-Profil

Nach dem optionalen Launcher-Link startet `pis` aus jedem Verzeichnis dieselbe
Pi-Runtime mit einem festen Workspace und einem eigenen Standard-Sitzungsverzeichnis.
`pi system` bleibt als kompatibler Aufruf verfügbar. Modell, Authentisierung und
Extension-Code bleiben gemeinsam; Sessions, Pläne und Setup-Präferenzen sind
standardmäßig profilgetrennt. Explizite `--session`, `--fork` und
`--session-dir` werden durchgereicht. Projektdateien und Projekt-Kontext
werden im System-Profil nicht automatisch geladen. `pis` läuft dauerhaft mit
Vollzugriff: Pi-eigene Permission-, Trust-, Pfad-, Risiko-, Verifier- und
Wiederholungs-Guards blockieren keine Befehle oder Tools; Bestätigungsdialoge
werden nicht gezeigt. `/permission` und `/yolo` können diesen Zustand nicht
absenken (ADR 043).

Details und aktuelle Einschränkungen: [`docs/pi-system-profile.md`](docs/pi-system-profile.md).
Der lokale RPC-Host und seine offenen Betriebsgrenzen sind in
[`docs/pi-system-host.md`](docs/pi-system-host.md) dokumentiert.

## Planung und Skill-Auswahl (Shift+Tab)

Pi hat keinen technischen Planmodus und keinen Workflow-Umschalter. Planung
läuft über normale Prompts; jeder Turn arbeitet unter der gewählten
Zugriffsstufe (`/permission`). Pläne aus früheren Versionen unter
`~/.pi/agent/plans/` bleiben unberührt, werden aber nicht mehr gelesen.

**Shift+Tab** (oder `/skill`) öffnet eine durchsuchbare Liste der Skills, die
die Runtime in dieser Sitzung geladen hat, gruppiert nach Herkunft (Projekt,
Projekt-Paket, Global, Paket). Tippen sucht sofort, ↑/↓ bewegt, Enter merkt den
Skill für die **nächste Nachricht** vor, Esc schließt ohne Änderung. Die Auswahl
startet keinen Turn und ruft kein Modell auf; ein vorhandener Entwurf bleibt
unberührt. Der Footer zeigt `Skill: <name>`.

- Beim Absenden der nächsten normalen Nachricht wird ihr `/skill:<name> `
  vorangestellt; die native Skill-Expansion der Runtime lädt die `SKILL.md`.
  Danach ist die Vormerkung verbraucht. Commands (`/…`), Prompt-Templates und
  ausdrückliche `/skill:`-Aufrufe lassen sie unberührt stehen.
- Es gibt immer höchstens einen vorgemerkten Skill, kein Pinning und keine
  Mehrfachauswahl. Erneutes Wählen desselben Skills nimmt die Vormerkung zurück;
  `/skill <name>` setzt sie direkt, `/skill --clear` entfernt sie.
- Neue Sitzung, Wechsel, Fork und `/reload` beginnen ohne Vormerkung. Ein nach
  `/reload` entfallener Skill wird nicht geladen und gemeldet.
- Die Liste ist die Skill-Erkennung der Runtime, keine eigene: Projekt-Skills
  erscheinen nur in vertrauten Projekten, `pi system` zeigt nur die dort
  geladenen (globalen) Skills. Ein Skill vergibt keine Rechte; Zugriffsstufen,
  Trust und Verifier bleiben unverändert.
- Bestehende `/skill:<name> …`-Aufrufe funktionieren wie zuvor.

Die Runtime-Standardaktion von Shift+Tab (`app.thinking.cycle`) ist in
`keybindings.json` auf Super+T umgelegt; diese Umbelegung muss erhalten bleiben,
sonst kollidiert die Taste (`tests/suites/runtime/shortcuts.mjs` prüft das und
dass genau eine Registrierung die Taste besitzt, ADR 037).

## Subagenten

Es gibt keine festen Subagenten-Rollen. Der Hauptagent beschreibt
aufgabenspezifische, temporäre Task-Agenten als `spec` (Profile `analyse`,
`research`, `verify`; ADR 031); höchstens 3 pro Parent-Lauf. Die Verifier-
Kette behält `agents/verifier.md` als technisches Profil. Planung, Implementierung und finale Kommunikation bleiben beim
Hauptagenten; Delegation ist nie eine automatische Pflichtkette. Der
`verifier` ist nur bei den in `AGENTS.md` aufgezählten Risikofaktoren
verpflichtend — der Umfang eines Diffs allein löst keine Delegation aus.

Die Paket-Builtins sind in `settings.json` mit
`subagents.disableBuiltins: true` deaktiviert. Die aktive Paketkonfiguration
steht direkt in `extensions/subagent/config.json`: `toolSchemaMode: "harness"`
reduziert die akzeptierten Parameter auf SINGLE-Ausführung sowie `list`,
`status`, `stop` und `interrupt`; `toolDescriptionMode: "custom"` steuert nur
den sichtbaren Beschreibungstext; `maxSubagentSpawnsPerSession: 5` begrenzt die
Starts pro Sitzung. Es gibt keine Parallelitätskonfiguration — das Harness
führt keine parallelen Subagenten aus. Frischer Kontext und das Verbot
verschachtelter Delegation sind Eigenschaften des Verifier-Profils und der temporären Spec-Agenten.

## Berechtigungen und Freigaben

Berechtigungen im Projektprofil sind eine reine Stufenwahl über `/permission`: `readonly`,
`project-write`, `confirm-all` und temporäres `yolo` in drei Stufen
(`yolo`, `yolo-ask`, `yolo-full`, kurz `/yolo 1|2|3`; Entscheidung 029). Gespeicherte
Einzelfreigaben gibt es nicht. Subagenten-Delegationen (`subagent`) sind auf `project-write`,
`confirm-all` und `yolo` ohne Bestätigung erlaubt (Entscheidung 018);
`readonly` bleibt im Projektprofil vollständig gesperrt. `pis` verwendet
unabhängig von einer gespeicherten Stufe dauerhaft `yolo-full`; seine
Permission-Guards blockieren keine Tool-Aufrufe.

Harte Trust-, Secret-, Symlink-, Projekt- und Systemgrenzen bleiben auf jeder
Stufe blockiert, YOLO 1 eingeschlossen. Dazu zählen auch Ausführungspfade
innerhalb des Projekts: Schreibzugriffe auf `.git/`, `.pi/lsp.json` und
`.pi/verify.json` müssen bestätigt werden, weil dort Geschriebenes später
ausgeführt wird. YOLO 2 (`yolo-ask`) fragt an diesen Grenzen mit Gefahr-Dialog
nach (sudo, Systempfade, Secrets, Pfade außerhalb des Projekts, opake
Interpreter); YOLO 3 (`yolo-full`) erlaubt sie, auch sudo. Auf jeder YOLO-Stufe
bleiben Trust-Grenze und der Credential-Pfad des
interaktiven Shell-Tools aktiv.

## Verifikation

```bash
npm --prefix npm run typecheck
npm --prefix npm run test
npm --prefix npm run verify
```

`verify` schließt seit dem Audit-Gate `npm run audit:check` ein — ein lokal
grüner Lauf deckt damit dieselben Abhängigkeitsbefunde ab wie CI. Seit dem
Lint-Gate ist auch `npm run lint` (ESLint + eslint-plugin-security) Teil von
`verify`. `.ts`-Dateien sind darin vorerst ausgenommen: typescript-eslint
verweigert aktuell den Start gegen die hier gepinnte TypeScript-7-Version
(siehe `npm/eslint.config.mjs`); sie bleiben bis dahin allein durch
`tsc --noEmit` (strict) abgedeckt. Zusätzlich läuft in CI ein
advisorischer, nicht blockierender Semgrep-Scan (`p/ci` + `p/security-audit`);
lokal ist Semgrep nicht installiert — bei Bedarf manuell mit
`semgrep scan --config p/ci --config p/security-audit .` ausführen.

Nur ein `project_check`-Aufruf des deklarierten Pflichtprofils (`verify`,
siehe `.pi/verify.json`) aktualisiert den Verifikations-Footer, und
`project_check` ist auch der einzige Weg, diese vollständige Verifikation
überhaupt auszulösen. Das `verify`-Tool bietet nur noch die schnellen
Teilprüfungen `typecheck` und `test`. Ein direkter `bash`-Lauf derselben
Befehle oder ein Lauf aus einem Subagenten heraus lässt den Footer bei
`changed_unverified` stehen, selbst wenn der Lauf lokal grün war.

Ein unveränderter Workspace meldet `unchanged`. Das ist eine Aussage über den
Arbeitsbaum, nicht über eine bestandene Prüfung — vorher hieß dieser Zustand
`clean` und las sich wie ein Prüfergebnis.

`npm run test:runtime` (siehe „Lokale Laufzeitdaten" unten) ist bewusst kein
Teil von `verify`/CI: es prüft die explizit gewählte oder lokal erkannte
Pi-Runtime.

Abhängigkeiten werden nicht automatisch installiert. Commits und Pushes
erfolgen in kleinen Schritten ohne Einzelfreigabe, Veröffentlichungen nur auf
ausdrücklichen Auftrag.

## Lokale Laufzeitdaten

`auth.json`, `models-store.json`, `run-history.jsonl`, `pi-crash.log` und
`pi-debug.log` gehören nicht ins Repository (siehe `.gitignore`) und tragen
`0600`. Das Pi-Runtime schreibt die drei letzten selbst; legt es eine davon neu
an, ist der Modus erneut zu setzen:

```bash
chmod 600 run-history.jsonl pi-crash.log pi-debug.log
```
