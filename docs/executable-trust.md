# Executable-Vertrauen

Gilt für die Befehlsklassifikation in `extensions/shared/permission-policy.ts`.
Sie wird von der Recovery-Fähigkeit „read-only Shell“ (`isRecoveryReadOnlyCommand`)
genutzt; die Zugriffsstufe `readonly` nutzt den strikteren Parser
`parseReadOnlyShell` (`isReadOnlyCommand`). Die Klassifikation ist ein Guard vor
dem Executor, keine OS-Sandbox.

Zwei getrennte Fragen (`extensions/shared/permission-policy.ts`):

- `resolveExecutableTrust`: **Ist das ein vertrauenswürdiges Systemprogramm?**
  Discovery → Quelle → Ziel. Dient der Klassifikation und der Diagnose.
- `diagnoseCommandSafety`: **Darf der Befehl als harmlos gelten?** Offen, außer
  bei projektkontrollierten Treffern.

**Discovery:** Der erste ausführbare PATH-Treffer gilt; ein späterer Treffer
gleichen Namens ist nie ein Fallback. Relative und leere PATH-Einträge zeigen
auf das Arbeitsverzeichnis des Befehls.

**Systemquellen** (`resolveExecutableTrust` meldet `trusted`):

| Quelle             | Pfade                                                                        | Bedingung                                                                |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Klassische Distro  | `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`                                     | Realpath des Ziels bleibt in diesen Verzeichnissen                       |
| NixOS-Systemprofil | `/run/current-system/sw/bin`, `/nix/var/nix/profiles/default/bin`            | Gefunden **über** das Profil; Profilverzeichnis und Ziel liegen im Store |
| Host-Laufzeit      | der beim Modulstart gefundene `rg`, das laufende `node` (`process.execPath`) | Exakter Realpath, außerhalb des Projekts                                 |
| Shell-Builtins     | `echo`, `printf`, `pwd`, `type`                                              | Nur ohne Pfad                                                            |

Bei Systemprofil-Treffern ist der Werkzeugname der **aufgerufene Name**, nicht
der Realpath: Nix-Pakete wie coreutils sind Multicall-Binaries
(`ls -> …/bin/coreutils`), die über `argv[0]` verzweigen. `/nix/store` allein ist
kein Systembeweis (gruppenschreibbar, enthält auch Benutzer- und
Projekt-Closures); `~/.nix-profile`, `~/.local/bin` und ein Store-`bin` im PATH
sind keine Systemquelle.

**Entscheidung `diagnoseCommandSafety`:** Ein Programm, das keine Systemquelle ist (Benutzer-
profil, `nix develop`-Pfad, `~/.local/bin`, absoluter Pfad außerhalb des
Projekts), gilt trotzdem als startbar, wenn seine Wirkung harmlos ist.
Das ist bewusst offener als ein Systempfad-Zwang, weil sonst gewöhnliche
Erkundung (`rg`, `python3 --version`, `npm ls` aus einer Benutzerinstallation)
scheitern würde. Abgelehnt (`executable-untrusted`) werden nur:

- projektkontrollierte Treffer: erster PATH-Treffer oder absoluter Pfad im
  Projekt (`bin/ls`, `node_modules/.bin/ls`, relativer/leerer PATH-Eintrag,
  Symlink ins Projekt). `PATH=/projekt/fake-bin:/run/current-system/sw/bin` mit
  `/projekt/fake-bin/ls` wird abgelehnt, ohne Rückfall auf das System-`ls`;
- relative pfadbehaftete Aufrufe (`./ls`, `./git status`, `../x/ls`);
- PATH-/Loader-Overrides vor dem Befehl (siehe unten).

**Prefix-Umgehungen:** `env`, `nohup` und Zuweisungen vor dem Befehl werden
mitgeprüft. `PATH=…`, `LD_*`, `DYLD_*`, `BASH_ENV` und `ENV` vor einem Befehl
machen ihn unverifizierbar, weil die Shell dann einen anderen Suchpfad nutzt als
die Prüfung.

**Bewusste Randfälle und Grenzen:**

- Ein Programm aus einem Benutzer- oder Store-Pfad wird nicht auf Echtheit
  geprüft: ein bösartiges Binary in `~/.local/bin` würde als harmlos gelten,
  sofern sein Name harmlos klassifiziert ist. Das ist ein bewusst akzeptiertes
  Risiko; der Schutz gilt dem, was ein Projekt einschleusen kann.
- Ein Aufruf ohne PATH-Treffer oder mit nicht vorhandenem absolutem Pfad
  außerhalb des Projekts startet nichts und wird nicht abgelehnt.
- Die Prüfung ist eine Momentaufnahme vor der Ausführung (TOCTOU).
- Skriptinhalte und Wrapper werden nicht inspiziert.
- `LD_PRELOAD` & Co. werden nur als Präfix des Befehls erkannt, nicht, wenn sie
  bereits in der Umgebung des Agentenprozesses gesetzt sind.

Die Klassifikation schützt nicht vor Befehlen, die ein Mensch selbst per
`!`/`!!` eingibt (`user_bash`); dort gelten die Zugriffsstufe und die harten
Grenzen aus `extensions/permissions/guards.ts`.

