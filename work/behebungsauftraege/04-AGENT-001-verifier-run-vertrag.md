# AGENT-001 — Verifier-PASS ist nicht an Root und Ausgangsstand gebunden

## Priorität und Ziel

- **Priorität:** P1, hoch
- **Bereich:** Agent, Verifier, Security
- **Ziel:** Ein Verifier-Ergebnis darf ausschließlich den konkret gestarteten Run, den geprüften Root, den Scope und den geprüften Inhalt zertifizieren.

## Betroffene Bereiche

- `extensions/setup-core/index.ts`
- `extensions/permissions/verifier-policy.ts`
- Verifier-Start, Ergebnisverarbeitung und Ledger
- gepinnte `pi-subagents`-Integration

## Verbindliche Regeln

1. Vor dem Start ein unveränderliches Verifikationsticket erzeugen.
2. Ticket enthält mindestens `runId`, kanonischen Root, Scope, Start-Fingerprint, Session-ID, Generation, Profil und effektives Modell.
3. Ergebnisse ohne passende `runId` werden nicht verbucht.
4. Ein fremder `cwd`, Root oder Scope kann keinen PASS für den Elternworkspace erzeugen.
5. Start- und Endstand müssen gegen die tatsächlich geprüfte Evidenz geprüft werden.
6. Mutation im relevanten Scope macht das Ergebnis `stale` oder `unverifiable`, außer sie ist explizit als erlaubtes Artefakt definiert.
7. Verspätete Ergebnisse nach Sessionwechsel oder Generationwechsel werden verworfen.

## Todos

- [ ] Launch-Vertrag und Ergebnis-Schema definieren.
- [ ] Kanonischen Root und erlaubten Scope vor dem Start validieren.
- [ ] Start-Fingerprint vor dem Child-Start erfassen.
- [ ] Ticket an Sync-Ergebnis, Ledger und Commit-Gate weiterreichen.
- [ ] End-Fingerprint und relevante Mutation prüfen.
- [ ] `cwd`-Override kurzfristig verbieten oder vollständig in den Scope-Vertrag aufnehmen.
- [ ] Fremde, alte und verspätete Resultate testen.
- [ ] Ergebnisse mit fehlendem Verdict weiterhin als unvollständig behandeln.

## Pflicht-Regressionstests

- Verifier mit `cwd` auf Projekt B darf Projekt A nicht freigeben.
- Mutation in Projekt A während der Prüfung invalidiert den PASS.
- Verifier-Resultat nach Sessionwechsel wird verworfen.
- Verifier-Resultat mit fremder `runId` wird verworfen.
- Erlaubte Ausgabe-Artefakte werden nicht fälschlich als Source-Mutation behandelt.
- Commit-Gate prüft exakt den Ticket-Stand.

## Abnahmekriterien

- Kein PASS ohne gültiges Ticket.
- Root, Scope und Fingerprint des Ergebnisses stimmen mit dem Commit-Gate überein.
- Ein alter oder fremder PASS öffnet kein Gate.
- Mutation während des Runs führt zu `stale`/`unverifiable`.
- Der Nachweis ist im Ledger nachvollziehbar und nach Neustart nicht semantisch falsch zuordenbar.

## Abhängigkeiten

- SNAP-001 für die Inhaltsidentität.
- AGENT-002 und AGENT-003 für vollständigen Launch-Vertrag.
- REC-001 für mutierende Verifier-/Check-Pfade.

## Risiken

- Verifier können Build- oder Diagnoseartefakte erzeugen.
- Zu grobe Mutationserkennung erzeugt unnötige Wiederholungen; erlaubte Artefakte müssen explizit modelliert werden.

## Erforderlicher Abschlussnachweis

PR mit Ticket-/Result-Schema, falschem-Root-Test, Mutation-during-run-Test und Ledger-Nachweis.
