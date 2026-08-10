# Project State

## Aktuelle Arbeit

Pi-Harness-Audit und Arbeitsaufträge (August 2026) — umgesetzte Phasen:

- **P0 Installer / AP3**: `shared/` und die agentweite
  `subagent-tool-description.md` in Allowlist, `docs/archive/session-logs`
  ausgeschlossen. Beim Upgrade werden Legacy-Dateien (`planner.md`,
  `worker.md`, `reviewer.md`) sowie die frühere, den Fallback überschattende
  `.pi/subagent-tool-description.md` bereinigt. Greenfield- und
  Upgrade-Integrationstests statt Quelltext-Stringprüfungen; ein geöffnetes
  Projekt darf die Standardbeschreibung weiterhin gezielt übersteuern.
- **P0 Subagent-Sicherheit**: `runVerifyCommand()` im Fork von `shell: true`
  auf strukturiertes `program + args` umgestellt. `cwd`-Symlink-Escapes
  werden blockiert. Shell-Metazeichen führen zu fail-closed. Totes
  npm-Patch-Skript und zugehörige Tests entfernt.
- **P1 Thinking-Default**: `thinking-control.ts` leitet den Default jetzt vom
  Runtime-Default (`settings.json`) ab statt `"medium"` zu hardcoden.
- **P1 Pfadportabilität**: `EXTRA_READABLE_ROOTS` in `workflow-policy.ts`
  und `DEFAULT_RUNTIME_ROOT` in `apply-runtime-patches.mjs` dynamisch über
  `createRequire` aufgelöst. `AGENTS.md`-Pfad portabel formuliert.
- **P1 LSP**: Restart-Race behoben — `acquire()` erzeugt keinen zweiten
  Client während `starting`/`restarting`. Status-Events (`state`, `degraded`)
  live an Aurora gebunden. Start-Fehler werden korrekt an den Client
  delegiert, nicht durch Registry-Löschung verschwiegen.
- **P1 Verifikationsdiagnostik**: `passedProfileIds` als `Map<id, fingerprint>`
  statt `Set<id>`. `classifyCheckFailure` unterscheidet `flaky` (gleicher
  Fingerprint) von `introduced` (anderer Fingerprint). Exit-Code ≠ 0 wird
  als `"failed"` gemeldet, `"spawn_failed"` nur für echte Exec-Fehler.
- **P1 Diff-Viewer**: `/changes` in „Edit-/Write-Verlauf“ umbenannt,
  Leermeldung präzisiert. `docs/pi_agent_ux_konzept.md`: Subagenten-Kategorie
  und Footer-Korrekturen.

## Letzte Verifikation

- Typecheck und vollständige Harness-Tests sind nach AP3 grün.
- Der kanonische Verify-Lauf bleibt wegen einer fachfremden Aurora-Coverage-
  Abweichung rot: `extensions/aurora-ui/index.ts` erreicht 97,4 % statt der
  geforderten 100 %. Diese Datei ist nicht Teil des AP3-Diffs.

## Nächste Schritte

- Phase 8 (P2): Restkomplexität, Dokumentation und Knip-Regeln bereinigen.
