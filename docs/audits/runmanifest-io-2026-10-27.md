# M-19 — Runmanifest-I/O

**Projektstatus:** `BEWUSST_NICHT_UMGESETZT` (Spiegel der autoritativen Arbeitsordner-[INDEX.csv](/home/g/Downloads/Pi_PiSystem_Vereinfachung_Auftragsordner_2026-10-27/00_STEUERUNG/INDEX.csv)). Die Arbeitsordner-`INDEX.csv` bleibt gemäß Auftrag die einzige Statusquelle.
**Datum/Baseline:** 2026-10-27, `daydaylx/pi` HEAD `bc3b10c`; M-19 änderte keinen Produktcode.
**Wiederaufnahme:** reproduzierbares Profiling zeigt bei realistischen Langläufen relevante Hostblockade oder I/O-Kosten.

## Befund

`frontend-server/runs.mjs` serialisiert das ganze Runmanifest bei jeder Zustandsänderung atomar: temporäre Datei, `fsync` der Datei, `rename`, danach best-effort `fsync` des Verzeichnisses. Submit, Toolstart, Toolwirkung, Verifikation, Unknown-Reconciliation und Abschluss sind Recovery-relevante Daten. Öffentliche UI-Snapshots werden aus dem aktuellen Record erzeugt; ein separater persistierter reiner UI-Projektionspfad zum Bündeln wurde nicht gefunden.

Ein isolierter Lauf mit 200 abgeschlossenen Read-Toolaktionen erzeugte ein Manifest von 127.439 B. In der unbelasteten Messung dauerte ein Toolstart bei 127 KB 3,2 ms insgesamt, Toolabschluss 3,0 ms und Finalisierung 4,3 ms. Die beiden `fsync`-Aufrufe zusammen hatten bei 100 Toolstart-Persistierungen Median 2,2 ms, p95 3,5 ms, Maximum 8,5 ms. Damit ist kein relevanter Engpass belegt. Kritische Writes bleiben synchron und atomar; keine Projektion wurde gebündelt.

## Prüfungen

`node --test frontend-server/test/runs.test.mjs frontend-server/test/host.test.mjs`: **17/17 bestanden**. Enthalten sind RunStore-Crash-/Reconciliation, unbekannte Wirkung, verlorene/späte ACKs, Reconnect und Host-Restart. Es wurde kein Stromausfall zwischen den einzelnen `fsync`-/`rename`-Systemaufrufen injiziert; getestet wurden die vorhandenen API-/Host-Restartgrenzen.

- [Benchmarkskript](../evidence/runmanifest-io-benchmark-2026-10-27.mjs)
- [Unbelastetes Benchmarkprotokoll](../evidence/runmanifest-io-benchmark-2026-10-27.log)
- [RunStore-/Host-Testprotokoll](../evidence/runmanifest-io-tests-2026-10-27.log)
- [Vollständiges Maßnahmenprotokoll im Arbeitsordner](/home/g/Downloads/Pi_PiSystem_Vereinfachung_Auftragsordner_2026-10-27/MASSNAHMEN/19_runmanifest-io/03_ERGEBNIS.md)
