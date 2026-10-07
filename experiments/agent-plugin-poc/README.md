# Agent-Plugin-PoC: `doc-diff`

## Ziel und Umfang

Dieses isolierte Paket prüft, ob der vorhandene `doc-diff`-Skill als Skill-only
Agent Plugin verteilt werden kann. Es wird weder installiert noch in den Pi-
Core oder die produktive Skill-Konfiguration eingebunden. Die Skill-Datei ist
byte-identisch mit `skills/doc-diff/SKILL.md`.

## Portabel

- `plugin.json` enthält das portable Agent-Plugins-Schema und die stabile
  Identität mit `name`, `version` und `description`.
- Portable Hosts erkennen Skills im Paketpfad `skills/<name>/SKILL.md`; für
  dieses Layout ist kein `skills`-Feld im Manifest nötig.
- Skill-Frontmatter (`name`, `description`) und Markdown-Anweisungen werden
  unverändert übernommen.
- Der Skill ist read-only und benötigt keine MCP-Server, Zugangsdaten oder
  zusätzlichen Programme. Daher ist kein `mcp.json` nötig.

## Pi-spezifische Annahmen

- Der Skill verweist auf `AGENTS.md` und die aktive Permission-Policy. Das ist
  für den Pi-Einsatz passend; andere Hosts müssen ihre entsprechenden
  Projektregeln anwenden. Das Paket selbst kann diese Regeln nicht festlegen.
- Pi nutzt weiterhin `skills/doc-diff/SKILL.md`. Der PoC kopiert die Datei und
  ändert weder den Pi-Ladepfad noch die Originaldatei.

## Adapter und Entscheidung

Für die getestete Skill-only Struktur reicht Packaging; ein Code-Adapter ist
nicht erforderlich. Falls ein Zielhost keine Projektregeln oder
Permission-Policy mitbringt, braucht es dort eine kurze Regelzuordnung. Das ist
eine Host-Konfiguration, keine Änderung am Skill.

**Entscheidung:** Packaging-only für Skills ohne Pi-Runtime-Abhängigkeit
weiterverfolgen. Keine produktive Plugin-Abhängigkeit und keine Migration
weiterer Skills aus diesem PoC ableiten.

## Abnahmestand

- [x] Isolierter PoC ohne Core- oder Permission-System-Änderung.
- [x] Portierbare Manifestfelder und Skill-Bestandteile dokumentiert.
- [x] Pi-Annahmen, Adaptergrenze und Weiterverfolgungsentscheidung dokumentiert.
- [x] Original-Skill unter Pi unverändert; Paketkopie ist byte-identisch.
- [x] Rückbau ist das Löschen dieses Ordners; es wurden keine Installations- oder
      Marketplace-Dateien geändert.
- [x] Kein `mcp.json`, weil der Skill keinen Server benötigt.

## Grenzen der Prüfung

Die Manifest- und Verzeichnisstruktur wurde lokal geprüft. Der Plugin-Host
wurde nicht installiert oder gestartet; damit ist die Laufzeit-Erkennung durch
einen Host noch nicht nachgewiesen. Das ist außerhalb des P4-Abnahmekatalogs.
`plugin.json` folgt der aktuellen
[offiziellen Plugin-Packaging-Dokumentation](https://developers.openai.com/plugins/build/plugins).
