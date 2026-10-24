# Release- und Aktivstand lesen

Aus dem Pi-Checkout:

```sh
node scripts/release-state.mjs
```

Der Bericht liest ausschließlich bekannte Produktdateien und Prozessidentitäten.
Er trennt Checkout-Commit und Dirtyzustand, Runtime-Pin, Runtime auf Platte,
installierte Dateihashes, GUI-Binary und beobachtete Host-/Adapter-/Runtimeprozesse.
Er liest weder Sessioninhalte noch Auth-Dateien oder Prozessumgebungen und führt
keine Installation oder Serviceaktion aus. Fehlende Belege erscheinen als `null`
oder `unknown`; zwei fehlende Dateien zählen nicht als Übereinstimmung.

Ein Hash der aktuell installierten JavaScriptdatei beweist nicht, welche Bytes ein
bereits laufender Nodeprozess geladen hat. Auch ein Runtime-Paket mit passender
Version beweist keine erfolgreiche Patchausführung. Diese Angaben bleiben
unbekannt, bis ein gebundener Start-/Buildnachweis vorhanden ist. Für GUI-Prozesse
wird das tatsächliche Executable über `/proc/<pid>/exe` gehasht; das ersetzt keine
Funktionsabnahme. Die Erhebung ist eine Momentaufnahme, kein atomarer Systemdump.

## Spätere Aktivierung

Vor einer konkreten Freigabe nur den Bericht sowie `systemctl --user show
pi-system-host.service -p MainPID -p ExecStart -p FragmentPath -p DropInPaths`
erheben. Aktive Runs/Applyjobs vor einer Aktivierung gesondert und ohne private
Inhalte prüfen. Keine aktive Sitzung für einen Versionsvergleich beenden.

Der bestehende Installationspfad ist `scripts/install-user.mjs`; NixOS-Paketierung
und Recovery bleiben im Repository `nixos-config`. Vor einer genehmigten
Aktivierung müssen der vollständige gebaute Versionssatz, die vorherige
Generation, die Units und ein wieder startfähiger Rückweg gesichert sein.
Build, Installation und tatsächlicher Neustart benötigen jeweils eigene Belege.
Ein Bericht dieses Skripts ist weder eine Freigabe noch ein Rollbacktest.
