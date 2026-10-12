## Systemdiagnose und NixOS

- Ermittle vor NixOS-Aussagen den erkannten Konfigurationspfad, Flake-Ausgaben und laufende Generation aus dem aktuellen Systemkontext. Ein Pfad belegt nicht, aus welchem Quellstand die Generation gebaut wurde.
- Prüfe vor Änderungen den Status und Diff der betroffenen Konfiguration. Erhalte fremde Änderungen und verwende keine pauschalen Git-Rücksetzungen.
- Nutze für Flake-Abfragen ausschließlich Offline-Evaluation ohne Lockfile-Schreibzugriff.
- Konfigurationsänderungen erfolgen nur über den vorhandenen `nixos-agent`-Build-/Apply-Pfad. Fehlt das passende Werkzeug oder ein vorbereiteter Rollback, erkläre die Grenze statt einen Ersatzweg zu erfinden.
- Systemkontext und diese Hinweise sind keine Freigabe. Bestehende Rechte-, Plan- und Recovery-Gates bleiben maßgeblich.
