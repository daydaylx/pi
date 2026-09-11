# Provenienz-Baseline ab dem aktuellen Remediation-Stand

Diese Datei setzt eine **neue** Einzeldatei-Baseline für künftige
Fortsetzungen. Sie schließt die historische Lücke nicht rückwirkend: Für die
bereits vor Beginn der ursprünglichen Remediation schmutzigen Dateien liegen
die damaligen Einzelinhalte weiterhin nicht vor.

## Erfassung

- Referenz-HEAD: `02d6f729c350072c13a81d9e2d3ba6f7bae8c2a7`
- Workspace-Fingerprint bei Erfassung: `a37aa0ba62026c542422071ac346a41c62c8f3ee13a6663b42809e3be4320d25`
- Hashverfahren: SHA-256 über den aktuellen Dateiinhalt (`sha256sum`)
- Zweck: Vor jeder weiteren Änderung an einem gelisteten Pfad den Hash gegen
  diese Baseline vergleichen und die Abweichung einer konkreten Änderung
  zuordnen.

## Einzel-Fingerprints

| Pfad | SHA-256 |
| --- | --- |
| `docs/decisions/README.md` | `38819bcd705d04b4eaec72ec9b8265c031f0eaf9358c9beeaac7a4e0c5cb30b6` |
| `docs/decisions/022-project-write-interpreter-boundary.md` | `8f103a973ec2084cb701c0fbb5cb04a2dc44c1d1a7b4dadf94cf0ce94c3a71c3` |
| `extensions/permissions/guards.ts` | `a8d9858e91e1e4655791a127eab7dbaaf7b0c828286b0f6a7816d686426a03ef` |
| `extensions/permissions/tool-policy.ts` | `4ea83ab221043d789c2edbb54306d89d916e54a7a3165f3197c4615d5a8cbb25` |
| `extensions/permissions/verifier-policy.ts` | `3beed3f443f22d4cc5f9c6b501e4ee44433e76e2e3c0074d3b263bad9113486d` |
| `extensions/permissions/workflow-policy.ts` | `dc3942b94c485e45d2462416dd44efd1a0f781800cfa206acd1edba609c64d60` |
| `extensions/setup-core/index.ts` | `52ef96d2e674a14df56f48716813dcb60016496c001f1a32a9061222cd905e8a` |
| `extensions/setup-core/subagent-output-guard.ts` | `2636180a8b3d78c4a17bc45fd15e7f9bee57ac10f1867ba89233237bcfec2520` |
| `extensions/shared/permission-policy.ts` | `026b3b14c173907ed1748bee7f605ea78796f186f5590865615ceedf4ee7bae2` |
| `extensions/shared/verification-capabilities.ts` | `2136966734ffb59deef6a23c9b04312abaec457c13d322d4ca7c78149b716aa9` |
| `npm/package.json` | `bb550ad652b959ece6b2de2c9b08227be1b36b20b3c96dedc559442d2e2f179d` |
| `settings.json` | `2d97e31b82da49b2a8ea04ba632514bbc6bf4d11b58a91ec883a55627de197d6` |
| `tests/suites/runtime/resilience.mjs` | `611a3e386a2e961f1f2fc3e08b33ca542a361b558a078b7501b3092413f92b73` |
| `tests/suites/runtime/verification.mjs` | `0a42e1f6c7160dc52be1ed2ea2b4bdd97af3b6c6fa5cf6500bdd508e66cdb5d0` |
| `tests/workflow-mode/permissions.test.mjs` | `d2bc40f3cf14d741ee363b9bcf0bacfea11a31f7aaa17d199281ebe348945260` |
| `phase2-plan.md` | `821a8af52869f5da21c17ced6d15b5f727740f45f8f170f8dceda415f0c62830` |

Das unversionierte Audit-Paket einschließlich dieser Datei ist bewusst nicht
selbstreferenziell in der Tabelle enthalten. `settings.json` ist nur als
unabhängig übernommene Arbeitsbaum-Datei erfasst; daraus folgt keine
inhaltliche Task-Zuordnung.
