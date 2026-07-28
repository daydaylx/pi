# 003 — CAS und atomare Schreibvorgänge bleiben

## Kontext

Beim Rückbau von Lease und Heartbeat lag die Frage nahe, ob auch die
Compare-and-Swap-Schreibvorgänge entfallen können — sie sind der aufwendigste
verbliebene Teil der Persistenz.

## Entscheidung

CAS bleibt, ebenso atomare Schreibvorgänge, sichere temporäre Dateien,
Pfad- und Symlink-Prüfung (`assertSafePath`), Dateigrößenlimits und sichere
Dateimodi.

## Begründung

CAS ist kein Rest der Lease-Architektur, sondern ihr Ersatz. Ohne CAS würde die
zweite Session den Sidecar der ersten überschreiben und der Fortschritt wäre
still verloren — genau der Datenverlust, den die Lease verhindern sollte.
Atomare Schreibvorgänge schützen zusätzlich gegen abgebrochene Prozesse.

## Konsequenzen

- Jeder Sidecar-Schreibvorgang führt einen erwarteten Token mit.
- `assertSafePath` bleibt die einzige Quelle für Pfad- und Symlink-Regeln;
  es gibt keine zweite Pfadprüfung.
- Ein CAS-Konflikt ist ein sichtbarer Fehler, kein stiller Fallback.
