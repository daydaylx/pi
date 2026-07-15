/**
 * Replaces the startup header with git status: current branch, a compact
 * working-tree summary, and the last 5 commits. Leaves the built-in header
 * untouched when cwd is not inside a git repository.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

async function isGitRepo(pi: ExtensionAPI, cwd: string): Promise<boolean> {
  try {
    const result = await pi.exec(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd },
    );
    return result.code === 0;
  } catch {
    return false;
  }
}

async function readBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
  const branch = await pi.exec("git", ["branch", "--show-current"], { cwd });
  const name = branch.stdout.trim();
  if (name) return name;
  const head = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { cwd });
  return head.code === 0 ? `HEAD detached at ${head.stdout.trim()}` : "HEAD";
}

function summarizeStatus(porcelain: string): string[] {
  const lines = porcelain.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return ["(clean)"];

  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let deleted = 0;
  for (const line of lines) {
    const indexStatus = line[0];
    const worktreeStatus = line[1];
    if (line.startsWith("??")) {
      untracked++;
      continue;
    }
    if (indexStatus === "D" || worktreeStatus === "D") {
      deleted++;
      continue;
    }
    if (indexStatus !== " " && indexStatus !== "?") staged++;
    if (worktreeStatus === "M") modified++;
  }

  const parts: string[] = [];
  if (staged > 0) parts.push(`${staged} staged`);
  if (modified > 0) parts.push(`${modified} geändert`);
  if (untracked > 0) parts.push(`${untracked} neu`);
  if (deleted > 0) parts.push(`${deleted} gelöscht`);
  return [parts.length > 0 ? parts.join(", ") : "(clean)"];
}

async function readCommits(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const result = await pi.exec("git", ["log", "-5", "--oneline"], { cwd });
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  return lines.length > 0 ? lines : ["(keine Commits)"];
}

async function installGitHeader(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.hasUI) return;
  if (!(await isGitRepo(pi, ctx.cwd))) return;

  const [branch, statusResult, commits] = await Promise.all([
    readBranch(pi, ctx.cwd),
    pi.exec("git", ["status", "--porcelain=v1"], { cwd: ctx.cwd }),
    readCommits(pi, ctx.cwd),
  ]);
  const status = summarizeStatus(statusResult.stdout);

  ctx.ui.setHeader((_tui, theme) => ({
    render(width: number): string[] {
      const lines = [
        `${theme.bold("Current branch:")} ${branch}`,
        theme.bold("Status:"),
        ...status,
        "",
        theme.bold("Recent commits:"),
        ...commits.map((line) => theme.fg("muted", line)),
      ];
      return lines.map((line) => truncateToWidth(line, width, ""));
    },
    invalidate() {},
  }));
}

export default function gitHeaderExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await installGitHeader(pi, ctx);
  });
}
