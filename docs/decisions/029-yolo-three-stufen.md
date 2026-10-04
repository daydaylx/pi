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

| Stufe | Level (`/permission`) | `/yolo` | Verhalten an einer harten Grenze                                  |
| ----- | --------------------- | ------- | ----------------------------------------------------------------- |
| 1     | `yolo`                | `1`     | blockiert (unverändert)                                           |
| 2     | `yolo-ask`            | `2`     | Rückfrage mit Gefahr-Dialog                                       |
| 3     | `yolo-full`           | `3`     | erlaubt, auch sudo, Secrets, Partitionen und destruktive Aktionen |

„Harte Grenze" meint: Secrets/Credentials, Schreibzugriffe außerhalb des
Projekts und Symlink-Escapes bei Mutationen, Systempfad-Schreibzugriffe, sudo/su,
System-Paketmanager, Download-to-shell, opake Interpreter, externe Shell-
Schreibzugriffe, unquotierte Shell-Variablen sowie Schreibzugriffe auf
Ausführungspfade (`.git/`, `.pi/lsp.json`, `.pi/verify.json`). YOLO 3 gibt
alle diese Aktionen ohne Rückfrage frei.

Ohne Grenzberührung verhalten sich alle drei Stufen bei der Permission-Policy
gleich: keine Rückfragen, keine Commit-Verifier-Pflicht, unbekannte Tools
werden nach der bestehenden YOLO-Policy behandelt. YOLO 3 übergeht zusätzlich
Trust-, Recovery- und Planmodus-Sperren. `/yolo` ohne
Argument schaltet wie bisher Stufe 1 um; `/yolo 2` und `/yolo 3` wechseln
direkt in die Stufe, dieselbe Stufe erneut oder `/yolo off` schaltet YOLO aus.
`Super+Y` bleibt bei Stufe 1.

## Grenzen außerhalb der Permission-Policy

- **OS-Rechte:** YOLO 3 hebt Pi-interne Permission-Sperren auf, kann dem
  Prozess aber keine Betriebssystemrechte verleihen. `sudo` benötigt eine
  passende sudo-Konfiguration oder ein gültiges Ticket; ohne Root-Rechte kann
  der Prozess Partitionen und geschützte Systempfade weiterhin nicht ändern.
- **Web-Eingabegrenze:** `fetch_content` nur `http(s)` ohne Zugangsdaten in
  der URL.
- **Tool-Verträge:** Spezifische Prüf- und Web-Tools behalten ihre eigenen
  Eingabe- und Vertragsprüfungen.

## Begründung

Die Stufen sind eine Verschiebung der einen Frage „was passiert an einer
harten Grenze" (blockieren, fragen, erlauben) und keine drei getrennten
Regelwerke. Dadurch teilen sich alle drei Stufen den Pfad der Routine-Fälle,
und ein Fehler in einer Grenze wirkt nicht stufenweise unterschiedlich.
Stufe 3 ist bewusst ein Vollzugriff auf Wunsch des Nutzers; die Restrisiken
(Secrets landen im Modellkontext, destruktive System- und Partitionsänderungen
laufen ohne Rückfrage) sind akzeptiert und über den Statusbadge
`⚠ YOLO 3 · VOLLZUGRIFF` jederzeit sichtbar.

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
