"""Kritische Infrastruktur-Tests fuer das Duell (Auftrag §22). Keine API-Aufrufe:
`pi` und `codex` sind Fake-Skripte im PATH, das Quell-Repo ist ein Temp-Repo."""

import hashlib
import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import usage  # noqa: E402

_loader = importlib.machinery.SourceFileLoader("duel_cli", str(HERE / "duel"))
_spec = importlib.util.spec_from_loader("duel_cli", _loader)
duel = importlib.util.module_from_spec(_spec)
_loader.exec_module(duel)

FAKE_PI = r"""#!/usr/bin/env python3
import json, os, sys, time
if sys.argv[1:] == ["--version"]:
    print("fake 1.0"); sys.exit(0)
if "FERTIG" in sys.argv[-1]:
    open(os.environ["FAKE_RECORD"] + ".pi.reply", "w").write(str("--continue" in sys.argv))
    print(json.dumps({"type": "turn_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "FERTIG"}]}}))
    sys.exit(0)
open("marker.txt", "a").write("pi\n")           # tracked-Datei aendern
open("pi_only_untracked.txt", "w").write("x")     # untracked
open(os.environ["FAKE_RECORD"] + ".pi", "w").write(os.getcwd() + "\n" + sys.argv[-1])
if os.environ.get("FAKE_PI_FAIL"):
    sys.exit(3)
time.sleep(0.05)
print(json.dumps({"type": "tool_execution_start", "toolName": "bash"}))
print(json.dumps({"type": "turn_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "pi fertig"}],
    "usage": {"input": 100, "cacheRead": 50, "cacheWrite": 0, "output": 30, "reasoning": 10, "totalTokens": 180, "cost": {"total": 0.5}}}}))
"""

FAKE_CODEX = r"""#!/usr/bin/env python3
import json, os, sys
if sys.argv[1:] == ["--version"]:
    print("fake 1.0"); sys.exit(0)
if "resume" in sys.argv:
    open(os.environ["FAKE_RECORD"] + ".codex.reply", "w").write(" ".join(sys.argv[2:]))
    print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "FERTIG"}}))
    sys.exit(0)
leak = os.path.exists("pi_only_untracked.txt") or "pi" in open("marker.txt").read()
open(os.environ["FAKE_RECORD"] + ".codex", "w").write(os.getcwd() + "\n" + sys.argv[-1] + "\nleak=" + str(leak))
open("marker.txt", "a").write("codex\n")
print(json.dumps({"type": "thread.started", "thread_id": "T-1"}))
print(json.dumps({"type": "item.completed", "item": {"type": "command_execution", "exit_code": 0}}))
print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "codex fertig"}}))
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 400, "cached_input_tokens": 300, "output_tokens": 60, "reasoning_output_tokens": 20}}))
"""


def sh(*cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class DuelTest(unittest.TestCase):
    PROMPT = "Fixe den Bug äöü\r\nzwei Zeilen, kein Newline am Ende".encode()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.repo = tmp / "repo"
        self.repo.mkdir()
        sh("git", "init", "-q", cwd=self.repo)
        sh("git", "config", "user.email", "t@t", cwd=self.repo)
        sh("git", "config", "user.name", "t", cwd=self.repo)
        (self.repo / "marker.txt").write_text("base\n")
        sh("git", "add", ".", cwd=self.repo)
        sh("git", "commit", "-qm", "base", cwd=self.repo)
        self.sha = sh("git", "rev-parse", "HEAD", cwd=self.repo)
        self.bin = tmp / "bin"
        self.bin.mkdir()
        for name, body in (("pi", FAKE_PI), ("codex", FAKE_CODEX)):
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        self.prompt = tmp / "task.md"
        self.prompt.write_bytes(self.PROMPT)
        self.history = tmp / "run-history.jsonl"
        self.record = str(tmp / "record")
        self._env = dict(os.environ)
        os.environ.update(PATH=f"{self.bin}{os.pathsep}{os.environ['PATH']}", FAKE_RECORD=self.record,
                          DUEL_RUN_HISTORY=str(self.history))
        os.environ.pop("FAKE_PI_FAIL", None)
        duel.DUELS_DIR = tmp / "duels"
        duel.WORKTREES_DIR = tmp / "wt"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)
        self._tmp.cleanup()

    def start(self):
        rc = duel.main(["start", "--repo", str(self.repo), "--prompt", str(self.prompt), "--slug", "t"])
        self.assertEqual(rc, 0)
        return next(duel.DUELS_DIR.iterdir())

    def test_same_start_commit_reset_and_identical_prompt(self):  # 1, 2, 3
        d = self.start()
        pi_cwd, pi_prompt = Path(self.record + ".pi").read_bytes().decode().split("\n", 1)
        cx_cwd, cx_rest = Path(self.record + ".codex").read_bytes().decode().split("\n", 1)
        cx_prompt, leak = cx_rest.rsplit("\nleak=", 1)
        self.assertNotEqual(pi_cwd, cx_cwd)
        self.assertEqual(leak, "False")  # Pi-Aenderungen (tracked + untracked) nicht im Codex-Worktree
        meta = json.loads((d / "metadata.json").read_text())
        self.assertEqual(meta["base_sha"], self.sha)
        for arm in ("pi", "codex"):
            self.assertEqual(json.loads((d / arm / "usage.json").read_text())["final_head"], self.sha)
        self.assertEqual((d / "prompt.md").read_bytes(), self.PROMPT)
        self.assertEqual(meta["prompt_sha256"], hashlib.sha256(self.PROMPT).hexdigest())
        self.assertEqual(pi_prompt.encode(), self.PROMPT)
        self.assertEqual(cx_prompt.encode(), self.PROMPT)
        self.assertEqual(sh("git", "status", "--porcelain", cwd=self.repo), "")  # Quell-Repo unberuehrt

    def test_logs_diffs_and_timing_saved(self):  # 4, 5, 6
        d = self.start()
        for arm in ("pi", "codex"):
            self.assertTrue((d / arm / "logs" / "stdout.jsonl").read_text().strip())
            self.assertIn("marker.txt", (d / arm / "diff.patch").read_text())
            u = json.loads((d / arm / "usage.json").read_text())
            self.assertLess(u["start_ts"], u["end_ts"])
            self.assertGreaterEqual(u["duration_s"], 0)
        self.assertIn("pi_only_untracked.txt", (d / "pi" / "diff.patch").read_text())
        self.assertNotIn("pi_only_untracked.txt", (d / "codex" / "diff.patch").read_text())
        self.assertTrue((d / "comparison.md").is_file())

    def test_usage_parsing(self):  # 7
        pi = usage.parse_pi(FAKE_PI_EVENTS)
        self.assertEqual((pi["input_fresh"], pi["input_cache_read"], pi["output"], pi["total_tokens"]), (100, 50, 30, 180))
        self.assertEqual((pi["tool_calls"], pi["shell_calls"], pi["cost"]), (1, 1, 0.5))
        cx = usage.parse_codex(
            '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":60,"output_tokens":10}}\n'
            '{"type":"turn.completed","usage":{"input_tokens":400,"cached_input_tokens":300,"output_tokens":60}}\n')
        self.assertEqual((cx["input_fresh"], cx["input_cache_read"], cx["output"], cx["total_tokens"]), (100, 300, 60, 460))
        self.assertIsNone(cx["cost"])  # keine Schaetzung

    def _history(self, entries):
        self.history.write_text("\n".join(json.dumps(e) for e in entries) + "\n")

    def test_subagents_and_verifier_attributed_to_pi(self):  # 8, 9
        wd, now = "/wt/pi", time.time()
        tok = {"input": 10, "cacheRead": 5, "cacheWrite": 0, "output": 5}
        self._history([
            {"agent": "investigator", "cwd": wd, "ts": now, "tokens": tok, "cost": 0.1, "duration": 100},
            {"agent": "verifier", "cwd": wd + "/sub", "ts": now, "tokens": tok, "cost": 0.2, "duration": 50},
            {"agent": "verifier", "cwd": "/andere/sitzung", "ts": now, "tokens": tok},   # fremde cwd
            {"agent": "worker", "cwd": wd, "ts": now - 999, "tokens": tok},             # ausserhalb Zeitfenster
        ])
        hist = usage.run_history_usage(wd, now - 5, now + 5)
        main = usage.parse_pi(FAKE_PI_EVENTS)
        total = usage.pi_total(main, hist)
        self.assertEqual(total["subagent_calls"], 1)
        self.assertEqual(total["verifier_calls"], 1)
        self.assertEqual(total["subagent_tokens"], 20)
        self.assertEqual(total["verifier_tokens"], 20)
        self.assertEqual(total["total_tokens"], 180 + 40)  # Verifier nicht doppelt gezaehlt
        self.assertAlmostEqual(total["cost"], 0.8)

    def test_auto_reply_continues_same_session(self):
        d = self.start()
        self.assertTrue(Path(self.record + ".pi.reply").read_text() == "True")  # --continue
        self.assertIn("T-1", Path(self.record + ".codex.reply").read_text())    # resume <thread id>
        for arm in ("pi", "codex"):
            u = json.loads((d / arm / "usage.json").read_text())
            self.assertEqual(u["auto_replies"], 1)
            self.assertTrue((d / arm / "logs" / "round2.jsonl").is_file())
        # Usage ueber alle Runden: Pi summiert, Codex nimmt die kumulative letzte Summe
        self.assertEqual(json.loads((d / "pi" / "usage.json").read_text())["main"]["total_tokens"], 180)

    def test_failure_of_one_arm_keeps_other_arm(self):  # 10
        os.environ["FAKE_PI_FAIL"] = "1"
        d = self.start()  # nicht-null Exit von Pi ist Ergebnis, kein Abbruch
        self.assertEqual(json.loads((d / "pi" / "usage.json").read_text())["exit_code"], 3)
        self.assertTrue((d / "codex" / "diff.patch").is_file())
        # Harter Fehler im ersten Arm (Tool fehlt): zweiter Arm laeuft trotzdem
        (self.bin / "pi").unlink()
        os.environ["PATH"] = str(self.bin) + os.pathsep + "/usr/bin" + os.pathsep + "/bin"
        d2 = self.start_second()
        self.assertTrue((d2 / "pi" / "error.json").is_file())
        self.assertTrue((d2 / "codex" / "usage.json").is_file())
        self.assertTrue((d2 / "comparison.md").is_file())

    def start_second(self):
        duel.main(["start", "--repo", str(self.repo), "--prompt", str(self.prompt), "--slug", "zwei"])
        return sorted(duel.DUELS_DIR.iterdir())[-1]

    def test_dirty_source_repo_is_refused(self):
        (self.repo / "marker.txt").write_text("dirty\n")
        rc = duel.main(["start", "--repo", str(self.repo), "--prompt", str(self.prompt)])
        self.assertEqual(rc, 2)


FAKE_PI_EVENTS = "\n".join([
    json.dumps({"type": "tool_execution_start", "toolName": "bash"}),
    json.dumps({"type": "turn_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "ok"}],
                "usage": {"input": 100, "cacheRead": 50, "cacheWrite": 0, "output": 30, "reasoning": 10,
                          "totalTokens": 180, "cost": {"total": 0.5}}}}),
])

if __name__ == "__main__":
    unittest.main()
