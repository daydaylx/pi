const GUARDED = new Set([
  "nixos-agent-apply",
  "nixos-agent-switch",
  "nixos-agent-helper",
  "switch-to-configuration",
  "sudo",
]);

function shellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  const flushToken = () => {
    if (token) tokens.push(token);
    token = "";
  };
  const flushCommand = () => {
    flushToken();
    if (tokens.length) commands.push(tokens);
    tokens = [];
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/[\s;|&<>()[\]]/.test(char)) {
      flushToken();
      if (/[;|&\n()]/.test(char)) flushCommand();
      continue;
    }
    token += char;
  }
  flushCommand();
  return commands;
}

function flattenTokens(commands: string[][], depth: number): string[] {
  const flattened: string[] = [];
  for (const tokens of commands) {
    for (const token of tokens) {
      flattened.push(token);
      if (depth < 3 && /[\s;|&]/.test(token))
        flattened.push(...flattenTokens(shellCommands(token), depth + 1));
    }
  }
  return flattened;
}

function containsProtectedToken(commands: string[][]): boolean {
  const tokens = flattenTokens(commands, 0);
  return tokens.some((token, index) => {
    const basename = token.split("/").at(-1) ?? "";
    if (GUARDED.has(basename)) return true;
    return (
      basename === "nixos-rebuild" &&
      tokens
        .slice(index + 1)
        .some((later) =>
          ["switch", "boot", "test"].includes(later.split("/").at(-1) ?? ""),
        )
    );
  });
}

/** Erkennt geschützte Systemprogramme als Shell-Tokens, einschließlich Wrappern. */
export function systemBashNeedsApproval(command: string): boolean {
  return containsProtectedToken(shellCommands(command));
}
