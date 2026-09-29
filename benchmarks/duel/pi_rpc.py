"""Pi ueber `pi --mode rpc` treiben, damit Bestaetigungsdialoge (z. B. fuer
Dateiloeschungen) wie in einer echten TUI-Sitzung beantwortet werden koennen.

Der Treiber ersetzt nur den Menschen am Terminal: Dialoge werden freigegeben,
Rueckfragen mit derselben Standardantwort beantwortet wie im Print-Modus.
Alle Antworten stehen im Protokoll `ui_answers`. Die Events entsprechen dem
JSON-Modus (turn_end, tool_execution_*), usage.parse_pi() funktioniert direkt.
"""

from __future__ import annotations

import json
import queue
import re
import subprocess
import threading
import time

ALLOW = re.compile(r"allow|erlaub|zulass|freigeb|ja\b|yes|approve|genehmig|fortfahren|continue", re.I)
DENY = re.compile(r"block|deny|verweiger|nein|no\b|abbrech|cancel|ablehn", re.I)


def answer_dialog(req: dict, auto_reply: str) -> dict:
    method, rid = req.get("method"), req.get("id")
    if method == "confirm":
        return {"type": "extension_ui_response", "id": rid, "confirmed": True}
    if method == "select":
        options = [o if isinstance(o, str) else str(o.get("label", o)) for o in req.get("options") or []]
        choice = next((o for o in options if ALLOW.search(o) and not DENY.search(o)), options[0] if options else None)
        if choice is None:
            return {"type": "extension_ui_response", "id": rid, "cancelled": True}
        return {"type": "extension_ui_response", "id": rid, "value": choice}
    return {"type": "extension_ui_response", "id": rid, "value": auto_reply}  # input / editor


def run_rpc(cmd, cwd, prompt, auto_reply, is_done, max_rounds=8, idle_timeout=900, total_timeout=7200):
    """Gibt (stdout_events_text, rounds, ui_answers, returncode) zurueck."""
    proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace", bufsize=1)
    lines: queue.Queue = queue.Queue()
    errs: list[str] = []
    threading.Thread(target=lambda: [lines.put(l) for l in proc.stdout] or lines.put(None), daemon=True).start()
    threading.Thread(target=lambda: errs.extend(proc.stderr), daemon=True).start()

    def send(obj):
        proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        proc.stdin.flush()

    events, rounds, answers = [], [], []
    round_start, round_no, deadline = 0, 1, time.time() + total_timeout
    send({"type": "prompt", "message": prompt})
    rc = None
    try:
        while time.time() < deadline:
            try:
                line = lines.get(timeout=idle_timeout)
            except queue.Empty:
                errs.append("idle-timeout")
                break
            if line is None:
                break
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "extension_ui_request" and ev.get("method") in ("select", "confirm", "input", "editor"):
                resp = answer_dialog(ev, auto_reply)
                answers.append({"round": round_no, "method": ev.get("method"), "title": ev.get("title") or ev.get("message"),
                                "options": ev.get("options"), "response": {k: v for k, v in resp.items() if k not in ("type", "id")}})
                send(resp)
                continue
            events.append(line if line.endswith("\n") else line + "\n")
            if ev.get("type") == "agent_end":
                text = "".join(events[round_start:])
                rounds.append({"round": round_no, "auto_reply": round_no > 1})
                if round_no >= max_rounds or is_done(text, round_no):
                    break
                round_no += 1
                round_start = len(events)
                send({"type": "prompt", "message": auto_reply})
    finally:
        try:
            proc.stdin.close()
        except OSError:
            pass
        try:
            rc = proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            rc = proc.wait()
    return "".join(events), rounds, answers, rc, "".join(errs)
