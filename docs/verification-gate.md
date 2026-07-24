# Verifikations-Gate (`.pi/verify.json` → `/verify-gate`)

> Universelles, advisory Abschluss-Gate.
> Issue: [#102](https://github.com/daydaylx/pi/issues/102) — konsumiert die
> Projekt-Verifikationsprofile aus [#105](verify-profiles.md) und die
> Setup-Verifikation.

## Zweck

Bevor eine Aufgabe als erledigt gilt, soll derselbe verbindliche Prüfprozess
durchlaufen werden – unabhängig davon, ob direkt, über den Planmodus oder durch
einen Worker gearbeitet wurde. Das Gate bewertet **Auftrag + Diff + Scope +
Prüfergebnisse gemeinsam** und liefert einen strukturierten Abschlussbericht.

## Status: Advisory (MVP)

Dieses Gate ist **advisory**: es wird über `/verify-gate` aufgerufen und
**blockiert nicht** automatisch den bestehenden Abschluss (`/done`, `/finish`).
Hard-Enforcement im Completion-Pfad und echtes Scope-Drift (das den
Task-Contract [#106](https://github.com/daydaylx/pi/issues/106) voraussetzt)
sind bewusst als Folgeschritte vorgesehen, sobald das Engine bewährt ist.

## Aufruf

```
/verify-gate
```

Läuft nur im Idle-Zustand (nach Abschluss des laufenden Agent-Turns). Führt
real Prüfungen aus (Typecheck, Tests, ggf. Projekt-Profile) – die Laufzeit
entspricht der Prüfsumme.

## Was das Gate prüft

1. **Working-Tree-Diff** – `git status --porcelain` + `git diff --stat`.
2. **Setup-Verifikation** – `typecheck` und `test` aus `setup.json.verification`
   (unverletzlich, laufen immer im Agent-Verzeichnis).
3. **Projekt-Profile (#105)** – `.pi/verify.json`, **nur bei vertrautem Projekt**;
   siehe [`verify-profiles.md`](verify-profiles.md).
4. **Scope-Hinweise** – offensichtliches Rauschen (`node_modules`, Lockfiles,
   `.git/`) und „keine Änderungen" werden markiert (kein echtes Drift-Urteil
   ohne #106).
5. **Restrisiken** – nicht ausführbare Prüfungen (`missing_binary`), ungültige
   Profilkonfiguration.

## Gate-Status

| Status | Bedeutung | Empfehlung |
|---|---|---|
| `pass` | alle Pflichtprüfungen bestanden | Abschluss möglich; Restrisiken beachten |
| `blocked` | mind. eine Pflichtprüfung nicht ausführbar | Binary/Konfiguration prüfen |
| `fail` | mind. eine Pflichtprüfung fehlgeschlagen | Fehler beheben, erneut prüfen |

Optionale Prüfungen (`required: false`) erscheinen im Bericht, führen aber nicht
zu `fail`/`blocked`.

## Berichtsaufbau

```
Verifikations-Gate
Auftrag: <Task/Plan>
Status: PASS — 2/2 Pflichtprüfungen bestanden; 3 Working-Tree-Datei(en) geändert.

Geänderte Dateien (Working Tree):
   M src/a.ts
  A  docs/b.md

Prüfungen:
  [PASS] setup/typecheck [Pflicht] (4200ms)
  [PASS] setup/test [Pflicht] (18900ms)
  [PASS] project/pytest [Pflicht] (3100ms)

Scope-Hinweise:
  - potenzielles Rauschen im Diff: package-lock.json

Empfehlung: Abschluss möglich …
```

## Sicherheitsgarantien

- Keine freie Shell: alle Prüfungen laufen als `program + args[]` (Setup via
  `verify`-Tool-Pfad, Projekt via #105-Runner).
- Setup-Verifikation bleibt unverletzlich (Agent-Verzeichnis, von Projekten
  unbeeinflussbar).
- Projekt-Profile nur bei Vertrauen; unbekannte Schlüssel fail-closed.
- Diff wird nur gelesen (`git status`/`git diff`), nie mutiert.

## Abgrenzung / Folge-Schritte

- **Hard-Enforcement** in `/finish`: Status `fail`/`blocked` verweigert den
  Abschluss (Folge-Schritt).
- **Echtes Scope-Drift**: Vergleich geänderter Dateien gegen den deklarierten
  Datei-Scope aus dem Task-Contract (#106).
