# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` im Repo-Root enthält die verbindlichen Agent-Regeln (Schutzregeln, Verifikation, Commit/Push, Subagenten) und gilt auch hier; nicht duplizieren, sondern lesen. Projektsprache ist Deutsch.

## Was das Repo ist

Konfigurations- und Extension-Repo für den Pi-Coding-Agent (`@earendil-works/pi-coding-agent`, extern gepinnt): Aurora-Terminal-UI, Berechtigungen, Plan Mode, LSP, Verifikation, Resilience, Subagenten-Harness. Wird per `npm run install:user -- --apply` nach `~/.pi/agent` synchronisiert (ohne `--apply` nur Dry-Run). Nach Runtime-Updates Patches gemäß `docs/RUNTIME_PATCHES.md` (`npm run patch:runtime`) prüfen.

Node 22.23.2 / npm 10.9.8 sind fest gepinnt (`.nvmrc`, `engines`). Abhängigkeiten liegen in `npm/` (nicht im Root); die Root-Scripts delegieren dorthin.

## Befehle

Aus dem Repo-Root (delegiert an `npm --prefix npm`) oder direkt in `npm/`:

- `npm run verify` – Gesamtprofil (format:check, lint, typecheck, deadcode/knip, test:coverage, test:patches, test:frontend-contracts, test:gui, audit:check). Für den kanonischen Nachweis im Agent-Ablauf stattdessen das Tool `project_check({ profile: "verify" })` nutzen (siehe `AGENTS.md`).
- `npm run typecheck`, `npm run lint`, `npm run format:check` (`format` schreibt), `npm run deadcode`
- `npm test` – Frontend-Contracts + `tests/run-all.mjs` (Suiten aus `tests/shared/run-suite-registry.mjs`)
- Einzelne Suite: `PI_TEST_SUITE=<runtime|ui|lsp|diff|…> node tests/run.mjs` (Namen: `RUN_MJS_SUITES` in der Registry); einzelne Testdatei: `node tests/<datei>.test.mjs` bzw. `node --test <datei>`
- `npm --prefix npm run test:frontend-contracts`, `test:patches`, `test:benchmark`, `test:runtime`
- GUI (Electron): `npm --prefix npm run test:gui`; in `gui/`: `npm start`, `npm run smoke`, einzelne Tests z. B. `node test/security.mjs`

Neue Testabschnitte in `tests/run.mjs` müssen in `SECTION_SUITES` der Registry einer Domäne zugeordnet werden, sonst laufen sie nicht korrekt in `npm test`.

## Architektur

```
Core-Runtime + extensions/ ──> neutraler Frontend-State-Bus ──> Aurora TUI (extensions/aurora-ui)
                          └──> extensions/frontend-bridge + frontend-server/ ──> JSONL Frontend API v1 ──> gui/ (Electron)
```

- `extensions/` – ein Verzeichnis/Datei je Fähigkeit (permissions, plan-mode, subagent, lsp, resilience, session-health, setup-core, verification …). Der Core-Zustand ist maßgeblich; Frontends halten nur flüchtigen Anzeigezustand und implementieren keine Permission-, Workflow-, Routing-, Verifikations- oder Session-Logik.
- `extensions/permissions/` – Tool-/Workflow-Policy, Trust-Grenzen, Verifier-Gate (`verifier-required-paths.ts` = Katalog der automatisch erkannten Hard-Verifier-Pfade).
- `extensions/plan-mode/` – Modi `work`/`simple_plan`/`detailed_plan`; Pläne nur über `plan_write` in die Runtime-Ablage (`~/.pi/agent/plans/…`), Ausführung nur per expliziter Freigabe (ADR 020).
- `npm/packages/frontend-protocol/` – öffentliches, separat packbares Protokoll-Paket (`@daydaylx/pi-frontend-protocol`); `frontend-server/` adaptiert den Upstream-RPC darauf. Änderungen hier berühren einen öffentlichen Vertrag (`docs/frontend-api.md`).
- `agents/` – Rollenprompts (investigator, debugger, verifier); temporäre Task-Agenten via `subagent` mit `spec` sind der Standardweg (ADR 031, `docs/subagents.md`).
- Projektlokale Prüfprofile: `.pi/verify.json` (nur in vertrauten Projekten, `docs/verify-profiles.md`).
- `settings.json`, `setup.json`, `models.json`, `schemas/`, `prompts/`, `skills/`, `APPEND_SYSTEM.md` sind die synchronisierte aktive Konfiguration.

**Achtung Scope:** `extensions/aurora-ui/` ist die Terminal-UI (CLI/TUI), nicht die Electron-GUI. Bei auf CLI/TUI oder GUI beschränkten Aufträgen nur die jeweilige Seite lesen – Pfadzuordnung in `docs/scope-cli-tui-vs-gui.md`.

## Dokumentation

Architekturentscheidungen: `docs/decisions/` (ADRs); Überblick `docs/architecture.md`; dauerhaftes Projektgedächtnis `docs/CONTEXT_LEDGER.md` und flüchtiger Stand `docs/PROJECT_STATE.md` werden nur über den Skill `context-checkpoint` gepflegt.
