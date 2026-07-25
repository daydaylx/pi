---
name: lsp-navigation
description: "Nutze LSP-Tools (lsp_workspace_symbols, lsp_definition, lsp_references, lsp_hover, lsp_diagnostics) für semantische Code-Navigation, wenn bash/grep an Grenzen stößt. Verwende diesen Skill bei TypeScript-, Python- oder Rust-Projekten für Strukturerkundung, Definitionen, Referenzen und Typinformationen."
---

# LSP-Navigation

Nutze die verfügbaren LSP-Tools als semantische Ergänzung zu bash/grep, nicht
als Ersatz. Bash bleibt der primäre Weg für Textsuche, Dateioperationen und
Shell-Kommandos. LSP kommt dann zum Einsatz, wenn die Fragestellung echte
**Sprachsemantik** erfordert — Dinge, die grep strukturell nicht leisten kann.

## Wann LSP statt bash/grep?

| Situation | LSP-Tool | Nutzen gegenüber Textsuche |
|-----------|----------|----------------------------|
| Definition eines Symbols finden (nicht nur Texttreffer) | `lsp_definition` | Findet die echte Deklaration statt Treffern in Strings oder Kommentaren |
| Alle Verwendungen eines Symbols | `lsp_references` | Liefert semantische Referenzen statt bloßer Namensgleichheiten |
| Typ, Signatur, Dokumentation einer Funktion/Variable | `lsp_hover` | Liefert Typinformationen, die grep nicht ermitteln kann |
| Projektstruktur erkunden (Klassen, Funktionen) | `lsp_workspace_symbols` | Gibt einen semantischen Überblick über bekannte Symbole |
| Compiler-Fehler/Warnungen prüfen | `lsp_diagnostics` | Liefert Server-Diagnosen ohne vollständigen Build-Prozess |

## Wann NICHT LSP?

- Reine Textsuche („finde alle Stellen mit TODO") → `rg`
- Dateisuche nach Namen → `find` / `ls`
- Shell-Operationen → `bash`
- Wenn der LSP-Server nicht läuft oder kein Profil für die Sprache existiert → bash

## Workflow

1. **Erst LSP-Übersicht, dann gezielt lesen.** Beim Einstieg in ein unbekanntes
   Projekt: `lsp_workspace_symbols` mit einem relevanten Begriff → die
   Treffer zeigen Dir die Struktur und wichtige Dateien, bevor Du blind `read`
   auf Verdacht aufrufst.

2. **Vor Refactoring: Referenzen prüfen.** Bevor Du eine Funktion umbenennst
   oder verschiebst: `lsp_references` auf die Definition → Du siehst alle
   betroffenen Stellen, nicht nur Textmatches.

3. **Bei Typfragen: Hover statt Raten.** Wenn unklar ist, welchen Typ eine
   Variable hat oder welche Signatur eine Funktion: `lsp_hover` statt durch
   mehrere Dateien zu greppen.

4. **Nach Code-Änderungen: Diagnosen einholen.** Nach einem `edit`:
   `lsp_diagnostics` auf die geänderte Datei → sofortiges Feedback zu
   Compiler-Fehlern, ohne Build oder Testlauf.

## Einschränkungen

- **Position-Tools brauchen Zeile/Spalte.** `lsp_definition`, `lsp_references`
  und `lsp_hover` benötigen exakte Positionsangaben. Diese ergeben sich aus
  vorherigem `read` oder einem `lsp_workspace_symbols`-Ergebnis.
- **Server-Start kann dauern.** Der erste LSP-Call pro Sitzung startet den
  Server lazy. Folge-Calls sind schnell.
- **Nur aktivierte Profile.** TypeScript, Python und Rust sind standardmäßig
  aktiv. Andere Sprachen müssen erst in der Konfiguration freigeschaltet werden.
- **Read-only.** Alle LSP-Tools verändern keinen Code und sind in jedem
  Permission-Modus verfügbar — auch wenn bash blockiert ist.
