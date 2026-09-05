# P2 – Redundante Exploration

## Befund

Pi benötigte im zweiten Real-Duel deutlich mehr Toolcalls und Laufzeit als Codex,
bei vergleichbarer qualitativer Bewertung.

Das beweist noch keine ineffiziente Exploration, macht sie aber zu einer klaren
Hypothese, die anhand des Transkripts geprüft werden sollte.

## Arbeitsauftrag

Untersuche, ob Pi Informationen mehrfach beschafft, obwohl sie bereits im aktiven
Arbeitskontext vorhanden sind.

### Prüfen

- dieselbe Datei mehrfach vollständig gelesen
- dieselben Symbole mehrfach gesucht
- Repo-Struktur mehrfach erfasst
- Suchergebnisse nicht in spätere Entscheidungen übernommen
- Plan nach jeder kleinen Erkenntnis neu aufgebaut
- Verifikation mehrfach ohne Codeänderung dazwischen

### Zielbild

`Orientieren → relevante Bereiche sammeln → Hypothese → ändern → gezielt prüfen`

statt zyklischer Voll-Exploration.

### Umsetzung

Keine pauschalen Limits. Nur konkrete Wiederholungsmuster beseitigen.

### Abschlusskriterien

- Vorher/Nachher-Sequenzen dokumentiert.
- weniger redundante Reads/Searches.
- keine Verschlechterung bei Fehlerfindung.
