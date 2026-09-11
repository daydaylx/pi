# Änderungsübersicht gegenüber dem ursprünglichen Arbeitspaket

## Struktur

- 8 operative Phasen-/Checkpoint-Dokumente statt der bisherigen, stärker
  überlappenden Phasenlogik.
- Critical Remediation F-01–F-10 klar von P2/P3 getrennt.
- Checkpoint A als eigenständig review-/mergefähiger Stand eingeführt.
- Traceability-Matrix zur einzigen Statusquelle gemacht.

## Test- und Verifierlast

- Vollständiges `verify` von zahlreichen Phasenenden auf Baseline,
  Checkpoint A und Final konzentriert.
- Zusätzliche Vollprüfung nur risikobasiert nach echtem Querschnittsrefactor.
- Verifier pro Commit nur bei geschützten Pfaden plus finaler Pflichtlauf falls
  relevant.
- Protocol/Frontend-Server nach F-07 nicht unnötig neben `verify` doppelt
  ausführen.

## Technische Präzisierungen

- F-01/F-02: Fingerprint-Fixtures vor Streaming-Umbau.
- Streaming: Backpressure, Exit/Signal, Timeout/Abort, stderr-Grenze,
  Deadlock-Vermeidung, deterministische Hashreihenfolge.
- Snapshotkonsistenz bei Mutation während Erfassung ergänzt.
- F-08 um Git-globalen Optionen ergänzt; eigener Shellparser ausdrücklich
  ausgeschlossen.
- F-09 von „eine Besitzerfunktion“ zu „eine autoritative Policy-Schicht“
  korrigiert.
- F-10: langlebigen Cross-Tool-Cache als Erstlösung ausgeschlossen.
- F-13: Legacy-Sunset/Migrationsende ergänzt.
- F-14: keine Architekturquelle vorab vorgeschrieben.
- F-17: Catch-Inventar begrenzt, um Scope Creep zu verhindern.
- F-23: Runtime-Upgrade erst nach Nachweis eines echten Pin-Konflikts.
- F-24: Standard auf deferred/bewusst behalten bis separater Housekeeping-
  Auftrag.

## Prozessvereinfachung

- Commitregel: fachlich unabhängig rückrollbar statt zwanghaft eine Audit-ID
  pro Commit.
- Phase 0 sammelt bei Entscheidungsbefunden nur Fakten; Optionen/ADR erst bei
  tatsächlicher Entscheidung.
- P2/P3 dürfen `deferred` werden, wenn Wiederaufnahme-Trigger dokumentiert ist.
