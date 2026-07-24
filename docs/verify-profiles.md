# Projekt-Verifikationsprofile (`.pi/verify.json`)

> Vertrauensgebundene, schema-gestützte projektlokale Prüfprofile.
> Issue: [#105](https://github.com/daydaylx/pi/issues/105) – Foundation für das
> universelle Verifikations-Gate [#102](https://github.com/daydaylx/pi/issues/102).

## Zweck

Ein **vertrautes** Projekt kann seine eigenen Prüfungen (Typecheck, Lint, Tests,
Build, projektspezifische Checks) deklarieren – z. B. eine JS-Profil `npm test`,
eine Python-Profil `pytest`, eine Rust-Profil `cargo test`. Das künftige
Verifikations-Gate (#102) führt diese Profile deterministisch aus, bevor eine
Aufgabe als abgeschlossen gilt.

## Abgrenzung zur Setup-Verifikation (wichtig)

Die Setup-Verifikation (`verify`-Tool, `verification` in `setup.json`) ist eine
**unverletzliche Setup-Fähigkeit**: sie läuft immer im Agent-Verzeichnis und kann
von **keinem** Projekt geändert werden. Projekt-Verifikationsprofile sind eine
**separate, zusätzliche** Schicht – sie ersetzen die Setup-Verifikation nicht und
lockern keine globalen Grenzen.

## Trust-Gate

- `.pi/verify.json` wird **nur in vertrauten Projekten** gelesen.
- In nicht vertrauten Projekten wird die Datei komplett ignoriert (Diagnose:
  „ignored until the project is trusted“).
- `/setup-doctor` zeigt den Status: Anzahl geladener Profile bzw. „ignoriert
  (untrusted)“.

## Schema

```jsonc
{
  "profiles": {
    "<id>": {
      "program": "pytest",          // Programmname (PATH), kein Shell-String
      "args": ["-q"],               // Argumente, getrennt als Array
      "cwd": ".",                   // relativ zum Projekt-Root, kein Escape
      "timeoutMs": 300000,          // 1000..900000
      "required": true,             // Pflichtprüfung (Gate blockiert sonst)
      "env": { "KEY": "value" },    // additiv auf process.env
      "trustRequired": true         // nur in vertrauten Projekten ausführen
    }
  }
}
```

### Felder

| Feld | Typ | Default | Hinweis |
|---|---|---|---|
| `program` | string | – (Pflicht) | Programmname, via PATH aufgelöst. Kein Shell-String, keine Pipes. |
| `args` | string[] | `[]` | Argumente, verbatim und getrennt. Max. 64 Einträge. |
| `cwd` | string | `"."` | Muss relativ sein und unter dem Projekt-Root bleiben. Absolut/`..` → Profil ungültig. |
| `timeoutMs` | int | `120000` | Bereich 1000..900000. |
| `required` | bool | `true` | `false` = optionale Prüfung (Gate warnt nur). |
| `env` | {string:string} | `{}` | Zusätzliche/übersteuernde Env-Variablen. |
| `trustRequired` | bool | `true` | Explizite Vertrauensanforderung (Redundanz zum Trust-Gate, aber auditierbar). |

### Fail-closed-Validierung

Unbekannte Schlüssel (Top-Level oder pro Profil) und falsche Typen führen zu
einer Fehlerdiagnose und lassen das betroffene Profil **entfallen** – ein Tipp-
fehler startet also niemals ein falsches Kommando. `/setup-doctor` listet alle
Diagnosen.

## Beispiele

### Node / TypeScript

Siehe [`verify-profiles.example.json`](verify-profiles.example.json).

```json
{
  "profiles": {
    "typecheck": { "program": "npm", "args": ["run", "typecheck"], "timeoutMs": 120000 },
    "tests":     { "program": "npm", "args": ["test"],            "timeoutMs": 300000 },
    "lint":      { "program": "npm", "args": ["run", "lint"],     "required": false }
  }
}
```

### Python (pytest)

```json
{
  "profiles": {
    "tests": {
      "program": "pytest",
      "args": ["-q", "--maxfail=1"],
      "cwd": ".",
      "timeoutMs": 300000,
      "env": { "PYTHONDONTWRITEBYTECODE": "1" }
    }
  }
}
```

## Sicherheitsgarantien

- **Keine Shell:** Ausführung immer als `program` + `args[]`; keine Shell-
  Konstruktion, keine Pipes/Redirections aus Projektwerten.
- **Begrenztes `cwd`:** Pfad-Traversal (`..`/absolut) wird beim Laden und vor
  der Ausführung abgelehnt.
- **Begrenztes Timeout:** harte Obergrenze, kein endloses Hängen.
- **Additiv-Env:** nur deklarierte Keys werden gesetzt/überschrieben;
  `process.env` wird nicht als ganzes durchgereicht.
- **Trust-Pflicht:** ohne Vertrauen keine Auswertung, keine Ausführung.

## Troubleshooting

| Symptom | Ursache | Behebung |
|---|---|---|
| `/setup-doctor`: „ignoriert (untrusted)“ | Projekt nicht vertraut | Projekt vertrauen. |
| Profil fehlt, Diagnose „unbekannter Schlüssel“ | Tippfehler im Schema | Schlüssel korrigieren; fail-closed hat das Profil entfallen lassen. |
| Diagnose „cwd … verlässt den Projekt-Root“ | absoluter oder `..`-Pfad | relatives `cwd` unterhalb des Projekts verwenden. |
| Lauf-Ergebnis `missing_binary` | Programm nicht installiert | Binary installieren oder Profil entfernen. |
| Lauf-Ergebnis `timeout` | `timeoutMs` zu klein | realistischeres Timeout setzen. |
