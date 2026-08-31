# Benchmark v2: Pi vs. Codex auf Harbor

Ablösung des Runners/Controllers der bisherigen `benchmarks/`-Serien (P3–P6)
durch [Harbor](https://github.com/harbor-framework/harbor) bei
Weiterverwendung bereits kalibrierter Fachlogik (Tokenfeld-Mapping,
Task-Inhalte, Subagenten-Artefaktauswertung). Details, Architektur und
gestufter Ausführungsplan: siehe
`/home/d/.claude/plans/arbeitsauftrag-pi-vs-codex-benchmark-eager-sparkle.md`.

`benchmarks/` (P3–P6) bleibt unverändert als historisches Artefakt bestehen
und wird von diesem Verzeichnis nicht berührt.

## Status: Sitzung 1 abgeschlossen (2026-08-31)

Ziel war ausschließlich, die Harbor-Plumbing nachzuweisen — noch **kein**
echter Pi-Produktivstack, keine echten Task-Migrationen, keine Pilotzahlen.

Siehe `HARBOR_SETUP.md` für Setup-Details und das dokumentierte
Sitzung-1-Ergebnis (inkl. eines echten, für Sitzung 2 relevanten Fundes zur
Pi-Credential-Auflösung).

## Nächster Schritt

Sitzung 2 (separat freizugeben, siehe Plan): echter Pi-Produktivstack im
Docker-Image, `ask-user.ts`-RPC-Fix als eigener Produktcode-Vorschritt,
OAuth-Credential-Mounting für `openai-codex`/`gpt-5.6-terra` nach dem in
Sitzung 1 verifizierten Vorbild von Harbors eigenem Codex-Adapter
(`_resolve_auth_json_path`/`CODEX_FORCE_AUTH_JSON`).
