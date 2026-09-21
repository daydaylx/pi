import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

export const INTERACTIVE_SHELL_TOOL_NAME = "interactive_shell";

export function interactiveShellCommand(event: ToolCallEvent): string {
  return String((event.input as Record<string, unknown>).command ?? "");
}

/**
 * Reject command forms that would deliberately move a credential through the
 * model-provided shell string instead of the user's terminal input path.
 */
export function forbiddenInteractiveCredentialPath(
  command: string,
): string | undefined {
  const credentialCommand =
    /\b(?:sudo|su|ssh|sshpass|passwd|npm\s+login)\b/i.test(command);
  if (credentialCommand && /[|;&<>`()$'"\\\r\n]/.test(command)) {
    return "Shell-Kompositionen für Credential-Kommandos sind im interaktiven Shell-Pfad verboten.";
  }
  if (
    /(?:^|[;&|])[^\r\n]*\|\s*(?:(?:\S+\/)?env\s+)?(?:\S+\/)?(?:sudo|su|ssh|passwd|npm\s+login)\b/i.test(
      command,
    )
  ) {
    return "Credential-Pipelines zu sudo sind im interaktiven Shell-Pfad verboten.";
  }
  if (
    /\bsudo\b[^;&|]*(?:^|\s)(?:-[^\s]*S[^\s]*|--stdin)(?:\s|$)/i.test(command)
  ) {
    return "sudo -S/--stdin ist im interaktiven Shell-Pfad verboten.";
  }
  if (/\b[A-Z_]*(?:PASSWORD|PASSWD|TOKEN|SECRET)\s*=/i.test(command)) {
    return "Credential-Umgebungsvariablen sind im interaktiven Shell-Pfad verboten.";
  }
  if (
    /(?:^|[\s;&|])(?:--password|--passphrase)(?:[=\s]|$)/i.test(command) ||
    /\b(?:sshpass|autoexpect|expect)\b/i.test(command)
  ) {
    return "Passwortargumente und automatische Credential-Helfer sind im interaktiven Shell-Pfad verboten.";
  }
  return undefined;
}
