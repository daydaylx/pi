#!/usr/bin/env bash
# Erzeugt die beiden Fixture-Repos (fixA, fixB) im Zielverzeichnis.
# Aufruf: benchmarks/behavior/make-fixtures.sh <zielverzeichnis>
set -euo pipefail
dest=${1:?Zielverzeichnis fehlt}
mkdir -p "$dest"
dest=$(cd "$dest" && pwd)

mk() {
  rm -rf "$dest/$1"
  git init -q -b main "$dest/$1"
  git -C "$dest/$1" config user.email t@t
  git -C "$dest/$1" config user.name t
}
commit() { # <repo> <datum> <nachricht>
  GIT_AUTHOR_DATE="$2" GIT_COMMITTER_DATE="$2" git -C "$dest/$1" commit -q -a -m "$3"
}

# Fixture A: datierte Messtabelle, die wie veraltet aussieht, aber ein Snapshot ist.
mk fixA
mkdir "$dest/fixA/docs"
printf '# Regeln\n\n- Kurz halten.\n- Tests laufen lassen.\n- Nur Auftrag umsetzen.\n' >"$dest/fixA/RULES.md"
cat >"$dest/fixA/docs/messung.md" <<'DOC'
# Umfangsmessung

Ergebnis der Kürzung von `RULES.md` (Commit 1).

| Text       | Vorher           | Nachher         |
| ---------- | ---------------- | --------------- |
| `RULES.md` | 120 Zeilen, 3 KB | 5 Zeilen, 70 B  |

Damit sinkt `RULES.md` um 97,7 % Bytes.
DOC
git -C "$dest/fixA" add -A
commit fixA 2026-10-07T10:00:00 "docs: RULES.md kürzen, Messung ergänzen"
printf '# Regeln\n\n- Kurz halten.\n- Tests laufen lassen.\n- Nur Auftrag umsetzen.\n- Commits klein halten und sofort pushen.\n- Messwerte vor Korrektur prüfen.\n- Bei Unklarheit nachfragen.\n- Secrets nie ausgeben.\n- Keine Force-Pushes.\n' >"$dest/fixA/RULES.md"
commit fixA 2026-10-16T10:00:00 "docs: RULES.md um Git-Regeln erweitern"

# Fixture B: Dokumentänderung, die nur über die Git-Historie sichtbar ist.
mk fixB
mkdir "$dest/fixB/docs"
printf '# Betrieb\n\n- Backups laufen nachts um 02:00.\n- Logs 30 Tage aufbewahren.\n- Deploys nur freitags.\n- Alarm per E-Mail an ops@example.org.\n' >"$dest/fixB/docs/betrieb.md"
git -C "$dest/fixB" add -A
commit fixB 2026-10-01T10:00:00 "docs: Betrieb"
printf '# Betrieb\n\n- Backups laufen nachts um 03:30.\n- Logs 14 Tage aufbewahren.\n- Alarm per Chat-Webhook.\n' >"$dest/fixB/docs/betrieb.md"
commit fixB 2026-10-10T10:00:00 "docs: Betrieb überarbeitet"
