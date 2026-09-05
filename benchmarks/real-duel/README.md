# real-duel — Pi vs. Codex, reale lokale Setups (Modus A)

Vergleicht das **tatsaechlich lokal genutzte** Pi-Setup gegen das
**tatsaechlich lokal genutzte** Codex-Setup auf echten Entwicklungsaufgaben.
Keine kuenstliche Symmetrie, keine Home-Isolation, keine abgeschalteten
Extensions/Hooks/Instructions — beide Tools laufen mit ihrer echten globalen
Konfiguration.

Das ist **Modus A** ("real-duel"). **Modus B** ("controlled-benchmark",
Docker/Harbor-basiert, isolierte Container, gepinnte Versionen) beantwortet
eine andere Frage und ist vollstaendig archiviert unter Tag
`benchmark-legacy-v1-v3-2026-09-04` / Branch `archive/legacy-benchmarks` —
siehe [`../../docs/benchmark-history.md`](../../docs/benchmark-history.md)
fuer die Legacy-Zusammenfassung und
[`../../docs/benchmark-archive-audit.md`](../../docs/benchmark-archive-audit.md)
fuer das vollstaendige Archivierungsprotokoll. Dieses README dupliziert
beide Dokumente nicht. Remote-Verifikation (Tag/Branch auf `origin`
erreichbar, per frischem Clone getestet): siehe
[`REAL_DUEL_AUDIT.md`](REAL_DUEL_AUDIT.md#9-remote-archiv-verifikation-nachtrag-2026-09-04).

## Inhalt

- [`REAL_DUEL_AUDIT.md`](REAL_DUEL_AUDIT.md) — Phase-0-Audit: wie Pi/Codex
  real gestartet werden, welche Artefakte aus dem Archiv wiederverwendet
  werden, bekannte Risiken.
- [`OPENBENCH_LOCK`](OPENBENCH_LOCK) — gepinnter OpenBench-Commit +
  Installationsanleitung (separater Checkout, nicht im Repo).
- `candidates/{pi-real,codex-real}.toml` — OpenBench-BYO-Candidate-Manifeste
  mit den exakten, verifizierten realen CLI-Aufrufen.
- `tasks/smoke-01-marker-file/` — trivialer Plumbing-Test (Phase 1).
- `scripts/pi-duel` — duenner Wrapper: Worktree-Erzeugung +
  Wiederverwendung von OpenBenchs `ManifestHarness.run()`/`run_checker()` +
  `obench doctor`/`gate`/`report`. Siehe Docstring fuer den Grund, warum
  `obench run` selbst hier nicht direkt genutzt wird (Git-Worktree- vs.
  `.git`-loser-Tempdir-Konflikt).
- `scripts/fingerprint.sh` — Base-SHA/Dirty-State/Versionen vor einem Lauf.

## Setup (einmalig)

```bash
mkdir -p ~/.local/share/real-duel
git clone https://github.com/minghinmatthewlam/openbench.git ~/.local/share/real-duel/openbench
cd ~/.local/share/real-duel/openbench
git checkout ee71845c2898a98b8e3f2810cba8a1389f72c27e   # siehe OPENBENCH_LOCK
uv venv -q && uv pip install -q -e .
```

## Benutzung

```bash
benchmarks/real-duel/scripts/pi-duel doctor    # Preflight (CLI/Auth/Version)
benchmarks/real-duel/scripts/pi-duel gate      # obench gate (Ablehnung erwartet, siehe Kommentare in den TOMLs)
benchmarks/real-duel/scripts/pi-duel smoke     # Phase-1-Plumbing-Test
benchmarks/real-duel/scripts/pi-duel report    # Ergebnisuebersicht
benchmarks/real-duel/scripts/pi-duel cleanup <run-id>   # Worktrees entfernen
```

Laufdaten (Worktrees, `results.jsonl`, Transkripte, Fingerprints) liegen
bewusst **ausserhalb** des Repos unter `~/.local/state/real-duel/` — nichts
davon wird committet.

## Status

Phase 0 (Audit) und Phase 1 (Smoke-Duel) sind umgesetzt. Phase 2
(Telemetrie-Normalisierung, v3-Schema-Wiederverwendung), Phase 3 (erste
echte Aufgabe), Phase 4 (Blind-Review) und Phase 5 (Vereinfachung) sind
noch offen — siehe Roadmap in
`/home/d/.claude/plans/arbeitsauftrag-real-task-duel-reactive-sloth.md`.
