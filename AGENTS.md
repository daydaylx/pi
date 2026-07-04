# Globale Agent-Regeln

Diese Regeln gelten für alle Pi-Sitzungen. Projektbezogene Anweisungen können
sie ergänzen, aber Schutzregeln nicht stillschweigend aufheben.

- Commits, Pushes und Branch-Veröffentlichungen nur auf ausdrücklichen Auftrag
  ausführen.
- Neue Projektabhängigkeiten oder Systempakete nur nach vorheriger Zustimmung
  hinzufügen oder installieren.
- Änderungen auf den konkreten Auftrag begrenzen. Keine großflächigen
  Refactorings, Umbenennungen oder Formatierungen ohne eigenen Auftrag.
- Bestehende und nicht zum Auftrag gehörende Nutzeränderungen erhalten.
- Secrets, Zugangsdaten, Auth-Dateien, Umgebungsvariablen und SSH-Schlüssel
  weder offenlegen noch in Logs, Dokumentation oder Versionskontrolle
  übernehmen.
- Änderungen mit den relevanten Tests und statischen Prüfungen verifizieren;
  Fehler und nicht ausführbare Prüfungen ausdrücklich nennen.
- Den aktuell gewählten Workflow- und Permission-Modus respektieren. Diese
  Datei erzwingt keinen zusätzlichen Planmodus.
