# Harte Umsetzungsregeln

## R1 – Pi-Core bleibt fachlich maßgeblich

Keine GUI-Komponente darf zentrale Agentenentscheidungen selbst implementieren.

## R2 – Keine zweite State-Wahrheit

Nicht zulässig:

```text
Core sagt: verification=failed
GUI sagt intern: verification=passed
```

Frontend-State darf nur abgeleitet oder rein visuell sein.

## R3 – Aurora bleibt bis zur finalen Entscheidung erhalten

Aurora darf nicht frühzeitig gelöscht, stillgelegt oder strukturell entwertet werden.

## R4 – `pi` und `pi gui` müssen parallel funktionieren

Jede Phase muss Regressionen in `pi` aktiv prüfen.

## R5 – Shortcuts sind semantische Commands

Bestehende Shortcut-Belegung möglichst beibehalten.

Wenn ein Shortcut technisch nicht 1:1 übertragbar ist:

1. Ursache dokumentieren,
2. funktional äquivalente Lösung anbieten,
3. keine eigenmächtige Umbelegung,
4. Nutzerentscheidung einholen.

## R6 – Menülogik bleibt erkennbar

Model-, Thinking-, Workflow-, Permission- und Hauptmenü dürfen visuell völlig neu aussehen.

Die dahinterliegende Struktur und Bedeutung darf nicht ohne Begründung geändert werden.

## R7 – GUI darf optisch radikal anders sein

Erlaubt:

- Sidebar
- Tabs
- Panels
- Cards
- Modals
- Drawers
- Tooltips
- Mouse
- resizable panes
- grafische Statusdarstellung
- andere Informationshierarchie

Nicht erlaubt:

- funktionale Abweichung ohne explizite Entscheidung.

## R8 – Tool-Nutzung darf Chat nicht dominieren

Standarddarstellung:

- kompakte Tool-Cards,
- gruppierbare Aktivität,
- expandierbare Details,
- Chat-Inhalt visuell priorisieren.

## R9 – Keine Big-Bang-Migration

Jede Phase muss einzeln testbar und rückbaubar sein.

## R10 – Bestehende Schnittstellen bevorzugen

Bevor neue APIs gebaut werden:

1. Pi RPC prüfen,
2. vorhandene Extension-State-Events prüfen,
3. bestehende Commands prüfen,
4. vorhandene Session-Schnittstellen prüfen.

## R11 – Frontend-Bridge ist dünn

Die Bridge transportiert:

- Commands
- State
- Events
- Ergebnisse

Sie implementiert keine Agentenlogik.

## R12 – Keine Phantom-Funktionen

Keine GUI-Fläche für Funktionen bauen, die der Core noch nicht zuverlässig bereitstellt.

## R13 – Keine stillen Fallbacks

Wenn ein Feature nicht kompatibel ist:

- sichtbar deaktivieren,
- Grund dokumentieren,
- nicht still anders ausführen.

## R14 – Sicherheit

Renderer darf Pi nicht frei kontrollieren.

Nur dokumentierte, validierte IPC-Aufrufe.

## R15 – Tests vor Optik

Core-Kompatibilität hat Vorrang vor visueller Politur.

## R16 – Jede Phase endet mit STOP

Nach Phase-Abschluss:

```text
STATUS: PHASE COMPLETE
NEXT: BLOCKED
REASON: USER APPROVAL REQUIRED
```

Erst nach ausdrücklicher Freigabe fortsetzen.
