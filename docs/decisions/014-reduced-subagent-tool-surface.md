# 014 — Die reduzierte Subagent-Tool-Surface ist ein eigener Schalter

## Kontext

Der Fork registrierte das reduzierte Parameter-Schema, sobald
`toolDescriptionMode: "custom"` gesetzt war. Zwei unabhängige Dinge hingen damit
an einem Schalter: der für das Modell sichtbare Beschreibungstext und die
technisch akzeptierten Parameter. Wer nur die Beschreibung ersetzen wollte,
verlor unangekündigt den größten Teil des Tools; wer nur die reduzierte Surface
wollte, musste eine eigene Beschreibungsdatei pflegen.

Zusätzlich war die Reduktion schwächer als dokumentiert. `action` war ein
freies `Type.String()`, und das Schema erlaubte zusätzliche Eigenschaften. Die
Dokumentation behauptete, Chain, Parallel, CRUD, Scheduling, Worktrees, Sharing
und Watchdog seien „auf Schema-Ebene abgelehnt" — tatsächlich hätte ein
`chain`-Argument die Validierung passiert.

Der zugehörige Pin in `settings.json`
(`2004b727d2362363b47c95a93ff40cfc4204ad19`) war bei GitHub nicht erreichbar:
Der Commit existierte nur lokal und wurde nie gepusht. Eine saubere
Neuinstallation scheiterte daran.

## Entscheidung

Der Fork bekommt `toolSchemaMode: "full" | "harness"` als eigene Einstellung.
`toolDescriptionMode` steuert ausschließlich den sichtbaren Text.

`harness` registriert genau die Surface, die dieses Harness braucht:
SINGLE-Ausführung sowie `list`, `status`, `stop` und `interrupt`. `action` ist
ein geschlossenes Enum, und das Objekt setzt `additionalProperties: false`.
Damit ist die Reduktion eine echte Capability-Grenze: Chain, Parallel,
Agent-CRUD, Scheduling, Worktrees, Sharing, Watchdog, `resume`, `steer` und
`append-step` scheitern an `validateToolArguments`, bevor der Executor läuft.

Die Laufzeitpfade dieser Funktionen bleiben im Fork bestehen — Hosts auf der
vollen Surface benutzen sie. Die Reduktion ist eine Registrierungsentscheidung,
kein Rückbau.

Der Pin zeigt auf einen erreichbaren, vollständigen SHA auf
`daydaylx/pi-subagents@agent/simplify-and-stabilize`.

## Begründung

Ein Schalter, der zwei unabhängige Eigenschaften gleichzeitig verstellt, ist
nicht konfigurierbar, sondern nur bedienbar, wenn man den Quelltext kennt. Und
eine Reduktion, die nur in der Beschreibung existiert, schützt vor nichts: Das
Modell hätte jederzeit ein `chain`-Argument senden können, und die Validierung
hätte es durchgelassen.

Der geschlossene Enum ist die billigste Stelle für diese Grenze. Sie kostet eine
Zeile im Schema, wird von der bestehenden Argumentvalidierung durchgesetzt und
braucht keinen zusätzlichen Laufzeit-Guard.

## Konsequenzen

- `extensions/subagent/config.json` setzt `toolSchemaMode: "harness"` neben
  `toolDescriptionMode: "custom"`.
- `/setup-doctor` meldet beide Werte (`subagent tool surface: schema=…,
  description=…`) und leitet die aktive Surface nur noch aus `toolSchemaMode`
  ab. Der Fork meldet dasselbe unter `Tool surface` in
  `subagent({ action: "doctor" })`.
- `setup.json`, `schemas/setup.schema.json` und
  `extensions/setup-core/config.ts` tragen keinen `subagents.concurrency`-Wert
  mehr. Das aktive Harness führt keine parallelen Subagenten aus, also hatte
  die Baseline keinen Laufzeitverbraucher. `/setup-doctor` meldet weiterhin als
  Fehler, wenn im Paket wieder eine Parallelitätskonfiguration auftaucht.
- `tests/suites/runtime.mjs` prüft die beiden Schalter und die Abwesenheit der
  Concurrency-Baseline; im Fork prüft `test/unit/tool-schema-mode.test.ts` die
  erlaubten und abgelehnten Aktionen gegen dieselbe Validierungsfunktion, die
  die Laufzeit verwendet.
- Der Pin bleibt ein vollständiger 40-stelliger SHA. Der Test dafür bleibt
  offline: Erreichbarkeit wird bei Änderungen des Pins manuell gegen GitHub
  geprüft, nicht in der lokalen Suite.
