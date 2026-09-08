Pi unterstützt eine optionale, read-only Language-Server-Integration
(`extensions/lsp/`, Dokumentation in `docs/lsp.md`). Eingebaute Serverprofile
liegen in `extensions/lsp/server-profiles.ts`. Aktuell werden TypeScript/
JavaScript, Python, Go, Rust, C/C++ und Java unterstützt — Ruby fehlt.

Aufgabe: Ergänze ein eingebautes Serverprofil für Ruby, das den `solargraph`
Language Server ansteuert (Kommando `solargraph`, Subcommand `stdio`).

Anforderungen:

- Neuer Eintrag `ruby` in `PROFILES` (gleiche Struktur wie die bestehenden
  Einträge: id, label, enabled, command, args, rootMarkers, optional notes).
- `rootMarkers` müssen mindestens `Gemfile` enthalten.
- Wie bei Go/C/Java (Servern, die Toolchain-Kommandos ausführen oder
  ressourcenintensiv sind): das Profil muss standardmäßig deaktiviert
  (`enabled: false`, Opt-in) sein — Solargraph kann projektlokale Ruby-
  Skripte zur Introspektion ausführen. Begründe diese Wahl mit einem kurzen
  Notiz-Feld (`notes`), analog zu den bestehenden Opt-in-Profilen.
- `EXTENSION_LANGUAGE_MAP` muss `.rb` und `.rake` auf `{ profileId: "ruby",
languageId: "ruby" }` abbilden.
- `docs/lsp.md`: Die Server-Matrix-Tabelle um eine Ruby-Zeile ergänzen,
  konsistent mit den bestehenden Zeilen.
- Ergänze in `tests/suites/lsp.mjs` (Abschnitt "Server profile defaults")
  eine Prüfung, dass auch das neue Ruby-Profil standardmäßig deaktiviert
  ist, plus eine Prüfung, dass `.rb`/`.rake` korrekt auf das Ruby-Profil
  gemappt werden.

Nicht Teil dieser Aufgabe: das tatsächliche Starten/Testen eines echten
Solargraph-Prozesses, Änderungen an `client.ts`/`registry.ts`/`process.ts`,
oder an anderen bestehenden Profilen.
