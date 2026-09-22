# Diff Learning

Diff Learning ist eine optionale, lokale Pi-Extension zum Lesen echter
Codeänderungen. Sie verwendet die bereits vom `extensions/diff-viewer`
erfassten erfolgreichen `edit`-/`write`-Deltas und stellt nach einem stabil
beendeten Agentenlauf höchstens eine deterministische Multiple-Choice-Frage.

## Bedienung

```text
/learn-diff          Toggle
/learn-diff on       aktivieren
/learn-diff off      deaktivieren
/learn-diff stats    Lernprofil anzeigen
/learn-diff weak     schwache Konzepte anzeigen
/learn-diff review   aktivieren (Review-Modus)

Super+L              `/learn-diff`-Toggle
```

Der Lernmodus startet pro Session ausgeschaltet. `Super+L` schaltet ihn um;
der Slash-Command ist weiterhin jederzeit verfügbar.

Nach der Antwort wird eine Sicherheit abgefragt:

- `0` – geraten
- `1` – glaube ich
- `2` – ziemlich sicher
- `3` – weiß ich

Eine richtige Antwort mit niedriger Sicherheit zählt entsprechend schwach; eine
falsche Antwort mit hoher Sicherheit wird als mögliche Fehlvorstellung stärker
priorisiert. `Skip` speichert keinen Richtig-/Falsch-Wert und keine Confidence.

## Erfassung und Grenzen

- Quelle ist ausschließlich das Read-only-Event des bestehenden Diff-Viewers.
- Erfasst werden nur tatsächliche, erfolgreiche und isolierte `edit`-/`write`-
  Änderungen.
- Bash-Dateimutationen, Git-Snapshots, AST-Analyse, LLM-Fragen und Cloud-
  Synchronisierung gehören nicht zum MVP.
- Der Classifier ist absichtlich konservativ: Bei mehrdeutigen, großen,
  generierten, reinen Import-, Kommentar-, Formatierungs- oder Lockfile-
  Änderungen erscheint keine Frage.
- Fragen behaupten nur, was der gezeigte Hunk trägt; ein Test-Expectation-Diff
  beweist beispielsweise keine Produktcode-Reparatur.

## Persistenz und Datenschutz

Der Lernfortschritt liegt außerhalb des Repositories unter:

```text
<PI_CODING_AGENT_DIR>/diff-learning/progress.json
```

Die Datei enthält eine Schema-Version, Konzept-Scores und eine begrenzte Liste
minimaler Versuche. Vollständige Quelldateien oder vollständige Diffs werden
nicht gespeichert. Updates werden atomisch über eine temporäre Datei geschrieben
und erhalten nach Möglichkeit restriktive Dateirechte.

Eine beschädigte oder unbekannte Profilversion wird gemeldet und nicht still
überschrieben; die laufende Session verwendet dann ein leeres Profil. Zum
Zurücksetzen kann die Datei nach beendetem Pi-Prozess gelöscht werden.

## Deinstallation

`extensions/diff-learning/index.ts` aus der aktiven Extension-Allowlist in
`settings.json` entfernen und Pi neu laden. Die externe Profil-Datei kann danach
separat gelöscht werden.
