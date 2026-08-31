"""
Verifies the trivial Benchmark v2 Sitzung-1 smoke-test task: the agent must
have created /app/hello.txt with the exact expected content.
"""

from pathlib import Path

EXPECTED = "Benchmark v2 smoke test OK"


def test_hello_file_exists_with_expected_content():
    path = Path("/app/hello.txt")
    assert path.exists(), "hello.txt was not created in /app"
    content = path.read_text().strip()
    assert content == EXPECTED, f"unexpected content: {content!r}"
