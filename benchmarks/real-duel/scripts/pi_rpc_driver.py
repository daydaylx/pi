"""Pi Plan->Work-Treiber ueber `pi --mode rpc`.

Warum RPC-Modus statt simulierter Tastendruecke oder zwei getrennter
`pi --print`-Aufrufe:

  - Shift+Tab (Modusauswahl) und die Freigabe-Dialoge sind TUI-Interaktionen
    ohne stabile nicht-interaktive Entsprechung.
  - `/workflow-set <modus>` und `/plan-approve` sind normale, dokumentierte
    Slash-Commands. Laut ~/.npm-global/.../pi-coding-agent/docs/rpc.md werden
    sie ueber den RPC-Command `prompt` mit einer mit "/" beginnenden Nachricht
    ausgefuehrt ("Extension commands ... execute immediately").
  - KRITISCH: Die Planfreigabe-Bereitschaft (WorkflowSession.readiness/
    approval) lebt nur im Prozessspeicher der Extension, siehe
    extensions/plan-mode/README.md: "innerhalb derselben Sitzung -- ein
    Neustart verwirft Freigabe und Bereitschaft, auch wenn die Plandatei noch
    existiert." Planung und Freigabe MUESSEN deshalb im selben durchgehenden
    `pi --mode rpc`-Prozess laufen -- nicht durch zwei per --session-id
    verbundene Prozessaufrufe.
  - `/plan-approve` loest bei Erfolg selbst `sendUserMessage(...)` aus
    (extensions/plan-mode/commands.ts, `approvePlan()`) -- der Work-Turn
    startet also automatisch im selben Prozess, ohne dass der Treiber einen
    weiteren `prompt`-Befehl schicken muss.

Unverifiziert bis zum ersten echten Testlauf (Stufe 1, technischer Pilot):
  - Exakte Reihenfolge/Timing der `extension_ui_request`-Events beim
    Freigabeaufruf (input-Dialog "Optionaler Zusatzauftrag" kommt laut
    commands.ts IMMER, confirm-Dialog nur bei qualityOverride).
  - Das exakte Serialisierungsformat eines `plan-approval`-Audit-Eintrags
    ueber `get_entries` (RPC) -- rpc.md dokumentiert nur die generische
    Entry-Form, nicht das Feld fuer "custom"-Eintraege. Die interne
    Harness-Form kennt `entry.customType` (siehe
    tests/workflow-mode/e2e.test.mjs), `_has_plan_approval_entry` prueft
    deshalb defensiv auf `customType` UND `type`.
Diese Annahmen sind defensiv programmiert (Timeouts, klare Fehlermeldungen
statt stillem Weiterlaufen) und muessen im Pilot bestaetigt werden.

Bewusst NICHT verwendet: `--session-id` als CLI-Flag beim Start von
`pi --mode rpc`. Es ist ein dokumentiertes, aber RPC-modus-fremdes Flag
(rpc.md listet es nicht unter "Common options"), und der Rest dieses Moduls
verwendet ohnehin ausschliesslich die per `get_state()["sessionId"]` vom
laufenden Prozess zurueckgelesene, echte Session-ID -- ein vorab selbst
erzeugter Wert haette keinen Verwendungszweck, nur unnoetiges Risiko.
"""

from __future__ import annotations

import hashlib
import json
import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


class RpcError(RuntimeError):
    pass


class PlanQualityGateFailed(RuntimeError):
    """Der gespeicherte Plan hat den Quality-Gate nicht bestanden. Der Treiber
    beantwortet den daraufhin erscheinenden Override-Confirm-Dialog bewusst
    NICHT positiv -- eine automatische, stillschweigende Override-Freigabe
    waere genau die "produktive Auto-Approval-Hintertuer", die der
    Arbeitsauftrag ausdruecklich ausschliesst. Ein fehlgeschlagener
    Quality-Gate ist ein Gate-Fehler des Laufs, kein Fall fuer den Treiber,
    selbst zu entscheiden."""


def workspace_key(cwd: str | Path) -> str:
    """Muss exakt extensions/plan-mode/plan-store.ts:workspaceKey() spiegeln:
    sha256(resolve(cwd)) auf die ersten 16 Hex-Zeichen gekuerzt."""
    resolved = str(Path(cwd).resolve())
    return hashlib.sha256(resolved.encode("utf-8")).hexdigest()[:16]


def plan_path_for(cwd: str | Path, session_id: str) -> Path:
    """Muss extensions/plan-mode/plan-store.ts:planPath() spiegeln. Die
    Session-ID-Bereinigung dort (nur [A-Za-z0-9._-], sonst Hash-Fallback)
    wird hier nicht nachgebildet, weil Pi selbst nur eigene, bereits
    dateisystemsichere Session-IDs vergibt -- eine fremde/manipulierte ID
    wuerde ohnehin nicht aus get_state kommen."""
    return (
        Path.home()
        / ".pi"
        / "agent"
        / "plans"
        / workspace_key(cwd)
        / f"{session_id}.md"
    )


def hash_plan(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


@dataclass
class RpcSession:
    cwd: str
    model: str
    provider: str
    extra_args: tuple[str, ...] = ()
    log_path: Path | None = None

    def __post_init__(self) -> None:
        cmd = [
            "pi",
            "--mode",
            "rpc",
            "--provider",
            self.provider,
            "--model",
            self.model,
            *self.extra_args,
        ]
        self._log_fh = open(self.log_path, "w", encoding="utf-8") if self.log_path else None
        self.proc = subprocess.Popen(
            cmd,
            cwd=self.cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.events: "queue.Queue[dict[str, Any]]" = queue.Queue()
        self.all_events: list[dict[str, Any]] = []
        self._stop = threading.Event()
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()
        self._stderr_lines: list[str] = []
        self._stderr_reader = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_reader.start()

    def _read_stdout(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.rstrip("\n").rstrip("\r")
            if not line.strip():
                continue
            if self._log_fh:
                self._log_fh.write(line + "\n")
                self._log_fh.flush()
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            self.all_events.append(obj)
            self.events.put(obj)
        self._stop.set()

    def _read_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            self._stderr_lines.append(line.rstrip("\n"))

    def send(self, obj: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(obj) + "\n")
        self.proc.stdin.flush()

    def wait_for(
        self, predicate: Callable[[dict[str, Any]], bool], timeout: float
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """Blockiert bis ein Event predicate() erfuellt. Gibt (Treffer,
        alle-dabei-gesehenen-Events) zurueck."""
        deadline = time.monotonic() + timeout
        collected: list[dict[str, Any]] = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RpcError(
                    f"Timeout nach {timeout}s beim Warten auf ein Event. "
                    f"Zuletzt gesehen: {collected[-5:]!r}. "
                    f"stderr: {self._stderr_lines[-20:]!r}"
                )
            if self._stop.is_set() and self.events.empty():
                raise RpcError(
                    f"pi-Prozess beendet (returncode={self.proc.poll()}), bevor das "
                    f"erwartete Event eintraf. stderr: {self._stderr_lines[-40:]!r}"
                )
            try:
                ev = self.events.get(timeout=min(0.5, remaining))
            except queue.Empty:
                continue
            collected.append(ev)
            if predicate(ev):
                return ev, collected

    def close(self) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        if self._log_fh:
            self._log_fh.close()


def _is_prompt_response(ev: dict[str, Any]) -> bool:
    return ev.get("type") == "response" and ev.get("command") == "prompt"


def send_command_and_confirm(sess: RpcSession, message: str, timeout: float = 30) -> dict:
    """Schickt einen Slash-Command als `prompt` und wartet auf dessen
    Response (nicht auf agent_settled -- Extension-Commands laufen sofort,
    siehe rpc.md)."""
    sess.send({"type": "prompt", "message": message})
    ev, _ = sess.wait_for(_is_prompt_response, timeout)
    if not ev.get("success"):
        raise RpcError(f"Command {message!r} fehlgeschlagen: {ev}")
    return ev


def get_state(sess: RpcSession, timeout: float = 15) -> dict:
    sess.send({"type": "get_state"})
    ev, _ = sess.wait_for(
        lambda e: e.get("type") == "response" and e.get("command") == "get_state", timeout
    )
    if not ev.get("success"):
        raise RpcError(f"get_state fehlgeschlagen: {ev}")
    return ev["data"]


def get_session_stats(sess: RpcSession, timeout: float = 15) -> dict:
    sess.send({"type": "get_session_stats"})
    ev, _ = sess.wait_for(
        lambda e: e.get("type") == "response" and e.get("command") == "get_session_stats",
        timeout,
    )
    if not ev.get("success"):
        raise RpcError(f"get_session_stats fehlgeschlagen: {ev}")
    return ev["data"]


def get_entries(sess: RpcSession, timeout: float = 15) -> list[dict]:
    sess.send({"type": "get_entries"})
    ev, _ = sess.wait_for(
        lambda e: e.get("type") == "response" and e.get("command") == "get_entries", timeout
    )
    if not ev.get("success"):
        raise RpcError(f"get_entries fehlgeschlagen: {ev}")
    return ev["data"]["entries"]


def _has_plan_approval_entry(entries: list[dict]) -> bool:
    """Prueft, ob bereits ein plan-approval-Audit-Eintrag existiert (siehe
    Modul-Docstring zur unklaren RPC-Serialisierung von "custom"-Eintraegen --
    daher defensiv auf beide plausiblen Feldnamen)."""
    return any(
        e.get("customType") == "plan-approval" or e.get("type") == "plan-approval"
        for e in entries
    )


@dataclass
class PlanPhaseResult:
    sess: RpcSession
    session_id: str
    plan_content: str
    plan_hash: str
    plan_path: Path
    settled: bool
    quality_ok: bool | None
    quality_issues: list
    asked_followup_questions: list[str]
    stats_before_approval: dict
    entries_before_approval: list[dict]
    events: list[dict]


def run_plan_phase(
    *,
    cwd: str,
    model: str,
    provider: str,
    instruction: str,
    plan_mode: str,
    followups: dict[str, str],
    quality_check: Callable[[str, str], tuple[bool | None, list]],
    timeout: float,
    log_dir: Path | None = None,
) -> PlanPhaseResult:
    """Fuehrt Modus-Wahl + Planning-Turn aus und liest den entstandenen Plan
    extern (Dateisystem), OHNE etwas im Projekt-Worktree zu schreiben.
    `quality_check(plan_mode, plan_text) -> (ok_or_None, issues)` ist
    injizierbar, damit dieses Modul nicht selbst `node` aufrufen muss (siehe
    plan_quality_bridge.py fuer die Standardimplementierung)."""
    log_path = log_dir / "pi_rpc_transcript.jsonl" if log_dir else None
    sess = RpcSession(cwd=cwd, model=model, provider=provider, log_path=log_path)

    all_events: list[dict] = []
    asked_followups: list[str] = []

    def handle_ui_requests(batch: list[dict]) -> None:
        for ev in batch:
            if ev.get("type") != "extension_ui_request":
                continue
            method = ev.get("method")
            if method == "notify" or method == "setStatus" or method == "setWidget" or method == "setTitle":
                continue  # fire-and-forget, keine Antwort noetig
            if method == "select" and ev.get("title") == "Fertiger Plan":
                # sollte in diesem Treiber nie auftreten (wir rufen /plan-decide
                # nicht auf), aber sicherheitshalber sauber ablehnen statt haengen
                sess.send({"type": "extension_ui_response", "id": ev["id"], "cancelled": True})
                continue
            # Alles andere waehrend der Planungsphase ist eine Rueckfrage des
            # Agenten (ask_user-Tool) -- gegen die feste Followup-Liste pruefen.
            question = ev.get("message") or ev.get("title") or ""
            asked_followups.append(question)
            answer = followups.get(question)
            if answer is None:
                # Keine vorgesehene Antwort: Turn nicht blockieren, aber der
                # Treiber erfindet KEINE Antwort. Ablehnen -- der Gate
                # `only_allowed_followups` macht diesen Lauf ungueltig.
                sess.send({"type": "extension_ui_response", "id": ev["id"], "cancelled": True})
            elif method == "confirm":
                sess.send({"type": "extension_ui_response", "id": ev["id"], "confirmed": True})
            else:
                sess.send({"type": "extension_ui_response", "id": ev["id"], "value": answer})

    try:
        send_command_and_confirm(sess, f"/workflow-set {plan_mode}")

        sess.send({"type": "prompt", "message": instruction})
        settle_ev, batch = sess.wait_for(lambda e: e.get("type") == "agent_settled", timeout)
        all_events += batch
        handle_ui_requests(batch)
        settled = settle_ev.get("type") == "agent_settled"

        state = get_state(sess)
        session_id = state["sessionId"]

        p_path = plan_path_for(cwd, session_id)
        if not p_path.exists():
            raise RpcError(
                f"Kein Planartefakt unter {p_path} nach abgeschlossenem Planning-Turn "
                f"(session_id={session_id})."
            )
        plan_content = p_path.read_text(encoding="utf-8")
        plan_hash = hash_plan(plan_content)

        quality_ok, issues = quality_check(plan_mode, plan_content)

        stats = get_session_stats(sess)
        entries_before_approval = get_entries(sess)

        return PlanPhaseResult(
            sess=sess,
            session_id=session_id,
            plan_content=plan_content,
            plan_hash=plan_hash,
            plan_path=p_path,
            settled=settled,
            quality_ok=quality_ok,
            quality_issues=issues,
            asked_followup_questions=asked_followups,
            stats_before_approval=stats,
            entries_before_approval=entries_before_approval,
            events=all_events,
        )
    except Exception:
        sess.close()
        raise


@dataclass
class WorkPhaseResult:
    approved: bool
    approval_count: int
    preconsumed: bool
    session_id_after: str | None
    stats_after_work: dict
    entries: list[dict]
    events: list[dict]


def approve_and_run_work(
    plan_phase: PlanPhaseResult, *, timeout: float
) -> WorkPhaseResult:
    """Loest /plan-approve aus (echter Freigabepfad), beantwortet die dabei
    auftretenden Dialoge deterministisch und wartet den dadurch gestarteten
    Work-Turn ab. Wirft PlanQualityGateFailed, wenn der Plan den Quality-Gate
    nicht bestanden hat -- der Confirm-Override-Dialog wird dann bewusst
    abgelehnt statt automatisch bestaetigt."""
    sess = plan_phase.sess
    all_events: list[dict] = []
    approval_count = 0
    approved = False
    preconsumed = _has_plan_approval_entry(plan_phase.entries_before_approval)

    sess.send({"type": "prompt", "message": "/plan-approve"})

    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RpcError("Timeout beim Warten auf Abschluss des Work-Turns nach /plan-approve.")
        ev, batch = sess.wait_for(
            lambda e: e.get("type") in ("extension_ui_request", "response", "agent_settled"),
            remaining,
        )
        all_events += batch

        if ev.get("type") == "extension_ui_request":
            method = ev.get("method")
            if method == "input":
                # "Optionaler Zusatzauftrag" -- bewusst leer: der Treiber
                # formuliert keinen Zusatzauftrag, der freigegebene Plan wird
                # unveraendert umgesetzt.
                sess.send({"type": "extension_ui_response", "id": ev["id"], "value": ""})
            elif method == "confirm":
                # Dieser Dialog erscheint nur bei qualityOverride=true (siehe
                # approvePlan() in commands.ts). Ein Plan, der den Gate nicht
                # bestanden hat, wird hier NICHT automatisch durchgewunken.
                sess.send({"type": "extension_ui_response", "id": ev["id"], "cancelled": True})
                raise PlanQualityGateFailed(
                    "Plan hat den Quality-Gate nicht bestanden; Override-Freigabe "
                    "wird vom Treiber nicht automatisch erteilt."
                )
            else:
                sess.send({"type": "extension_ui_response", "id": ev["id"], "cancelled": True})
            continue

        if ev.get("type") == "response" and ev.get("command") == "prompt":
            if not ev.get("success"):
                raise RpcError(f"/plan-approve fehlgeschlagen: {ev}")
            approval_count += 1
            approved = True
            continue

        if ev.get("type") == "agent_settled":
            break

    stats = get_session_stats(sess)
    entries = get_entries(sess)
    state_after = get_state(sess)
    return WorkPhaseResult(
        approved=approved,
        approval_count=approval_count,
        preconsumed=preconsumed,
        session_id_after=state_after.get("sessionId"),
        stats_after_work=stats,
        entries=entries,
        events=all_events,
    )
