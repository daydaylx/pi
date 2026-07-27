/**
 * Bounded reads and atomic writes for workflow artifacts.
 *
 * Every write goes through a temp file plus rename so a failed write can never
 * damage the last valid state (Umbauvertrag §13.6).
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { assertSafePath, ensureParent } from "./paths.ts";

export function readBounded(
  cwd: string,
  path: string,
  maximumBytes: number,
): string | undefined {
  assertSafePath(cwd, path);
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (!stat.isFile())
    throw new Error(`Workflow-Artefakt ist keine Datei: ${path}`);
  if (stat.size > maximumBytes) {
    throw new Error(
      `Workflow-Artefakt ist zu groß (${stat.size} Bytes): ${path}`,
    );
  }
  const content = readFileSync(path, "utf8");
  if (Buffer.byteLength(content, "utf8") > maximumBytes) {
    throw new Error(
      `Workflow-Artefakt überschreitet die Größenbegrenzung: ${path}`,
    );
  }
  return content;
}

export function writeAtomic(
  cwd: string,
  path: string,
  content: string,
  maximumBytes: number,
): void {
  if (Buffer.byteLength(content, "utf8") > maximumBytes) {
    throw new Error(`Workflow-Artefakt ist zu groß: ${path}`);
  }
  ensureParent(cwd, path);
  assertSafePath(cwd, path);
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    writeFileSync(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function tokenFor(raw: string | undefined): string {
  return raw === undefined
    ? "missing"
    : `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}
