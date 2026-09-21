# Sichere interaktive PTY-Ausführung

## Problem und aktueller Zustand

Der vorhandene Kontrollfluss für normale Agent-Shells bleibt unverändert:

```text
Agent → bash tool request → tool_call/Trust/Workflow/Permission-Gates
      → Pi-Normal-Runner → stdout/stderr → Tool-Result → Agent
```

Der normale Runner nutzt Pipes und sammelt begrenzte Ausgabe für das
`bash`-Tool. Das ist für nicht-interaktive Prüf- und Build-Kommandos richtig,
aber nicht für `sudo`, `ssh`, Editoren oder andere Programme, die eine echte
Terminal-Eingabe benötigen.

## Gewählter Ansatz

`interactive_shell` ist ein separates, ausdrücklich sichtbares LLM-Tool. Es
ersetzt `bash` nicht und schaltet normale Shell-Kommandos nicht pauschal auf
PTY um. Der Toolvertrag enthält nur `command` und einen optionalen Timeout;
es gibt keinen Passwortparameter und keine Passwortfunktion.

Der Runner in `extensions/interactive-pty/runner.ts` startet über `node-pty`
einen eigenen PTY-Master. Die Terminal-Brücke in `terminal.ts` stoppt die TUI
für die Laufzeit, setzt den Prozess-Terminalzustand kontrolliert, verbindet
`stdin` transient mit `pty.write()` und schreibt PTY-Ausgabe direkt nach
`stdout`. Nach Exit, Ctrl+C, Abort, Timeout oder Fehler wird die TUI in einem
zentralen Cleanup-Pfad wieder gestartet.

## Datenfluss und Security-Modell

```text
Benutzer-Tastatur
      │  transienter, kurzlebiger stdin-Listener
      ▼
PTY-Master → interaktiver Child-Prozess
      │
      └── PTY-Ausgabe direkt auf das Terminal
```

Während dieser Phase:

- kein `onUpdate`-Callback,
- kein `tool_result` mit PTY-Ausgabe,
- kein `appendEntry`, Transcript-, Replay-, Debug- oder Telemetrie-Eintrag,
- kein Session-State für Eingaben,
- keine Prompt-Erkennung und keine Wiederanzeige von Eingaben,
- Status-Resultate enthalten ausschließlich Exit-Code sowie `killed`, `aborted`
  und `timedOut`.

Der Eingabestream wird weder gepuffert noch in einem Resultat gespeichert. Die
PTY-Ausgabe ist für die Benutzerin/den Benutzer sichtbar, aber nicht Teil des
Modellkontexts. Ein Programm, das seine eigene Eingabe wieder ausgibt, kann sie
naturgemäß auf dem Benutzerterminal anzeigen; Pi spiegelt diese Eingabe nicht
selbst und reicht sie nicht als Tool-Result zurück.

`SUDO_PASSWORD` wird aus der für diesen Runner erzeugten Umgebung entfernt.
Zusätzlich blockiert die interaktive Policy Credential-Abkürzungen wie
`sudo -S`, `sudo --stdin`, Passwort-/Credential-Umgebungszuweisungen,
Passwortargumente, automatische Credential-Helfer und Pipelines in Credential-Kommandos,
bevor ein PTY erzeugt wird. Credential-Kommandos mit Quotes, Substitution,
Redirection oder Shell-Komposition werden konservativ ebenfalls abgelehnt,
damit kein Regex-Quoting-Bypass einen Passwortkanal erzeugt. Pi setzt,
liest oder cached niemals ein sudo-Passwort. Es gibt keinen Agent-Prompt für
Credentials.

## Permission-Gates und Einfügepunkt

Der neue Toolname wird in den bestehenden Guard-Schichten wie ein Shell-
Kommando klassifiziert:

```text
interactive_shell request
      ↓
Trust-Gate
      ↓
Workflow-/Secret-/System-Grenze
      ↓
Recovery-Gate und Planmodus
      ↓
Permission-Entscheidung / Benutzerbestätigung
      ↓
TUI-/TTY-Fähigkeitsprüfung
      ↓
PTY starten
```

`sudo` bleibt damit ein privilegierter Vorgang. Die vorhandene Policy kann ihn
anfragen oder blockieren; YOLO hebt die harte Grenze für erhöhte Rechte nicht
auf. Wird die Aktion abgelehnt, nicht vertrauenswürdig oder ohne verfügbares
TUI angefordert, wird kein PTY gestartet.

## Lifecycle

1. Nach erfolgreicher Gate-Entscheidung zeigt Pi `INTERACTIVE TERMINAL`, den
   Befehl und `Ctrl+C: interrupt process`.
2. Die TUI gibt den Terminalzugriff frei; Eingaben gehen ausschließlich zum
   PTY.
3. Initiale Terminalgröße und spätere `resize`-Ereignisse werden an den PTY
   weitergegeben.
4. Ctrl+C wird als Terminalbyte an den aktiven Child-Prozess gesendet und
   beendet nicht Pi selbst.
5. Abort und Timeout senden zunächst SIGTERM an Prozessgruppe und PTY und
   eskalieren nach kurzer Frist zu SIGKILL.
6. Ein zentraler `finally`-Pfad entfernt Listener, stoppt Timer, schließt
   PTY-Ressourcen, stellt Raw Mode und TUI wieder her und meldet nur Status.

## sudo-Referenzablauf

```text
Agent → interactive_shell({ command: "sudo id" })
      → vorhandene Permission-Anfrage
      → Benutzer bestätigt
      → PTY + TUI-Handoff
      → sudo fragt im echten Terminal nach dem Passwort
      → Benutzer → stdin → PTY → sudo
      → Status/Exit-Code zurück an den Agenten
```

Das Passwort wird nie als Toolargument eingegeben, nie als Ausgabe gesammelt
und nie an das Modell zurückgegeben.

## Verworfene Ansätze

- Eine `sudo`-spezifische Passwortfunktion würde den Credential-Fluss durch Pi
  führen und wurde deshalb verworfen.
- `sudo -S`, Umgebungsvariablen und Passwort-Caching sind ausdrücklich nicht
  Teil des Designs.
- Den normalen `bash`-Runner pauschal durch PTY zu ersetzen würde
  Ausgabe-/Testsemantik und Security-Flächen unnötig verändern.
- Ein eigener Passwort-Prompt in der TUI würde die klare Grenze zwischen
  Benutzerterminal und Agenten-/UI-Eingabe verletzen.

## Bekannte Einschränkungen

- `node-pty` ist eine native Abhängigkeit und muss für jedes unterstützte
  Zielsystem gebaut bzw. aus einem passenden Prebuild geladen werden.
- Der native TTY-/sudo-Smoke-Test wurde in dieser Umgebung nicht ausgeführt,
  weil die bestehende Shell-Sicherheitsgrenze einen direkten Smoke-Aufruf mit
  Systempfad blockierte. Die Fake-PTY-Suite belegt weiterhin die Lifecycle-,
  Gruppen-Kill- und Leakage-Verträge; ein echter TTY-Smoke bleibt vor einer
  Release-Abnahme offen.
- `interactive_shell` ist ein expliziter Toolpfad; eine automatische
  Heuristik, die jeden `bash`-Aufruf umleitet, ist bewusst nicht enthalten.
- Nicht-TUI-, RPC- und Print-Läufe werden fail-closed abgelehnt, weil dort kein
  sicherer direkter Benutzerterminal-Handoff verfügbar ist.
- Der Child-Prozess kann Inhalte, die er selbst ausgibt, am Terminal anzeigen;
  Pi speichert oder spiegelt diese Daten jedoch nicht in Modell- oder
  Sessionkanäle.
