# Stufe-2 Medium-Laufmatrix

## Status

**Vorbereitet, nicht gestartet.** Die Serie verwendet `gpt-5.6-luna` mit dem
expliziten Reasoning-Profil `medium` für Pi und Codex. Der Base-SHA wird erst
nach dem ausdrücklich freigegebenen Audit-Commit eingefroren; vorher darf kein
Trial gestartet werden.

## Zielstandard

3 Tasks × 3 Trials × 2 Workflows × 2 Kandidaten = **36 Kandidatenläufe**.
Pi und Codex laufen pro Aufruf parallel. Die Matrix und das effektive
Reasoning-Profil dürfen nach dem Freeze nicht verändert werden.

## Reihenfolge-Rotation

| Trial | 1. Workflow | 2. Workflow |
| ----- | ----------- | ----------- |
| 1 | work-only | plan-work |
| 2 | plan-work | work-only |
| 3 | work-only | plan-work |

## Matrix

| Task | Klasse | Trial | Workflow-Reihenfolge | Status | comparable | Ersetzt Trial? |
| ---- | ------ | ----- | -------------------- | ------ | ---------- | -------------- |
| real-03-lsp-ruby-profile | A | 1 | WO→PW | vorbereitet | | |
| real-03-lsp-ruby-profile | A | 2 | PW→WO | vorbereitet | | |
| real-03-lsp-ruby-profile | A | 3 | WO→PW | vorbereitet | | |
| real-04-session-health-provider-filter | B | 1 | WO→PW | vorbereitet | | |
| real-04-session-health-provider-filter | B | 2 | PW→WO | vorbereitet | | |
| real-04-session-health-provider-filter | B | 3 | WO→PW | vorbereitet | | |
| real-05-lsp-rename-tool | C | 1 | WO→PW | vorbereitet | | |
| real-05-lsp-rename-tool | C | 2 | PW→WO | vorbereitet | | |
| real-05-lsp-rename-tool | C | 3 | WO→PW | vorbereitet | | |

## Eintrittsgates

1. Der Audit- und Medium-Konfigurationsstand ist committed; der kanonische
   Arbeitsbaum ist sauber.
2. `STAGE2_BASE_SHA` ist auf den dokumentierten Medium-Freeze gesetzt.
3. `pi-duel doctor` und ein sauberer Dual-Smoke mit `--reasoning medium` sind
   erfolgreich; `--allow-dirty` ist verboten.
4. Während eines Trials läuft keine parallele interaktive Pi-Sitzung.
5. Live-Trials verwenden reale APIs und die vorhandenen Auto-Approve-Profile;
   Ergebnisse verbleiben append-only außerhalb des Repositories.
