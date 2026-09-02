"""A7: tool-call error classification.

Previously `failedToolCalls` was a single count (isError:true), mixing real
agent/environment failures with our own permission-guard denials and with
expected-red test runs. This module classifies each failing tool call by
regex/substring rules against the tool name and its result text -- never a
guess: anything that does not match a known pattern is `unknown`, not
silently folded into a bucket that implies certainty.
"""

import re

from postprocess.schema import ToolCallRecord, ToolErrorCategory, ToolErrorSummary

# Pi's own guard-denial string (extensions/permissions/guards.ts,
# confirmGuardResult() /`"Aktion vom Benutzer abgelehnt."`). Matching this
# exactly (not a fuzzy substring) means we are counting OUR OWN
# infrastructure blocking the agent, not an agent or environment defect.
_PERMISSION_DENIED_TEXT = "Aktion vom Benutzer abgelehnt."

_RULES: list[tuple[ToolErrorCategory, re.Pattern[str]]] = [
    (
        ToolErrorCategory.permission_denied_by_harness,
        re.compile(re.escape(_PERMISSION_DENIED_TEXT)),
    ),
    (
        ToolErrorCategory.git_error,
        re.compile(r"fatal: not a git repository|fatal: .*git", re.IGNORECASE),
    ),
    (
        ToolErrorCategory.timeout,
        re.compile(r"\btimed?[ -]?out\b|\bETIMEDOUT\b", re.IGNORECASE),
    ),
    (
        ToolErrorCategory.network_error,
        re.compile(
            r"\bENOTFOUND\b|\bECONNREFUSED\b|\bECONNRESET\b|network unreachable",
            re.IGNORECASE,
        ),
    ),
    (
        ToolErrorCategory.file_not_found,
        re.compile(r"\bENOENT\b|No such file or directory", re.IGNORECASE),
    ),
    (
        ToolErrorCategory.syntax_error,
        re.compile(r"SyntaxError|Unexpected token|ParseError"),
    ),
    (
        ToolErrorCategory.test_failure,
        re.compile(r"\bAssertionError\b|# fail [1-9]|tests? failed", re.IGNORECASE),
    ),
    (
        ToolErrorCategory.build_failure,
        re.compile(r"\bcompilation failed\b|\bbuild failed\b|error TS\d+", re.IGNORECASE),
    ),
    (
        ToolErrorCategory.tool_misuse,
        re.compile(r"invalid (arguments|input)|missing required (argument|field)", re.IGNORECASE),
    ),
]


def classify(tool_name: str, is_error: bool, result_text: str) -> ToolErrorCategory:
    if not is_error:
        return ToolErrorCategory.none
    text = result_text or ""
    for category, pattern in _RULES:
        if pattern.search(text):
            return category
    return ToolErrorCategory.unknown


def summarize(
    tool_calls: list[tuple[str, bool, str]],
    *,
    keep_records: bool = True,
) -> ToolErrorSummary:
    """`tool_calls`: list of (tool_name, is_error, result_text)."""
    by_category: dict[str, int] = {}
    records: list[ToolCallRecord] = []
    total_failures = 0
    seen_failure_signatures: dict[tuple[str, str], int] = {}

    for tool_name, is_error, result_text in tool_calls:
        category = classify(tool_name, is_error, result_text)
        if is_error:
            total_failures += 1
            by_category[category.value] = by_category.get(category.value, 0) + 1
            signature = (tool_name, (result_text or "")[:200])
            seen_failure_signatures[signature] = seen_failure_signatures.get(signature, 0) + 1
        if keep_records:
            records.append(
                ToolCallRecord(
                    tool_name=tool_name,
                    is_error=is_error,
                    category=category,
                    command_preview=(result_text or "")[:200] or None,
                )
            )

    repeated = sum(count - 1 for count in seen_failure_signatures.values() if count > 1)

    return ToolErrorSummary(
        total_tool_calls=len(tool_calls),
        total_failures=total_failures,
        by_category=by_category,
        repeated_identical_failures=repeated if total_failures else None,
        records=records,
    )
