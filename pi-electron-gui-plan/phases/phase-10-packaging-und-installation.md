# Phase 10 – Packaging und Installation

## Ziel

Einen reproduzierbaren, installierbaren GUI-Build erzeugen, ohne die Unabhängigkeit der TUI oder die Pi-Versionsparität zu verlieren.

## Aufgaben

1. Workspace- und Paketstruktur für GUI festlegen.
2. Electron-, Main-, Preload- und Renderer-Artefakte reproduzierbar bauen.
3. sicherstellen, dass nur eine kompatible Pi-Runtime verwendet wird.
4. dynamische Extensions, Themes und Projektressourcen außerhalb problematischer ASAR-Grenzen behandeln.
5. GUI-Fehlerfall bei fehlenden Assets sauber behandeln.
6. Linux-Paket und Startpfad erstellen.
7. saubere Installation ohne bestehende Entwicklungsumgebung testen.
8. Deinstallation und Updatepfad dokumentieren.
9. Windows- und macOS-Pfade vorbereiten, aber Linux zuerst abschließen.
10. Lizenzen und gebündelte Abhängigkeiten prüfen.

## Packaging-Regeln

- TUI darf nicht vom erfolgreichen Electron-Start abhängen.
- Keine zweite abweichende Pi-Version im Bundle.
- Keine Secrets oder lokale Auth-Dateien im Paket.
- Extensions müssen aus den vorgesehenen Benutzer- und Projektpfaden geladen werden.
- Release-Build darf keinen Entwicklungsserver benötigen.

## Erforderliche Tests

- Clean Build
- wiederholter Build
- Installation auf sauberer Linux-Umgebung
- `pi`
- `pi gui`
- fehlende GUI-Assets
- Extension aus Benutzerpfad
- Extension aus Projektpfad
- Session und Auth nach Update
- Deinstallation ohne Löschen von Nutzerdaten

## Abschlusskriterien

- [ ] Linux-Release-Build ist reproduzierbar.
- [ ] `pi` funktioniert unabhängig vom GUI-Paket und dessen Zustand.
- [ ] `pi gui` findet seine gebündelten Assets zuverlässig.
- [ ] Bundle enthält keine zweite abweichende Pi-Runtime.
- [ ] Dynamische Extensions und Projektressourcen funktionieren im Release-Build.
- [ ] Keine Credentials oder lokalen Nutzerdaten befinden sich im Artefakt.
- [ ] Installation, Update und Deinstallation sind dokumentiert und getestet.
- [ ] Release-Build benötigt keinen Vite- oder Entwicklungsserver.
- [ ] Lizenzprüfung ist abgeschlossen.

## Gate

`NO-GO`, wenn nur der Entwicklungsmodus funktioniert oder die TUI durch ein defektes GUI-Paket unbrauchbar wird.

