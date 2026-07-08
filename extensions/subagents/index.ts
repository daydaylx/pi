/**
 * Controlled subagent delegation.
 *
 * Each delegated task runs in a separate `pi --mode json -p --no-session`
 * process with explicit tools, thinking level and permission environment.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type AgentConfig,
  type AgentScope,
  discoverAgents,
  formatAgentList,
} from "./agents.ts";
import {
  type SubagentEntry,
  clearSubagents,
  getWidgetState,
  renderWidget,
  resetWidgetState,
  setModel,
  setNext,
  setNow,
  setRisk,
  setThink,
  setThinking,
  setWidgetCompact,
  setWidgetDebug,
  setWidgetVisible,
  upsertSubagent,
} from "./widget.ts";

const MAX_PARALLEL_TASKS = 6;
const MAX_CONCURRENCY = 3;
const PER_TASK_OUTPUT_CAP = 40 * 1024;

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
}

interface SubagentDetails {
  mode: "single" | "parallel" | "chain" | "list";
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: SingleResult[];
}

type OnUpdate = (partial: AgentToolResult<SubagentDetails>) => void;

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "text") return part.text;
    }
  }
  return "";
}

function isFailed(result: SingleResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.stopReason === "error" ||
    result.stopReason === "aborted"
  );
}

function resultOutput(result: SingleResult): string {
  if (isFailed(result)) {
    return (
      result.errorMessage ||
      result.stderr.trim() ||
      getFinalOutput(result.messages) ||
      "(no output)"
    );
  }
  return getFinalOutput(result.messages) || "(no output)";
}

function truncateOutput(output: string): string {
  if (Buffer.byteLength(output, "utf8") <= PER_TASK_OUTPUT_CAP) return output;
  let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
  while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}\n\n[Output truncated for parent context.]`;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  let next = 0;
  const workers = new Array(Math.min(Math.max(1, concurrency), items.length))
    .fill(null)
    .map(async () => {
      while (next < items.length) {
        const current = next++;
        results[current] = await fn(items[current], current);
      }
    });
  await Promise.all(workers);
  return results;
}

async function writePromptToTempFile(
  agentName: string,
  prompt: string,
): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(dir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { dir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  return { command: "pi", args };
}

function childEnv(agent: AgentConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PI_SUBAGENT: "1",
    PI_SUBAGENT_PERMISSION_LEVEL: agent.permission,
    PI_SUBAGENT_WRITE_OVERRIDE: agent.writeOverride,
  };
}

async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdate | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
  const agent = agents.find((item) => item.name === agentName);
  if (!agent) {
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent "${agentName}". Available agents:\n${formatAgentList(agents)}`,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
      step,
    };
  }

  const args = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.thinking) args.push("--thinking", agent.thinking);
  args.push("--tools", agent.tools.join(","));

  let tmpPromptDir: string | undefined;
  let tmpPromptPath: string | undefined;
  const current: SingleResult = {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
    model: agent.model,
    step,
  };

  // Widget: mark subagent as running (#31)
  upsertSubagent({
    id: agent.name,
    label: agent.name,
    status: "running",
    currentTask: task,
    lastUpdate: Date.now(),
  });
  setNow(`startet ${agent.name}`);

  const emitUpdate = () => {
    onUpdate?.({
      content: [{ type: "text", text: getFinalOutput(current.messages) || "(running...)" }],
      details: makeDetails([current]),
    });
  };

  try {
    if (agent.systemPrompt) {
      const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmp.filePath);
    }
    args.push(`Task: ${task}`);

    let wasAborted = false;
    let timeout: NodeJS.Timeout | undefined;
    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: cwd ?? defaultCwd,
        env: childEnv(agent),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buffer = "";

      const finish = (code: number) => {
        if (timeout) clearTimeout(timeout);
        resolve(code);
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        if (event.type === "message_end" && event.message) {
          const message = event.message as Message;
          current.messages.push(message);
          if (message.role === "assistant") {
            current.usage.turns += 1;
            if (!current.model && message.model) current.model = message.model;
            if (message.stopReason) current.stopReason = message.stopReason;
            if (message.errorMessage) current.errorMessage = message.errorMessage;
            const usage = message.usage;
            if (usage) {
              current.usage.input += usage.input || 0;
              current.usage.output += usage.output || 0;
              current.usage.cacheRead += usage.cacheRead || 0;
              current.usage.cacheWrite += usage.cacheWrite || 0;
              current.usage.cost += usage.cost?.total || 0;
            }
          }
          emitUpdate();
        } else if (event.type === "tool_result_end" && event.message) {
          current.messages.push(event.message as Message);
          emitUpdate();
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });
      proc.stderr.on("data", (data) => {
        current.stderr += data.toString();
      });
      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        finish(code ?? 0);
      });
      proc.on("error", (error) => {
        current.stderr += error.message;
        finish(1);
      });

      const killProc = () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      timeout = setTimeout(killProc, agent.timeoutMs);
      if (signal) {
        if (signal.aborted) killProc();
        else signal.addEventListener("abort", killProc, { once: true });
      }
    });

    current.exitCode = exitCode;
    if (wasAborted && !current.errorMessage) {
      current.stopReason = "aborted";
      current.errorMessage = "Subagent was aborted or timed out.";
    }

    // Widget: update subagent status on completion (#31)
    upsertSubagent({
      id: agent.name,
      label: agent.name,
      status: isFailed(current) ? "blocked" : "done",
      currentTask: task,
      lastUpdate: Date.now(),
      risk: isFailed(current) ? current.errorMessage : undefined,
    });
    if (isFailed(current)) {
      setRisk(current.errorMessage ?? "failed");
    }

    return current;
  } finally {
    if (tmpPromptPath) {
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        // ignore cleanup errors
      }
    }
    if (tmpPromptDir) {
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

const TaskItem = {
  type: "object",
  properties: {
    agent: { type: "string", description: "Name of the agent to invoke" },
    task: { type: "string", description: "Task to delegate" },
    cwd: { type: "string", description: "Working directory for this task" },
  },
  required: ["agent", "task"],
  additionalProperties: false,
} as const;

const ChainItem = {
  type: "object",
  properties: {
    agent: { type: "string", description: "Name of the agent to invoke" },
    task: {
      type: "string",
      description: "Task; {previous} is replaced with prior output",
    },
    cwd: { type: "string", description: "Working directory for this step" },
  },
  required: ["agent", "task"],
  additionalProperties: false,
} as const;

const AgentScopeSchema = {
  type: "string",
  enum: ["user", "project", "both"],
  description: 'Agent directories to use. Default: "user".',
  default: "user",
} as const;

const SubagentParams = {
  type: "object",
  properties: {
    list: { type: "boolean", description: "List available agents" },
    agent: { type: "string", description: "Single agent name" },
    task: { type: "string", description: "Single agent task" },
    tasks: {
      type: "array",
      items: TaskItem,
      description: "Parallel tasks",
    },
    chain: {
      type: "array",
      items: ChainItem,
      description: "Sequential task chain",
    },
    agentScope: AgentScopeSchema,
    confirmProjectAgents: {
      type: "boolean",
      description: "Ask before running project-local agents. Default: true.",
      default: true,
    },
    cwd: { type: "string", description: "Working directory for single mode" },
  },
  additionalProperties: false,
} as const;

async function confirmProjectAgentsIfNeeded(
  ctx: ExtensionContext,
  agentScope: AgentScope,
  confirmProjectAgents: boolean,
  requestedAgentNames: Set<string>,
  agents: AgentConfig[],
  projectAgentsDir: string | null,
): Promise<boolean> {
  if (!confirmProjectAgents) return true;
  if (agentScope !== "project" && agentScope !== "both") return true;
  const requestedProjectAgents = Array.from(requestedAgentNames)
    .map((name) => agents.find((agent) => agent.name === name))
    .filter((agent): agent is AgentConfig => agent?.source === "project");
  if (requestedProjectAgents.length === 0) return true;
  if (!ctx.hasUI) return false;
  const names = requestedProjectAgents.map((agent) => agent.name).join(", ");
  return ctx.ui.confirm(
    "Run project-local subagents?",
    `Agents: ${names}\nSource: ${projectAgentsDir ?? "(unknown)"}\n\nProject agents are repository-controlled prompts.`,
  );
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  // ─── Widget-Installation (#30) ───
  function installWidget(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    const ui = ctx.ui as typeof ctx.ui & {
      setWidget?: (key: string, factory: unknown) => void;
    };
    if (typeof ui.setWidget !== "function") return;

    ui.setWidget("subagent-status", (_tui: unknown, theme: any) => ({
      render(): string[] {
        const state = getWidgetState();
        return renderWidget(state).map((line, index) => {
          if (index === 0) return theme.fg("accent", theme.bold(line));
          if (line.startsWith("Think:")) return theme.fg("muted", line);
          return theme.fg("text", line);
        });
      },
      invalidate() {},
    }));
  }

  // Hooks sind optional – das Tool funktioniert auch ohne Widget-Unterstützung.
  if (typeof pi.on === "function") {
    pi.on("session_start", async (_event, ctx) => {
      resetWidgetState();
      setModel(ctx.model?.id);
      setThinking(
        typeof pi.getThinkingLevel === "function"
          ? pi.getThinkingLevel()
          : undefined,
      );
      installWidget(ctx);
    });

    pi.on("session_shutdown", async () => {
      resetWidgetState();
    });

    pi.on("model_select", async (_event, ctx) => {
      setModel(ctx.model?.id);
    });

    pi.on("thinking_level_select", async (_event) => {
      setThinking(
        typeof pi.getThinkingLevel === "function"
          ? pi.getThinkingLevel()
          : undefined,
      );
    });
  }

  // ─── /sawidget Commands (#33) ───
  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("sawidget", {
      description: "Subagent/Thinking-Widget: on | off | compact | debug",
      handler: async (args, ctx) => {
        const sub = args.trim().toLowerCase();
        switch (sub) {
          case "on":
            setWidgetVisible(true);
            setWidgetCompact(true);
            setWidgetDebug(false);
            installWidget(ctx);
            ctx.ui.notify("Subagent-Widget aktiviert (compact).", "info");
            break;
          case "off":
            setWidgetVisible(false);
            ctx.ui.notify("Subagent-Widget deaktiviert.", "info");
            break;
          case "compact":
            setWidgetVisible(true);
            setWidgetCompact(true);
            setWidgetDebug(false);
            installWidget(ctx);
            ctx.ui.notify("Subagent-Widget: compact (max. 4 Zeilen).", "info");
            break;
          case "debug":
            setWidgetVisible(true);
            setWidgetCompact(false);
            setWidgetDebug(true);
            installWidget(ctx);
            ctx.ui.notify("Subagent-Widget: debug (mehr interne Statusdaten).", "info");
            break;
          default:
            ctx.ui.notify(
              "Nutzung: /sawidget on | off | compact | debug",
              "info",
            );
        }
      },
    });
  }

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate bounded tasks to configured subagents in isolated pi processes.",
      "Supports list, single, parallel and chain modes.",
      "Default scope is user-level agents from ~/.pi/agent/agents.",
    ].join(" "),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agentScope: AgentScope = params.agentScope ?? "user";
      const discovery = discoverAgents(ctx.cwd, agentScope);
      const agents = discovery.agents;
      const confirmProjectAgents = params.confirmProjectAgents ?? true;

      const hasList = params.list === true;
      const hasSingle = Boolean(params.agent && params.task);
      const hasParallel = (params.tasks?.length ?? 0) > 0;
      const hasChain = (params.chain?.length ?? 0) > 0;
      const modeCount = Number(hasList) + Number(hasSingle) + Number(hasParallel) + Number(hasChain);

      const makeDetails =
        (mode: SubagentDetails["mode"]) =>
        (results: SingleResult[]): SubagentDetails => ({
          mode,
          agentScope,
          projectAgentsDir: discovery.projectAgentsDir,
          results,
        });

      if (modeCount !== 1) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid subagent request. Provide exactly one mode.\n\nAvailable agents:\n${formatAgentList(agents)}`,
            },
          ],
          details: makeDetails("list")([]),
          isError: true,
        };
      }

      if (hasList) {
        return {
          content: [{ type: "text", text: `Available agents:\n${formatAgentList(agents)}` }],
          details: makeDetails("list")([]),
        };
      }

      const requested = new Set<string>();
      if (params.agent) requested.add(params.agent);
      if (params.tasks) for (const task of params.tasks) requested.add(task.agent);
      if (params.chain) for (const step of params.chain) requested.add(step.agent);
      const approved = await confirmProjectAgentsIfNeeded(
        ctx,
        agentScope,
        confirmProjectAgents,
        requested,
        agents,
        discovery.projectAgentsDir,
      );
      if (!approved) {
        return {
          content: [{ type: "text", text: "Canceled: project-local agents were not approved." }],
          details: makeDetails(hasChain ? "chain" : hasParallel ? "parallel" : "single")([]),
          isError: true,
        };
      }

      if (params.chain && params.chain.length > 0) {
        const results: SingleResult[] = [];
        let previous = "";
        for (let i = 0; i < params.chain.length; i++) {
          const step = params.chain[i];
          const task = step.task.replace(/\{previous\}/g, previous);
          const result = await runSingleAgent(
            ctx.cwd,
            agents,
            step.agent,
            task,
            step.cwd,
            i + 1,
            signal,
            (partial) => {
              const current = partial.details?.results[0];
              if (current) {
                onUpdate?.({
                  content: partial.content,
                  details: makeDetails("chain")([...results, current]),
                });
              }
            },
            makeDetails("chain"),
          );
          results.push(result);
          if (isFailed(result)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Chain stopped at step ${i + 1} (${step.agent}): ${resultOutput(result)}`,
                },
              ],
              details: makeDetails("chain")(results),
              isError: true,
            };
          }
          previous = resultOutput(result);
        }
        return {
          content: [{ type: "text", text: resultOutput(results[results.length - 1]) }],
          details: makeDetails("chain")(results),
        };
      }

      if (params.tasks && params.tasks.length > 0) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [{ type: "text", text: `Too many parallel subagent tasks. Max is ${MAX_PARALLEL_TASKS}.` }],
            details: makeDetails("parallel")([]),
            isError: true,
          };
        }
        const placeholders: SingleResult[] = params.tasks.map((task) => ({
          agent: task.agent,
          agentSource: "unknown",
          task: task.task,
          exitCode: -1,
          messages: [],
          stderr: "",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
        }));
        const emitParallelUpdate = () => {
          const done = placeholders.filter((result) => result.exitCode !== -1).length;
          onUpdate?.({
            content: [{ type: "text", text: `Parallel subagents: ${done}/${placeholders.length} done.` }],
            details: makeDetails("parallel")([...placeholders]),
          });
        };
        const results = await mapWithConcurrencyLimit(
          params.tasks,
          MAX_CONCURRENCY,
          async (task, index) => {
            const result = await runSingleAgent(
              ctx.cwd,
              agents,
              task.agent,
              task.task,
              task.cwd,
              undefined,
              signal,
              (partial) => {
                const current = partial.details?.results[0];
                if (current) {
                  placeholders[index] = current;
                  emitParallelUpdate();
                }
              },
              makeDetails("parallel"),
            );
            placeholders[index] = result;
            emitParallelUpdate();
            return result;
          },
        );
        const successCount = results.filter((result) => !isFailed(result)).length;
        const body = results
          .map((result) => {
            const status = isFailed(result) ? "failed" : "completed";
            return `### [${result.agent}] ${status}\n\n${truncateOutput(resultOutput(result))}`;
          })
          .join("\n\n---\n\n");
        return {
          content: [{ type: "text", text: `Parallel: ${successCount}/${results.length} succeeded\n\n${body}` }],
          details: makeDetails("parallel")(results),
          isError: successCount !== results.length,
        };
      }

      const result = await runSingleAgent(
        ctx.cwd,
        agents,
        params.agent!,
        params.task!,
        params.cwd,
        undefined,
        signal,
        onUpdate,
        makeDetails("single"),
      );
      return {
        content: [{ type: "text", text: resultOutput(result) }],
        details: makeDetails("single")([result]),
        isError: isFailed(result),
      };
    },
  });
}
