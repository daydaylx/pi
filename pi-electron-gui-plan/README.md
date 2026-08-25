# Pi Electron GUI – Planpaket

## Zweck

Dieses Paket beschreibt die Umsetzung einer separaten Electron-GUI für `daydaylx/pi`.

Das Zielbild ist verbindlich:

```text
pi       -> bestehende TUI
pi gui   -> neue Electron-GUI
```

Beide Frontends benutzen dieselbe Pi-Runtime, dieselben Sessions, Einstellungen, Modelle, Extensions, Permissions, Workflows und Verifikationsdaten. Die GUI ist eine zweite Darstellungs- und Bedienoberfläche – kein zweiter Agent-Harness.

## Dokumentstruktur

- `00-entscheidungen-und-nicht-ziele.md` – verbindliche Produkt- und Architekturentscheidungen
- `01-zielarchitektur.md` – Prozess-, Runtime- und Frontendarchitektur
- `02-sicherheit-und-zustandsregeln.md` – Sicherheitsgrenzen und State Ownership
- `03-test-und-paritaetsmatrix.md` – übergreifende Testanforderungen
- `04-gesamtabschluss.md` – finale Definition of Done
- `05-agenten-arbeitsauftrag.md` – ausführbarer Arbeitsauftrag für einen Coding-Agenten
- `phases/` – jede Umsetzungsphase als separates Dokument

## Phasenreihenfolge

1. Phase 00 – Voraussetzungen und TUI-Stabilität
2. Phase 01 – Electron-/SDK-Kompatibilitätsspitze
3. Phase 02 – gemeinsamer UI-Contract
4. Phase 03 – Launcher `pi gui`
5. Phase 04 – Electron-Shell und Sicherheitsbasis
6. Phase 05 – Runtime, Chat und Streaming
7. Phase 06 – Project Trust, Permissions und Ask User
8. Phase 07 – Sessions, Locks und Lifecycle
9. Phase 08 – Changes, Diff und Verification
10. Phase 09 – Subagenten, Kontext und GUI-Einstellungen
11. Phase 10 – Packaging und Installation
12. Phase 11 – Parität, Stabilisierung und Release Gate

## Arbeitsregel

Eine Phase darf erst abgeschlossen werden, wenn alle im jeweiligen Dokument genannten Abschlusskriterien nachweisbar erfüllt sind. Eine sichtbare Demo oder ein erfolgreicher Happy Path reicht nicht.

Wenn ein Abschlusskriterium nicht erfüllt werden kann, muss die Phase offen bleiben. Workarounds, die eine zweite Runtime, doppelte Fachlogik oder direkte Renderer-Systemrechte einführen, sind nicht zulässig.

## Empfohlene Nutzung

1. Zuerst `00` bis `05` lesen.
2. Phase 00 durchführen.
3. Nach jeder Phase Tests, Nachweise und offene Risiken dokumentieren.
4. Erst danach die nächste Phase beginnen.
5. Vor einem Release `03-test-und-paritaetsmatrix.md` und `04-gesamtabschluss.md` vollständig abarbeiten.

