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

Bei `agent_settled` zeigt die Footer-Statuszeile den rein technischen
Verifikationsstatus des aktuellen Workspace: `clean`, `changed_unverified`,
`verified`, `checks_failed` oder `checks_unavailable`.
`agent_end` ist kein Completion- oder Verifikationssignal. Ohne Pflichtprofil
bleibt der Status bei Änderungen `checks_unavailable`; es gibt weder einen
automatischen Testlauf noch eine Completion- oder Planphase. Die Anzeige kann
über `verificationStatus.enabled` in der Setup-Konfiguration deaktiviert werden.

Nur ein `project_check`-Aufruf des deklarierten Pflichtprofils aktualisiert
diesen Status. Ein direkter `bash`-Lauf des gleichen Befehls — oder ein Lauf
aus einem Subagenten heraus (`verifier` besitzt kein `project_check`) — lässt
den Footer bei `changed_unverified` stehen,
selbst wenn der Lauf lokal grün war. Das ist keine Ungenauigkeit, sondern
Konsequenz aus „Akkumulation nur bei identischem Snapshot" unten: nur
`project_check` schreibt in den Ledger.

Pro Profil enthält das Ergebnis Profil-ID, redigiertes Programm und Argumente,
relatives Arbeitsverzeichnis, Klassifikation, Start- und Endzeit, Exit-Code,
Dauer, Status und begrenzte relevante Ausgabe. `advisory`-Befunde machen den
Tool-Aufruf nicht fehlerhaft; bei `recommended` bleibt ein fehlendes Binary als
sichtbares Restrisiko erhalten. Ungültige, fehlende oder in nicht vertrauten
Projekten liegende Profile werden nicht ausgeführt.

Ein fehlgeschlagenes Profil kann das optionale, rein beschreibende Feld
`changed_since_pass` tragen. Es ist nur dann gesetzt, wenn dasselbe Profil in
dieser Sitzung zuvor erfolgreich war und der aktuelle Workspace-Fingerprint
hiervon abweicht. Das Feld beeinflusst keinen Task- oder
Verifikationsstatus und macht keine Aussage über Kausalität oder
„vorbestehende“ Fehler.

## Was `verified` bedeutet

`verified` heißt genau eines: **jedes deklarierte `required`-Profil** ist gegen
**genau diesen Workspace-Snapshot** erfolgreich gelaufen. Es ist kein Beweis,
dass die eigentliche Aufgabe erledigt ist — nur, dass die technischen Prüfungen
für diesen Dateizustand durchgelaufen sind.

Daraus folgen drei Regeln:

- **Abdeckung.** Ein Lauf, der nur einen Teil der `required`-Profile ausführt,
  ergibt niemals `verified`. `project_check` schreibt am Ende seiner Ausgabe die
  Zeile `Pflichtabdeckung: <n>/<m>` und benennt die offenen Profile.
- **Akkumulation nur bei identischem Snapshot.** Die Abdeckung darf sich über
  mehrere `project_check`-Aufrufe addieren, aber ausschließlich solange der
  Workspace-Fingerprint unverändert bleibt. Jede Änderung an Dateien — und jeder
  Wechsel des Workspace-Roots — verwirft die gesammelte Abdeckung vollständig.
- **Keine widersprüchlichen Status.** Blockiert ein Lauf (Tool-Ergebnis ist ein
  Fehler), kann derselbe Snapshot nicht gleichzeitig `verified` sein. Das gilt
  auch für einen bestätigten `recommended`-Fehlschlag — und selbst dann, wenn
  das Projekt gar kein `required`-Profil deklariert: `checks_failed` verdrängt
  `checks_unavailable`.
- **Nur ein Erfolg räumt einen Fehlschlag weg.** Ein bestätigter
  `recommended`-Fehlschlag bleibt für seinen Snapshot bestehen, bis genau dieses
  Profil erfolgreich erneut läuft. Verschwindet stattdessen sein Binary, ist das
  Restrisiko — es setzt keinen neuen Block, löscht aber auch den bestehenden
  nicht. Andernfalls könnte ein deinstalliertes Werkzeug `checks_failed` wieder
  zu `verified` machen, ohne dass irgendetwas behoben wurde.

Der Ledger, der das festhält, ist ein einziger flüchtiger Datensatz pro Session:
an einen Workspace-Root und einen Fingerprint gebunden, nicht persistiert, keine
Datenbank. Nach dem Sitzungsende ist jede Abdeckung wieder offen.

### Status-Matrix

| Lauf gegen den aktuellen Snapshot           | Tool-Ergebnis | Status                |
| ------------------------------------------- | ------------- | --------------------- |
| alle `required` erfolgreich, Abdeckung voll  | ok            | `verified`            |
| `required` erfolgreich, Abdeckung unvollständig | ok         | `changed_unverified`  |
| ein `required` schlägt fehl                  | **Fehler**    | `checks_failed`       |
| ein `required` läuft nicht (Timeout, Binary) | **Fehler**    | `checks_unavailable`  |
| `recommended` schlägt bestätigt fehl         | **Fehler**    | `checks_failed`       |
| `recommended`: Binary fehlt                  | ok            | unverändert (Restrisiko) |
| `advisory` schlägt fehl                      | ok            | unverändert           |
| Workspace nach dem Lauf geändert             | –             | `changed_unverified`  |
| kein `required` deklariert, aber bestätigter Fehlschlag | –  | `checks_failed`       |
| kein `required`-Profil deklariert / untrusted | –            | `checks_unavailable`  |
| keine Änderungen im Workspace                | –             | `clean`               |

Ein echter `required`-Fehlschlag hat Vorrang vor einem gleichzeitigen Lauf ohne
Verdikt: `checks_failed` verdrängt `checks_unavailable`.

Ist der Workspace unverändert, meldet der Status `clean` — auch dann, wenn eine
Prüfung auf dem unveränderten Stand fehlschlagen würde. `clean` beschreibt
ausschließlich „nichts geändert", nicht „alles in Ordnung".

## Schema

```jsonc
{
  "profiles": {
    "<id>": {
      "program": "pytest", // Programmname (PATH), kein Shell-String
      "args": ["-q"], // Argumente, getrennt als Array
      "cwd": ".", // relativ zum Projekt-Root, kein Escape
      "timeoutMs": 300000, // 1000..900000
      "classification": "required", // required | recommended | advisory
      "required": true, // Legacy-Projektion
      "env": { "KEY": "value" }, // additiv auf process.env
      "trustRequired": true, // nur in vertrauten Projekten ausführen
    },
  },
}
```

### Felder

| Feld             | Typ             | Default     | Hinweis                                                                               |
| ---------------- | --------------- | ----------- | ------------------------------------------------------------------------------------- |
| `program`        | string          | – (Pflicht) | Programmname, via PATH aufgelöst. Kein Shell-String, keine Pipes.                     |
| `args`           | string[]        | – (Pflicht) | Argumente, verbatim und getrennt. Leeres Array erlaubt, max. 64 Einträge.             |
| `cwd`            | string          | `"."`       | Muss relativ sein und unter dem Projekt-Root bleiben. Absolut/`..` → Profil ungültig. |
| `timeoutMs`      | int             | `120000`    | Bereich 1000..900000.                                                                 |
| `classification` | string          | `required`  | `required`, `recommended` oder `advisory`.                                            |
| `required`       | bool            | `true`      | Legacy-Projektion; darf einer expliziten Klassifikation nicht widersprechen.          |

`required: false` bildet auf `advisory` ab, **nicht** auf `recommended` — die
Legacy-Form kann `recommended` nicht ausdrücken. Wer einen blockierenden, aber
nicht abdeckungsrelevanten Check will, muss `classification: "recommended"`
ausdrücklich setzen.
| `env`            | {string:string} | `{}`        | Zusätzliche/übersteuernde Env-Variablen.                                              |
| `trustRequired`  | bool            | `true`      | Explizite Vertrauensanforderung (Redundanz zum Trust-Gate, aber auditierbar).         |

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
    "typecheck": {
      "program": "npm",
      "args": ["run", "typecheck"],
      "timeoutMs": 120000
    },
    "tests": { "program": "npm", "args": ["test"], "timeoutMs": 300000 },
    "lint": { "program": "npm", "args": ["run", "lint"], "required": false }
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

| Symptom                                        | Ursache                    | Behebung                                                            |
| ---------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `/setup-doctor`: „ignoriert (untrusted)“       | Projekt nicht vertraut     | Projekt vertrauen.                                                  |
| Profil fehlt, Diagnose „unbekannter Schlüssel“ | Tippfehler im Schema       | Schlüssel korrigieren; fail-closed hat das Profil entfallen lassen. |
| Diagnose „cwd … verlässt den Projekt-Root“     | absoluter oder `..`-Pfad   | relatives `cwd` unterhalb des Projekts verwenden.                   |
| Lauf-Ergebnis `missing_binary`                 | Programm nicht installiert | Binary installieren oder Profil entfernen.                          |
| Lauf-Ergebnis `timeout`                        | `timeoutMs` zu klein       | realistischeres Timeout setzen.                                     |
