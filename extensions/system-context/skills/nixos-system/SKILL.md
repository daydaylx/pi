---
name: nixos-system
description: NixOS-Konfiguration prüfen oder ändern (Flake, Generationen, nixos-rebuild, nixos-agent, Module wie configuration.nix). Verwenden bei Fragen oder Änderungen an der NixOS-Konfiguration.
---

# NixOS-System

- Unterscheide Informationsfrage, Untersuchung und ausdrücklich lesenden Auftrag. Eine Optionsfrage verlangt keinen Audit. Bei einem Untersuchungs- oder Prüfauftrag behebst du bestätigte, im Umfang liegende Konfigurationsfehler selbst, wenn die Korrektur risikoarm und autorisiert ist; Anschlussfragen führen den Sitzungskontext fort.
- Ermittle Konfigurationspfad, Flake-Ausgaben und laufende Generation. Prüfe Git-Status sowie Datum und Revision älterer Prüfberichte; ein Pfad belegt nicht den Quellstand der laufenden Generation.
- Priorisiere konkrete Verdachtsmomente. Prüfe betroffene Module, Imports und bei Bedarf effektiv ausgewertete Optionen; vergleiche diese mit Diensten, Kernel und begrenzten Logs. Ein erfolgreicher Build beweist keine zweckmäßige Einstellung.
- Build-Records und Werte wie git_dirty sind Momentaufnahmen, kein aktueller Git-Status. Vergleiche bei Widersprüchen Zeitpunkt und Revision mit aktuellem git status und HEAD.
- Belege Befunde mit Quelle und Zeitpunkt. Trenne sie von Hypothesen und unprüfbaren Punkten; nutze zulässige Alternativen und benenne verbleibende Einschränkungen.
- Prüfe vor Änderungen Status und Diff; erhalte fremde Änderungen. Nutze für Flake-Abfragen ausschließlich Offline-Evaluation ohne Lockfile-Schreibzugriff.
- Bewahre belegte Hardware-Workarounds; entferne sie erst nach Ursachen- und Folgenprüfung.
- Änderungen laufen ausschließlich über nixos-agent build/apply. Ohne passendes Werkzeug oder Rollback ändere nichts. Lesende Aufträge erlauben keine Änderung; riskante Aktivierung braucht eine klare Nutzerfreigabe. Dieser Skill verleiht keine Rechte.
- Baue Reparaturen, aktiviere nur autorisiert und prüfe danach den echten Zustand. Untersuche Fehlschläge; nutze eine zulässige Alternative oder rolle die eigene Änderung zurück. Bloße Vorschläge ersetzen keine ausführbare Reparatur.
