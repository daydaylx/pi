# 032 — Verifier Need-Gate: technisch erzwungene Need-Entscheidung für optionale Verifier-Läufe

## Status

Umgesetzt. Referenzstand: Commit `68cdace5277e793eb065e80c786d0fc1d114902c`
(unverändert zum Zeitpunkt der Umsetzung). Neue Datei
`extensions/permissions/verifier-risk.ts`, Integration in
`assessVerifierDelegation` (`extensions/permissions/verifier-policy.ts`),
Trigger-Vertrag in `rewriteVerifySpecToVerifier`
(`extensions/permissions/temporary-agent-policy.ts`), Ticket-Provenienz
(`extensions/setup-core/verifier-ticket.ts`,
`extensions/shared/verification-capabilities.ts`), Telemetrie-Breakdown
(`benchmarks/real-duel/scripts/telemetry.py`). Verifier-Prompt
(`agents/verifier.md`) unverändert — die geforderte "targeted evidence
first"-Regel stand dort bereits (Schritt 5).

Nachtrag (`pi-subagents`-Pin `ced79226d964e4b71063f386429b5f229909ba43`,
Branch `feat/temporary-agent-spec`): `RunEntry`/`RecordRunExtras` im Fork um
`model`/`internalToolCalls` erweitert (alle 4 `recordRun()`-Aufrufstellen),
dadurch sind `verifier_model`, `nested_models`, `mixed_model_run` und
`verifier_internal_tool_calls` in der Benchmark-Telemetrie jetzt real
befüllt statt geschätzt. `createVerifierTicket` hat jetzt außerdem einen
direkten Unit-Test (`tests/verifier-ticket.test.mjs`), vorher nur indirekt
über die Runtime-Suite abgedeckt.

Weiterhin bewusst nicht umgesetzt (siehe „Bewusst nicht eingeführt“ unten):
`verifier_reasoning` (Datenquelle liefert es nicht — der Fork trackt keine
Reasoning-Token-Zahl), `verifier_decision`/`verifier_trigger`/
`verifier_skip_reason` (nirgends persistiert, da die Need-Gate-Entscheidung
im Fork-Executor nicht sichtbar ist), Nachmessung/Tier-Wechsel (Phase 8 —
braucht zuerst 20–50 echte Läufe).

## Kontext

Der Verifier ist ein teurer, unabhängiger LLM-Prüfschritt. Vor dieser
Änderung konnte der Hauptagent ihn für praktisch jeden Diff starten, auch
wenn keine unabhängige semantische Prüfung nötig war — nur der Hard-Pfad-
Katalog (`verifier-required-paths.ts`) und das Commit-Gate erzwangen ihn für
sicherheitskritische Pfade. Für alles andere gab es keine technische
Bremse, nur die (nicht erzwungene) Erwartung, ihn sparsam einzusetzen.

Ziel war ausdrücklich nicht, den Verifier abzuschwächen oder ihn generell
seltener laufen zu lassen, sondern ihn nur dort zu blockieren, wo weder ein
Hard-Pfad noch ein belegtes Restrisiko vorliegt — ohne einen zweiten
LLM-/Meta-Agenten einzuführen, der über seine Nutzung entscheidet.

## Entscheidung

Eine neue, pure Funktion `assessVerifierNeed` entscheidet deterministisch:

```text
required     -> Hard-Pfad-Treffer oder explizite Nutzeranforderung
justified    -> kein Hard-Pfad, aber ein bekannter Trigger mit
                nicht-leerer Evidenz
not_needed   -> sonst; der Verifier-Lauf wird technisch blockiert
```

Zulässige optionale Trigger: `user_requested`, `semantic_contract_risk`,
`uncovered_behavior`, `failed_check_after_fix`, `cross_boundary_change`,
`environment_uncertainty`. Ein unbekannter Trigger oder leere Evidenz wird
fail-closed abgelehnt — sowohl im `spec.verification`-Schema (vor der
Übersetzung in einen `verifier`-Aufruf) als auch, falls ein Legacy-Aufruf
den entsprechenden Abschnitt von Hand nachbildet, in der Need-Bewertung
selbst (ein unbekannter Trigger wird dort einfach nicht erkannt und fällt
auf `not_needed` zurück — derselbe Effekt wie eine explizite Ablehnung).

Diffgröße oder Dateianzahl sind niemals allein ein Trigger.

### Sicherheitsregel

Der Hauptagent kann `required` nicht selbst behaupten. Er kann nur einen
optionalen Trigger anmelden (`spec.verification.trigger`/`triggerEvidence`
oder ein `## Optional verifier trigger`-Abschnitt im Legacy-`task`-Text).
`required` wird ausschließlich durch den Hard-Pfad-Katalog oder eine
technisch erkannte explizite Nutzeranforderung bestimmt. Da diese Runtime
aktuell kein zuverlässiges technisches Signal für „hat der Nutzer selbst
explizit danach gefragt“ unabhängig von der Behauptung des Hauptagenten
besitzt (kein bestehender Session-Flag, keine verlässliche Textklassifikation
ohne einen verbotenen Meta-Agenten), bleibt `userRequestedVerification` in
der aktuellen Integration konstant `false`. Der `user_requested`-Trigger
deckt den praktischen Fall über den Justified-Pfad ab — mit denselben
Fail-closed-Garantien wie jeder andere Trigger, nie mit `required`.

### Warum beide Aufrufwege (Legacy + Spec) denselben Text-Marker nutzen

`rewriteVerifySpecToVerifier` übersetzt `spec.profile: "verify"` bereits vor
dieser Änderung in Markdown-Abschnitte im `task`-Text (z. B.
`## Re-verification justification`), die `assessVerifierDelegation` per
Regex zurückliest. Der neue `## Optional verifier trigger`-Abschnitt folgt
demselben Muster, statt einen zweiten, paralleln Übergabeweg zu bauen — ein
Legacy-`agent: "verifier"`-Aufruf kann denselben Marker von Hand setzen und
erreicht exakt dieselbe Need-Bewertung, ohne dass zwei Wahrheitsquellen
gepflegt werden müssen.

### Warum die Ticket-Provenienz additiv bleibt (kein Schema-Versionsbump)

`VerificationTicketSnapshot` bekommt optionale Felder (`riskClass`,
`trigger`, `triggerEvidence`, `requiredPathHits`) statt eines
`schemaVersion`-Bumps. Diese Felder haben keine sicherheitsrelevante
Bedeutung für sich genommen — ein altes Ticket ohne sie bedeutet nur „keine
Provenienz erfasst“, nie ein falsches Negativ. Ein echter Versionsbump hätte
jeden Ticket-Konsumenten und jede Testfixture im Repo gezwungen, explizit
zwischen Version 1 und 2 zu unterscheiden — unverhältnismäßig für eine rein
informative Ergänzung.

## Bewusst nicht eingeführt

- Kein zusätzlicher LLM-/Meta-Agent zur Need-Entscheidung.
- Kein zweiter Hard-Pfad-Katalog — `verifier-required-paths.ts` bleibt die
  einzige Quelle.
- Kein zweites paralleles Verification-Ledger.
- Keine automatische Verifier-Modell-/Tier-Änderung (Phase 8 dieses
  Auftrags: erst nach 20–50 echten Läufen bewerten).
- Keine inhaltliche Bewertung der `triggerEvidence`-Qualität (z. B. „better
  safe than sorry“ als unzureichend erkennen) — das wäre exakt die
  semantische Diff-Klassifikation, die dieses Repo bewusst vermeidet.
  Nicht-leer ist die einzige technisch geprüfte Eigenschaft.
- `verifier_reasoning` in der Benchmark-Telemetrie: `pi-subagents`' `Usage`-
  Typ (gepinnter Fork, separates Repository, `src/shared/types/basic.ts`)
  trackt gar keine Reasoning-Token-Zahl, an keiner Stelle im Paket. Das zu
  ergänzen hieße, die Usage-Akkumulierung überall im Fork anzufassen, nicht
  nur eine Aufrufstelle — eine deutlich größere, separate Änderung.
  `verifier_model`, `verifier_internal_tool_calls`, `nested_models` und
  `mixed_model_run` sind dagegen seit Pin `ced79226d964e4b71063f386429b5f229909ba43`
  real befüllt (siehe Nachtrag oben).
- `verifier_decision`/`verifier_trigger`/`verifier_skip_reason` in der
  Benchmark-Telemetrie: Die Need-Gate-Entscheidung entsteht in Pis eigener
  Permission-Guard-Schicht, bevor der `pi-subagents`-Executor den Tool-Call
  überhaupt sieht — der Fork hat dafür schlicht keine Sicht auf diese
  Information, unabhängig davon, welche Felder `RunEntry` trägt. Das würde
  einen neuen Übergabeweg vom Guard in den Tool-Input hinein brauchen (analog
  zu `normalizeVerifierDelegationInput`s `acceptance`-Override), den der
  Fork-Executor zusätzlich explizit einlesen und durchreichen müsste —
  außerhalb des Scopes dieser Änderung.

## Folgen

- Ein Aufruf ohne Hard-Pfad-Treffer, ohne explizite Nutzeranforderung und
  ohne validen Trigger wird vor dem Start geblockt — unabhängig davon, ob er
  über `agent: "verifier"` oder `spec.profile: "verify"` läuft
  (`tests/verifier-need-gate.test.mjs`, T18–T21).
- Bestehende Dedup-/Fingerprint-/Ticket-/Commit-Gate-Mechanik bleibt
  unverändert; die Need-Gate-Prüfung läuft nach der Schema-/Vollständigkeits-
  prüfung und vor dem Dedup (`assessVerifierDelegation`).
- `docs/subagents.md` und `AGENTS.md` beschreiben den neuen
  Trigger-Abschnitt und die drei Risikokategorien.
