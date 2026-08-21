/**
 * /session-health — read-only Session-Diagnose.
 *
 * Liest Pi-Session-JSONLs und berichtet Turn-Ergebnisse, Recovery-Fälle,
 * Fehler nach Klasse/Provider/Phase, Berechtigungsübergänge und
 * Verifier-Urteile. `run-history.jsonl` wird ausdrücklich nicht als
 * Zuverlässigkeitsmetrik herangezogen; die Datei bleibt unverändert.
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
  aggregateSessionFile,
  emptySessionHealthReport,
  formatSessionHealth,
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
  if (!existsSync(sessionsRoot)) return [];
  const files: string[] = [];
  for (const project of readdirSync(sessionsRoot)) {
    const projectPath = join(sessionsRoot, project);
    if (!statSync(projectPath).isDirectory()) continue;
    for (const name of readdirSync(projectPath)) {
      if (!name.endsWith(".jsonl")) continue;
      const filePath = join(projectPath, name);
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

interface RawHistorySummary {
  lines: number;
  lastTs?: number;
}

export function summarizeRawHistory(path: string): RawHistorySummary | undefined {
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let lines = 0;
  let lastTs: number | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    lines += 1;
    try {
      const record = JSON.parse(line) as { ts?: unknown };
      if (typeof record.ts === "number" && (lastTs === undefined || record.ts > lastTs)) {
        lastTs = record.ts;
      }
    } catch {
      // Rohhistorie: unlesbare Zeilen zählen nur als Zeile.
    }
  }
  return { lines, ...(lastTs !== undefined ? { lastTs } : {}) };
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
        parsed.days !== undefined ? Date.now() - parsed.days * DAY_MS : undefined;
      const files = collectSessionFiles(join(agentDir, "sessions"), sinceMs);
      const report: SessionHealthReport = emptySessionHealthReport();
      for (const file of files) {
        aggregateSessionFile(file, report, sinceMs);
      }
      const rawHistory = summarizeRawHistory(join(agentDir, "run-history.jsonl"));
      if (parsed.json) {
        ctx.ui.notify(
          JSON.stringify(
            {
              windowDays: parsed.days ?? null,
              sessionsRoot: join(agentDir, "sessions"),
              report,
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
        ? `\n  run-history.jsonl (roh, unverändert): ${rawHistory.lines} Zeilen${rawHistory.lastTs !== undefined ? `, letzter Eintrag ${new Date(rawHistory.lastTs * 1000).toISOString()}` : ""}`
        : "";
      ctx.ui.notify(
        `${formatSessionHealth(report).replace("Session-Health", `Session-Health${header}`)}${historyLine}`,
        "info",
      );
    },
  });
}
