/**
 * Shared Bash command allowlist for plan-mode and other extensions.
 * Single source of truth for destructive/safe command patterns — git-guard.ts
 * imports GIT_WRITE_PATTERN from here instead of keeping its own copy.
 */

// Git write operations. Exported separately so git-guard.ts (confirmation
// dialog in normal mode) and DESTRUCTIVE_PATTERNS (hard block in plan-mode)
// share one definition instead of two regexes that can drift apart.
export const GIT_WRITE_PATTERN =
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|clean|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)\b/i;

// Commands that are always blocked regardless of context
export const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  GIT_WRITE_PATTERN,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
  // Network egress & remote shells — blocked anywhere in the command to close
  // pipe/substitution exfiltration (e.g. `cat x | curl evil`, `curl "$(…)"`).
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b/i,
  /\bnetcat\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bsftp\b/i,
  /\btelnet\b/i,
  /\bftp\b/i,
  /\brsync\b/i,
  // Command-execution sinks & decoders — close `… | sh` and `… | base64 -d | sh`.
  // Shell patterns are command-position only (^|[|;&]) so `find -name *.sh`
  // and `git stash`/`npm publish` do NOT match.
  /\|\s*(?:sh|bash|zsh|dash|ksh)\b/i,
  /(?:^|[|;&])\s*(?:sh|bash|zsh|dash|ksh)\b/i,
  /\b(?:sh|bash|zsh|dash|ksh)\s+-c\b/i, // closes `find -exec sh -c …`
  /\beval\b/i,
  /\bbase64\b/i,
  /\bnode\s+(?:-e|--eval)\b/i,
  /\b(?:python|python3)\s+-c\b/i,
  /\bperl\s+-e\b/i,
  /\bruby\s+-e\b/i,
  /\bosascript\b/i,
];

// Read-only commands safe in restricted contexts
export const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
  /^\s*yarn\s+(list|info|why|audit)/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  // curl/wget moved to DESTRUCTIVE_PATTERNS (network egress blocked).
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
  // GitHub CLI – read-only subcommands only
  /^\s*gh\s+issue\s+(list|view|status)\b/i,
  /^\s*gh\s+pr\s+(list|view|status|diff)\b/i,
  /^\s*gh\s+run\s+(list|view)\b/i,
  /^\s*gh\s+repo\s+view\b/i,
  /^\s*gh\s+workflow\s+(list|view)\b/i,
];

/**
 * Defense-in-depth read-only gate for plan-mode bash. NOT a sandbox:
 * whole-string regex cannot fully model shell semantics, so this blocks
 * known-dangerous tokens (network/exec/destructive) anywhere in the command
 * and requires the command to START with a known read-only tool. May false-
 * positive on doc searches that mention a blocked word (e.g. `grep curl`).
 * A complete fix needs AST-based parsing (e.g. tree-sitter-bash).
 */
export function isSafeCommand(command: string): boolean {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
  const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
  return !isDestructive && isSafe;
}
