# BUILD-001 — Vorhandenes `node_modules` wird nach Lockfile-Wechsel als passend markiert

## Priorität und Ziel

- **Priorität:** P2, mittel
- **Bereich:** Build, Dependencies, Verification
- **Ziel:** `project_check` darf nur Dependencies verwenden, deren Installation nachweisbar zum geprüften Lockfile und zur aktuellen Umgebung gehört.

## Betroffene Bereiche

- `extensions/setup-core/dependency-prepare.ts`
- `extensions/setup-core/index.ts`
- Dependency- und Verification-Tests

## Verbindliche Regeln

1. Die Existenz von `node_modules` ist kein Installationsnachweis.
2. Ein erfolgreicher Zustand muss mindestens Lockfile-Hash, Plattform, Architektur, Node-Version, Package-Manager und Installationsstatus referenzieren.
3. Hashwechsel darf nicht als erfolgte Installation verbucht werden.
4. Unbekannter Zustand ergibt `not_ready` oder `unknown`, niemals `ready`.
5. Neuinstallation erfolgt nur im dafür autorisierten Ausführungspfad.
6. Workspaces und gemeinsam genutzte Dependency-Verzeichnisse müssen explizit behandelt werden.

## Todos

- [ ] Format für eine Installations-Attestierung definieren.
- [ ] Lockfile-Hash und Umgebungsidentität erfassen.
- [ ] Erfolgreiche Installation erst nach tatsächlichem Exitcode und Validierung speichern.
- [ ] Vorhandenes, aber unbekanntes `node_modules` validieren oder als ungeprüft melden.
- [ ] Leeres, unvollständiges und veraltetes Verzeichnis testen.
- [ ] Lockfile-Wechsel und Branchwechsel testen.
- [ ] `project_check`-Ergebnis an die Dependency-Attestierung binden.

## Pflicht-Regressionstests

- Lockfile-Wechsel bei vorhandenem `node_modules`.
- Leeres `node_modules`-Verzeichnis.
- Falscher gespeicherter Lockfile-Hash.
- Erfolgreiche autorisierte Neuinstallation.
- Fehlgeschlagene Installation darf nicht `ready` liefern.
- Plattform-/Node-Wechsel mit gleichem Lockfile.

## Abnahmekriterien

- Der Auditfall wird nicht mehr als vorbereitet markiert, nur weil das Verzeichnis existiert.
- Alte Dependencies werden nach Lockfile-Wechsel nicht still verwendet.
- Ein gültiger Attestierungsnachweis erlaubt Wiederverwendung ohne unnötige Neuinstallation.
- Verification zeigt den verwendeten Dependency-Nachweis an.

## Abhängigkeiten

- TEST-001 für reproduzierbare Installationsfixtures.
- REC-001, weil Dependency-Installation eine mutierende Fähigkeit ist.

## Risiken

- Häufigere Neuinstallationen erhöhen Laufzeit und lokale Kosten.
- Monorepos und Workspace-Symlinks benötigen eine präzise Installationsdefinition.

## Erforderlicher Abschlussnachweis

PR mit Attestierungsformat, Lockfile-Wechsel-Test und Nachweis eines autorisierten Reinstall-/Reuse-Pfads.
