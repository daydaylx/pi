/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Supports multiple terminal protocols:
 * - OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * - OSC 99: Kitty
 * - Windows toast: Windows Terminal (WSL)
 *
 * Security: title/body are interpolated into a PowerShell script. To prevent
 * command injection they are (a) escaped as PowerShell single-quoted string
 * literals and (b) the whole script is passed via -EncodedCommand (base64 of
 * UTF-16LE), so no raw script reaches the command line. notify() MUST still
 * only receive trusted/static strings — do not feed it untrusted input.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Escape a value as a PowerShell single-quoted string literal. The only
 *  special character inside such a literal is the single quote, which is
 *  doubled. This is the safe way to embed content in a PowerShell script. */
function psSingleQuote(value: string): string {
	return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	const text = psSingleQuote(body);
	const aumid = psSingleQuote(title);
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode(${text})) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier(${aumid}).Show(${toast})`,
	].join("; ");
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	// Kitty OSC 99: i=notification id, d=0 means not done yet, p=body for second part
	process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
	process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notifyWindows(title: string, body: string): void {
	// -EncodedCommand expects the base64 of the script encoded as UTF-16LE.
	// Combined with psSingleQuote above this neutralizes PowerShell injection
	// even if title/body were ever to become dynamic.
	const encoded = Buffer.from(windowsToastScript(title, body), "utf16le").toString("base64");
	execFile("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded]);
}

function notify(title: string, body: string): void {
	if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		notify("Pi", "Ready for input");
	});
}
