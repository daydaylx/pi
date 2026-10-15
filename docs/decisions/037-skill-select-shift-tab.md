# 037 — Skill-Auswahl auf Shift+Tab

Status: angenommen · 2026-10-15

## Entscheidung

Shift+Tab (und `/skill`) öffnet eine durchsuchbare Liste der von der Runtime
geladenen Skills. Die Auswahl merkt **einen** Skill für die nächste normale
Nutzernachricht vor; beim Absenden wird ihr `/skill:<name> ` vorangestellt und
die native Skill-Expansion der Runtime lädt die `SKILL.md`. Implementiert in
`extensions/skill-select/index.ts` (rund 170 Zeilen), Menü über die geteilte
Aurora-Auswahl (`runMenu` mit `typeToSearch`), Vormerkung als `Skill: <name>`
im Footer.

## Begründung

- Die Runtime führt `input`-Handler **vor** `_expandSkillCommand` aus
  (`core/agent-session.js`). Ein `transform` auf `/skill:<name> <Text>` nutzt
  dadurch die vorhandene Ladepipeline: keine zweite Skill-Registry, kein
  eigenes Lesen von Skill-Dateien, keine doppelte Injektion, keine neue
  Nachrichtenart.
- Die Liste kommt aus `pi.getCommands()` (Quelle `skill`). Damit gelten
  Projektvertrauen, konfigurierte Pfade und Pakete exakt wie in der Runtime;
  `pi system` zeigt nur dort geladene Skills.
- Die Auswahl ändert keine Zugriffsstufe, keinen Trust, kein Recovery- oder
  Verifier-Verhalten.

## Verworfen: `pi-skill-palette` 2.2.0

Das Paket (MIT, ~1000 Zeilen, nur Peer-Abhängigkeiten) wurde geprüft und nicht
übernommen:

- **Pinning:** `pinned: true` im Frontmatter und die Palette hängen Skills
  dauerhaft an den System-Prompt. Das widerspricht „Skills sind aufgabenbezogen
  und zeitlich begrenzt“.
- **Eigene Ladepipeline:** liest `SKILL.md` selbst per `fs`, baut eigene
  `<skill>`-Blöcke und eine eigene Nachrichtenart; das dupliziert die native
  Expansion.
- **Zustand:** globaler Modulzustand ohne Reset bei Sitzungswechsel, `/reload`
  oder Fork.
- **Darstellung:** feste ANSI-/Regenbogenfarben, `theme.json` aus dem
  Home-Verzeichnis, Emoji-Status, 30-s-Timer-Dialog — nichts davon folgt dem
  Aurora-Theme. Ein Umbau hätte den größten Teil des Pakets ersetzt.
- `@kmiyh/pi-skills-menu` hängt an den alten `@mariozechner/*`-Paketen.

## Folgen

- **Eine** Vormerkung, kein Pinning, keine Mehrfachauswahl (die native
  Expansion kennt nur einen Skill pro Nachricht).
- Verbrauch: beim Absenden der nächsten Nachricht, die weder mit `/` beginnt
  noch von einer Extension stammt. Reset bei `session_start` (neu, Wechsel,
  Fork, `/reload`).
- Ein nach `/reload` entfallener Skill wird nicht geladen und gemeldet.
- Frontend-Protokoll unverändert: die Auswahl ist TUI-only; externe Clients
  können `/skill <name>` über den Slash-Weg nutzen, es gibt keinen neuen
  Protokollbefehl.
- `keybindings.json` muss `app.thinking.cycle` weiter auf Super+T halten.
