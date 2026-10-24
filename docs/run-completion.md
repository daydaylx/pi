# Turnende und unabhängiger Nachweis

`agent.settled` beendet den Modellturn. Der Host entscheidet anhand offener
Fehler, laufender Wirkungen und gebundener Readbacks über den Auftrag.

| Aktion nach Turnende                            | Unabhängiger Nachweis                                       | Ergebnis                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Informationsauftrag / erfolgreicher Read        | Kein Wirkungsnachweis nötig                                 | SUCCEEDED ohne Verifikationsreferenz                                                                   |
| Bestätigter Datei-Write/Edit mit absolutem Ziel | Host-SHA passend zum vorher bestimmten Ziel                 | SUCCEEDED erst mit Beleg; sonst höchstens 30 Sekunden VERIFYING, danach fehlender Nachweis             |
| Typisierter Dienst / Arbeitsfläche              | Host-Systemzustand, bei Restart neue Invocation             | SUCCEEDED erst mit passendem Beleg                                                                     |
| NixOS-Apply                                     | Gebundener erfolgreicher Job und Zielgeneration             | Ohne terminalen Job kein Erfolg; offene externe Wirkung nach Frist sowie Crash/Abort separat UNCERTAIN |
| Audio / Fensterfokus                            | Derzeit kein unabhängiger Host-Proof im bestehenden Vertrag | Nach beendetem Tool BLOCKED / VERIFICATION_UNAVAILABLE                                                 |
| Shell / beliebiges Tool / project_check         | Kein Systemziel-Proof aus Exitcode oder Footer ableitbar    | Nach beendetem Tool BLOCKED / VERIFICATION_UNAVAILABLE                                                 |
| UI-Notify                                       | Anzeigeereignis, kein Host-Wirkungsbeweis                   | Kein Verifikationsanspruch; separates Tool namens notify konservativ wie unbekanntes Tool              |
| Offener Fehler / Providerfehler                 | Nicht durch Turnende aufgehoben                             | FAILED; bei unbekannter laufender Mutation zuerst UNCERTAIN                                            |

`BLOCKED / VERIFICATION_UNAVAILABLE` ist ein terminaler, unverifizierter
Abschluss. PiSystem zeigt „Beendet – Nachweis fehlt“ und das Ergebnis enthält die
fehlende Evidenz. Der Host hält dafür keinen aktiven Run fest; neue Aufträge
bleiben möglich. Bereits wartende Aufträge werden wie bei anderen negativen
Abschlüssen nicht automatisch gestartet. Es gibt weder einen neuen Runstatus
noch einen modellgenerierten Shellchecker oder eine Wiederholung von Mutationen.

Nach Turnende begrenzt der Host auch die Wartezeit auf unterstützte, noch
nicht gelieferte Proofs auf 30 Sekunden. Fehlt danach die Evidenz, endet der
Run als BLOCKED. Ein offener externer Job oder unbekannte Wirkung bleibt
stattdessen UNCERTAIN und sperrt unkontrollierte neue Mutationen. Ein Hostcrash
während der Wartezeit nutzt die vorhandene Restart-Reconciliation. Die Frist
führt keine Aktion erneut aus und startet keinen selbst erfundenen Checker.

Beendete Runs werden durch spätere beliebige Proofs nicht umgedeutet. Die vier
bestehenden Host-Readbackarten und deren Identitätsbindung bleiben maßgeblich;
`verificationRefs` enthalten ausschließlich tatsächlich gespeicherte Belege.
Providerfehler werden über das bestehende öffentliche Fehlerereignis transportiert;
private Providertexte werden weder dafür veröffentlicht noch im Run gespeichert.
