# 029 — YOLO in drei Stufen

## Kontext

YOLO war ein einziger Schalter: keine Rückfragen im Projekt, aber harte
Sperren für sudo, Paketmanager, Secrets, Pfade außerhalb des Projekts, opake
Interpreter und Ausführungspfade. Wer mehr brauchte — ein `sudo`-Befehl, ein
Blick in `~/.config`, ein `apt install` — musste YOLO verlassen und jede
Aktion einzeln in `project-write` bestätigen. Es fehlte die Zwischenstufe
„mehr Zugriff, aber mit Erlaubnis" und eine Stufe ohne jede Sperre.

## Entscheidung

YOLO bekommt drei Stufen. Alle sind temporär, werden nie persistiert (ein
gespeichertes YOLO fällt beim Sitzungsstart auf `project-write` zurück) und
sind über `/permission` oder `/yolo` wählbar.

| Stufe | Level (`/permission`) | `/yolo` | Verhalten an einer harten Grenze |
| ----- | --------------------- | ------- | -------------------------------- |
| 1     | `yolo`                | `1`     | blockiert (unverändert)          |
| 2     | `yolo-ask`            | `2`     | Rückfrage mit Gefahr-Dialog      |
| 3     | `yolo-full`           | `3`     | erlaubt, auch sudo und Secrets   |

„Harte Grenze" meint: Secrets/Credentials, Pfade außerhalb des Projekts und
Symlink-Escapes, Systempfad-Schreibzugriffe, sudo/su, System-Paketmanager,
Download-to-shell, opake Interpreter, externe Shell-Schreibzugriffe,
unquotierte Shell-Variablen sowie Schreibzugriffe auf Ausführungspfade
(`.git/`, `.pi/lsp.json`, `.pi/verify.json`).

Ohne Grenzberührung verhalten sich alle drei Stufen gleich: keine
Rückfragen, kein Recovery-Gate, keine Commit-Verifier-Pflicht, unbekannte
Tools erlaubt. `/yolo` ohne Argument schaltet wie bisher Stufe 1 um; `/yolo 2`
und `/yolo 3` wechseln direkt in die Stufe, dieselbe Stufe erneut oder
`/yolo off` schaltet YOLO aus. `Super+Y` bleibt bei Stufe 1.

## Was auch Stufe 3 nicht aufhebt

- **Trust-Grenze:** In nicht vertrauenswürdigen Projekten bleiben mutierende
  und externe Tools blockiert.
- **Plan-Mode-Schreibschutz (ADR 012/016):** Der Planmodus bleibt auf jeder
  Stufe eine harte Schreibgrenze für Agenten-Tool-Aufrufe.
- **sudo im `bash`-Tool:** läuft nur mit passwortlosem sudo (NOPASSWD) oder
  gültigem Ticket; Passwörter laufen nie über eine Kommandozeile des Modells.
- **Web-Eingabegrenze:** `fetch_content` nur `http(s)` ohne Zugangsdaten in
  der URL.
- **Root-Wipe:** `rm -rf /` verlangt auch in Stufe 3 eine Bestätigung — die
  einzige Ausnahme, weil dort kein legitimer Workflow verloren geht.

## Begründung

Die Stufen sind eine Verschiebung der einen Frage „was passiert an einer
harten Grenze" (blockieren, fragen, erlauben) und keine drei getrennten
Regelwerke. Dadurch teilen sich alle drei Stufen den Pfad der Routine-Fälle,
und ein Fehler in einer Grenze wirkt nicht stufenweise unterschiedlich.
Stufe 3 ist bewusst ein Vollzugriff auf Wunsch des Nutzers; die Restrisiken
(Secrets landen im Modellkontext, sudo ohne Rückfrage) sind akzeptiert und
über den Statusbadge `⚠ YOLO 3 · VOLLZUGRIFF` jederzeit sichtbar.

## Konsequenzen

- `PermissionLevel` kennt `yolo-ask` und `yolo-full`; jede Prüfung „ist
  YOLO" läuft über `isYoloLevel`, nicht über `=== "yolo"`.
- Die GUI-Frontend-Schnittstelle (`permission.set`) kennt weiterhin nur die
  alten vier Stufen; die neuen Stufen sind über `/yolo 2|3` erreichbar.
- Stufe 2 fragt bei opaken Interpretern (`node -e`, `python -c`) und
  unquotierten Variablen häufig nach — das ist der Preis der Zwischenstufe.

## Alternativen

- **Nur Stufe 3 als Schalter ohne Zwischenstufe:** verworfen, weil dann der
  häufigste Bedarf („einmal sudo, einmal ~/.config lesen") entweder alles
  freigibt oder gar nichts.
- **Stufe 3 mit Bestätigungsdialog beim Aktivieren:** nicht umgesetzt; die
  Aktivierung ist eine bewusste Eingabe und der Badge bleibt sichtbar.
