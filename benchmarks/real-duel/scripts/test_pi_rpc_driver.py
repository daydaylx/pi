#!/usr/bin/env python3
"""Regression tests for non-interactive RPC event handling."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = Path(__file__).with_name("pi_rpc_driver.py")
spec = importlib.util.spec_from_file_location("pi_rpc_driver", SCRIPT)
driver = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = driver
spec.loader.exec_module(driver)


class FakeSession:
    def __init__(self) -> None:
        self.events = [
            {"type": "extension_ui_request", "method": "input", "id": "ui-1"},
            {"type": "agent_settled"},
        ]

    def wait_for(self, predicate, timeout):
        event = self.events.pop(0)
        self.last_timeout = timeout
        self.seen = getattr(self, "seen", []) + [event]
        self.asserted = predicate(event)
        if not self.asserted:
            raise AssertionError("helper skipped a non-matching event")
        return event, [event]


class RpcDriverTest(unittest.TestCase):
    def test_ui_request_is_serviced_before_settlement(self) -> None:
        session = FakeSession()
        handled = []
        settled, events = driver.wait_for_agent_settled(
            session, lambda batch: handled.extend(batch), timeout=1
        )
        self.assertEqual(settled["type"], "agent_settled")
        self.assertEqual([event["type"] for event in handled], [
            "extension_ui_request",
            "agent_settled",
        ])
        self.assertEqual(len(events), 2)
        self.assertEqual(len(session.events), 0)


if __name__ == "__main__":
    unittest.main()
