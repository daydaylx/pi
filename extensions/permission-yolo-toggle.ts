/**
 * Session-scoped YOLO mode for @gotgenes/pi-permission-system.
 *
 * Ctrl+Y updates the permission config used by the package's normal
 * before-agent refresh. Normal shutdowns and manual reloads restore
 * yoloMode=false; stale enabled values left by a crash are reset at startup.
 */

import {
	existsSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	getAgentDir,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	WORKFLOW_STATUS_EVENT,
	type WorkflowStatusEvent,
} from "./shared/workflow-status.ts";

const PERMISSION_STATUS_KEY = "pi-permission-system";

type PermissionConfig = Record<string, unknown> & {
	yoloMode?: boolean;
};

function configPath(): string {
	return join(
		getAgentDir(),
		"extensions",
		"pi-permission-system",
		"config.json",
	);
}

function readConfig(): PermissionConfig {
	const path = configPath();
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid permission config: ${path}`);
	}
	return parsed as PermissionConfig;
}

function writeYoloMode(enabled: boolean): void {
	const path = configPath();
	const temporaryPath = `${path}.${process.pid}.tmp`;
	const config = readConfig();
	config.yoloMode = enabled;

	try {
		writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporaryPath, path);
	} finally {
		if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
	}
}

export default function (pi: ExtensionAPI) {
	let runtimeYolo = false;
	let staleYolo = false;

	function publishStatus(ctx: {
		ui: {
			setStatus(key: string, value: string | undefined): void;
		};
	}): void {
		ctx.ui.setStatus(
			PERMISSION_STATUS_KEY,
			runtimeYolo ? "yolo" : undefined,
		);
		pi.events.emit(WORKFLOW_STATUS_EVENT, {
			source: "permission",
			yolo: runtimeYolo,
		} satisfies WorkflowStatusEvent);
	}

	try {
		const configuredYolo = readConfig().yoloMode === true;
		staleYolo = configuredYolo;
	} catch {
		// The shortcut reports the actionable error if the config is unavailable.
	}

	pi.on("session_start", async (_event, ctx) => {
		if (staleYolo) {
			try {
				writeYoloMode(false);
				staleYolo = false;
				ctx.ui.notify(
					"Stale YOLO mode was disabled. Use Ctrl+Y to enable it for this runtime.",
					"warning",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not reset stale YOLO mode: ${message}`, "error");
			}
		}

		try {
			runtimeYolo = readConfig().yoloMode === true;
		} catch {
			runtimeYolo = false;
		}
		publishStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (!runtimeYolo) return;
		try {
			writeYoloMode(false);
		} catch {
			// Shutdown must continue; stale-state recovery runs on next startup.
		}
	});

	pi.registerShortcut("ctrl+y", {
		description: "Toggle session-scoped permission YOLO mode",
		handler: async (ctx) => {
			try {
				const nextYolo = readConfig().yoloMode !== true;
				writeYoloMode(nextYolo);
				runtimeYolo = nextYolo;
				publishStatus(ctx);
				ctx.ui.notify(
					runtimeYolo
						? "YOLO mode enabled for this runtime."
						: "YOLO mode disabled.",
					runtimeYolo ? "warning" : "info",
				);
			} catch (error) {
				runtimeYolo = false;
				try {
					writeYoloMode(false);
				} catch {
					// Preserve the original error below.
				}
				publishStatus(ctx);
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not toggle YOLO mode: ${message}`, "error");
			}
		},
	});
}
