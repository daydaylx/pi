# 034 – Typed System-Control-Werkzeuge ohne Root-Daemon

## Status

Angenommen.

## Entscheidung

Pi registriert im Systemprofil eine kleine Extension mit typisierten Lese- und Benutzeraktionen. Jeder Prozessstart verwendet ein festes Programm und ein argv-Array über `execFile`; es gibt keinen Shell-Fallback und keinen neuen Root-Daemon. Die einzige privilegierte Aktion startet `nixos-agent-apply` über eine transiente User-Unit.

## Begründung

Ein zusätzlicher Root-Dienst würde eine neue privilegierte Schnittstelle samt eigener Authentisierung und Wartung einführen. Die gleiche UID wird durch Pi nicht verteidigt. `nixos-agent` ist bereits der freigegebene Weg für den Root-Anteil, und Pi ist dort als Aufrufer vorgesehen. Freigaben, feste Argumente und Audit bleiben in Pi; Root-Ausführung bleibt auf die bestehenden `preflight`-/`switch`-sudoers-Regeln beschränkt.

## Folgen

Systemwerkzeuge sind außerhalb des Systemprofils nicht registriert. Read-only-Aufrufe sind immer erlaubt; Benutzeraktionen werden einzeln bestätigt, privilegierte Apply-Aufrufe auch in YOLO-Stufen. Plan Mode, readonly und headless sperren Mutationen. Bash-Umgehungen über geschützte NixOS-/sudo-Befehle fragen im Systemprofil einzeln nach.

Die Shell-Erkennung durchsucht Tokens aller Teilbefehle und zerlegt passende
Nutzlasten wie `bash -c` rekursiv bis Tiefe drei. Sie dient als Unfallschutz,
nicht als Grenze gegen ein adversariales Modell: Variablenindirektion,
Kodierung und Skriptdateien werden nicht erkannt. Die flache Tokenprüfung kann
auch harmlose Treffer wie `echo sudo` zur Rückfrage führen. `grep -r
nixos-agent docs` bleibt erlaubt, da `nixos-agent` kein vollständiger Treffer
für einen geschützten Programmnamen ist. Harte Sperren aus `assessBash` bleiben
dabei vorrangig.
