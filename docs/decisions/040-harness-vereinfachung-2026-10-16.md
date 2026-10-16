# 040 — Harness-Vereinfachung auf Messbasis (2026-10-16)

## Status

Angenommen, 2026-10-16. Belege und Zahlen: [Bestandsaufnahme](../audits/harness-bestandsaufnahme-2026-10-16.md).
Ergänzt 016 (Recovery-Gate), 022 (Interpretergrenze), 031 (temporäre Task-Agenten) und 039 (Task-Tier).

## Leitregel

Jede Steuerung braucht einen nachweisbaren Nutzen. Die Messung über 37 Sessions und die
Subagent-Laufhistorie zeigte: Die Reibung entsteht fast ausschließlich in der eigenen
Policy-Schicht, nicht in der Runtime oder im Subagent-Fork.

## Entscheidungen

### Behalten (Nutzen belegt oder Risiko zu hoch)

- **Task-Tier-Rest** (ADR 039): 42 von 1 145 Reads (3,7 %) vom Duplicate-Read-Guard abgefangen, kein
  Schaden sichtbar. Variante B bleibt; Rückbau nach ADR 039.
- **Context-Capsule**: passiv und begrenzt (6 KB). Nutzen nicht belegt (seit der Einführung 3
  Kompaktierungen, 0 Einträge). Bleibt, bis `/session-health` über mehrere Wochen etwas zeigt.
- **Verifier-Need-Gate, Ticket, Output-Guard**: Vertrag und Sicherheitsgrenze, nicht angefasst.
- **Frontend-Bridge, Protokollpaket, `system-control`, `quickpanel-agent`**: öffentliche Verträge.

### Vereinfacht

- **Ask-User**: Pflicht ist nur noch die Frage und je Option das Label. Beschreibung, Aufwand, Risiko,
  Vor-/Nachteil, Empfehlung und Begründung sind optional und erscheinen nur, wenn sie gesetzt sind.
  Tool-Beschreibung nennt die Einsatzgrenze (Zielkonflikt, Risiko, echte Mehrdeutigkeit).
- **Shell-Policy (022)**: Zwei messbare Fehlalarmklassen beseitigt.
  1. `2>&1`, `2>/dev/null`, `&>/dev/null` galten als Schreibzugriff und machten lesende Befehle mit
     externem Pfad zur „externen Shell-Änderung“ (87 von 244 hart geblockten Befehlen).
  2. Ein literales Projektskript wurde in `a && b`, `a | b`, `a; b` und `cd dir && a` als „opaker
     Interpreter“ behandelt, obwohl es als einfacher Befehl erlaubt ist. Jetzt wird jedes Segment einzeln
     geprüft. Konservativ bleiben: Befehle mit Schreibmöglichkeit (das Skript könnte im selben Befehl
     entstehen), Variablen im Pfad, Ersetzungen, Heredocs, Subshells, unbekanntes Arbeitsverzeichnis.
     Ergebnis auf den 244 gemessenen Befehlen: 43 → 127 erlaubt, alle Angriffsfälle des Tests weiter gesperrt.
- **Recovery (016)**: Das Gate sperrt nur bei Mutationsverdacht und blieb so. Neu:
  - Der Turn-Start prüft offene Gates selbst (derselbe lesende Check wie `recovery_check`, dieselben
    Marker) und injiziert den Bericht. Vorher: 314 Schreib-/Shell-Blockaden, weil das Modell trotz
    Anweisung zuerst schrieb. Schlägt die Prüfung fehl, bleibt das Gate zu und die Anweisung nennt
    `recovery_check`. Rückfall: `resilienceExtension(pi, { autoInspect: false })`.
  - Pipes, Ketten und `2>&1` aus rein diagnostischen Befehlen gelten im Gate als lesend (63 von 166
    gemessenen Blockaden). Dateiumleitungen, Ersetzungen und mutierende Befehle bleiben gesperrt.
    `find -fprint*/-fls` zählt jetzt als mutierend.
- **Skills**: Die drei keyword-injizierten Systemtexte sind native Skills (`nixos-system`,
  `hyprland-desktop`, `system-health`) über `resources_discover`. Es gibt keine zweite Registry mehr.
  Neu ist `implementation-plan` ohne Workflow-Sperre. Veraltete Planmodus-Verweise sind entfernt.
- **Runtime-Patches**: 11 → 8 Einträge. Das Command-Inventar (Built-ins in `pi.getCommands()`) hatte keinen
  Nutzen mehr. Die übrigen drei Eingriffe sind in `docs/RUNTIME_PATCHES.md` je mit nativer Alternative begründet.
- **Subagenten-Konfiguration**: `intercomBridge.mode: "off"`. Der Fork gab Kindern `contact_supervisor`; ein
  Headless-Kind kann den Aufruf nicht bestätigen und beendete den Verifier-Lauf mit Exit 1.
- **Telemetrie**: `/session-health` zeigt Requests, Tool-Calls, Tokens, Cache-Anteil, Kosten, Request-Dauer
  und Subagent-Läufe. Keine zweite Plattform.

### Nicht übernommen

- **Bubblewrap/OS-Sandbox**: `bwrap` ist nicht installiert; das Pi-Beispiel braucht
  `@anthropic-ai/sandbox-runtime` (neue Abhängigkeit, nur nach Rückfrage). Der Systemmodus braucht Root-nahe
  Fähigkeiten (`nixos-agent`, Dienste), die eine pauschale Sandbox unbrauchbar machte. Ein späterer Einsatz
  wäre auf `bash` im Projektprofil zu beschränken und ersetzte dort Teile der Heuristik; als zweites
  Permission-System daneben ist sie ausgeschlossen.
- **Subagent-V2 (eigene Implementierung)**: nicht gebaut, Begründung unten.
- **Ein Sammel-Einstiegspunkt statt Reihenfolge-Patch**: würde das Ein-/Ausschalten je Extension über
  `settings.json` entfernen; zu großer Eingriff für zwei Patch-Einträge.

## Subagenten-V2: Entscheidung

Befund: Von 392 `subagent`-Aufrufen sind 44 temporäre `spec`-Läufe (42 `verify`, 2 `research`). Die 31
Fehler stammen fast alle aus Policy-Ablehnungen (Planmodus 18, Verifier-Vorlage unvollständig 12,
Spec-Feldverbote 11, FAST-Sperre 2), nicht aus dem Fork. Der Fork hat 48 748 Zeilen `src`, davon nutzt das
Harness einen Bruchteil (Einzellauf per `spec`, `wait`, Status). Eine kleinere V2 würde die
Policy-Ablehnungen nicht beseitigen und müsste die Ergebnisformen nachbilden, an denen
`subagent-output-guard`, `verifier-ticket` und `temporary-agent-policy` hängen.

Entscheidung: Jetzt keine V2. Zuerst die gemessenen Fehlerursachen im Harness beheben (erledigt: Planmodus
und FAST-Sperre entfernt, Intercom aus, Shell-Fehlalarme). Wiedervorlage, wenn nach zwei Wochen
`/session-health` weiterhin Verifier-Fehlerquoten über 20 % zeigt, die auf den Fork zurückgehen, oder wenn der
Pin gewartet werden muss. Kriterien für einen Start: Ergebnisformen als Vertragstests fixieren, V2 als
Extension neben dem Fork (Schalter in `settings.json`), Rückfall = Pin behalten.

## Offene Befunde (nicht Teil dieser Entscheidung)

> Stand nach [041](041-recovery-als-unterbrechungshinweis.md): `sed`, Subshells/Ersetzungen und das
> Recovery-Gate (`autoInspect`) sind erledigt bzw. entfernt; die Punkte unten sind der historische Befund.

- `diagnoseCommandSafety` stuft `sed -n 'w datei'` und `sed '1e befehl'` als sicher ein; `sed` ist deshalb
  nicht Teil der Recovery-Diagnosebefehle.
- Die Interpretergrenze erkennt `(node -e 1)`, `{ node -e 1; }` und `$(node -e 1)` nicht (auch vor dieser
  Änderung): Inline-Code ist per Subshell möglich. Behebung braucht eine Designentscheidung (Subshells
  generell als opak behandeln).
- ESLint ignoriert alle `*.ts` (typescript-eslint unterstützt TypeScript 7 nicht); TypeScript wird nur
  über `tsc --noEmit` geprüft.
- Ursache der übrigen Verifier-`exit-1`-Läufe (Headless-Interpreter-Ablehnung, Workspace-Mutation durch
  Testläufe) ist nur teilweise behoben; Messung über `/session-health`.
