# Benchmark v3: Pi vs. Codex auf Harbor

Harte, kontaminationsarme Pi-vs-Codex-Benchmark-Suite auf Basis von
[Harbor](https://github.com/harbor-framework/harbor), primär auf
`encode/httpx` als reales Testrepository. Details, Architektur und
gestufter Ausführungsplan: siehe
`/home/d/.claude/plans/arbeitsauftrag-pi-vs-codex-benchmark-eager-sparkle.md`.

`benchmarks/` (P3–P6, ältere Generation) bleibt unverändert als historisches
Artefakt bestehen und wird von diesem Verzeichnis nicht berührt.

## Status: Teil A (Infrastruktur-Reparatur) abgeschlossen (2026-09-01)

Alle Gate-A-Bedingungen real gegen Container-Läufe verifiziert (nicht nur
statisch geprüft) — siehe `BENCHMARK_V3_FIXES.md` für den vollständigen
Changelog und `ENVIRONMENT_LOCK.md` / `TELEMETRY_SCHEMA.md` /
`SCORING_V3.md` / `KNOWN_LIMITATIONS.md` für die Detaildokumente.

Kurzfassung:

- Agent umbenannt: `pi-product-harness` (v3.0.0), Versionsmanifest
  (`MANIFEST.json`) im Tarball, Codex exakt auf `0.151.0` gepinnt, Node exakt
  auf `22.23.2`.
- Git funktioniert jetzt identisch für Pi UND Codex (war zuvor ein aktiver
  Bug: `fatal: not a git repository`).
- Pi läuft headless bei `project-write` + `--approve` ohne Rückfragen bei
  Test/Build/Typecheck/Lint/`project_check`/LSP/Git; ein kleiner,
  abgestimmter Produktcode-Patch (`extensions/permissions/tool-policy.ts`)
  war dafür nötig.
- Vollständiges Telemetrieschema (`postprocess/`): Laufzeitphasen,
  Token-/Kosten-Aufschlüsselung, Toolfehler-Klassifikation,
  Subagenten-Metadaten — für Pi live gegen echte Läufe verifiziert.
- 0–100-Scoring-Modell mit hartem Functional-Correctness-Gate, gegen
  bekannte Pass-/Fail-Referenzläufe verifiziert.

**Ein offener Punkt, an den Nutzer geflaggt** (`KNOWN_LIMITATIONS.md` #5):
echte Codex-`trajectory.json`-Dateien lassen sich innerhalb dieser
interaktiven Sitzung nicht zuverlässig einlesen (sandboxseitiger,
inhaltsbasierter Redaction-Filter beim Dateizugriff). Blockiert Gate A
nicht, muss aber vor Teil B entschieden werden.

## Nächster Schritt

Teil B (HTTPX-Snapshot: Repository klonen, Baseline-Commit einfrieren,
Docker-Snapshot bauen) — braucht eine eigene, neue Freigabe laut Plan
("harte Reihenfolge", kein automatischer Übergang).
