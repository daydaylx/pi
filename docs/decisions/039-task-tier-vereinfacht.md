# 039 — Task-Tier auf Duplicate-Read-Guard und Telemetrie vereinfacht

## Status

Angenommen, 2026-10-16. Ersetzt von 033 die Klassifikation FAST/NORMAL/DEEP samt
Prompt-Zusatz, Thinking-Automatik, Ausblenden der Subagenten-Tools, FAST-Sperre
für Subagenten/Verifier und Eskalation. Der Duplicate-Read-Guard und die
Telemetrie aus 033 gelten weiter.

## Entscheidung

`extensions/task-tier/` blockiert nur noch einen `read`, dessen Bereich bereits
unverändert im Kontext steht, und schreibt pro Lauf den Eintrag `task-tier.turn`
(`schemaVersion` 2: Aufrufzähler, Tokens, Cache-Verluste, Dauer; keine
Klassenfelder). Thinking, Subagenten und Verifier regeln Nutzerwahl und
Permission-Schicht allein. `classify.ts` und `shared/auto-thinking.ts` entfallen.

## Begründung (Befund Phase A, 2026-10-16)

- Die Klassifikation sah nur den Nutzertext. Ein Symptom-Prompt und „Go: setze
  Maßnahme M1 um.“ wurden FAST mit Thinking `low`, obwohl Ursachensuche bzw.
  eine größere Umsetzung folgte. 14 von 62 anfangs als FAST eingestuften Turns
  mussten später eskalieren; in 43 von 48 FAST-Turns stand `thinking=low`
  gegen den Default `high`.
- Keine Sicherheitsgarantie hing am Tier: Verifier-Need-Gate und Commit-Gate
  entscheiden unabhängig. Die FAST-Sperre und `RELEASE_PATTERN` existierten
  vor allem, um dem eigenen Verifier-Gate auszuweichen.
- Die Thinking-Stufe wurde still pro Turn überschrieben. Sie bleibt jetzt, wie
  der Nutzer sie setzt (`/thinking`).
- Einziger nachweislich aktiver Nutzen: Duplicate-Read-Guard (42 Blockaden in
  17 von 225 Turns).
- Für Subagent-Tool-Schemas (ca. 2 k Token je Request laut 033) liegt keine
  Messung vor; sie bleiben in jedem Turn aktiv.

## Rückbau und Prüfkriterium

Zeigen Telemetrie und Sessions nach zwei Wochen keinen Guard-Block mit
anschließendem Mehraufwand (Wiederholung desselben Reads, Abbruch), wird die
Extension ganz entfernt: Eintrag `+extensions/task-tier/index.ts` aus
`settings.json` und `knip.json` streichen, die Erwartungslisten in
`tests/suites/runtime/target-config.mjs`, `tests/suites/runtime/resilience.mjs`
und `tests/coverage-baseline.json` anpassen.
