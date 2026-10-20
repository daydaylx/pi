# 036 — `pis` arbeitet offen, nur Löschen und Risiken werden vorab bestätigt

## Status

Durch [ADR 042](042-pis-ohne-pi-seitige-blockaden.md) abgelöst. Die damalige
Risikoklassifikation bleibt als historische Implementierung und für
Kompatibilität erhalten; sie wird im aktiven `pis`-Profil nicht mehr zur
Freigabe oder Sperre verwendet.

## Entscheidung

Im Systemprofil gibt es auf `project-write`, `yolo`, `yolo-ask` und
`yolo-full` keine Trust-, Projekt-, Scope-, Symlink- oder Recovery-Sperren.
Eine kleine Heuristik (`extensions/permissions/system-open-policy.ts`) fragt
nur vor Löschen, Datenträger-/Rechte-/Dienstoperationen, Git-Verlust,
Paketentfernung, Secrets und Schreibzugriffen auf Systempfade. Alles andere
läuft ohne Rückfrage. Die Standardstufe einer frischen Systemsitzung ist
`project-write`, auch hinter dem Frontend-Host.

## Begründung

`pis` ist das persönliche Agenten-Werkzeug für das eigene System; der
Projekt-Trust-Begriff und der kanonische Workspace-Scope blockierten dort
gewöhnliche Arbeit ohne Gegenwert. Die Vorab-Bestätigung bleibt an den Stellen,
die nicht rückgängig zu machen sind.

## Konsequenzen

- Die Prüfung ist eine Heuristik, keine Sandbox: verschleierte Befehle
  (Skripte, Interpreter-Code) werden nicht erkannt. Die systemd-Sandbox des
  Hosts begrenzt weiterhin den Host-Prozess.
- `readonly`, `confirm-all` und `headless` bleiben unverändert streng.
- Das Recovery-Gate gilt im offenen Systemprofil nicht; Workspace-Änderungen
  werden dort nicht mehr nach einem fehlgeschlagenen Turn blockiert.
- Die Delegations-Vertragsprüfung (Verifier-Pflichtfelder, Spec-Grenzen)
  bleibt, weil sie die Form der Delegation prüft, kein Zielsystem schützt.
