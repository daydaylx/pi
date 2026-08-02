# Projekt-Verifikationsprofile (`.pi/verify.json`)

> Vertrauensgebundene, schema-gestützte projektlokale Prüfprofile.
> Issues: [#105](https://github.com/daydaylx/pi/issues/105) und
> [#123](https://github.com/daydaylx/pi/issues/123).

## Zweck

Ein **vertrautes** Projekt kann seine eigenen Prüfungen (Typecheck, Lint, Tests,
Build, projektspezifische Checks) deklarieren – z. B. eine JS-Profil `npm test`,
eine Python-Profil `pytest`, eine Rust-Profil `cargo test`. Das Tool
`project_check` führt ausdrücklich angeforderte Profile in ihrer angegebenen
Reihenfolge aus. Es gibt kein automatisches Abschluss-Gate und keine
Pflichtprüfung nach Änderungen.

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

## Ausführen mit `project_check`

Das Tool akzeptiert entweder ein einzelnes Profil oder eine kleine geordnete
Liste (maximal acht), aber niemals ein freies Shell-Kommando:

```text
project_check({ "profile": "typecheck" })
project_check({ "profiles": ["typecheck", "tests"] })
```

Bei einem `agent_end` mit Projektänderungen erscheint eine kurze, nicht
blockierende Warnung, falls seit dem aktuellen Diff kein erfolgreicher
`required`-Check lief. Ein Check vor einer weiteren Änderung gilt dabei nicht
als aktuell. Ohne Pflichtprofil erscheint höchstens ein Hinweis; es gibt weder
einen automatischen Testlauf noch eine Completion- oder Planphase.

Pro Profil enthält das Ergebnis Profil-ID, redigiertes Programm und Argumente,
relatives Arbeitsverzeichnis, Klassifikation, Start- und Endzeit, Exit-Code,
Dauer, Status und begrenzte relevante Ausgabe. `advisory`-Befunde machen den
Tool-Aufruf nicht fehlerhaft; bei `recommended` bleibt ein fehlendes Binary als
sichtbares Restrisiko erhalten. Ungültige, fehlende oder in nicht vertrauten
Projekten liegende Profile werden nicht ausgeführt.

## Schema

```jsonc
{
  "profiles": {
    "<id>": {
      "program": "pytest",          // Programmname (PATH), kein Shell-String
      "args": ["-q"],               // Argumente, getrennt als Array
      "cwd": ".",                   // relativ zum Projekt-Root, kein Escape
      "timeoutMs": 300000,          // 1000..900000
      "classification": "required", // required | recommended | advisory
      "required": true,             // Legacy-Projektion
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
| `args` | string[] | – (Pflicht) | Argumente, verbatim und getrennt. Leeres Array erlaubt, max. 64 Einträge. |
| `cwd` | string | `"."` | Muss relativ sein und unter dem Projekt-Root bleiben. Absolut/`..` → Profil ungültig. |
| `timeoutMs` | int | `120000` | Bereich 1000..900000. |
| `classification` | string | `required` | `required`, `recommended` oder `advisory`. |
| `required` | bool | `true` | Legacy-Projektion; darf einer expliziten Klassifikation nicht widersprechen. |
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
- **Additiv-Env:** nur deklarierte Keys werden gesetzt/überschrieben; sie
  erscheinen nicht im Tool-Ergebnis.
- **Trust-Pflicht:** ohne Vertrauen keine Auswertung, keine Ausführung.

## Troubleshooting

| Symptom | Ursache | Behebung |
|---|---|---|
| `/setup-doctor`: „ignoriert (untrusted)“ | Projekt nicht vertraut | Projekt vertrauen. |
| Profil fehlt, Diagnose „unbekannter Schlüssel“ | Tippfehler im Schema | Schlüssel korrigieren; fail-closed hat das Profil entfallen lassen. |
| Diagnose „cwd … verlässt den Projekt-Root“ | absoluter oder `..`-Pfad | relatives `cwd` unterhalb des Projekts verwenden. |
| Lauf-Ergebnis `missing_binary` | Programm nicht installiert | Binary installieren oder Profil entfernen. |
| Lauf-Ergebnis `timeout` | `timeoutMs` zu klein | realistischeres Timeout setzen. |
