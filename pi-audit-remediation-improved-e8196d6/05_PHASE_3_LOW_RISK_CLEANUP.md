# Phase 3 – Low-Risk Tests, Diagnose und Dokumentation

## Scope

F-16, F-17, F-20, F-21, F-22, F-25, F-26, F-27, F-28.

Diese Phase soll keine neue Architektur erzeugen.

## 3.1 – F-16 Shortcut-Parität

Alle tatsächlichen Shortcut-Quellen inventarisieren und Parität in beide
Richtungen prüfen. Doppelte IDs, fehlende Zuordnungen und abweichende Modifier
müssen verständlich fehlschlagen.

**Nicht ändern:** Tasten, Shift+Tab, Menüs, Bedienlogik.

## 3.2 – F-17 stille Catches mit begrenztem Scope

Nicht repositoryweit blind alle `catch`-Blöcke refactoren.

Reihenfolge:

1. Audit-genannte Dateien/Bereiche;
2. Kontrollpfade, die durch F-01–F-10 geändert wurden;
3. repositoryweit nur dann erweitern, wenn konkrete Evidenz ein systematisches
   Muster zeigt.

Klassifizieren in Sicherheitsgate, Zustandsverlust, Nutzeraktion, optionale
Komfortfunktion, erwartbarer Probe-Fehler. Nur sicherheits-/zustandsrelevante
Catches sichtbar/strukturiert machen. Keine Log-Flut.

## 3.3 – F-20 Planmodus-Dokumentation

README gegen reale Allowlist/Guards aktualisieren. Werkzeug-Allowlist,
Bash-Einschränkungen, Webzugriffe und Prüfprofile sauber trennen. Umsetzung
nicht an veraltete Doku zurückbauen.

## 3.4 – F-21/F-22/F-26 Text-/Doku-Korrekturen bündeln

Ein gemeinsamer, reversibler Doku/Testtext-Commit ist zulässig:

- `PROJECT_STATE.md` auf aktuellen Arbeitsstrang/Base-SHA;
- Kommentar `session_compact_failed` auf reale Runtimequelle;
- Assertion-Beschreibung in `target-config.mjs` an tatsächlich geprüften Wert
  anpassen, ohne Erwartungswert nebenbei zu ändern.

## 3.5 – F-25 Test-/Skripteinordnung

Für genannte Tests/Skripte echte Aufrufer suchen und jeweils genau eine Rolle
festlegen:

- Pflichtprofil;
- optionale lokale Integration;
- manueller Smoke;
- obsolet.

GUI-Smokes mit Electron/Display nicht blind in headless CI hängen. Obsolete
Einstiege nur entfernen, wenn keine versionierten Aufrufer existieren.

## 3.6 – F-27 Session-Mismatch bedingt behandeln

Ergebnis aus Phase 0 verwenden:

- erreichbar => sichtbarer Hinweis + Zustandstest;
- unerreichbar => keinen neuen Benachrichtigungscode erfinden; Zweig entweder
  mit Beleg entfernen oder als defensive Invariante getestet/kommentiert
  behalten.

## 3.7 – F-28 npm-audit bewusst platzieren

Mindestens einmal im CI-Pflichtpfad erhalten. Doppelung nur behalten, wenn sie
einen dokumentierten Fail-fast-Zweck hat. Kein Sicherheitscheck vollständig
entfernen.

## Phase-3-Abnahme

- jede Scope-ID besitzt Endstatus/Evidenz in der Matrix;
- fokussierte Tests grün;
- kein automatisches Voll-`verify` allein wegen des Phasenendes nötig;
- Verifier nur bei geschützten Pfaden;
- keine Benchmarkdaten/Shortcuts verändert;
- Arbeitsbaum sauber.
