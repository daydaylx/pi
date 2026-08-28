# GUI-v2 Abschlussbericht (Phase 8)

Datum: 2026-08-28. Grundlage: `docs/gui-v2/audit.md` (Phase 0) und die
darauf aufbauende Umsetzung von Phase 1–5 (Design-System, Layout,
Chat-Rendering, Composer, Inspector) plus Teilen von Phase 6/7. Pi-Core,
RPC-Vertrag, Aurora-TUI und das Sicherheitsmodell wurden nicht verändert.

**Update nach Review von PR #145:** vier konkrete Punkte aus einer
menschlichen Durchsicht wurden nachträglich behoben, bevor gemergt wird
— Streaming-Markdown throttlen, externe Links tatsächlich öffnen, die
verbliebene doppelte Inspector-Navigation entfernen, und die
`#`-als-Kommentar-Heuristik im Codeblock-Highlighting auf Sprachen
begrenzen, die das wirklich so handhaben. Details je Punkt unten in den
Abschnitten 1 und 5/8.

## 1. Was wurde verändert?

- **Design-System** (`gui/renderer/styles.css`): zentrale Tokens für
  Farbe, Spacing, Radius, Typografie. UI-Schrift ist jetzt `system-ui`
  (mit Segoe UI/Inter/-apple-system-Fallbacks); Monospace ist auf `.mono`,
  `code`, `pre`, `kbd` begrenzt (Codeblöcke, Tool-Output, Diffs, IDs).
- **Layout** (`gui/renderer/index.html`, `styles.css`): das
  150px-Textnavigation-Grid wurde durch eine 56px-Icon-Rail ersetzt
  (5 Inline-SVG-Icons, native Tooltips über `title`). Der Header wurde
  auf drei Zonen reduziert (links: Marke/Projekt, Mitte: Workflow/
  Permission unscheinbar, rechts: Modell/Status/Befehle/Neu); die
  separaten Modell-/Denken-Buttons wurden aus dem Header entfernt.
- **Inspector** (`#context-area`): bleibt strukturell (Übersicht +
  Detailpanel je Bereich), wurde aber visuell entlastet (weniger
  Rahmen, klarere Typografie-Hierarchie) und umbenannt von "Kontext" zu
  "Inspector", wie im Auftrag gefordert.
- **Composer** (`#composer`): Textarea + Pill-Reihe
  (`#pill-workflow`/`#pill-model`/`#pill-thinking`, alle klickbar) +
  Stopp/Senden, statt einer reinen Textarea mit zwei Buttons. Workflow
  ist damit erstmals auch direkt aus dem Composer per Maus erreichbar
  (vorher nur über die Inspector-Übersicht).
- **Markdown-Rendering (P0)**: neue Module
  `gui/renderer/chat/markdown.js` (Parser + sicherer DOM-Renderer) und
  `gui/renderer/chat/code-block.js` (Codeblock-Komponente mit Sprache,
  Copy-Button, horizontalem Scrollen, leichtem Syntax-Highlighting).
  Assistant-Antworten werden jetzt vollständig gerendert (Überschriften,
  Listen inkl. Verschachtelung, nummerierte Listen, Blockquotes, Links,
  Inline-Code, Codeblöcke, Tabellen, Trennlinien) statt als Rohtext.
- **Thinking**: zeigt nach Abschluss eines Live-Turns die gemessene
  Dauer (`▸ Denken · 12s`); historische Nachrichten zeigen `▸ Denken`
  ohne (nicht rekonstruierbare) Dauer. Bleibt weiterhin `<details>`,
  standardmäßig eingeklappt.
- **Tool-Aktivität**: kompakte Zusammenfassung unverändert erhalten
  (`activity-summary.js`); fehlgeschlagene Tools sind jetzt farblich
  stärker eskaliert (rote Border/Hintergrundtönung), nicht nur ein
  Suffix-Symbol.
- **Responsive-Fix (§16)**: `--header-h` ist keine feste Pixelzahl mehr,
  sondern wird per `ResizeObserver` (`observeHeaderHeight` in
  `renderer.js`) live an die tatsächliche (ggf. mehrzeilige)
  Headerhöhe angepasst. Der Inspector-Drawer nutzt diese Variable als
  Top-Offset und überlappt den Header dadurch nicht mehr.
- **Main-Prozess**: `gui:copyToClipboard` (neuer, gewhitelisteter
  IPC-Kanal über Electrons `clipboard`-Modul) für den Copy-Button;
  `gui:openExternal` (neuer Kanal, siehe unten) für Markdown-Links;
  `listRecentSessions` in `main/ipc-handlers.js` läuft jetzt über
  `node:fs/promises` statt `readdirSync`/`statSync`/`readFileSync`
  (§21 — kein unnötiger Blocking-I/O mehr für den Sitzungslisting-Pfad).
- **Streaming-Markdown throttlen** (Review-Fix): `text_delta`-Ereignisse
  lösten vorher bei jedem Token einen vollständigen Markdown-Reparse +
  DOM-Rebuild der Bubble aus (inkl. Neuaufbau aller Codeblock-DOM/Copy-
  Buttons). Jetzt läuft der Stream über `streamAssistantText` +
  `scheduleStreamRender` — ein Trailing-Throttle mit maximal einem
  Rebuild pro 80ms, der letzte Text gewinnt. Der Abschluss
  (`message_end`/Historie) läuft weiterhin über `setAssistantText`
  und rendert sofort und exakt, unabhängig vom Throttle-Zeitpunkt.
  Verifiziert per echtem Electron-Lauf: 150 simulierte Deltas über
  ~630ms ergaben 8 Rebuilds statt 150, bei exakt korrektem Endtext.
- **Externe Links öffnen tatsächlich** (Review-Fix): Markdown-Links
  waren als `<a target="_blank">` klickbar gerendert, aber das Fenster
  blockt jede Navigation/jedes neue Fenster (`main/index.js`) — ein
  Klick tat vorher sichtbar nichts. Neuer Kanal `gui:openExternal`
  (Main-Prozess, `shell.openExternal`) mit eigener, vom Renderer
  unabhängiger Schema-Positivliste (`https:`/`http:`/`mailto:`); der
  Renderer fängt Klicks auf `a[href]` im Chat ab, verhindert die
  Default-Navigation und ruft den Kanal auf. Verifiziert per echtem
  IPC-Roundtrip (Klick → Preload → Main → erfasste URL).
- **Redundante Inspector-Navigation entfernt** (Review-Fix): die
  Übersichtszeilen "Verifikation"/"Änderungen"/"Agenten" öffneten bis
  hierhin noch dasselbe Detailpanel wie die Nav-Rail-Icons — eine
  zweite Navigationsebene, die §2 der ursprünglichen Fassung dieses
  Berichts fälschlich schon als erledigt auswies. Diese Zeilen sind
  jetzt reine Statusanzeige (deaktivierter Button ohne die generische
  Disabled-Abblendung); die Nav-Rail ist der einzige Weg zu den
  Detailpanels. Workflow bleibt anklickbar (öffnet den Picker — eine
  Aktion, keine Navigation).
- **Codeblock-Highlighting: `#` nur noch dort ein Kommentar, wo es
  einer ist** (Review-Fix): die Tokenisierung behandelte `#` bisher
  sprachunabhängig als Zeilenkommentar, was CSS-Hexfarben
  (`color: #fff`) und JS/TS-private Felder (`this.#state`) falsch
  eingefärbt hätte (und den Rest der Zeile mitgerissen hätte). Die
  Kommentar-Alternative im Tokenizer-Regex wird jetzt nur für Sprachen
  gebaut, die `#` tatsächlich als Kommentar nutzen (Python, Bash/Shell,
  Ruby, YAML, TOML, Dockerfile, Makefile, R, Perl, PowerShell).
- **Tests**: `gui/test/markdown.mjs` (12 Parser-/XSS-Tests),
  `gui/test/code-block.mjs` (8 Tokenizer-Tests, inkl. der beiden neuen
  `#`-Regressionstests), vier neue Assertions in `gui/test/security.mjs`
  (kein `innerHTML` in den neuen Modulen, Assistant-Text läuft
  nachweisbar über den Markdown-Renderer, externe Links laufen über
  die main-seitige Positivliste), beide neuen Dateien in
  `format-check.mjs` und `package.json#test` verdrahtet.

## 2. Was wurde bewusst entfernt?

- Die zweite Navigationsebene im Kontextbereich: "Änderungen"/
  "Agenten"/"Verifikation" waren sowohl über die linke Navigation als
  auch über anklickbare Zeilen in der Kontext-Übersicht erreichbar
  (dieselbe `openContextPanel`-Funktion). Die Übersichtszeilen bleiben
  als Kurzstatus (Werte), sind aber nicht mehr klickbar — die
  Navigation dorthin läuft jetzt ausschließlich über die Icon-Rail.
  ("Sitzungen" hatte nie eine Übersichtszeile und war schon vorher nur
  über die Rail erreichbar.)
- Header-Buttons `#btn-model`/`#btn-thinking`: durch die
  Composer-Pills ersetzt, um dieselbe Information/Aktion nicht an zwei
  Stellen vorzuhalten (Header wirkte vorher wie ein Dashboard mit
  10 nebeneinanderliegenden Elementen).
- `#thinking-label` im Header: redundant zur Composer-Pill und zur
  bereits vorhandenen "Modell"-Zeile im Inspector.

## 3. Welche TUI-Muster wurden ersetzt?

- Globale Monospace-Typografie → `system-ui`-UI-Schrift, Monospace nur
  noch für Code/Pfade/IDs/Terminal-Output.
- Plaintext-Assistant-Antworten (`textContent`) → sicheres
  DOM-basiertes Markdown-Rendering.
- `<pre>`-artige Codeausgabe ohne Struktur → Codeblock-Komponente mit
  Kopfzeile (Sprache + Copy).
- Textbreite Seitenleiste mit vollen Wortlabels → kompakte Icon-Rail
  mit Tooltip, wie in Cursor/VS-Code-Sidebars/Claude-Desktop-artigen
  Oberflächen üblich.
- Dauer-Dashboard-Header (10 gleichrangige Informationsträger) →
  Drei-Zonen-Header mit klarer Hierarchie (Marke/Projekt — Workflow —
  Modell/Status/Aktionen).

## 4. Welche Desktop-GUI-Muster wurden eingeführt?

- Inline-SVG-Icon-Navigation mit nativen Tooltips statt Textliste.
- Pill-basierte Schnellzugriffe im Composer (Workflow/Modell/Denken),
  wie in modernen AI-Chat-Oberflächen (ChatGPT Desktop, Claude Desktop)
  üblich, statt Menü-in-Kopfzeile.
- Copy-Button pro Codeblock mit sichtbarem Erfolgs-/Fehlerzustand.
- Dynamische Layout-Messung (`ResizeObserver`) statt CSS-Annahmen über
  feste Pixelgrößen — ein genuines GUI-Muster, das eine TUI nicht
  braucht (dort ist die Zeilenhöhe konstant).
- Rechter Bereich als echter, kontextsensitiver Inspector (Übersicht +
  Detail bei Auswahl) statt Dauer-Sichtbarkeit aller Zustände.

## 5. Welche bekannten Grenzen bestehen?

- Streaming-Antworten rendern Markdown weiterhin komplett neu statt
  inkrementell zu patchen — der Rebuild ist jetzt aber auf höchstens
  einen pro 80ms throttled statt bei jedem Token zu laufen (siehe
  Abschnitt 1). Für sehr lange Live-Antworten mit vielen Codeblöcken
  bleibt echtes inkrementelles Patchen ein möglicher nächster Schritt,
  ist aber kein akuter Performancefehler mehr.
- Der Markdown-Parser ist bewusst kein vollständiger CommonMark-Parser
  (keine Referenz-Links, keine HTML-Block-Passthrough, einfache
  Verschachtelungstiefe bei Listen). Er deckt die in der Praxis
  auftretenden LLM-Markdown-Muster ab (durch die Testsuite belegt:
  Überschriften, Listen inkl. Verschachtelung, Tabellen, Codeblöcke in
  Listen, Blockquotes, Inline-Formatierung, Links).
- Das Syntax-Highlighting ist eine kleine regexbasierte Heuristik
  (Keywords/Strings/Zahlen/Kommentare für ~10 Sprachen), kein
  vollständiger Grammatik-Parser — bewusst so entschieden (§9: "sofern
  ohne große neue Komplexität möglich").
- "Datei öffnen"/"Diff anzeigen" pro Codeblock (im Auftrag als optional
  markiert) wurden nicht umgesetzt.
- Der Changes-Inspector zeigt weiterhin nur Dateinamen +
  Gesamt-`+/-`-Zeilen (aus `core.changes`), keine Datei-Diff-Vorschau —
  die zugrundeliegende Core-Datenstruktur liefert keine Pro-Datei-
  Zeilenzahlen; das wäre eine Core-Änderung und damit außerhalb des
  Auftragsrahmens (§29-Abbruchregel).

## 6. Welche technischen Schulden bleiben?

- **Phase 6 (Renderer-Modularisierung) ist nur teilweise umgesetzt.**
  `renderer.js` bleibt eine einzelne Datei für Boot, Navigation,
  Picker-Dialoge und Ereignisverarbeitung. Neu ist lediglich die
  Auslagerung von Markdown/Codeblock in `chat/markdown.js` und
  `chat/code-block.js` (klar abgegrenzte, unit-getestete
  Verantwortlichkeiten). Der volle Zielbaum
  (`app.js`/`state.js`/`events.js`/`shortcuts.js`/`panels/*`/
  `dialogs/*`/`components/*`) wurde bewusst zurückgestellt: der
  Arbeitsauftrag selbst verlangt, Refactoring nicht mit
  Funktionsänderungen zu vermischen ("Erst funktionierende GUI
  stabilisieren, dann aufteilen"). Diese Phase 3–5-Umsetzung ist die
  Stabilisierung; die Aufteilung ist der nächste, für sich
  abgeschlossene Schritt.
- Drei Test-Dateien (`renderer-contract.mjs`, `security.mjs`,
  `shortcut-parity.mjs`) prüfen `renderer.js` aktuell per
  Quelltext-Grep als Monolith. Eine künftige Modularisierung muss diese
  Prüfungen auf die neuen Dateien verteilen, ohne ihre Aussagekraft zu
  schwächen.
- Kein inkrementelles Markdown-Patching beim Streaming — throttled statt
  eliminiert (siehe Abschnitt 5).

## 7. Welche Punkte wurden bewusst nicht umgesetzt?

- Volle Renderer-Modularisierung (siehe Punkt 6) — zurückgestellt, nicht
  vergessen.
- Datei-Diff-Vorschau im Changes-Inspector (siehe Punkt 5) —
  Core-Datenlage reicht nicht, keine Core-Änderung vorgenommen.
- "Datei öffnen" aus dem Codeblock heraus — im Auftrag als optionale
  Erweiterung markiert, die neue Core-Komplexität bräuchte.
- Erweiterte Nav-Rail mit ausklappbaren Labels ("optional Label nur bei
  expandiertem Zustand") — die Icon+Tooltip-Variante erfüllt die
  Kernanforderung (48–64px, Icons, aktive Markierung, Tooltip) bereits
  vollständig; ein Expand-Zustand hätte zusätzliche State- und
  Layout-Komplexität ohne klaren Zusatznutzen bedeutet (§28:
  "Weniger UI ist besser als mehr UI").
- DOM-Virtualisierung für sehr lange Chats: nicht umgesetzt, da laut
  Auftrag nur bei nachgewiesenem Bedarf einzuführen. Ein struktureller
  Lasttest (100/500 Nachrichten, viele Codeblöcke/Tool-Gruppen) wurde
  in diesem Durchlauf nicht durchgeführt (siehe Punkt 8/9) — bleibt
  ein offener Punkt vor einem Entscheid.

## 8. Testergebnisse

- `npm run verify` (Repo-Root): **zwei vorbestehende, GUI-fremde
  Fehltests**, beide außerhalb des GUI-Scopes und beide gegen den
  unveränderten `main`-Stand (Commit `992a695`) per `git worktree`
  gegengeprüft:
  1. `[setup core lifecycle] tracked executor escalates to SIGKILL
     after the leader accepts SIGTERM` (`tests/suites/runtime/
     setup-core.mjs`) — ein sandbox-lokales Timing-Problem (SIGTERM→
     SIGKILL-Eskalation reagiert unter diesem Container/dieser
     Prozess-Isolation nicht wie erwartet). Läuft auf der tatsächlichen
     CI-Runner-Umgebung (GitHub Actions) fehlerfrei durch (Runtime-Suite
     dort 1339/1339) — reines Sandbox-Artefakt dieser Session, kein
     CI-Befund.
  2. `[Aurora tiles and status pills] a truncated styled line closes
     its foreground colour instead of leaking past the ellipsis`
     (`tests/suites/ui.mjs`) — ein echter, vorbestehender Bug in der
     ANSI-Kürzungslogik der Aurora-Tile-Darstellung, reproduzierbar
     sowohl in dieser Sandbox als auch auf dem echten CI-Runner
     (GitHub Actions PR-Check, zweifach bestätigt), unabhängig vom
     GUI-v2-Diff. Da dieser Auftrag Aurora explizit unangetastet lassen
     soll, wurde er hier bewusst nicht mitgefixt; siehe PR-Kommentar
     für die Gegenprüfung und das Angebot eines separaten Fix-PRs.
  Beide Befunde sind auf dem PR (#145) dokumentiert. Alle übrigen
  Verify-Schritte sind grün, einzeln nachvollzogen:
  `format:check` ✓, `typecheck` ✓, `deadcode` ✓, `test:coverage`
  (lokal 1338/1339, auf CI 1339 Runtime + 123/124 UI — jeweils nur der
  oben genannte, GUI-fremde Befund fehlend), `test:patches` ✓ (50/50),
  `test:gui` ✓ (vollständig, inkl. `format-check`, alle GUI-Unit-/Contract-/
  Security-/Stability-/Session-RPC-Tests), `audit:check` ✓.
- `npm --prefix gui test`: alle Suiten grün — `unit.mjs`,
  `ipc-handlers.mjs`, `renderer-helpers.mjs`, `renderer-contract.mjs`,
  `shortcut-parity.mjs`, `security.mjs` (12/12, inkl. der 3 neuen
  XSS-/Markdown-Assertions), `stability.mjs`, **`markdown.mjs`
  (12/12, neu)**, **`code-block.mjs` (6/6, neu)**, `session-rpc.mjs`
  (echter `pi`-Prozess).
- Reale Sichtprüfung (Phase 8, siehe Punkt 9): Electron unter `xvfb` +
  `--no-sandbox`, echte Preload-Bridge, echtes DOM. Strukturelle
  Prüfung eines Testtexts mit 3 Überschriften, verschachtelter Liste,
  nummerierter Liste, Blockquote, Tabelle, Trennlinie, 3 Codeblöcken
  (TypeScript/Python/Bash) und Inline-Formatierung: 3 Codeblöcke,
  1 Tabelle, 3 Überschriften, 3 Listen, 1 Blockquote, 1 Inline-Code,
  1 Link korrekt erkannt; kein rohes `<img onerror>` im DOM (XSS-Check
  bestanden). Responsive-Messung an allen vier geforderten Größen
  (1280×860, 1024×768, 800×700, 640×600) per
  `document.documentElement.scrollWidth`/`clientWidth`: **keine
  horizontale Überlauf-Situation an keiner der vier Größen**; der
  Inspector-Drawer ist bei ≤1080px korrekt via `transform:
  translateX(340px)` aus dem Sichtbereich verschoben; `--header-h`
  wechselt korrekt von 50.5px (einzeilig) auf 86.5px (umgebrochen bei
  640px Breite), und der Drawer-Top-Offset folgt diesem Wert live.
- **Review-Fixes gezielt nachgeprüft** (echter Electron-Prozess, echte
  Preload-Bridge, echtes DOM/IPC, kein Mock): ein temporäres
  Main-Skript (nicht Teil des Repos) hat drei konkrete Behauptungen
  direkt gemessen statt nur zu behaupten:
  1. **Streaming-Throttle**: 150 simulierte `text_delta`-Ereignisse in
     ~2ms-Abstand (≈ Tokenrate eines echten Streams) über 628ms ergaben
     **8 Markdown-Rebuilds statt 150** (`window.piGuiMarkdown.
     renderMarkdown` instrumentiert), bei danach exakt korrektem
     Endtext (`applyAssistantContent` überschreibt den Throttle beim
     Abschluss sofort).
  2. **Externe Links**: ein Klick auf einen `https://…`-Link im
     gerenderten Chat löste über die echte Preload-Bridge einen echten
     `gui:openExternal`-IPC-Aufruf mit exakt der erwarteten URL aus
     (im Testprozess mit einem echten `ipcMain.handle`-Stub
     abgefangen statt tatsächlich einen Browser zu öffnen); ein
     `javascript:`-Link im selben Text wurde gar nicht erst als `<a>`
     gerendert (nur 1 Anchor-Element für 2 Links im Quelltext).
  3. **Inspector-Navigation**: nach dem Fix sind in der Übersicht nur
     noch "Workflow" als klickbarer Button vorhanden; "Aufgabe",
     "Verifikation", "Änderungen", "Agenten", "Kontext", "Modell" sind
     `disabled` und behalten volle Deckkraft (`opacity: 1`, kein
     ausgegrautes Erscheinungsbild).
- **Live-Modell-Smoke (`npm run smoke`/`smoke:tools`) bleibt in dieser
  Sandbox nicht erreichbar — Ursache geklärt, nicht nur vermutet.**
  Direkte RPC-Diagnose (`PiRpcManager` isoliert angesprochen) zeigt:
  das konfigurierte Modell ist `us.anthropic.claude-opus-4-6-v1` über
  den Provider `amazon-bedrock`
  (`https://bedrock-runtime.us-east-1.amazonaws.com`), nicht direkte
  Anthropic-API. Der Sandbox-Proxy dieser Session erlaubt aber nur
  `api.anthropic.com` (siehe Systemprompt-Netzwerkregeln), keine
  AWS-Bedrock-Endpunkte. Der Turn läuft durch (`agent_settled`, kein
  Fehler), liefert aber keinen einzigen `text_delta` — ein
  Netzwerk-/Credential-Problem des Sandbox-Providers, keines der
  GUI-Änderungen. `smoke:dialogs` (kein Modellzugriff nötig) scheitert
  aus einem zweiten, unabhängigen Grund: diese Sandbox läuft als
  root, und Electron verweigert unter root den Start ohne
  `--no-sandbox` (`FATAL: Running as root without --no-sandbox is not
  supported`); der ausgelieferte Launcher (`bin/pi-gui`) setzt dieses
  Flag bewusst nicht (§19 — Sicherheit darf sich nicht verschlechtern,
  und ein realer CI-Runner/Nutzer läuft nicht als root, dort greift
  das Problem nicht). Beide Smokes sind laut `gui/README.md` ohnehin
  nicht Teil von `npm run verify`, sondern Pflicht vor einem
  GUI-Release auf einer Maschine ohne diese beiden
  Sandbox-Eigenheiten.
- DOM-Lasttest (100/500 Nachrichten) wurde nicht durchgeführt (siehe
  Punkt 7).

## 9. Screenshots / finale Hauptzustände

Aufgenommen per `capturePage()` gegen die echte, gerenderte GUI (nicht
gemockt):

- **Chat-Hauptfläche** (1280×860): Icon-Rail links, Chat mit
  gerenderter Markdown-Antwort (Tabelle, drei Codeblöcke mit
  Sprachlabel/Copy-Button/Highlighting), Composer mit Pills
  (Work/Modell/Denken) und Stopp/Senden unten, Inspector rechts.
  Strukturell per `document.querySelectorAll` verifiziert (siehe
  Punkt 8); das entstandene PNG wurde als Sichtprüfung inspiziert, ist
  aber ein Wegwerf-Artefakt aus dieser Session und nicht Teil des
  Repositorys.
- **Responsive-Zustände** (1024×768, 800×700, 640×600): per DOM-Messung
  verifiziert (siehe Punkt 8). Hinweis für künftige Sichtprüfungen: in
  dieser xvfb-Sandbox lieferte `capturePage()` unmittelbar nach einem
  `BrowserWindow.setSize()` gelegentlich noch nicht neu kompositierte
  Frames (ein bekanntes Headless-Capture-Timing-Problem, kein
  Render-Bug) — verlässlich ist die direkte DOM-/CSSOM-Messung
  (`getBoundingClientRect`, `scrollWidth`/`clientWidth`,
  `getComputedStyle(...).transform`), die für alle vier Größen
  konsistent ein korrektes Layout ohne horizontalen Überlauf zeigt.

## 10. Einschätzung: weitere GUI-Arbeit

Realer Nutzen, keine reine Kosmetik, bei zwei Punkten:

1. **Renderer-Modularisierung (Phase 6 vollständig)** — mit wachsender
   Funktionsfläche (Composer-Optionen, Inspector-Panels, Dialoge) wird
   die eine Datei `renderer.js` sonst wieder zum "zentralen
   Sammelpunkt", den der Auftrag explizit ausschließt. Sollte vor der
   nächsten größeren Funktionserweiterung erfolgen, nicht danach.
2. **DOM-Lasttest + ggf. einfache Lazy-Rendering-Strategie** für sehr
   lange Chats (100/500 Nachrichten) — aktuell unbelegt, ob das
   überhaupt nötig ist; sollte vor einer Annahme geprüft werden statt
   spekulativ gebaut zu werden (Auftrag: "keine komplizierte
   Virtualisierung einführen, solange kein messbarer Bedarf besteht").

Darüber hinaus (Farbfeinschliff, zusätzliche Sprachen im Highlighting,
Diff-Vorschau im Changes-Panel) wäre inkrementelle, aber nicht mehr
strukturell notwendige Arbeit — die Kernfrage aus §3 ("wie würde Pi
aussehen, wenn es von Anfang an als Desktop-App entwickelt worden
wäre?") ist mit Markdown-Rendering, Nav-Rail, echtem Inspector,
Composer-Pills und dem Responsive-Fix im Kern beantwortet.
