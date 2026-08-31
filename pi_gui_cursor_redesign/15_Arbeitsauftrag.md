# 15 – Arbeitsauftrag: Pi GUI Cursor-orientiert überarbeiten

## Auftrag

Überarbeite die bestehende Pi-GUI anhand der Dokumente in diesem Ordner.

Cursor dient als primäre Referenz für Informationsarchitektur und Task-/Agenten-UX. Es geht ausdrücklich **nicht** um eine 1:1-Kopie und nicht um den Bau einer IDE.

## Primärziel

Verwandle die bestehende Oberfläche von:

**Chat + permanente technische Statusleiste**

zu:

**Task Workspace + Activity + Changes + Verification + Review**

## Vorgehen

1. Lies zuerst vollständig:
   - `README.md`
   - `00_Ziel_Nichtziel_Annahmen.md`
   - `01_Cursor_Referenz_und_Designprinzipien.md`
   - `02_Zielarchitektur_und_Statusmodell.md`
   - `14_Umsetzungsregeln_fuer_Agent.md`

2. Analysiere danach das Repository und die aktuelle GUI.

3. Prüfe vor Änderungen:
   - relevante Architektur
   - aktuelle GUI-Komponenten
   - State Management
   - Agent-/Tool-Events
   - Verification-Daten
   - Changes-/Git-Daten
   - bestehende Shortcuts
   - Tests

4. Beginne erst danach mit **Phase 1**.

5. Arbeite exakt in der vorgegebenen Reihenfolge.

6. Nach jeder Phase:
   - Build/Test
   - Screenshot
   - Abschlussbericht
   - Abschlusskriterien einzeln prüfen

7. Nach **Phase 3** und **Phase 7** zwingend STOP und auf Freigabe warten.

## Wichtige Einschränkungen

- Core möglichst nicht umbauen.
- Keine zusätzlichen Features ohne Auftrag.
- Kein vollständiger Editor.
- Kein Terminal-Panel.
- Keine Cursor-Kopie.
- Keine zweite unabhängige State-Architektur.
- Keine kosmetische Großüberarbeitung vor Abschluss der funktionalen Struktur.

## Qualitätsmaßstab

Die neue Oberfläche muss auf einen Blick beantworten:

- Welche Aufgabe läuft?
- Was macht Pi?
- Was wurde geändert?
- Wird meine Entscheidung benötigt?
- Ist Verification erfolgreich?
- Kann ich reviewen oder abschließen?

## Erwartetes Ergebnis pro Phase

```text
PHASE X ABGESCHLOSSEN

Geänderte Dateien:
- ...

Umgesetzt:
- ...

Tests:
- Build: PASS/FAIL
- Tests: PASS/FAIL
- Manuell: PASS/FAIL

Abschlusskriterien:
- [x] ...
- [x] ...

Risiken:
- ...

Offen:
- ...

Screenshot:
- ...

Nächster Schritt:
STOP / Phase X+1
```

Bei einem harten Gate darf `Nächster Schritt` ausschließlich `STOP – Freigabe erforderlich` sein.

Schwierigkeiten: 8/10 | Thinking: xhigh
