# 028 — Aurora Forge: semantische Visual States und gemeinsame Motion

## Kontext

Aurora besaß bereits einen gemeinsamen Ticker, ein budgetiertes Activity-
Dashboard, Tool-/Subagent-Zeilen und die Motion-Modi `contextual`, `reduced`
und `off`. Die Runtime-Zustände wurden jedoch an mehreren Stellen separat auf
Farben und Glyphen abgebildet. Thinking, Toolarbeit, Antwortstream und Warten
teilten dadurch häufig denselben Akzent; Verification konnte wie Erfolg wirken,
wenn ein laufender Marker als Checkmark gelesen wurde.

## Entscheidung

Aurora Forge ergänzt eine kleine pure Visual-State-Zuordnung in
`extensions/aurora-ui/visual-state.ts`. Sie projiziert bestehende Runtime-
Signale auf semantische Zustände (`thinking`, `working`, `responding`,
`waiting`, `verifying`, `success`, `warning`, `error`, `attention`) und liefert
Ton, Glyph, statischen Fallback und Bewegungsprofil. Sie erzeugt keinen neuen
Runtime-State und fragt keine Tools, Provider, Dateien oder LSPs ab.

Pi stellt eine geschlossene `ThemeColor`-Menge bereit. Forge verwendet deshalb
bestehende typisierte Slots als semantische Adapter: `accent` für Working,
`thinkingHigh` für Thinking, `thinkingMax` für Responding und `thinkingXhigh`
für Verification. Die Forge-Palette weist diesen Slots deutlich getrennte
Werte zu; `aurora-night` bleibt verfügbar.

Der gemeinsame Aurora-Ticker bleibt die einzige Clock. `expressive` ergänzt
logische schnelle Arbeit, eine langsamere Waiting-Pulse, einen ruhigen
Responding-Stream und Verification-Motion. `contextual` animiert weiterhin nur
aktive Arbeit; `reduced` und `off` bleiben ohne schnelle bzw. zeitbasierte
Bewegung. Kein Tool, Subagent oder Dashboard-Element erhält einen eigenen
Timer.

## Konsequenzen

- Laufende Verification zeigt nie einen Erfolg-Checkmark; Erfolg erscheint erst
  nach real bestätigtem Abschluss.
- Farben tragen Statusbedeutung und werden nicht als beliebige Dekoration in
  Footer oder Rahmen eingesetzt.
- Bestehende Dashboard-Budgets, Unicode-/ANSI-sichere Crops, Footer-Prioritäten,
  native Editor-/Shortcutlogik und die Core-Lifecycle-Ereignisse bleiben
  unverändert.
- Statuskontrast und wichtige Statuspaar-Abstände werden für Forge getestet.
- Ein Change-Highlight bleibt optional und wird nicht eingeführt, wenn es eine
  zusätzliche Timer-/State-Architektur erfordern würde.
