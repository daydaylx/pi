import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSensitiveReference } from "../shared/permission-policy.ts";
import type {
  ContextManifest,
  ContextManifestEntry,
  ContextReference,
} from "./types.ts";

const MAX_REFERENCES = 8;
const MAX_LABEL_LENGTH = 120;
const MAX_RANGE_LINES = 400;
const MAX_FULL_FILE_BYTES = 16_000;
const MAX_TOTAL_BYTES = 64_000;
export function estimateTextTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4) + 8;
}

const SECRET_CONTENT = [
  /-----BEGIN [^-]*PRIVATE KEY-----/i,
  /\b(?:ghp|gho|ghu|ghs|github_pat|xox[baprs]|sk-[A-Za-z0-9_-]{12,})[A-Za-z0-9_-]*\b/,
  /\b(?:authorization|api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password)\s*[:=]\s*['"]?[A-Za-z0-9_./+=:-]{12,}/i,
];

export type ManifestErrorCode =
  "invalid_context" | "blocked_sensitive_content" | "context_budget_exceeded";

export interface ManifestError {
  code: ManifestErrorCode;
  message: string;
}

export type ManifestResult =
  { ok: true; manifest: ContextManifest } | { ok: false; error: ManifestError };

function fail(code: ManifestErrorCode, message: string): ManifestResult {
  return { ok: false, error: { code, message } };
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel))
  );
}

function hasSecretContent(content: string): boolean {
  return SECRET_CONTENT.some((pattern) => pattern.test(content));
}

function isSessionDumpReference(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    /(?:^|\/)\.pi\/(?:sessions?|conversations?|transcripts?)(?:\/|$)/i.test(
      normalized,
    ) ||
    /(?:^|\/)(?:session|conversation|transcript|chat[-_]?history)(?:[-_][^/]*)?\.(?:json|jsonl|ndjson|txt|md)$/i.test(
      normalized,
    )
  );
}

function normalizeReference(
  reference: ContextReference,
): ContextReference | ManifestError {
  if (!reference || typeof reference !== "object")
    return { code: "invalid_context", message: "Ungültige Kontextreferenz" };
  if (
    typeof reference.label !== "string" ||
    !reference.label.trim() ||
    reference.label.length > MAX_LABEL_LENGTH
  )
    return {
      code: "invalid_context",
      message: "Ungültige Kontextbeschreibung",
    };
  if (
    !["code_range", "diff", "test_summary", "requirement"].includes(
      reference.kind,
    )
  )
    return { code: "invalid_context", message: "Unbekannter Kontexttyp" };
  if (
    typeof reference.path !== "string" ||
    !reference.path.trim() ||
    isAbsolute(reference.path)
  )
    return {
      code: "invalid_context",
      message: "Kontextpfad muss workspace-relativ sein",
    };
  if (
    reference.startLine !== undefined &&
    (!Number.isInteger(reference.startLine) || reference.startLine < 1)
  )
    return { code: "invalid_context", message: "Ungültiger Startbereich" };
  if (
    reference.endLine !== undefined &&
    (!Number.isInteger(reference.endLine) || reference.endLine < 1)
  )
    return { code: "invalid_context", message: "Ungültiger Endbereich" };
  if (
    reference.startLine !== undefined &&
    reference.endLine !== undefined &&
    reference.startLine > reference.endLine
  )
    return { code: "invalid_context", message: "Umgekehrter Zeilenbereich" };
  return {
    kind: reference.kind,
    path: reference.path.replaceAll("\\", "/"),
    startLine: reference.startLine,
    endLine: reference.endLine,
    label: reference.label.trim(),
  };
}

function readEntry(
  root: string,
  reference: ContextReference,
): ContextManifestEntry | ManifestError {
  const path = reference.path!;
  if (isSensitiveReference(path))
    return {
      code: "blocked_sensitive_content",
      message: "Sensible Kontextquelle blockiert",
    };
  if (isSessionDumpReference(path))
    return {
      code: "invalid_context",
      message: "Session- oder Conversation-Dump blockiert",
    };
  const absolute = resolve(root, path);
  if (!inside(root, absolute))
    return {
      code: "invalid_context",
      message: "Kontextquelle liegt außerhalb des Workspace",
    };
  if (!existsSync(absolute))
    return { code: "invalid_context", message: "Kontextquelle nicht gefunden" };
  try {
    let current = root;
    for (const part of relative(root, absolute).split(sep)) {
      if (!part) continue;
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink())
        return {
          code: "invalid_context",
          message: "Symbolische Kontextquelle blockiert",
        };
    }
  } catch {
    return {
      code: "invalid_context",
      message: "Kontextquelle konnte nicht geprüft werden",
    };
  }
  let canonical: string;
  try {
    canonical = realpathSync(absolute);
  } catch {
    return {
      code: "invalid_context",
      message: "Kontextquelle konnte nicht kanonisiert werden",
    };
  }
  if (!inside(root, canonical))
    return { code: "invalid_context", message: "Symlink-Ausbruch blockiert" };
  let fileSize = 0;
  try {
    const stats = statSync(canonical);
    if (!lstatSync(canonical).isFile() || !stats.isFile())
      return {
        code: "invalid_context",
        message: "Kontextquelle ist keine reguläre Datei",
      };
    fileSize = stats.size;
    if (fileSize > MAX_FULL_FILE_BYTES)
      return {
        code: "invalid_context",
        message: "Kontextquelle überschreitet die Sicherheitsgrenze",
      };
  } catch {
    return {
      code: "invalid_context",
      message: "Kontextquelle ist nicht lesbar",
    };
  }

  let source: string;
  try {
    source = readFileSync(canonical, "utf8");
  } catch {
    return {
      code: "invalid_context",
      message: "Kontextquelle ist nicht lesbar",
    };
  }
  if (source.includes("\0") || source.includes("\ufffd"))
    return {
      code: "blocked_sensitive_content",
      message: "Binäre oder nicht dekodierbare Kontextquelle blockiert",
    };
  if (hasSecretContent(source))
    return {
      code: "blocked_sensitive_content",
      message: "Sensible Inhalte blockiert",
    };

  const lines = source.split("\n");
  const start = reference.startLine ?? 1;
  const end = reference.endLine ?? lines.length;
  if (
    start > lines.length ||
    end > lines.length ||
    end - start + 1 > MAX_RANGE_LINES
  )
    return {
      code: "invalid_context",
      message: "Kontextbereich ist zu groß oder außerhalb der Datei",
    };
  const content = lines.slice(start - 1, end).join("\n");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FULL_FILE_BYTES)
    return {
      code: "invalid_context",
      message: "Kontextbereich überschreitet die Sicherheitsgrenze",
    };
  const workspacePath = relative(root, canonical).split("\\").join("/");
  const range = `${start}-${end}`;
  const snapshotHash = createHash("sha256")
    .update(workspacePath)
    .update("\0")
    .update(range)
    .update("\0")
    .update(content)
    .digest("hex");
  return {
    path: workspacePath,
    range,
    contentType: reference.kind,
    bytes,
    estimatedTokens: estimateTextTokens(content),
    snapshotHash,
    content,
  };
}

export function buildContextManifest(
  cwd: string,
  references: readonly ContextReference[],
): ManifestResult {
  if (!Array.isArray(references) || references.length === 0)
    return fail(
      "invalid_context",
      "Mindestens eine Kontextreferenz ist erforderlich",
    );
  if (references.length > MAX_REFERENCES)
    return fail("invalid_context", "Zu viele Kontextreferenzen");
  const root = resolve(cwd);
  const normalized: ContextReference[] = [];
  const entries: ContextManifestEntry[] = [];
  let bytes = 0;
  let estimatedTokens = 0;
  for (const candidate of references) {
    const reference = normalizeReference(candidate);
    if ("code" in reference) return fail(reference.code, reference.message);
    normalized.push(reference);
    const entry = readEntry(root, reference);
    if ("code" in entry) return fail(entry.code, entry.message);
    bytes += entry.bytes;
    estimatedTokens += entry.estimatedTokens;
    if (bytes > MAX_TOTAL_BYTES)
      return fail(
        "context_budget_exceeded",
        "Kontext überschreitet die Byte-Grenze",
      );
    entries.push(entry);
  }
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(entries.map(({ content, ...entry }) => entry)))
    .digest("hex");
  return {
    ok: true,
    manifest: {
      references: normalized,
      entries,
      bytes,
      estimatedTokens,
      snapshotHash,
    },
  };
}

export function manifestStillCurrent(
  cwd: string,
  manifest: ContextManifest,
): boolean {
  const current = buildContextManifest(cwd, manifest.references);
  return current.ok && current.manifest.snapshotHash === manifest.snapshotHash;
}

export function manifestPromptText(manifest: ContextManifest): string {
  return manifest.entries
    .map(
      (entry) =>
        `SOURCE ${entry.path} [lines ${entry.range}, ${entry.contentType}]\n<untrusted_evidence>\n${entry.content}\n</untrusted_evidence>`,
    )
    .join("\n\n");
}
