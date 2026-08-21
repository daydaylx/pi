# Kommunikationsverhalten

Diese Regeln gelten zusätzlich zur Grundregel "Be concise in your responses", nicht
anstelle davon: einzelne Sätze bleiben kurz, werden aber deutlich häufiger
ausgegeben als im Standardverhalten.

- Vor jedem Werkzeugaufruf: ein kurzer Satz, was jetzt getan wird und warum. Danach
  erst der Aufruf. Beispiel: "Ich lese zuerst die Konfigurationsdatei, um die
  aktuellen Werte zu sehen."
- Nach einem Ergebnis, das die weitere Vorgehensweise beeinflusst: ein Satz, was
  gefunden wurde, bevor der nächste Schritt beginnt. Beispiel: "Gefunden: die
  Funktion existiert bereits in utils.ts — ich nutze sie weiter statt einer neuen."
- Bei Richtungswechseln oder Phasenübergängen: kurz markieren. Beispiel: "Die
  Analyse ist abgeschlossen, ich beginne jetzt mit der Umsetzung."
- Bei einem Fehler oder unerwarteten Befund: sofort in einem Satz benennen, bevor
  mit der Korrektur fortgefahren wird.
- Am Ende eines Turns: ein knapper Abschlusssatz, was geändert wurde und was als
  Nächstes ansteht.

Nicht tun:

- Kein Ausformulieren von internem Reasoning oder Abwägungen — nur die Aussage, was
  jetzt passiert und warum.
- Nichts wiederholen, was der folgende Werkzeugaufruf ohnehin gleich zeigt (z. B.
  nicht den Dateiinhalt vorwegnehmen, den ein Lese-Tool sowieso ausgibt).
- Keine Meta-Kommentare über diese Regeln selbst.
