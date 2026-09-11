# Pi Audit-Remediation – optimiertes Arbeitspaket

Dieses Paket ist die gestraffte Fassung des Remediation-Auftrags für das Audit
`docs/PI_COMPLEXITY_ERROR_ANALYSIS.html` im Repository
`https://github.com/daydaylx/pi`.

## Bezug

- Referenz-HEAD des ursprünglichen Pakets: `e8196d60d95afead4aa0487f941deffa736e47a8`
- Audit-Commit: `e6db405b6cb3f17dc6f262375c5152a721c8cca6`
- vom Audit untersuchter Produktcode: `4563fad1937ed838a4824777d6c6a25298349f27`
- Auditumfang: 28 Befunde
  - 2× P0: F-01–F-02
  - 8× P1: F-03–F-10
  - 9× P2: F-11–F-19
  - 9× P3: F-20–F-28

Vor der Umsetzung muss der aktuelle HEAD erneut gegen diesen Stand geprüft
werden. Veraltete Zeilennummern oder bereits behobene Befunde dürfen nicht
blind übernommen werden.

## Was gegenüber dem ursprünglichen Paket geändert wurde

1. **Zwei echte Meilensteine statt eines einzigen großen Abschlussgates.**
   F-01–F-10 werden zuerst vollständig geschlossen. Danach ist die kritische
   Remediation eigenständig review- und mergefähig.
2. **P2/P3 sind vom P0/P1-Abschluss entkoppelt.** Cleanup oder ADR-Arbeit kann
   einen fertigen Sicherheitsfix nicht mehr unnötig blockieren.
3. **Weniger Vollprüfungen.** Fokussierte Tests pro Änderung; vollständiges
   `verify` nur an Baseline, Critical Checkpoint und Final bzw. nach einem
   wirklich risikoreichen Refactor.
4. **F-10 bewusst einfacher.** Kein langlebiger Snapshot-Cache über Toolaufrufe
   hinweg als Erstlösung. Zuerst nur redundante Berechnung im selben
   Kontrollpfad entfernen und messen.
5. **Snapshot-Streaming präzisiert.** Backpressure, Exit/Signal, stderr-Grenze,
   Fingerprint-Kompatibilität und instabile Workspaces werden ausdrücklich
   berücksichtigt.
6. **F-08 begrenzt.** Unterstützte Git-Kommandoformen werden definiert; kein
   eigener vollständiger Shellparser.
7. **Traceability-Matrix ist die einzige F-01–F-28-Statusquelle.** Der
   Statusbericht dupliziert diese Buchhaltung nicht.
8. **Commit-Regel gelockert.** Ein Commit pro unabhängig rückrollbarer
   fachlicher Änderung, nicht künstlich einer pro Audit-ID.
9. **Refactors sind nicht automatisch Erfolg.** Bei F-12/F-14/F-15/F-23/F-24
   ist Nicht-Ändern bzw. Aufschieben ausdrücklich zulässig, wenn es die
   einfachere und sicherere Lösung ist.
10. **Kein Stage-2-Neustart.** Benchmark- und Modellläufe bleiben vollständig
    außerhalb dieses Auftrags.

## Reihenfolge

1. `00_MASTER_ARBEITSAUFTRAG.md`
2. `01_PHASE_0_BASELINE.md`
3. `02_PHASE_1_CRITICAL_SNAPSHOT_GATES.md`
4. `03_PHASE_2_RESTLICHE_P1.md`
5. `04_CHECKPOINT_A_CRITICAL_DONE.md`
6. `05_PHASE_3_LOW_RISK_CLEANUP.md`
7. `06_PHASE_4_OPTIONALE_VEREINFACHUNG_ENTSCHEIDUNGEN.md`
8. `07_FINAL_ABNAHME.md`
9. `08_TRACEABILITY_MATRIX.md` – **Single Source of Truth für Auditstatus**
10. `09_STATUS_EVIDENZ.md` – kompakter Lauf-/Evidenzbericht
11. `CHANGELOG_OPTIMIERUNGEN.md`

## Abschlusslogik

### Meilenstein A – Critical Remediation

F-01 bis F-10 besitzen einen belastbaren Endstatus; kein bestätigter P0/P1 ist
`offen`, `blockiert` oder `deferred`. Vollständiges `verify` ist grün und bei
betroffenen geschützten Pfaden liegt ein gültiges Verifier-PASS vor.

### Meilenstein B – Gesamtpaket

F-11 bis F-28 sind ebenfalls klassifiziert. Für P2/P3 ist neben `behoben`,
`widerlegt` und `bewusst behalten` auch `deferred` zulässig, wenn Grund,
Rest-Risiko und konkreter Wiederaufnahme-Trigger dokumentiert sind.

Die kritische Remediation darf nicht von kosmetischem Cleanup abhängig gemacht
werden.
