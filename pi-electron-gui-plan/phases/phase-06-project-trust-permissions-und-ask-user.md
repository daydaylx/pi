# Phase 06 – Project Trust, Permissions und Ask User

## Ziel

Alle sicherheitsrelevanten Nutzerentscheidungen vollständig und ohne stilles Erlauben in der GUI abbilden.

## Aufgaben

1. Project-Trust-Status beim Projektstart darstellen.
2. Vorhandene Permission-Modi anbinden:
   - Read-only
   - Project-write
   - Confirm-all
   - YOLO nur nach expliziter Auswahl
3. Confirm-, Select-, Input- und Editor-Anfragen darstellen.
4. Timeouts und Abbruch behandeln.
5. mehrere aufeinanderfolgende Anfragen serialisieren oder eindeutig korrelieren.
6. Subagent-Anfragen dem verursachenden Agenten zuordnen.
7. Dialogschließen als Ablehnung beziehungsweise Abbruch behandeln.
8. Permission-Entscheidungen nicht im Renderer fachlich interpretieren.

## Sicherheitsregeln

- kein Default-Allow
- kein Allow bei Timeout
- kein Allow bei Fenster- oder Dialogschließen
- keine freie Shell aus dem Renderer
- Pfad- und Toolinformationen müssen verständlich, aber redigiert dargestellt werden

## Erforderliche Tests

- unbekanntes Projekt
- vertrauenswürdiges Projekt
- jeder Permission-Modus
- Allow und Deny
- Dialog schließen
- Timeout
- App-Schließen bei offenem Dialog
- zwei direkt aufeinanderfolgende Dialoge
- Anfrage eines Subagenten
- manipulierte Antwort-ID

## Abschlusskriterien

- [ ] Project Trust wird vor privilegierter Arbeit zuverlässig abgefragt.
- [ ] Alle vorhandenen Permission-Modi sind auswählbar und korrekt angebunden.
- [ ] Confirm, Select, Input und Editor funktionieren.
- [ ] Timeout, Escape, Dialogschließen und App-Schließen erlauben niemals still.
- [ ] Antworten sind eindeutig mit der ursprünglichen Anfrage korreliert.
- [ ] Manipulierte oder veraltete Antworten werden abgelehnt.
- [ ] Subagent-Anfragen zeigen ihre Herkunft.
- [ ] Der Renderer enthält keine eigene Permission-Entscheidungslogik.
- [ ] Sicherheits- und Integrationstests sind grün.

## Gate

Jeder ungeklärte Default-Allow-Pfad ist ein `NO-GO` und P0-Fehler.

