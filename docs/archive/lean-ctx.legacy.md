> **LEGACY-ARCHIV:** Am 2026-07-04 aus `~/.pi/rules/lean-ctx.md`
> übernommen. Pi lädt diese Datei nicht; `pi-lean-ctx` ist weiterhin
> deaktiviert.

# lean-ctx — DEAKTIVIERT

> **Status (Stand 2026-07-01): inaktiv.**
>
> Diese Regel ist außer Kraft, weil das Paket `pi-lean-ctx` beim Config-Cleanup
> entfernt wurde. Die hier ursprünglich geforderten `ctx_*`-Tools
> (`ctx_read`, `ctx_search`, `ctx_shell`, `ctx_edit`, `ctx_overview` usw.)
> stehen **nicht mehr zur Verfügung**.
>
> Bitte die **nativen Werkzeuge** verwenden: `read`, `grep`/`find`, `bash`,
> `edit`/`write`. Der frühere Hinweis „NEVER use native Read/Grep/Shell" ist
> **hinfällig**.
>
> Falls `pi-lean-ctx` später wieder aktiviert wird, kann die ursprüngliche
> Regel aus dem Git-Verlauf restauriert werden (die Datei `rules/lean-ctx.md`
> lag nicht im `agent/`-Git-Repo; ggf. Separate Sicherung prüfen).
