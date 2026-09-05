"""Python-Seite der Bruecke zu tests/plan-eval/quality-bridge.mjs.

Ruft plan-quality-cli.mjs als Subprozess auf, damit pi_rpc_driver.py denselben
Quality-Gate prueft, den das Produkt selbst durchsetzt
(extensions/plan-mode/plan-quality.ts), ohne ihn erneut zu implementieren.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_CLI_PATH = _SCRIPT_DIR / "plan-quality-cli.mjs"


def check_plan_quality(plan_mode: str, plan_content: str) -> tuple[bool | None, list]:
    """Gibt (ok, issues) zurueck. ok=None bedeutet: Bruecke selbst konnte nicht
    ausgefuehrt werden (z.B. node fehlt) -- zaehlt im Gate als Fehlschlag, nie
    als stillschweigender Erfolg."""
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as tf:
        tf.write(plan_content)
        plan_path = tf.name
    try:
        result = subprocess.run(
            ["node", str(_CLI_PATH), plan_mode, plan_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, [{"code": "bridge-unavailable", "message": str(exc)}]
    finally:
        Path(plan_path).unlink(missing_ok=True)

    if result.returncode not in (0, 1):
        return None, [
            {
                "code": "bridge-error",
                "message": f"plan-quality-cli.mjs returncode={result.returncode}: {result.stderr[-1000:]}",
            }
        ]
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        return None, [{"code": "bridge-bad-output", "message": f"{exc}: {result.stdout[-1000:]}"}]

    return bool(data.get("ok")), data.get("issues", [])
