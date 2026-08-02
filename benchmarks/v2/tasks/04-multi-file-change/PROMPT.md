Führe keine neue Permission-Stufe ein. Ergänze stattdessen der bestehenden
Beschreibung von `read-bash` einen Hinweis, dass Bash in dieser Stufe nur
informative (nicht schreibende) Befehle erlaubt — die Beschreibung wird direkt
im Kontextmenü angezeigt (`extensions/shared/permission-menu.ts`,
`buildPermissionMenu`). Ergänze außerdem einen Testfall in `tests/run.mjs`,
der die aktualisierte Beschreibung prüft.
