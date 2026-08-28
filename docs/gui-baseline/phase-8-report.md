# Phase 8 — Nutzungsentscheidung

Status: **VORBEREITET — wartet auf die ausdrückliche Nutzerentscheidung
(A/B/C/D).** Keine automatische Ablösung der TUI; nur die ausdrückliche
Nutzerentscheidung beendet diese Phase (Dokument 13).

## Was bisher objektiv feststeht

**Funktionsstand (automatisiert belegt):**

- Beide Oberflächen laufen gegen denselben Core: `pi` (Aurora-TUI) und
  `pi gui` (Desktop-GUI) nutzen dieselbe Runtime, dieselben Extensions,
  dieselben Sessions. Kernzustände liefert die `frontend-bridge`;
  Divergenztests sichern die fachliche Gleichheit der Zustände.
- GUI: Chat-Streaming, Tool-Aktivität (kompakt), Cancel, Session-Resume,
  Workflow-/Modell-/Denktiefe-Steuerung, Kernzustands-Panels, responsive
  Layout, Security- und Stabilitäts-Gates — alles reproduzierbar grün.
- Linux-Paket gebaut und aus dem Paket heraus gestartet (xvfb-Smokes).
- Aurora-TUI ist zu keinem Zeitpunkt verändert oder verdrängt worden;
  alle TUI-Suiten sind durch alle Phasen grün geblieben.

**Offen (erfordert reale Nutzung durch den Nutzer):**

- „Wird `pi gui` tatsächlich freiwillig häufiger geöffnet?“ — das kann nur
  echte Nutzung beantworten, kein Test.
- Subjektive Lesbarkeit des Chats, Störempfinden der Tool-Aktivität,
  Vertrautheit der Shortcuts, Menügeschwindigkeit im Alltag.
- RAM/Startzeit im Dauerbetrieb (Electron-typisch höher als TUI;
  konkrete Werte am besten im Alltag messen, nicht im Smoke).
- Langzeitstabilität von Sessions über viele Tage (bisher nur
  Kurzläufe: E2E, Smokes, Resume-Tests).

## Bewertungsfragen (Dokument 13) — Vorbelegung

| Frage                             | Stand                                                        |
| --------------------------------- | ------------------------------------------------------------ |
| Wird `pi gui` freiwillig genutzt? | offen — reale Nutzung nötig                                  |
| Chat lesbarer?                    | wahrscheinlich (Bubbles, Fokus auf Text) — subjektiv         |
| Tool-Aktivität weniger störend?   | ja, strukturell (Aktivitätszeilen statt Card-Wand)           |
| Shortcuts weiterhin vertraut?     | ja — identische Belegung (Paritätssuite)                     |
| Menüs schneller erreichbar?       | teilweise (Palette + Panels parallel zu TUI-Selector)        |
| Debugging schwieriger?            | teilweise — GUI-Fehler brauchen xvfb/DevTools statt Terminal |
| Neue Fehlerquellen?               | ja — Electron/IPC-Schicht, aber isoliert und abgesichert     |
| RAM/Startzeit akzeptabel?         | offen — im Alltag messen                                     |
| Sessions stabil?                  | Kurzstrecke belegt; Langstrecke offen                        |
| Core/Frontend-Divergenz?          | nein — Contract + Divergenztests aktiv                       |

## Optionen

- **A — Beide behalten** (`pi` → Aurora, `pi gui` → Desktop): empfohlen,
  solange beide unterschiedliche Stärken haben. Kosten: GUI muss bei
  Core-Änderungen mitgepflegt werden (Contract-Tests begrenzen das).
- **B — GUI wird bevorzugte Oberfläche**: `pi` bleibt Fallback. Sinnvoll
  erst, wenn reale Nutzung die GUI klar bevorzugt und Langzeitstabilität
  belegt ist.
- **C — GUI-Projekt stoppen**: wenn der UX-Gewinn den Pflegeaufwand
  nicht rechtfertigt. Rollback ist dokumentiert (Phase-7-Report) und
  verlustfrei für die TUI.
- **D — Spätere TUI-Reduktion**: nur nach expliziter Entscheidung;
  Aurora wird niemals automatisch entfernt.

## Empfehlung des Agenten

**Option A** — beide behalten, Aurora unangetastet:

1. Die GUI hat eigene Stärken (Chat-Lesbarkeit, Maus-Bedienung,
   Zustands-Panels), die TUI ihre (Terminalnähe, Debugging, Ressourcen).
2. Der Rollback ist jederzeit verlustfrei möglich; nichts ist
   unumkehrbar entschieden.
3. Die offene Frage ist ausschließlich die reale Nutzung — und die
   beantwortet sich nur durch Nutzung, nicht durch Abschaffung.

## Nächster Schritt

Der Nutzer entscheidet ausdrücklich über A/B/C/D. Bis dahin: keine
Migration, keine TUI-Reduktion, `pi gui` bleibt additiv verfügbar.

## Entscheidung (Nutzer, ausdrücklich)

**Gewählt: Option B — `pi gui` wird bevorzugte Oberfläche; `pi` (Aurora-TUI)
bleibt Fallback.**

Konsequenzen und Leitplanken:

- Keine automatische Ablösung oder Reduktion der Aurora-TUI: `pi` bleibt
  vollständig funktionsfähig, gepflegt und getestet (alle TUI-Suiten
  bleiben Pflichtbestandteil von `verify`).
- „Bevorzugt“ ist eine Nutzungspriorität, kein Code-Umbau: Beide
  Oberflächen laufen weiter gegen denselben Core; die GUI erhält bei
  künftigen Erweiterungen Vorrang in der Ausgestaltung.
- Die offenen Evidenzpunkte aus der Tabelle (freiwillige
  Nutzungshäufigkeit, RAM/Startzeit im Alltag, Langzeit-Sessions)
  bleiben Beobachtungspunkte. Falls die reale Nutzung B widerlegt, ist
  der Wechsel zurück zu A jederzeit verlustfrei möglich (Rollback
  dokumentiert im Phase-7-Report).

Damit ist Phase 8 durch die ausdrückliche Nutzerentscheidung beendet;
das Auftragspaket `pi_gui_arbeitsauftrag/` (Phasen 0–8) ist vollständig
abgearbeitet.
