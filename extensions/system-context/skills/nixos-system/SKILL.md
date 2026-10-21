---
name: nixos-system
description: NixOS-Konfiguration prüfen oder ändern (Flake, Generationen, nixos-rebuild, nixos-agent, Module wie configuration.nix). Verwenden bei Fragen oder Änderungen an der NixOS-Konfiguration.
---

# NixOS-System

- Unterscheide Informationsfrage, Untersuchung und beauftragte Änderung. Eine Optionsfrage verlangt keinen Audit; einen Untersuchungsauftrag führst du aktiv aus, auch als Anschlussfrage im Sitzungskontext.
- Ermittle Konfigurationspfad, Flake-Ausgaben und laufende Generation aus erreichbaren Quellen. Erfasse aktuellen Git-Status und relevante frühere Prüfberichte; prüfe Datum, Quellrevision und heutige Gültigkeit. Ein Pfad belegt nicht, aus welchem Quellstand die Generation gebaut wurde.
- Priorisiere konkrete Verdachtsmomente aus Auftrag und Befunden. Lies betroffene Module und Imports, prüfe bei Bedarf effektiv ausgewertete Optionen und vergleiche sie mit laufenden Diensten, Kernel oder begrenzten Journal-Ausschnitten. Verfolge wahrscheinliche Ursachen, solange weitere Prüfungen sinnvoll Erkenntnisse liefern. Eine erfolgreiche Evaluation oder ein Build beweist keine zweckmäßige Einstellung.
- Unterscheide Quellstand, letzten Build und laufende Generation. Werte wie git_dirty aus „Last build rec.“ beschreiben den Build-Zeitpunkt, nicht den aktuellen Arbeitsbaum. Vergleiche bei Widersprüchen Build-Record samt Zeitpunkt/Revision mit aktuellem git status und HEAD; ein historischer Dirty-Wert allein ist kein Fehler.
- Trenne bestätigte Befunde mit Quelle und Zeitpunkt, Hypothesen und nicht prüfbare Punkte. Fehlt ein Werkzeug oder Leserecht, nutze passende zulässige Alternativen; melde die verbleibende Einschränkung ohne einen gesunden Zustand zu erfinden.
- Prüfe vor Änderungen Status und Diff; erhalte fremde Änderungen. Nutze für Flake-Abfragen ausschließlich Offline-Evaluation ohne Lockfile-Schreibzugriff.
- Konfigurationsänderungen erfolgen nur über den vorhandenen nixos-agent-Build-/Apply-Pfad. Fehlt das passende Werkzeug oder ein vorbereiteter Rollback, erkläre die Grenze statt einen Ersatzweg zu erfinden. Quellcodeänderungen und Tests autorisieren keinen System-Switch; Aktivierung nur nach ausdrücklicher Freigabe. Eine Diagnose allein autorisiert keine Reparatur.
- Nach beauftragten Reparaturen prüfe den betroffenen Zustand erneut. Beende mit einem belegten Ergebnis und klaren Einschränkungen; ausführbare Folgeprüfungen nur vorzuschlagen schließt eine Untersuchung nicht ab. Dieser Skill verleiht keine Rechte.
