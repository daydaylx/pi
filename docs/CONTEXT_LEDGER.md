# Context Ledger — agent

## Bestätigte Entscheidungen

- Aurora Night bleibt die aktive UI; die normalen Permission-Level und
  Trust-Grenzen bleiben erhalten.
- Der Planmodus besitzt nur `work`, `simple_plan` und `detailed_plan`. Der
  ausgewählte Modus gilt nur für die laufende Sitzung.
- `.agent/plans/current-plan.md` ist unverbindlicher Markdown-Kontext, kein
  Snapshot-Vertrag. Alte Workflowartefakte werden ignoriert.
- Planmodus-Mutationen außerhalb der Plan-Datei fragen gezielt nach Freigabe.
  Dauerhafte Freigaben sind eng, projektbezogen voreingestellt und getrennt
  von Projekt- und Workflowdaten gespeichert.
- LSP und normale Verifikationswerkzeuge bleiben eigenständige Funktionen,
  aber keine Abschlussbedingung.
- Keine Abhängigkeiten, Commits, Pushes oder Veröffentlichungen ohne
  ausdrücklichen Nutzerauftrag.
