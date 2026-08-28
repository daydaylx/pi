# Phase 7 — Hardening, Sicherheit und Packaging

Status: **ABGESCHLOSSEN** (alle Pflichtpunkte implementiert, getestet und
verifiziert).

## Sicherheit (Dokument 12, Pflicht)

Alle Punkte sind umgesetzt **und** durch das neue statische Sicherheits-Gate
`gui/test/security.mjs` reproduzierbar festgenagelt (8 Assertions, läuft ohne
Electron-Prozess):

| Pflichtpunkt                  | Umsetzung                                                   |
| ----------------------------- | ----------------------------------------------------------- |
| contextIsolation aktiv        | `webPreferences.contextIsolation: true`                     |
| Renderer Sandbox              | `webPreferences.sandbox: true`                              |
| kein freier Node-Zugriff      | `nodeIntegration: false`; Renderer ohne `node:`/eval        |
| IPC-Whitelist                 | nur `gui:*`-Kanäle, kein Passthrough, kein `ipcMain.on`     |
| Payload-Validierung           | `MAX_PROMPT_LENGTH`, Pfad-/Enum-/Typ-Prüfungen je Handler   |
| kein beliebiger Shell-IPC     | einziger Kindprozess = kontrollierter `pi --mode rpc`       |
| CSP                           | `default-src 'none'`, Skripte/Stile nur `self`              |
| sichere externe Links         | `setWindowOpenHandler` deny; `will-navigate` preventDefault |
| keine Geheimnisse im Renderer | Renderer ohne `process.env`/API-Keys/Dateizugriff           |

**Neu in Phase 7:** globaler `web-contents-created`-Guard (Defense in depth):
auch künftig erzeugte Web-Contents dürfen weder navigieren noch Fenster
öffnen noch Webviews anhängen.

**Keine kritische IPC-Lücke:** jeder Kanal validiert seine Payload; der
Renderer kann keine Pfade, Kommandos oder Objekte frei durchreichen.
Statisches Gate schlägt bei Regression hart fehl.

## Stabilität (Crash-Szenarien)

Neu: `gui/test/stability.mjs` (5 Assertions, deterministisch, ohne Modell):

- **Spawn-Fehler** (Pi-Binary fehlt) → als `exit {kind:"spawn-error"}` gemeldet.
- **Prozess-Exit mitten in laufender Anfrage** → Anfrage wird sauber
  verworfen, `exit`-Event mit Code, `running` ist danach `false`.
- **`stop()` ist idempotent** (mehrfaches Stoppen nach Exit wirft nicht).
- **Anfragen ohne laufenden Prozess** → sofortige, sichtbare Ablehnung.

Bereits durch E2E/Smoke abgedeckt und erneut bestätigt:

- **Cancel während Streaming/Tool** (Abort-Pfad, danach weiter bedienbar).
- **Provider-/Tool-Fehler** → `extension_error` und `done-error`-Karten
  werden sichtbar (Banner/Färbung), nicht verschluckt.
- **Pi beendet sich / GUI beendet sich** → Exit-Banner bzw. Graceful-Stop
  (Abort+Drain vor stdin-Ende, Phase 5).
- **Session-Fehler** → `switch_session`-Payload wird validiert, Fehler
  landen im Banner.
- **Neustart / Resume** → „Neue Sitzung“ und Sitzungsliste/-fortsetzen.

Manuell (xvfb deckt Logik, kein WM-Verhalten): sehr langer Chat, große
Diff-Datei, kleines/maximiertes Fenster sind als offene Punkte dokumentiert.

## Packaging

Primäre Zielplattform: **Linux** (Windows/macOS laut Auftrag erst nach
Freigabe).

- `scripts/package-gui.mjs` baut ohne neue Abhängigkeiten ein
  selbsttragendes Verzeichnis `dist/pi-gui-linux/` (gui/-Quellen +
  Electron-Laufzeit + Launcher `pi-gui`) und daraus
  `dist/pi-gui-linux.tar.gz` (~122 MB).
- Das Paket braucht keinen Repository-Kontext; `dist/` ist git-ignoriert.
- **Linux-Paket läuft:** beide xvfb-Smokes (plain + tools) laufen aus dem
  gepackten Launcher mit `SMOKE PASS`.

## Regressionen (Pflicht, alle grün)

- `npm run verify`: Exit 0, Pflichtabdeckung 1/1 (Snapshot 58db4a2152ee).
- Bestehende Pi-/TUI-Suiten: Runtime 1331, UI 124, workflow-mode 381,
  LSP 182, diff 22, Patches 50 — unverändert grün.
- GUI-Tests: Unit 8, Shortcut-Parität 5, Security 8, Stabilität 5.
- End-to-End (`gui/test/e2e-rpc.mjs`): PASS.
- Shortcut-Parität und State-Divergenz (Contract-Section): grün.
- Vollsuite `tests/run.mjs`: 1656 passed, 0 failed.

## Abschlusskriterien (Dokument 12)

- [x] Sicherheitscheck bestanden (statisches Gate + Hardening).
- [x] keine kritische IPC-Lücke.
- [x] Crash-Szenarien getestet (stability.mjs + E2E/Smoke).
- [x] Sessiondaten bleiben intakt (Smoke/E2E nutzen `--no-session`;
      Graceful-Stop fasst echte Sessions nicht an).
- [x] Linux-Paket läuft (xvfb-Smokes aus dem Paket).
- [x] `pi` läuft weiterhin unverändert (TUI-Suiten grün).
- [x] `pi gui` läuft stabil (Smoke/E2E grün).
- [x] Tests sind reproduzierbar (kein Modellzugriff für Unit/Security/
      Stabilität; E2E dokumentiert als Modell-pflichtig).
- [x] bekannte Einschränkungen dokumentiert (siehe unten).
- [x] Rollback dokumentiert (siehe unten).

## Bekannte Einschränkungen

- Sehr langer Chat wächst unvirtualisiert im DOM; für Extremverläufe ein
  Beobachtungspunkt.
- Fenstergrößen jenseits der Responsive-Stufen (≤1080/≤760px) sind nur
  manuell geprüft.
- Subagent-Status bleibt queued/needs_attention/entfernt (Paket-Events
  liefern keine feineren Zustände).
- `verification.run` bleibt dokumentierte Bridge-Lücke (siehe Phase 5).

## Rollback

Die GUI ist strikt additiv; die TUI (`pi`) ist zu keinem Zeitpunkt
angefasst. Rückbau in dieser Reihenfolge:

1. `dist/` löschen (Packaging-Artefakte, git-ignoriert).
2. `scripts/package-gui.mjs`, `gui/`, `bin/pi-gui`, `bin/pi` entfernen
   (Launcher + Shim). `pi` allein bleibt der TUI-Einstieg.
3. `+extensions/frontend-bridge/index.ts` aus `settings.json` entfernen
   (Bridge; GUI-Zustandsstrom). Pflichtfelder der TUI bleiben erhalten.
4. Optional: `/workflow-set` ist ein additiver plan-mode-Command; er kann
   bleiben, ohne die TUI zu ändern. Sein Entfernen ist kosmetisch.
5. `extensions/frontend-protocol/` wird von `aurora-ui/state.ts` als
   Alias-Quelle genutzt; ein Rückbau erfordert, diese Verweise auf die
   ursprünglichen Kanal-/Schema-Definitionen zurückzuführen (Phase 2).

Kein Schritt verändert Sessions, Runtime-Patches oder die Aurora-TUI.
