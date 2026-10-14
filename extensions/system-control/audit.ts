import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_AUDIT = 1024 * 1024;

function auditPath(): string {
  const directory =
    process.env.PI_SYSTEM_AUDIT_DIR ??
    join(
      process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
      "pi-system",
    );
  return join(directory, "audit.jsonl");
}

export async function audit(
  entry: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    const file = auditPath();
    const directory = dirname(file);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      if ((await stat(file)).size >= MAX_AUDIT) {
        await rename(file, `${file}.1`);
      }
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
    return undefined;
  } catch (error) {
    return `Audit konnte nicht geschrieben werden: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function digest(args: unknown): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",")}}`;
    return JSON.stringify(value) ?? "null";
  };
  return createHash("sha256").update(canonical(args)).digest("hex");
}

export async function auditSystemDenial(
  tool: string,
  args: unknown,
): Promise<string | undefined> {
  return audit({
    ts: new Date().toISOString(),
    tool,
    argsDigest: digest(args),
    outcome: "denied",
    exit: null,
    durationMs: 0,
  });
}
