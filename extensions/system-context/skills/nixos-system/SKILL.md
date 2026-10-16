---
name: nixos-system
description: NixOS-Konfiguration prüfen oder ändern (Flake, Generationen, nixos-rebuild, nixos-agent, Module wie configuration.nix). Verwenden bei Fragen oder Änderungen an der NixOS-Konfiguration.
---

# NixOS-System

- Ermittle vor NixOS-Aussagen den erkannten Konfigurationspfad, Flake-Ausgaben und laufende Generation aus dem aktuellen Systemkontext. Ein Pfad belegt nicht, aus welchem Quellstand die Generation gebaut wurde.
- Prüfe vor Änderungen den Status und Diff der betroffenen Konfiguration. Erhalte fremde Änderungen und verwende keine pauschalen Git-Rücksetzungen.
- Nutze für Flake-Abfragen ausschließlich Offline-Evaluation ohne Lockfile-Schreibzugriff.
- Konfigurationsänderungen erfolgen nur über den vorhandenen `nixos-agent`-Build-/Apply-Pfad. Fehlt das passende Werkzeug oder ein vorbereiteter Rollback, erkläre die Grenze statt einen Ersatzweg zu erfinden.
- Quellcodeänderungen und Tests autorisieren keinen System-Switch; Aktivierung nur nach ausdrücklicher Freigabe.
- Dieser Skill ist keine Freigabe. Bestehende Rechte-Gates bleiben maßgeblich.
