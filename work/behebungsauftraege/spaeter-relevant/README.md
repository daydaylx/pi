# Später relevant

Aufträge in diesem Ordner sind fachlich unverändert gültig, aber aktuell
zurückgestellt — nicht Teil der laufenden Abarbeitung der P1/P2-Liste.

## GUI-001, GUI-002

Beide hängen an echten Electron-/GUI-E2E-Tests statt an der schnellen
Node-Test-Suite. `npm run test:gui` erwies sich bei der SNAP-001-Arbeit als
spürbar langsamer und gelegentlich flaky (`SESSION RPC FAIL: Timeout für
get_state`, reproduzierbar mit identischem, unverändertem Stand einmal
fail/einmal pass) — unabhängig vom eigentlichen Codeinhalt. Das macht sie zu
den aufwendigsten und am wenigsten planbaren P2-Punkten, verglichen mit den
übrigen, rein auf der Node-Testsuite laufenden Aufträgen.

Zurückstellung, kein Verwerfen: beide Befunde bleiben gültig und sollten
bearbeitet werden, sobald GUI/Electron-Tests ohnehin angefasst werden oder
mehr Zeit für die zusätzliche E2E-Verifikation eingeplant ist.
