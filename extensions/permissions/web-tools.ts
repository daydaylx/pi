/**
 * Web capability class ("extern read-only"): die beiden pi-web-access-Tools.
 *
 * Die Klasse ist bewusst NICHT Teil der Trust-Allowlist in guards.ts
 * (READ_ONLY_TOOLS): Netzwerkzugriff ist kein lokales Lesen. In untrusted
 * Projekten bleiben beide Tools dadurch hart geblockt, unabhängig von der
 * Zugriffsstufe.
 *
 * Harte Eingabegrenzen: fetch_content akzeptiert nur öffentliche
 * http(s)-Ziele und keine auth-Profile; web_search darf seinen Workflow
 * nicht von "none" weg überschreiben. Damit bleibt fetch_content ein
 * Web-Tool statt eines alternativen Dateilesers (lokale Pfade, file://),
 * lokale Credentials werden nicht übertragen und Curator/Summary bleiben
 * deaktiviert.
 */
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { PolicyDecision } from "../shared/permission-policy.ts";
import {
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
} from "../shared/workflow-status.ts";

export const WEB_TOOLS = new Set(["web_search", "fetch_content"]);

interface WorkflowAssessment {
  blocked: boolean;
  reason: string;
}

function collectFetchUrls(input: Record<string, unknown> | undefined): string[] {
  if (!input) return [];
  const urls: string[] = [];
  if (typeof input.url === "string") urls.push(input.url);
  if (Array.isArray(input.urls)) {
    for (const entry of input.urls) {
      if (typeof entry === "string") urls.push(entry);
    }
  }
  return urls;
}

/**
 * Harte Grenze (gilt auf jeder Stufe, YOLO eingeschlossen): fetch_content
 * darf ausschließlich http(s)-URLs entgegennehmen und keinen auth-Parameter.
 * web_search darf den verbindlichen workflow: "none" nicht überschreiben.
 */
export function assessWebToolInput(event: ToolCallEvent): WorkflowAssessment {
  const input = event.input as Record<string, unknown> | undefined;
  if (event.toolName === "web_search") {
    if (input?.workflow !== undefined && input.workflow !== "none") {
      return {
        blocked: true,
        reason:
          'Harte Grenze: web_search darf workflow nur auf "none" setzen; Curator und Summary sind deaktiviert.',
      };
    }
    return { blocked: false, reason: "" };
  }
  if (event.toolName !== "fetch_content") {
    return { blocked: false, reason: "" };
  }
  if (input && input.auth !== undefined && input.auth !== false) {
    return {
      blocked: true,
      reason:
        "Harte Grenze: authenticated fetch (auth) ist im Harness nicht freigegeben.",
    };
  }
  for (const url of collectFetchUrls(input)) {
    if (!/^https?:\/\//i.test(url.trim())) {
      return {
        blocked: true,
        reason: `Harte Grenze: fetch_content akzeptiert nur http(s)-Ziele, nicht "${url.slice(0, 80)}".`,
      };
    }
  }
  return { blocked: false, reason: "" };
}

/**
 * Stufenlogik analog verify: readonly blockiert, confirm-all fragt,
 * project-write und yolo erlauben. Die harte Trust-Grenze läuft vorher und
 * blockiert beide Tools im untrusted Projekt weiterhin.
 */
export function decideWebTool(permissionLevel: PermissionLevel): PolicyDecision {
  if (permissionLevel === "readonly") {
    return {
      action: "block",
      reason: `${PERMISSION_LEVEL_LABEL[permissionLevel]}: Web-Tools sind nicht freigegeben.`,
    };
  }
  if (permissionLevel === "confirm-all") {
    return {
      action: "ask",
      reason: "Webzugriff (externer Host) benötigt eine Bestätigung.",
    };
  }
  return { action: "allow", reason: "Extern read-only Web capability" };
}
