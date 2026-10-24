/**
 * /session-health — read-only Session-Diagnose.
 *
 * Liest Pi-Session-JSONLs und berichtet Turn-Ergebnisse, Recovery-Fälle,
 * Fehler nach Klasse/Provider/Phase, Berechtigungsübergänge,
 * Verifier-Urteile sowie Requests, Tool-Calls, Tokens, Kosten und Request-Dauer.
 * `run-history.jsonl` wird ausdrücklich nicht als Zuverlässigkeitsmetrik
 * herangezogen; ihre Subagent-Läufe erscheinen nur als rohe Kostenübersicht.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { catalogDescription } from "../shared/command-catalog.ts";
import {
  aggregateSessionEntries,
  emptySessionHealthReport,
  formatSessionHealth,
  readSessionFile,
  summarizeUsage,
  type SessionHealthReport,
} from "./analyze.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ParsedArgs {
  days?: number;
  json: boolean;
  error?: string;
}

export function parseSessionHealthArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let days: number | undefined;
  let json = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--days") {
      const raw = tokens[index + 1];
      const value = Number(raw);
      if (!raw || !Number.isInteger(value) || value <= 0) {
        return { json, error: "--days erwartet eine positive ganze Zahl." };
      }
      days = value;
      index += 1;
      continue;
    }
    return { json, error: `Unbekanntes Argument: ${token}` };
  }
  return { days, json };
}

export function collectSessionFiles(
  sessionsRoot: string,
  sinceMs?: number,
): string[] {
  let entries;
  try {
    entries = readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const paths = entry.isDirectory()
      ? (() => {
          try {
            return readdirSync(join(sessionsRoot, entry.name), {
              withFileTypes: true,
            })
              .filter(
                (child) => child.isFile() && child.name.endsWith(".jsonl"),
              )
              .map((child) => join(sessionsRoot, entry.name, child.name));
          } catch {
            return [];
          }
        })()
      : entry.isFile() && entry.name.endsWith(".jsonl")
        ? [join(sessionsRoot, entry.name)]
        : [];
    for (const filePath of paths) {
      if (sinceMs !== undefined) {
        let mtimeMs: number;
        try {
          mtimeMs = statSync(filePath).mtimeMs;
        } catch {
          continue;
        }
        if (mtimeMs < sinceMs) continue;
      }
      files.push(filePath);
    }
  }
  return files.sort();
}

interface SessionRoot {
  role: "pi-project" | "pis-cli" | "pis-host";
  path: string;
}

interface SessionRootReport {
  role: SessionRoot["role"];
  path: string;
  status: "available" | "missing" | "unreadable";
  files: number;
  deduplicatedSessions: number;
  report: SessionHealthReport;
}

export function collectSessionRoots(
  roots: readonly SessionRoot[],
  sinceMs?: number,
): { sources: SessionRootReport[]; report: SessionHealthReport } {
  const report = emptySessionHealthReport();
  const seenSessions = new Set<string>();
  const sources: SessionRootReport[] = [];
  for (const root of roots) {
    let status: SessionRootReport["status"] = "available";
    let files: string[];
    try {
      readdirSync(root.path);
      files = collectSessionFiles(root.path, sinceMs);
    } catch (error) {
      status =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unreadable";
      files = [];
    }
    const sourceReport = emptySessionHealthReport();
    const source: SessionRootReport = {
      role: root.role,
      path: root.path,
      status,
      files: files.length,
      deduplicatedSessions: 0,
      report: sourceReport,
    };
    sources.push(source);
    for (const file of files) {
      const session = readSessionFile(file);
      if (!session) {
        report.parseErrors += 1;
        sourceReport.parseErrors += 1;
        continue;
      }
      report.parseErrors += session.parseErrors;
      sourceReport.parseErrors += session.parseErrors;
      const sessionId = session.sessionId;
      if (sessionId && seenSessions.has(sessionId)) {
        source.deduplicatedSessions += 1;
        continue;
      }
      if (sessionId) seenSessions.add(sessionId);
      report.files += 1;
      sourceReport.files += 1;
      aggregateSessionEntries(session.entries, report, sinceMs);
      aggregateSessionEntries(session.entries, sourceReport, sinceMs);
    }
  }
  return { sources, report };
}

interface RawHistoryAgent {
  runs: number;
  errors: number;
  medianDurationMs: number;
  tokens: number;
}

interface RawHistorySummary {
  lines: number;
  lastTs?: number;
  /** Subagent-Läufe im Auswertungsfenster, je Agentenname. */
  byAgent: Record<string, RawHistoryAgent>;
}

export function summarizeRawHistory(
  path: string,
  sinceMs?: number,
): RawHistorySummary | undefined {
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let lines = 0;
  let lastTs: number | undefined;
  const durations: Record<string, number[]> = {};
  const byAgent: Record<string, RawHistoryAgent> = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    lines += 1;
    try {
      const record = JSON.parse(line) as {
        ts?: unknown;
        agent?: unknown;
        status?: unknown;
        duration?: unknown;
        tokens?: { input?: unknown; output?: unknown; cacheRead?: unknown };
      };
      const ts =
        typeof record.ts === "number"
          ? record.ts
          : typeof record.ts === "string"
            ? Number(record.ts)
            : undefined;
      if (ts !== undefined && Number.isFinite(ts)) {
        if (lastTs === undefined || ts > lastTs) lastTs = ts;
        if (
          sinceMs !== undefined &&
          ts * 1000 >= sinceMs &&
          typeof record.agent === "string"
        ) {
          const entry = (byAgent[record.agent] ??= {
            runs: 0,
            errors: 0,
            medianDurationMs: 0,
            tokens: 0,
          });
          entry.runs += 1;
          if (record.status !== "ok") entry.errors += 1;
          for (const value of [
            record.tokens?.input,
            record.tokens?.output,
            record.tokens?.cacheRead,
          ]) {
            if (typeof value === "number") entry.tokens += value;
          }
          if (typeof record.duration === "number")
            (durations[record.agent] ??= []).push(record.duration);
        }
      }
    } catch {
      // Rohhistorie: unlesbare Zeilen zählen nur als Zeile.
    }
  }
  for (const [agent, samples] of Object.entries(durations)) {
    samples.sort((a, b) => a - b);
    byAgent[agent]!.medianDurationMs = samples[Math.floor(samples.length / 2)]!;
  }
  return { lines, ...(lastTs !== undefined ? { lastTs } : {}), byAgent };
}

function formatRawAgents(byAgent: Record<string, RawHistoryAgent>): string {
  const rows = Object.entries(byAgent).sort((a, b) => b[1].runs - a[1].runs);
  if (rows.length === 0) return "";
  return rows
    .slice(0, 6)
    .map(
      ([agent, stats]) =>
        `\n    Subagent ${agent}: ${stats.runs} Läufe (${stats.errors} Fehler) · Median ${(stats.medianDurationMs / 1000).toFixed(0)} s · ${(stats.tokens / 1000).toFixed(0)} k Tokens`,
    )
    .join("");
}

export default function sessionHealthExtension(pi: ExtensionAPI): void {
  pi.registerCommand("session-health", {
    description: catalogDescription("session-health"),
    handler: async (args, ctx: ExtensionCommandContext) => {
      const parsed = parseSessionHealthArgs(args);
      if (parsed.error) {
        ctx.ui.notify(
          `${parsed.error} Nutzung: /session-health [--days N] [--json]`,
          "error",
        );
        return;
      }
      const agentDir = getAgentDir();
      const sinceMs =
        parsed.days !== undefined
          ? Date.now() - parsed.days * DAY_MS
          : undefined;
      const roots: SessionRoot[] = [
        { role: "pi-project", path: join(agentDir, "sessions") },
        {
          role: "pis-cli",
          path: join(agentDir, "profile-state", "system", "sessions"),
        },
        {
          role: "pis-host",
          path: join(agentDir, "profile-state", "system", "host-sessions"),
        },
      ];
      const { sources, report } = collectSessionRoots(roots, sinceMs);
      const rootSummary = sources
        .map(
          (source) =>
            `${source.role}: ${source.status}, ${source.report.files} Sessions${source.deduplicatedSessions ? `, ${source.deduplicatedSessions} Duplikate übersprungen` : ""}`,
        )
        .join(" · ");
      const rawHistory = summarizeRawHistory(
        join(agentDir, "run-history.jsonl"),
        sinceMs,
      );
      if (parsed.json) {
        ctx.ui.notify(
          JSON.stringify(
            {
              windowDays: parsed.days ?? null,
              sources,
              report: { ...report, usage: summarizeUsage(report.usage) },
              runHistoryRaw: rawHistory ?? null,
            },
            null,
            2,
          ),
          "info",
        );
        return;
      }
      const header =
        parsed.days !== undefined
          ? ` (letzte ${parsed.days} Tage)`
          : " (gesamte Historie)";
      const historyLine = rawHistory
        ? `\n  run-history.jsonl (roh, unverändert): ${rawHistory.lines} Zeilen${rawHistory.lastTs !== undefined ? `, letzter Eintrag ${new Date(rawHistory.lastTs * 1000).toISOString()}` : ""}${formatRawAgents(rawHistory.byAgent)}`
        : "";
      ctx.ui.notify(
        `${formatSessionHealth(report).replace("Session-Health", `Session-Health${header}`)}\n  Quellen: ${rootSummary}${historyLine}`,
        "info",
      );
    },
  });
}
