# Pi-System – Capability- und Policy-Vertrag

Stand: 2026-10-15. Dieser Vertrag trennt den Iststand vom Zielverhalten. Die
Kennung `PI_LAUNCH_PROFILE=system` wählt Profil, Laufzeit und Darstellung; sie
ist selbst keine Berechtigung.

## Baseline

| Bereich | Beobachteter Stand |
|---|---|
| Pi-Repository | `main`, Baseline `3645411b6db621c9229e915c34c7fe0745b1a3df`, sauber |
| NixOS-Repository | `main`, Baseline `6cce2f8f23de3cb0e2c084a8f4cd6ca2db27d873`, sauber |
| Installierter Launcher | `~/.local/bin/pi` → `~/.pi/agent/bin/pi`, Pi `1.2.0` |
| Terminal-Auflösung | `pi system --help` aus `/tmp` und `~/nixos-config` erfolgreich; normale `pi --version` bleibt `1.2.0` |
| Live-Dienste | `pi-system-host`, `quickshell-quickpanel` und `agent-control` aktiv |
| Systemd-Grenze | Host-Unit setzt `ProtectSystem=strict`; `ReadWritePaths` enthält nur `~/.pi/agent/profile-state/system`, nicht `~/nixos-config` |
| NixOS | Generation 61; letzter Build erfolgreich. Es wurde in dieser Arbeit keine Generation aktiviert. |
| Sessions | TUI schreibt nach `profile-state/system/sessions`, Host nach `profile-state/system/host-sessions`; Attach/Handoff fehlt. |

Der Launcher-/Help-Test belegt Profilauflösung, nicht den vollständigen Start
einer interaktiven Sitzung. Der Host läuft tatsächlich, aber eine echte
Freigabe und ein Schreibversuch über QuickPanel wurden noch nicht live
abgenommen.

## Zielvertrag: Scope und Grundregeln

1. Die private, vom Launcher festgelegte System-Workspace-Wurzel ist ein
   begrenzter Datei-Scope. Die normale Berechtigungsstufe, Recovery- und
   Planmodus-Grenzen gelten weiterhin.
2. Ein fremder Root wie `~/nixos-config` wird erst nach einer sichtbaren,
   sitzungsgebundenen Bestätigung als **Datei-Schreibscope** freigegeben. Der
   Scope wird kanonisch geprüft und nach Root sowie Sitzung gebunden.
3. Diese Bestätigung setzt `ctx.isProjectTrusted()` nicht auf `true`, lädt keine
   Projektkonfiguration oder Verifikationsprofile als vertrauenswürdig und
   autorisiert keine freien Shell-Aufrufe.
4. `write` und `edit` dürfen im bestätigten Scope nach der aktiven
   Berechtigungsstufe arbeiten. Secrets, Spezialdateien, Symlink-Escapes,
   ausführbare/geschützte Konfigurationspfade und Planmodus bleiben eigene
   Grenzen. `confirm-all` fragt jede Mutation gesondert.
5. Shell-Kommandos erhalten keine Scope-Freigabe aus Textmustern wie
   `cd <pfad>`. Ein Shell-Scope braucht ein explizites, validiertes `cwd`,
   dieselbe Sitzungsfreigabe und eine passende OS-Sandbox. Bis dieser Pfad
   umgesetzt und negativ getestet ist, gilt ein externer Root nicht als
   Shell-Schreibziel.
6. Eine Root-Freigabe erlaubt keinen NixOS-Apply. `nixos_build` bleibt eine
   getrennte, sichtbare Aktion; `nixos_apply` braucht immer eine zusätzliche
   Bestätigung und einen geprüften Rückweg.
7. Im Systemprofil gibt es keinen `yolo-full`-Pfad, der Scope-, Secret- oder
   Trust-Grenzen umgeht. Reguläres `pi` behält seine bestehende Policy.

## Capability-Matrix

`allow`, `ask` und `deny` beschreiben die Zielpolicy. „Aktuell“ dokumentiert
Abweichungen, damit ein erlaubter Zielzustand nicht mit dem Iststand verwechselt
wird.

| Tool/Klasse | Scope | allow | ask | deny | Aktueller Befund |
|---|---|---|---|---|---|
| `read`, `grep`, `find`, `ls` | System-Workspace und externe, nicht-sensitive Dateien | Lesen auf allen Stufen und Frontends, sofern der Scope auflösbar ist | Keine Scope-Freigabe allein fürs Lesen | Secrets/Credentials, Geräte/Sockets, ungelöste Ziele und Symlink-Escape | Workflow-Policy erlaubt harmlose externe Reads; die harte Trust-Grenze blockiert sie teils noch im untrusted System-Workspace. |
| `write`, `edit` | Privater System-Workspace | Gemäß `project-write`/YOLO-Regeln, sofern Projekt-, Recovery- und Plan-Gates bestehen | Riskante geschützte Pfade oder `confirm-all` | `readonly`, `headless`, Secret-/Geräte-/Symlink-Grenzen, Planmodus | Untrusted-Guard blockiert derzeit auch den festen System-Workspace. |
| `write`, `edit` | Externer Root, etwa `~/nixos-config` | Nach expliziter System-Datei-Scope-Freigabe und gemäß aktiver Stufe | Einmalige sichtbare Freigabe des kanonischen Root; unter `confirm-all` zusätzlich je Mutation | Vor Freigabe, ohne UI, nach Ablehnung, außerhalb des Root, falsche/abgelaufene Sitzung | `workspace_add` kann einen Root als zusätzliches Projekt freigeben; das ist zu weit gefasst und keine geeignete System-Datei-Scope-Grenze. Host-Unit sperrt den tatsächlichen Schreibzugriff zusätzlich. |
| `bash`, interaktive Shell | Festes System-Workspace | Gewöhnliche Kommandos nach vorhandener Shell- und Stufenpolicy | Risikoabhängige System-/Shell-Kommandos mit UI | Secrets, verbotene Systemaktionen und fehlende UI | Agent-Shell wird im untrusted Systemprofil vor der Shell-Policy blockiert. |
| Shell mit externem Root | Explizit bestätigter Root plus explizites `cwd` | Erst nach Scope-Prüfung, aktiver Stufe und OS-Sandbox | Scope-Freigabe und risikoabhängige Shell-Aktion | Implizites `cd`-Heuristik-Scoping, nicht erlaubter Root, Sandbox-Escape, fehlende UI | Core-Bash-Schema hat nur `command` und optional `timeout`; kein `cwd`. Diese Capability ist offen und darf nicht durch String-Heuristiken simuliert werden. |
| `project_check` / Projekt-Setup | Projekt-Trust | Nur für tatsächlich vertrauenswürdiges Projekt und valides Profil | Ein eigenständiger Trust-Vorgang, falls später vorgesehen | Datei-Schreibscope allein reicht nicht | `workspace_add` macht den Root derzeit auch für Projektkonfiguration/Prüfprofile vertrauenswürdig. Das wird für den System-Datei-Scope nicht übernommen. |
| `workspace_add` | Regulärer Projektmodus | Bestehender expliziter Projekt-Trust-Flow | Bestehende Rückfrage und Sitzungsbindung | Ohne UI, bei geschützten Roots oder falscher Sitzung | Bleibt im normalen `pi` unverändert; im Systemprofil darf es keinen Schreibscope in Projekt-Trust umdeuten. |
| `system_unit_status`, `system_journal`, `nixos_status`, `desktop_state`, `audio_status`; `system_job` `status`/`output` | Feste, gefilterte Systemdaten | Alle Frontends, read-only | — | Nicht erlaubte Datenfelder/Argumente | Bereits profilgebundene typed Tools; keine Fenstertitel oder Secret-Ausgaben. |
| `desktop_switch_workspace`, `desktop_focus_window`, `audio_set_volume`, `notify`, `user_service`, `system_job`-Mutation | Festes Systemziel | Nach ausdrücklicher Einzelbestätigung | Interaktive Bestätigung | `readonly`, `headless`, fehlende UI, verbotene Dienste | Bereits typed; Dienst-Allowlist sperrt kritische Agent-/Panel-Dienste. |
| `nixos_build` | Deklarative Systemkonfiguration | Nach eigenständiger Bestätigung und vorhandenem Scope | Build-Aktion einzeln bestätigen | Ohne UI/Scope, Planmodus, `readonly`/`headless` | Typed Tool vorhanden; echter Build nach Änderung noch nicht Teil der Abnahme. |
| `nixos_apply` | Installierte Systemkonfiguration | Nie implizit durch Datei-Scope freigegeben | Immer eigene Bestätigung, auch bei YOLO; Rollback muss bereitstehen | Ohne Bestätigung, ohne Rollback, fehlende UI | Typed Tool vorhanden; in dieser Arbeit nicht ausgeführt. |

## Frontends

| Frontend | allow | ask | deny |
|---|---|---|---|
| `pi system` TUI | Lesen und freigegebene Aktionen entsprechend Scope/Stufe | Scope- und Risiko-Dialog über TUI | Fehlende UI, abgelehnter Dialog, harte Pfad-/Plan-/Secret-Grenze |
| Host + QuickPanel | Lesen und freigegebene Aktionen derselben Host-Sitzung | Host-Dialog wird sichtbar in QuickPanel beantwortet; Berechtigungsstufe ändert sich nur nach expliziter Auswahl | Kein QuickPanel-Kanal, Timeout, abgelehnter Dialog, falsche Host-Epoch/Sitzung |
| Android-Bridge | Read-only Host-Funktionen im erlaubten Methoden-Katalog | Keine positive Approval-Funktion | `permission.set`, Sessionwechsel, `command.invoke` und positive Approval-Antworten |
| RPC/Print/Headless ohne Approval-UI | Nur explizit sichere Reads und vorgesehene Prüfungen | Keine nicht erfüllbare Rückfrage | Scope-Erweiterung und jede Aktion, die UI-Zustimmung braucht |

QuickPanel hat bis zum Commit `40084d6` beim Snapshot `headless` automatisch
auf `project-write` geändert. Das ist behoben; die echte Live-Ansicht wird erst
nach einer separaten Host-Abnahme bewertet.

## P0-Gates und offener Status

| Gate | Status | Nachweis / Restarbeit |
|---|---|---|
| Launcher aus beliebigem `cwd` | Teilweise bestanden | `pi system --help` aus `/tmp` und NixOS-Repo; vollständige interaktive TUI- und Resume-/Session-Escape-Probe offen. |
| Untrusted System-Workspace lesen/schreiben | Nicht bestanden | Reads außerhalb werden teils durch Trust-Guard blockiert; lokale Writes werden blockiert. Negativ- und Freigabetests fehlen. |
| Expliziter Root-Scope für `~/nixos-config` | Nicht bestanden | Bestehendes `workspace_add` erteilt zu breiten Projekt-Trust; eigener systembezogener Dateiscope fehlt. |
| Shell auf bestätigtem Root | Nicht bestanden | Kein explizites `cwd` im Core-Bash-Schema; keine String-Heuristik als Ersatz. |
| Host-OS-Schreibgrenze | Nicht bestanden | Aktive Host-Unit erlaubt nur Profil-State. Source-Unit und deklarative/Installer-Quelle müssen konsistent aktualisiert und später live abgenommen werden. |
| TUI/Host/Android-Approval | Teilweise bestanden | Host und QuickPanel laufen; tatsächliche Root-Freigabe/Abweisung, Reconnect und Android-Negativfälle bleiben Live-/Integrationstests. |
| Build/Apply-Trennung | Teilweise bestanden | Typed Tools und Bestätigungspfad bestehen im Quellcode; ein Build nach Fixture-Änderung offen. Apply/rollback nur mit separater Freigabe. |

**Entscheidung:** `NO-GO` für eine Behauptung, dass der Pi-System-Host bereits
`~/nixos-config` bearbeiten oder OpenCode als NixOS-Systempaket einrichten
kann. Nächster sicherer Schritt: System-Datei-Scope separat vom Projekt-Trust
implementieren und gegen untrusted Systemprofil, Ablehnung, fehlende UI,
Plan-/Readonly, Secrets, Symlink-Escapes und fremde Roots testen. Host-Unit,
Launcher und Live-Approval bleiben eigene Gates. Hermes-Cutover bleibt separat.
