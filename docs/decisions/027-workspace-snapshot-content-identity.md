# 027 — Workspace-Snapshot-Fingerprints sind textconv-/external-diff-unabhängig

## Kontext

`shared/workspace-snapshot.mjs` liefert den einen Fingerprint, an den
Recovery-Gate (`extensions/resilience/`) und Verifier-Gate
(`extensions/permissions/verifier-policy.ts`, `extensions/setup-core/`) ihre
Sicherheitsentscheidungen binden: unverändert = derselbe Fingerprint,
geändert = ein anderer. Die beiden inhaltssensitiven Bestandteile
(`stagedPatchSha256`/`unstagedPatchSha256`) wurden aus `git diff --no-ext-diff
--binary -M` gehasht — ohne `--no-textconv`.

Ist für einen Pfad per `.gitattributes`/`diff.<driver>.textconv` ein
Textconv-Filter konfiguriert, ersetzt Git die Rohinhalte durch die
Filterausgabe, bevor der Diff gebildet wird. Zwei unterschiedliche Rohinhalte
können auf identische (oder leere) Filterausgabe abbilden — der Fingerprint
zertifizierte dann Inhaltsgleichheit, die real nicht bestand. Praktisch
bedeutet das: eine bereits mit `PASS` verifizierte protected-path-Änderung
bliebe nach einem zweiten, tatsächlich anderen Edit weiterhin als „von diesem
PASS abgedeckt“ gültig, solange beide Edits denselben Textconv-Output
erzeugen — das Commit-Gate (`assessGitCommitVerifierGate` /
`assessVerifierCoverageForDiff`) und der Verifier-Dedup
(`assessVerifierDedup`) hätten den unverifizierten zweiten Edit durchgelassen
bzw. eine erneute Prüfung fälschlich blockiert.

## Entscheidung

1. Beide inhaltssensitiven Git-Aufrufe erzwingen zusätzlich `--no-textconv`
   (neben dem bereits vorhandenen `--no-ext-diff`) —
   `shared/workspace-snapshot.mjs`, die zwei `hashGitOutput`-Aufrufe in
   `collectWorkspaceSnapshot()`.
2. `WORKSPACE_SNAPSHOT_SCHEMA_VERSION` wird von `"1"` auf `"2"` angehoben.
   Da `schemaVersion` Teil des gehashten `fingerprintInput` ist, invalidiert
   das garantiert jeden zuvor gespeicherten Fingerprint — unabhängig davon,
   ob ein konkreter Workspace überhaupt einen Textconv-Treiber konfiguriert
   hatte. Ohne den Bump wären die meisten Fingerprints zufällig identisch zum
   Vorzustand geblieben, was verschleiert hätte, ob der Fix greift.
3. Keine Kompatibilitäts- oder Migrationslogik für das alte Format: ein
   Angreifer dürfte sonst versuchen, das alte, verwundbare Format zu
   erzwingen. Alte, persistierte Nachweise (offene Recovery-Gate-Marker in
   einer über die Deploy-Grenze hinweg fortgesetzten Session) werden dadurch
   einmalig als `changed` behandelt und verlangen einen erneuten
   `recovery_check` — das ist das bestehende Fail-closed-Verhalten bei jedem
   Fingerprint-Mismatch, kein Sonderfall.
4. Die kanonische Definition von Inhaltsidentität steht im JSDoc-Block über
   `collectWorkspaceSnapshot` in `shared/workspace-snapshot.mjs` — dieser ADR
   verweist nur darauf, statt sie zu duplizieren.

## Konsequenzen

- Recovery-Gate und Verifier-Gate erkennen eine Textconv-maskierte, real
  unterschiedliche Änderung jetzt als das, was sie ist: eine neue,
  unverifizierte Diff-Variante, nicht dieselbe bereits geprüfte.
- Jeder vor diesem Fix gespeicherte Fingerprint ist bewusst ungültig; ein
  offenes Recovery-Gate über die Deploy-Grenze hinweg verlangt einmalig einen
  erneuten `recovery_check`.
- Kein Konsument (`extensions/resilience/index.ts`,
  `extensions/permissions/verifier-policy.ts`,
  `extensions/setup-core/index.ts`) musste geändert werden — alle vergleichen
  ausschließlich den opaken `fingerprint`-String.

## Alternativen

- **Nur `--no-ext-diff`, `--no-textconv` als spätere Härtung.** Verworfen:
  `--no-ext-diff` allein schließt nur den `diff.external`-Pfad, nicht den in
  der Praxis deutlich häufiger konfigurierten `textconv`-Pfad (z. B. für
  Lockfiles, Notebooks, Office-Formate) — genau die im Review reproduzierte
  Lücke.
- **Fingerprint-Format-Übergangslogik (beide Formate parallel akzeptieren).**
  Verworfen: schwächt die Fail-closed-Eigenschaft ohne echten Nutzen: kein
  Konsument persistiert Fingerprints so langlebig, dass eine Übergangsphase
  einen belastbaren Vorteil böte.
- **Schema-Version unverändert lassen, nur die Flags ergänzen.** Verworfen:
  hätte für die meisten Workspaces (ohne konfigurierten Textconv-Treiber)
  keinen sichtbaren Effekt gehabt und damit nicht auditierbar gemacht, dass
  der Fix tatsächlich wirkt.
