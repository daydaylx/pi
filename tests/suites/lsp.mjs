import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { assert, eq } from "../shared/assertions.mjs";
import {
  assertNoGlobalChrome,
  contrastRatio,
  createHarness,
  latestStatus,
  stripAnsi,
  withHarness,
} from "../shared/harness.mjs";
import { ROOT } from "../shared/jiti-loader.mjs";

// ---------------------------------------------------------------------------
// LSP transport, process and lifecycle (#93). Deterministic: uses the local
// fake-lsp fixture only, never a real language server or the network.
// ---------------------------------------------------------------------------
const FAKE_LSP_COMMAND = "python3";
const FAKE_LSP_FIXTURE = path.join(ROOT, "tests", "fixtures", "fake-lsp.py");

export const lspSections = {
  "LSP Control Center file picker": async (context) => {
    const { section, lspControlCenter, lspTools } = context;

    await section("LSP Control Center file picker", async () => {
      if (!lspControlCenter) return;
      assert(
        typeof lspTools?.runLspDiagnostics === "function",
        "Control Center reuses the exported diagnostics execution path",
      );
      const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp-picker-"));
      try {
        writeFileSync(path.join(cwd, "ok.ts"), "export {}\n");
        mkdirSync(path.join(cwd, "node_modules"));
        writeFileSync(
          path.join(cwd, "node_modules", "ignored.ts"),
          "export {}\n",
        );
        symlinkSync(path.join(cwd, "ok.ts"), path.join(cwd, "linked.ts"));
        eq(
          lspControlCenter.findLspDiagnosticCandidates(cwd),
          ["ok.ts"],
          "LSP picker accepts regular supported workspace files and skips symlinks/ignored directories",
        );
        eq(
          lspControlCenter.findLspDiagnosticCandidates(
            path.join(cwd, "missing"),
          ),
          [],
          "LSP picker has a clear empty candidate result",
        );
        eq(
          lspControlCenter.resolveLspDiagnosticCandidate(cwd, "ok.ts"),
          path.join(cwd, "ok.ts"),
          "LSP picker revalidates a regular selected file before diagnosis",
        );
        eq(
          lspControlCenter.resolveLspDiagnosticCandidate(cwd, "linked.ts"),
          undefined,
          "LSP picker rejects a selected symlink after enumeration",
        );

        let sessionCurrent = true;
        const lifecycleHarness = createHarness({
          select: (labels) => {
            if (labels.includes("Datei prüfen")) return "Datei prüfen";
            sessionCurrent = false;
            return labels.includes("ok.ts") ? "ok.ts" : undefined;
          },
        });
        lspControlCenter.registerLspControlCenter(lifecycleHarness.api, {
          getStatus: () => "leerlauf",
          refreshStatus() {
            throw new Error("stale picker must not refresh LSP status");
          },
          captureSession: () => "session-1",
          isSessionCurrent: () => sessionCurrent,
          captureDeps() {
            throw new Error("stale picker must not start LSP diagnostics");
          },
        });
        const lifecycleContext = lifecycleHarness.makeContext({ cwd });
        lifecycleContext.ui.custom = async () => {
          throw new Error("use deterministic select fallback");
        };
        await lifecycleHarness.dispatchEvent(
          "control-center:open-diagnostics",
          {
            ctx: lifecycleContext,
          },
        );
        eq(
          lifecycleHarness.notifications,
          [],
          "stale LSP pickers stop before diagnostics or UI updates",
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  },

  "LSP transport, process and lifecycle (#93)": async (context) => {
    const { section, load } = context;

    await section("LSP transport, process and lifecycle (#93)", async () => {
      const transportMod = await load("extensions/lsp/transport.ts");
      const clientMod = await load("extensions/lsp/client.ts");
      const indexMod = await load("extensions/lsp/index.ts");
      const typesMod = await load("extensions/lsp/types.ts");
      const toolsMod = await load("extensions/lsp/tools.ts");
      assert(
        typeof transportMod?.parseStreamChunk === "function",
        "lsp transport exports parseStreamChunk",
      );
      assert(
        typeof clientMod?.LspClient === "function",
        "lsp client exports LspClient",
      );
      assert(
        typeof indexMod?.createLspClient === "function",
        "lsp index exports createLspClient",
      );

      await check(
        "formatErrorMessage and LspError formatting handles RPC errors cleanly",
        async () => {
          const { formatErrorMessage } = clientMod;
          const { LspError } = typesMod;
          const { formatLspError } = toolsMod;

          eq(
            formatErrorMessage(new Error("std error")),
            "std error",
            "formatErrorMessage unpacks Error instance",
          );
          eq(
            formatErrorMessage({ code: -32601, message: "Method not found" }),
            "Method not found",
            "formatErrorMessage unpacks JSON-RPC error object",
          );
          eq(
            formatErrorMessage({ message: "custom obj message" }),
            "custom obj message",
            "formatErrorMessage unpacks object with message property",
          );

          const lspErr = new LspError({
            kind: "request_failed",
            serverId: "typescript",
            workspaceRoot: "/home/d/.pi/agent",
            method: "workspace/symbol",
            cause: "Method workspace/symbol not supported",
          });

          eq(
            lspErr.cause,
            "Method workspace/symbol not supported",
            "LspError stores cause property",
          );
          eq(
            lspErr.toStructured().cause,
            "Method workspace/symbol not supported",
            "toStructured returns cause without header prefix",
          );

          const formatted = formatLspError(lspErr);
          assert(
            !formatted.includes("[object Object]"),
            "formatted error does not contain [object Object]",
          );
          assert(
            formatted.includes(
              "Ursache: Method workspace/symbol not supported",
            ),
            "formatted error shows concise cause without duplicate header",
          );
        },
      );

      const fakeServer = FAKE_LSP_FIXTURE;
      const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp-test-"));
      const trackedClients = [];

      function makeClient(extra = {}) {
        const {
          args: extraArgs = [],
          process: extraProcess,
          command = FAKE_LSP_COMMAND,
          ...rest
        } = extra;
        const client = new clientMod.LspClient({
          serverId: "fake",
          workspaceRoot: workspace,
          command,
          args:
            command === FAKE_LSP_COMMAND
              ? [fakeServer, ...extraArgs]
              : extraArgs,
          requestTimeoutMs: 1000,
          process: {
            maxRestarts: 1,
            backoffBaseMs: 40,
            backoffMaxMs: 80,
            shutdownGraceMs: 400,
            ...extraProcess,
          },
          ...rest,
        });
        trackedClients.push(client);
        return client;
      }

      async function check(name, fn) {
        try {
          await fn();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          assert(false, name + " threw: " + detail);
        }
      }

      async function settle(client) {
        try {
          await client.shutdown();
        } catch {
          /* best-effort cleanup */
        }
      }

      function frame(message) {
        const body = Buffer.from(JSON.stringify(message), "utf8");
        const header = Buffer.from(
          `Content-Length: ${body.length}\r\n\r\n`,
          "utf8",
        );
        return Buffer.concat([header, body]);
      }

      await check(
        "framing parses coalesced and fragmented messages",
        async () => {
          const parse = transportMod.parseStreamChunk;
          const msg1 = { jsonrpc: "2.0", id: 1, method: "a", params: { n: 1 } };
          const msg2 = { jsonrpc: "2.0", method: "note", params: { x: 2 } };
          const msg3 = { jsonrpc: "2.0", id: 2, result: { ok: true } };
          const buf = Buffer.concat([frame(msg1), frame(msg2), frame(msg3)]);
          // Cut inside the first message body so the head is incomplete.
          const cut = frame(msg1).length - 3;
          const head = buf.subarray(0, cut);
          const tail = buf.subarray(cut);
          const first = parse(head);
          eq(
            first.messages.length,
            0,
            "partial head yields no complete message",
          );
          const second = parse(Buffer.concat([first.rest, tail]));
          eq(second.messages.length, 3, "tail completes all three messages");
          eq(second.rest.length, 0, "no trailing bytes remain");
          eq(second.messages[0].id, 1, "first message id correlates");
          eq(second.messages[2].result.ok, true, "third message result parsed");
        },
      );

      await check("initialize handshake and a sample request", async () => {
        const client = makeClient();
        const result = await client.start();
        assert(
          result?.capabilities?.hoverProvider === true,
          "initialize returns server capabilities",
        );
        const echo = await client.request("test/echo", { hello: "world" });
        eq(echo.hello, "world", "test/echo returns the request params");
        await settle(client);
        assert(!client.processRunning, "no live process after shutdown");
      });

      await check("parallel requests correlate by id", async () => {
        const client = makeClient();
        await client.start();
        const replies = await Promise.all([
          client.request("test/parallel", { i: 1 }),
          client.request("test/parallel", { i: 2 }),
          client.request("test/parallel", { i: 3 }),
        ]);
        eq(
          replies.map((r) => r.i),
          [1, 2, 3],
          "each parallel request resolves with its own params",
        );
        await settle(client);
      });

      await check("request timeout yields a structured error", async () => {
        const client = makeClient({ args: ["--hang"] });
        await client.start();
        let caught;
        try {
          await client.request("test/echo", {}, { timeoutMs: 250 });
        } catch (error) {
          caught = error;
        }
        assert(Boolean(caught), "a hanging request rejects");
        eq(caught?.kind, "timeout", "error kind is timeout");
        eq(caught?.serverId, "fake", "error names the server id");
        await settle(client);
      });

      await check("cancellation yields a structured error", async () => {
        const client = makeClient({ args: ["--hang"] });
        await client.start();
        const ac = new AbortController();
        const promise = client.request(
          "test/echo",
          {},
          {
            signal: ac.signal,
            timeoutMs: 5000,
          },
        );
        setTimeout(() => ac.abort(), 40);
        let caught;
        try {
          await promise;
        } catch (error) {
          caught = error;
        }
        eq(caught?.kind, "cancelled", "error kind is cancelled");
        await settle(client);
      });

      await check("shutdown rejects in-flight requests promptly", async () => {
        const client = makeClient({ args: ["--hang"] });
        await client.start();
        const started = Date.now();
        const promise = client.request("test/echo", {}, { timeoutMs: 5000 });
        // Shut down while the request is still hanging; it must reject now, not
        // after the full 5s timeout (exercises transport close()/failAll).
        setTimeout(() => {
          client.shutdown().catch(() => undefined);
        }, 60);
        let caught;
        try {
          await promise;
        } catch (error) {
          caught = error;
        }
        const elapsed = Date.now() - started;
        assert(Boolean(caught), "in-flight request rejects on shutdown");
        assert(
          elapsed < 4000,
          "in-flight request rejects well before its 5s timeout (got " +
            elapsed +
            "ms)",
        );
        await settle(client);
      });

      await check(
        "crash triggers a bounded restart then degrades",
        async () => {
          const client = makeClient({
            args: ["--crash-after-init"],
            process: {
              maxRestarts: 1,
              backoffBaseMs: 30,
              backoffMaxMs: 60,
              shutdownGraceMs: 400,
            },
          });
          let restarts = 0;
          client.on("restart", () => {
            restarts += 1;
          });
          const degraded = new Promise((resolve) =>
            client.once("degraded", () => resolve(true)),
          );
          await client.start(); // first init succeeds, server crashes right after
          await Promise.race([
            degraded,
            new Promise((r) => setTimeout(() => r(false), 2000)),
          ]);
          assert(restarts >= 1, "at least one automatic restart happened");
          eq(
            client.currentState,
            "degraded",
            "client degrades after bounded restart attempts",
          );
          await settle(client);
          assert(
            !client.processRunning,
            "no live process after degraded + shutdown",
          );
        },
      );

      await check(
        "missing binary yields a structured error without a crash",
        async () => {
          const client = makeClient({
            command: "pi-lsp-definitely-missing-binary-xyzzy",
            args: [],
          });
          let caught;
          try {
            await client.start();
          } catch (error) {
            caught = error;
          }
          assert(Boolean(caught), "a missing binary rejects start");
          eq(caught?.kind, "missing_binary", "error kind is missing_binary");
          assert(
            !client.processRunning,
            "no live process for a missing binary",
          );
          await settle(client);
        },
      );

      // Defensive sweep: every client must be shut down with no process left.
      for (const client of trackedClients) {
        try {
          await client.shutdown();
        } catch {
          /* ignore */
        }
      }
      let liveCount = 0;
      for (const client of trackedClients) {
        if (client.processRunning) liveCount += 1;
      }
      eq(liveCount, 0, "no LSP client leaves a live process behind");

      try {
        rmSync(workspace, { recursive: true, force: true });
      } catch {
        /* ignore temp cleanup errors */
      }
    });

    // ---------------------------------------------------------------------------
    // LSP config, root detection, registry and profiles (#94). Uses the fake-lsp
    // fixture from #93; deterministic, no real language server or network.
    // ---------------------------------------------------------------------------
  },

  "LSP config, root detection, registry and profiles (#94)": async (
    context,
  ) => {
    const { section, load } = context;

    await section(
      "LSP config, root detection, registry and profiles (#94)",
      async () => {
        const configMod = await load("extensions/lsp/config.ts");
        const rootsMod = await load("extensions/lsp/roots.ts");
        const profilesMod = await load("extensions/lsp/server-profiles.ts");
        const registryMod = await load("extensions/lsp/registry.ts");
        const capsMod = await load("extensions/lsp/capabilities.ts");

        assert(
          typeof configMod?.resolveConfig === "function",
          "lsp config exports resolveConfig",
        );
        assert(
          typeof rootsMod?.findWorkspaceRoot === "function",
          "lsp roots exports findWorkspaceRoot",
        );
        assert(
          profilesMod?.PROFILES?.typescript?.id === "typescript",
          "lsp server-profiles exports PROFILES",
        );
        assert(
          typeof registryMod?.ServerRegistry === "function",
          "lsp registry exports ServerRegistry",
        );
        assert(
          typeof capsMod?.normalizeCapabilities === "function",
          "lsp capabilities exports normalizeCapabilities",
        );

        const fakeServer = FAKE_LSP_FIXTURE;
        const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp94-test-"));

        function fakeProfile(extra = {}) {
          return {
            id: "fake",
            label: "Fake LSP",
            enabled: true,
            command: FAKE_LSP_COMMAND,
            args: [fakeServer, ...(extra.args ?? [])],
            rootMarkers: [],
            ...extra,
          };
        }

        // --- Config priority ---

        const defaults = {
          enabled: true,
          mode: "auto",
          requestTimeoutMs: 10000,
          idleShutdownMs: 600000,
          workspaceSymbolLimit: 50,
          languages: {},
        };
        const withTypeScript = { languages: { typescript: { enabled: true } } };

        assert(
          configMod.resolveConfig({
            defaults,
            trusted: true,
            sessionFlags: { mode: "force" },
          }).mode === "force",
          "session flag overrides mode",
        );
        assert(
          configMod.resolveConfig({
            defaults,
            trusted: true,
            sessionFlags: { requestTimeoutMs: 5000 },
          }).requestTimeoutMs === 5000,
          "session flag overrides timeout",
        );
        assert(
          configMod.resolveConfig({
            defaults,
            trusted: true,
            projectConfig: { mode: "off" },
            sessionFlags: { mode: "auto" },
          }).mode === "auto",
          "session wins over project",
        );
        assert(
          configMod.resolveConfig({
            defaults,
            trusted: true,
            projectConfig: { enabled: true },
          }).enabled === true,
          "project config applied when trusted",
        );
        assert(
          configMod.resolveConfig({
            defaults,
            trusted: false,
            projectConfig: { enabled: false },
          }).enabled === true,
          "untrusted ignores projectConfig (keeps defaults)",
        );
        assert(
          configMod.resolveConfig({
            defaults,
            trusted: false,
            projectConfig: { mode: "force" },
          }).mode === "auto",
          "untrusted ignores projectConfig mode",
        );

        // --- Profile override validation (C2) ---
        // Previously only `args` was type-checked; command/enabled/
        // rootMarkers fell through the `??` fallback unvalidated, so a
        // malformed .pi/lsp.json (e.g. command: 123) would reach the server
        // registry as-is.
        const baseProfile = {
          id: "custom",
          label: "custom",
          enabled: true,
          command: "custom-lsp",
          args: [],
          rootMarkers: [],
        };
        assert(
          (() => {
            try {
              configMod.resolveProfileOverrides(baseProfile, { command: 123 });
              return false;
            } catch (error) {
              return (
                error instanceof TypeError && /command/.test(error.message)
              );
            }
          })(),
          "resolveProfileOverrides rejects a non-string command",
        );
        assert(
          (() => {
            try {
              configMod.resolveProfileOverrides(baseProfile, {
                enabled: "yes",
              });
              return false;
            } catch (error) {
              return (
                error instanceof TypeError && /enabled/.test(error.message)
              );
            }
          })(),
          "resolveProfileOverrides rejects a non-boolean enabled",
        );
        assert(
          (() => {
            try {
              configMod.resolveProfileOverrides(baseProfile, {
                rootMarkers: "package.json",
              });
              return false;
            } catch (error) {
              return (
                error instanceof TypeError && /rootMarkers/.test(error.message)
              );
            }
          })(),
          "resolveProfileOverrides rejects a non-array rootMarkers",
        );
        assert(
          (() => {
            try {
              configMod.resolveProfileOverrides(baseProfile, {
                rootMarkers: [1, 2],
              });
              return false;
            } catch (error) {
              return (
                error instanceof TypeError && /rootMarkers/.test(error.message)
              );
            }
          })(),
          "resolveProfileOverrides rejects a rootMarkers array with non-string entries",
        );
        eq(
          configMod.resolveProfileOverrides(
            { ...baseProfile, id: "typescript" },
            {
              command: "typescript-language-server",
              enabled: false,
              rootMarkers: ["go.mod"],
            },
          ),
          {
            ...baseProfile,
            id: "typescript",
            command: "typescript-language-server",
            enabled: false,
            rootMarkers: ["go.mod"],
          },
          "resolveProfileOverrides still applies valid command/enabled/rootMarkers overrides",
        );
        // The command is what the registry spawns, so it is bound: the built-in
        // server for that id, or a binary the project installed itself.
        assert(
          (() => {
            try {
              configMod.resolveProfileOverrides(baseProfile, {
                command: "/bin/sh",
              });
              return false;
            } catch (error) {
              return (
                error instanceof TypeError && /node_modules/.test(error.message)
              );
            }
          })(),
          "resolveProfileOverrides rejects a command outside the allowed set",
        );
        assert(
          (() => {
            try {
              configMod.resolveProfileOverrides(baseProfile, {
                command: "other-lsp",
              });
              return false;
            } catch (error) {
              return error instanceof TypeError;
            }
          })(),
          "a bare binary name is not reachable either — PATH is not the allowlist",
        );
        eq(
          configMod.resolveProfileOverrides(
            baseProfile,
            { command: "node_modules/.bin/custom-lsp" },
            "/projects/demo",
          ).command,
          "node_modules/.bin/custom-lsp",
          "a binary from the project's own node_modules/.bin is accepted",
        );
        assert(
          (() => {
            try {
              configMod.resolveProfileOverrides(
                baseProfile,
                { command: "node_modules/.bin/../../../../bin/sh" },
                "/projects/demo",
              );
              return false;
            } catch (error) {
              return error instanceof TypeError;
            }
          })(),
          "a traversal out of node_modules/.bin does not pass the check",
        );
        // End-to-end: the same malformed value reaching resolveConfig
        // through a (trusted) project config must fail closed too, not only
        // when resolveProfileOverrides is called directly.
        assert(
          (() => {
            try {
              configMod.resolveConfig({
                defaults,
                trusted: true,
                projectConfig: {
                  languages: { custom: { command: 123 } },
                },
              });
              return false;
            } catch (error) {
              return (
                error instanceof TypeError && /command/.test(error.message)
              );
            }
          })(),
          "resolveConfig fails closed on a malformed project language override, not just resolveProfileOverrides in isolation",
        );

        // --- Root detection ---

        writeFileSync(path.join(workspace, "tsconfig.json"), "{}");
        const nested = path.join(workspace, "src", "lib");
        mkdirSync(nested, { recursive: true });
        assert(
          rootsMod.findWorkspaceRoot(path.join(nested, "index.ts"), [
            "tsconfig.json",
          ]) === workspace,
          "finds marker two levels up",
        );
        assert(
          rootsMod.findWorkspaceRoot(workspace, ["pyproject.toml"]) ===
            undefined,
          "returns undefined when no marker exists",
        );

        // --- Server profile defaults ---

        const ts = profilesMod.PROFILES.typescript;
        assert(ts.enabled === true, "typescript profile is enabled by default");
        assert(
          ts.initializationOptions?.disableAutomaticTypingAcquisition === true,
          "typescript disables automatic type acquisition",
        );

        const rust = profilesMod.PROFILES.rust;
        assert(rust.enabled === true, "rust profile is enabled by default");
        assert(
          rust.settings?.["rust-analyzer"]?.cargo?.buildScripts?.enable ===
            false,
          "rust disables cargo build scripts",
        );
        assert(
          rust.settings?.["rust-analyzer"]?.procMacro?.enable === false,
          "rust disables proc macros",
        );
        for (const id of ["go", "c", "java"]) {
          assert(
            profilesMod.PROFILES[id]?.enabled === false,
            `${id} profile is disabled by default`,
          );
        }

        // --- Capabilities normalisation ---

        const full = capsMod.normalizeCapabilities({
          hoverProvider: true,
          definitionProvider: { linkSupport: true },
          referencesProvider: false,
          // Correct LSP 3.17 shape: workspaceSymbolProvider is top-level, like
          // hoverProvider/definitionProvider (fixed as part of #96 — the
          // previous `workspace: { symbol: true }` shape never appears in a
          // real InitializeResult and made normalizeCapabilities() always
          // report workspaceSymbols as unsupported).
          workspaceSymbolProvider: true,
          textDocument: { textDocumentSync: 1 },
        });
        assert(full.hover === true, "boolean hoverProvider");
        assert(full.definition === true, "object definitionProvider (truthy)");
        assert(full.references === false, "explicit false referencesProvider");
        assert(
          full.workspaceSymbols === true,
          "top-level workspaceSymbolProvider",
        );
        assert(full.textDocumentSync === 1, "textDocumentSync passed through");

        const empty = capsMod.normalizeCapabilities({});
        assert(
          empty.hover === false &&
            empty.definition === false &&
            empty.references === false,
          "empty object → all false",
        );

        // --- Registry: reuse the same instance ---

        const idleShort = 80;
        const reg = new registryMod.ServerRegistry({
          config: {
            ...defaults,
            idleShutdownMs: idleShort,
            requestTimeoutMs: 2000,
          },
        });

        const pf = fakeProfile();
        const a = await reg.acquire(workspace, pf);
        const pidA = a.client.pid;
        assert(typeof pidA === "number", "acquire starts a server");

        reg.release(workspace, pf.id);
        const b = await reg.acquire(workspace, pf);
        assert(
          b.client.pid === pidA,
          "same (root,serverId) reuses the instance",
        );
        reg.release(workspace, pf.id);

        // --- Registry: idle shutdown ---

        const c = await reg.acquire(workspace, pf);
        reg.release(workspace, pf.id);
        await new Promise((r) => setTimeout(r, idleShort * 2 + 30));
        assert(reg.size === 0, "entry removed after idle shutdown");
        assert(
          !c.client.processRunning,
          "server process terminated after idle shutdown",
        );

        // --- Registry: active request prevents idle shutdown ---

        const d = await reg.acquire(workspace, pf);
        // Do not call release → activeRequests stays 1.
        await new Promise((r) => setTimeout(r, idleShort * 2 + 30));
        assert(reg.size === 1, "entry kept while active requests in flight");
        assert(
          d.client.processRunning,
          "server still alive with active requests",
        );
        reg.release(workspace, pf.id);
        await new Promise((r) => setTimeout(r, idleShort * 2 + 30));
        assert(reg.size === 0, "entry removed after release + idle wait");

        // --- Registry: missing binary → structured error, no crash ---

        let missingErr;
        try {
          await reg.acquire(workspace, {
            ...pf,
            command: "pi-lsp-definitely-missing-binary-xyzzy",
            id: "missing",
          });
        } catch (error) {
          missingErr = error;
        }
        assert(
          missingErr?.kind === "missing_binary" ||
            missingErr?.kind === "spawn_error",
          `missing binary gives structured error (got ${missingErr?.kind})`,
        );
        assert(reg.size === 0, "no server registered for missing binary");

        // --- Registry: shutdownAll leaves no orphans ---

        const srv1 = await reg.acquire(workspace, { ...pf, id: "srv1" });
        const srv2 = await reg.acquire(workspace, { ...pf, id: "srv2" });
        assert(reg.size === 2, "two servers registered before shutdownAll");
        await reg.shutdownAll();
        assert(reg.size === 0, "no entries after shutdownAll");
        assert(!srv1.client.processRunning, "srv1 process terminated");
        assert(!srv2.client.processRunning, "srv2 process terminated");

        // Defensive sweep.
        await reg.shutdownAll();
        try {
          rmSync(workspace, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      },
    );

    // ---------------------------------------------------------------------------
    // LSP document synchronisation and diagnostics (#95). Uses the fake-lsp
    // fixture; deterministic, no real language server or network.
    // ---------------------------------------------------------------------------
  },

  "LSP documents and diagnostics (#95)": async (context) => {
    const { section, load } = context;

    await section("LSP documents and diagnostics (#95)", async () => {
      const documentsMod = await load("extensions/lsp/documents.ts");
      const toolsMod = await load("extensions/lsp/tools.ts");
      const clientMod = await load("extensions/lsp/client.ts");
      const registryMod = await load("extensions/lsp/registry.ts");
      const profilesMod = await load("extensions/lsp/server-profiles.ts");
      const typesMod = await load("extensions/lsp/types.ts");

      assert(
        typeof documentsMod?.DocumentSync === "function",
        "lsp documents exports DocumentSync",
      );
      assert(
        typeof documentsMod?.getDocumentSync === "function",
        "lsp documents exports getDocumentSync",
      );
      assert(
        typeof documentsMod?.resolveTarget === "function",
        "lsp documents exports resolveTarget",
      );
      assert(
        typeof toolsMod?.registerLspDiagnosticsTool === "function",
        "lsp tools exports registerLspDiagnosticsTool",
      );

      const fakeServer = FAKE_LSP_FIXTURE;
      const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp95-test-"));
      writeFileSync(path.join(workspace, "tsconfig.json"), "{}");
      const trackedClients = [];

      function makeClient(extra = {}) {
        const { args: extraArgs = [], ...rest } = extra;
        const client = new clientMod.LspClient({
          serverId: "fake",
          workspaceRoot: workspace,
          command: FAKE_LSP_COMMAND,
          args: [fakeServer, ...extraArgs],
          requestTimeoutMs: 1000,
          process: {
            maxRestarts: 1,
            backoffBaseMs: 40,
            backoffMaxMs: 80,
            shutdownGraceMs: 400,
          },
          ...rest,
        });
        trackedClients.push(client);
        return client;
      }

      async function check(name, fn) {
        try {
          await fn();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          assert(false, name + " threw: " + detail);
        }
      }

      async function settle(client) {
        try {
          await client.shutdown();
        } catch {
          /* best-effort cleanup */
        }
      }

      await check(
        "didOpen precedes didChange, versions are monotone",
        async () => {
          const client = makeClient();
          await client.start();
          const sentNotifications = [];
          const originalNotify = client.notify.bind(client);
          client.notify = (method, params) => {
            sentNotifications.push({ method, params });
            originalNotify(method, params);
          };

          const filePath = path.join(workspace, "a.ts");
          writeFileSync(filePath, "const a = 1;\n");
          const sync = documentsMod.getDocumentSync(client, workspace);

          const first = sync.openOrSync(filePath, "typescript");
          eq(first.version, 1, "first sync is version 1");
          eq(
            sentNotifications[0]?.method,
            "textDocument/didOpen",
            "first sync sends didOpen",
          );

          writeFileSync(filePath, "const a = 2;\n");
          const second = sync.openOrSync(filePath, "typescript");
          eq(second.version, 2, "second sync increments version");
          eq(
            sentNotifications[1]?.method,
            "textDocument/didChange",
            "second sync sends didChange",
          );

          const third = sync.openOrSync(filePath, "typescript");
          eq(third.version, 2, "unchanged content keeps the same version");
          eq(third.changed, false, "unchanged content reports changed: false");
          eq(
            sentNotifications.length,
            2,
            "unchanged content sends no additional notification",
          );

          await settle(client);
        },
      );

      await check(
        "a new diagnostics version replaces the previous one",
        async () => {
          const client = makeClient();
          await client.start();
          const filePath = path.join(workspace, "b.ts");
          writeFileSync(filePath, "const b = 1;\n");
          const sync = documentsMod.getDocumentSync(client, workspace);

          const v1 = sync.openOrSync(filePath, "typescript");
          const snap1 = await sync.waitForDiagnostics(
            filePath,
            v1.version,
            2000,
          );
          eq(
            snap1.diagnostics.length,
            1,
            "first version has exactly one diagnostic",
          );
          eq(
            snap1.diagnostics[0].message,
            "fake diagnostic for version 1",
            "diagnostic mentions its version",
          );

          writeFileSync(filePath, "const b = 2;\n");
          const v2 = sync.openOrSync(filePath, "typescript");
          const snap2 = await sync.waitForDiagnostics(
            filePath,
            v2.version,
            2000,
          );
          eq(
            snap2.diagnostics.length,
            1,
            "second version still has exactly one diagnostic (replaced, not appended)",
          );
          eq(
            snap2.diagnostics[0].message,
            "fake diagnostic for version 2",
            "diagnostic reflects the new version",
          );
          eq(
            sync.getDiagnostics(filePath).version,
            2,
            "cache holds only the latest diagnostics version",
          );

          await settle(client);
        },
      );

      await check(
        "waitForDiagnostics does not resolve with a stale version",
        async () => {
          const client = makeClient();
          await client.start();
          const filePath = path.join(workspace, "c.ts");
          writeFileSync(filePath, "const c = 1;\n");
          const sync = documentsMod.getDocumentSync(client, workspace);
          const v1 = sync.openOrSync(filePath, "typescript");
          await sync.waitForDiagnostics(filePath, v1.version, 2000); // cache now holds version 1

          let outcome;
          try {
            await sync.waitForDiagnostics(filePath, v1.version + 1, 300);
            outcome = "resolved";
          } catch {
            outcome = "rejected";
          }
          eq(
            outcome,
            "rejected",
            "waiting for a version newer than cached times out instead of resolving with stale data",
          );

          await settle(client);
        },
      );

      await check("close() clears all local document state", async () => {
        const client = makeClient();
        await client.start();
        const filePath = path.join(workspace, "d.ts");
        writeFileSync(filePath, "const d = 1;\n");
        const sync = documentsMod.getDocumentSync(client, workspace);
        sync.openOrSync(filePath, "typescript");
        await sync.waitForDiagnostics(filePath, 1, 2000);
        eq(sync.getVersion(filePath), 1, "version tracked before close");

        sync.close(filePath);
        eq(
          sync.getVersion(filePath),
          undefined,
          "close() clears the tracked version",
        );
        eq(
          sync.getDiagnostics(filePath),
          undefined,
          "close() clears cached diagnostics",
        );

        await settle(client);
      });

      await check("a restart invalidates tracked document state", async () => {
        const client = makeClient({
          args: ["--crash-after-init"],
          process: {
            maxRestarts: 1,
            backoffBaseMs: 30,
            backoffMaxMs: 60,
            shutdownGraceMs: 400,
          },
        });
        const restarted = new Promise((resolve) =>
          client.once("restart", () => resolve(true)),
        );
        await client.start();
        const filePath = path.join(workspace, "e.ts");
        writeFileSync(filePath, "const e = 1;\n");
        const sync = documentsMod.getDocumentSync(client, workspace);
        sync.openOrSync(filePath, "typescript");
        eq(sync.getVersion(filePath), 1, "version tracked before restart");

        await Promise.race([
          restarted,
          new Promise((r) => setTimeout(() => r(false), 2000)),
        ]);
        await new Promise((r) => setTimeout(r, 20)); // let the invalidate handler run
        eq(
          sync.getVersion(filePath),
          undefined,
          "restart invalidates tracked document state",
        );

        await settle(client);
      });

      await check(
        "resolveTarget soft-fails on an unmapped extension",
        async () => {
          const filePath = path.join(workspace, "notes.xyz");
          writeFileSync(filePath, "whatever");
          const config = {
            enabled: true,
            mode: "auto",
            requestTimeoutMs: 2000,
            idleShutdownMs: 600000,
            workspaceSymbolLimit: 50,
            languages: profilesMod.PROFILES,
          };
          const result = documentsMod.resolveTarget(filePath, config);
          assert(
            result instanceof typesMod.LspError,
            "an unmapped extension yields a structured LspError, not a crash",
          );
        },
      );

      await check(
        "lsp_diagnostics tool: end-to-end success releases the registry entry",
        async () => {
          const fakeTsProfile = {
            id: "typescript",
            label: "Fake TypeScript",
            enabled: true,
            command: FAKE_LSP_COMMAND,
            args: [fakeServer, "--require-diagnostics-capability"],
            rootMarkers: ["tsconfig.json"],
          };
          const config = {
            enabled: true,
            mode: "auto",
            requestTimeoutMs: 2000,
            idleShutdownMs: 100000,
            workspaceSymbolLimit: 50,
            languages: { ...profilesMod.PROFILES, typescript: fakeTsProfile },
          };
          const registry = new registryMod.ServerRegistry({ config });
          let releaseCalls = 0;
          const originalRelease = registry.release.bind(registry);
          registry.release = (root, id) => {
            releaseCalls += 1;
            originalRelease(root, id);
          };
          const deps = { getConfig: () => config, getRegistry: () => registry };

          const harness = createHarness();
          toolsMod.registerLspDiagnosticsTool(harness.api, deps);
          const tool = harness.tools.get("lsp_diagnostics");
          assert(Boolean(tool), "lsp_diagnostics tool is registered");

          const filePath = path.join(workspace, "tool-test.ts");
          writeFileSync(filePath, "const x = 1;\n");
          const context = harness.makeContext({ cwd: workspace });
          const result = await tool.execute(
            "call-1",
            { path: "tool-test.ts" },
            undefined,
            undefined,
            context,
          );
          assert(
            result.content[0].text.includes("fake diagnostic"),
            "lsp_diagnostics announces diagnostics support and surfaces the fake server's diagnostic",
          );
          eq(
            releaseCalls,
            1,
            "release() runs exactly once after a successful tool call",
          );

          // An unmapped extension must not touch the registry at all (resolveTarget
          // fails before acquire() is ever called).
          const unknownPath = path.join(workspace, "notes2.xyz");
          writeFileSync(unknownPath, "whatever");
          const before = registry.size;
          const unknownResult = await tool.execute(
            "call-2",
            { path: "notes2.xyz" },
            undefined,
            undefined,
            context,
          );
          assert(
            unknownResult.content[0].text
              .toLowerCase()
              .includes("kein lsp-profil"),
            "unknown extension yields a soft-fail message",
          );
          eq(
            registry.size,
            before,
            "unknown file type creates no new registry entry",
          );

          await registry.shutdownAll();
        },
      );

      await check(
        "lsp_diagnostics tool: a timeout still releases the registry entry",
        async () => {
          const noDiagProfile = {
            id: "typescript",
            label: "Fake TypeScript (no diagnostics)",
            enabled: true,
            command: FAKE_LSP_COMMAND,
            args: [fakeServer, "--no-diagnostics"],
            rootMarkers: ["tsconfig.json"],
          };
          const config = {
            enabled: true,
            mode: "auto",
            requestTimeoutMs: 300,
            idleShutdownMs: 100000,
            workspaceSymbolLimit: 50,
            languages: { ...profilesMod.PROFILES, typescript: noDiagProfile },
          };
          const registry = new registryMod.ServerRegistry({ config });
          let releaseCalls = 0;
          const originalRelease = registry.release.bind(registry);
          registry.release = (root, id) => {
            releaseCalls += 1;
            originalRelease(root, id);
          };
          const deps = { getConfig: () => config, getRegistry: () => registry };

          const harness = createHarness();
          toolsMod.registerLspDiagnosticsTool(harness.api, deps);
          const tool = harness.tools.get("lsp_diagnostics");
          const filePath = path.join(workspace, "timeout-test.ts");
          writeFileSync(filePath, "const y = 1;\n");
          const context = harness.makeContext({ cwd: workspace });

          const result = await tool.execute(
            "call-3",
            { path: "timeout-test.ts" },
            undefined,
            undefined,
            context,
          );
          assert(
            result.content[0].text.toLowerCase().includes("timeout"),
            "lsp_diagnostics surfaces a verständliche timeout message instead of hanging or crashing",
          );
          eq(
            releaseCalls,
            1,
            "release() runs exactly once even when waitForDiagnostics times out",
          );

          await registry.shutdownAll();
        },
      );

      // Defensive sweep: every client must be shut down with no process left.
      for (const client of trackedClients) {
        try {
          await client.shutdown();
        } catch {
          /* ignore */
        }
      }
      let liveCount = 0;
      for (const client of trackedClients) {
        if (client.processRunning) liveCount += 1;
      }
      eq(liveCount, 0, "no LSP client leaves a live process behind");

      try {
        rmSync(workspace, { recursive: true, force: true });
      } catch {
        /* ignore temp cleanup errors */
      }
    });
  },

  "LSP security and registry single-flight (P0.2, P1.1)": async (context) => {
    const { section, load } = context;

    await section(
      "LSP security and registry single-flight (P0.2, P1.1)",
      async () => {
        const documentsMod = await load("extensions/lsp/documents.ts");
        const toolsMod = await load("extensions/lsp/tools.ts");
        const typesMod = await load("extensions/lsp/types.ts");
        const registryMod = await load("extensions/lsp/registry.ts");
        const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp-sec-"));

        try {
          // ---- P0.2: resolveToolPath blocks absolute paths outside the project ----
          // runLspDiagnostics must soft-fail (return a message) instead of crashing
          // when given a system path like /etc/passwd.
          await (async () => {
            const deps = {
              getConfig: () => ({
                enabled: true,
                mode: "auto",
                requestTimeoutMs: 2000,
                idleShutdownMs: 100000,
                workspaceSymbolLimit: 50,
                languages: {},
              }),
              getRegistry: () => ({
                acquire: async () => ({ client: {} }),
                release: () => {},
              }),
            };
            const result = await toolsMod.runLspDiagnostics(
              deps,
              "/etc/passwd",
              workspace,
              false,
            );
            assert(
              /außerhalb des Projekts|ungültiger Pfad/i.test(
                result.content[0].text,
              ),
              "runLspDiagnostics soft-fails for /etc/passwd instead of throwing",
            );
          })();

          // ---- P0.2: DocumentSync rejects symlink escapes ----
          await (async () => {
            const elsewhere = mkdtempSync(
              path.join(tmpdir(), "pi-lsp-symlink-target-"),
            );
            const escapedFile = path.join(elsewhere, "secret.ts");
            writeFileSync(escapedFile, "export const secret = 1;\n");
            // Create a symlink inside workspace pointing outside.
            symlinkSync(elsewhere, path.join(workspace, "link-out"));
            const targetPath = path.join(workspace, "link-out", "secret.ts");

            const notifications = [];
            const fakeClient = {
              serverId: "fake",
              workspaceRoot: workspace,
              onNotification: () => {},
              on: () => {},
              off: () => {},
              notify: (method, params) =>
                notifications.push({ method, params }),
            };
            const sync = new documentsMod.DocumentSync({
              client: fakeClient,
              workspaceRoot: workspace,
            });
            let threw = false;
            try {
              sync.openOrSync(targetPath, "typescript");
            } catch (error) {
              threw = true;
              assert(
                error instanceof typesMod.LspError,
                "symlink escape raises an LspError",
              );
              assert(
                /symlink.escape/i.test(error.cause ?? error.message),
                "symlink escape error carries a descriptive cause",
              );
            }
            assert(threw, "symlink escape is rejected with an error");
            eq(
              notifications.length,
              0,
              "no didOpen is sent for a symlink escape",
            );
            rmSync(elsewhere, { recursive: true, force: true });
          })();

          // ---- P0.2: DocumentSync rejects oversized files ----
          await (async () => {
            const bigFile = path.join(workspace, "huge.ts");
            // Write ~11 MB so the 10 MB limit triggers (Buffer avoids string limits).
            writeFileSync(bigFile, Buffer.alloc(11 * 1024 * 1024, 0x78));

            const fakeClient = {
              serverId: "fake",
              workspaceRoot: workspace,
              onNotification: () => {},
              on: () => {},
              off: () => {},
              notify: () => {},
            };
            const sync = new documentsMod.DocumentSync({
              client: fakeClient,
              workspaceRoot: workspace,
            });
            let threw = false;
            try {
              sync.openOrSync(bigFile, "typescript");
            } catch (error) {
              threw = true;
              assert(
                error instanceof typesMod.LspError,
                "oversized file raises an LspError",
              );
              assert(
                /10.MB.limit/i.test(error.cause ?? error.message),
                "oversized file error mentions the 10 MB limit",
              );
            }
            assert(threw, "an oversized file is rejected");
          })();

          // ---- P1.1: concurrent acquire shares the start and keeps the counter sane ----
          // Two acquires arriving while the server is still "starting" must both
          // resolve with the same client, and a single release() must NOT arm the
          // idle timer (i.e. activeRequests was incremented for the second caller).
          // We force the race deterministically by stubbing createClient so start()
          // only resolves when WE release the gate — guaranteeing both acquires see
          // the "starting" state and take the single-flight path.
          await (async () => {
            const config = {
              enabled: true,
              mode: "auto",
              requestTimeoutMs: 5000,
              idleShutdownMs: 5, // short: if armed erroneously, it fires within the wait
              workspaceSymbolLimit: 50,
              languages: {},
            };
            const registry = new registryMod.ServerRegistry({ config });

            const profile = {
              id: "singleflight",
              label: "Single Flight Test",
              enabled: true,
              command: "stub",
              args: [],
              rootMarkers: ["tsconfig.json"],
            };

            // Gate that blocks start() until we release it, so both acquires observe
            // the in-flight ("starting") promise.
            let startGate;
            const startPromise = new Promise((resolve) => {
              startGate = resolve;
            });
            let shutdownCalls = 0;
            const stubClient = {
              serverId: profile.id,
              workspaceRoot: workspace,
              get currentState() {
                return startedFlag ? "ready" : "starting";
              },
              pid: 4242,
              start: () => startPromise,
              shutdown: async () => {
                shutdownCalls += 1;
              },
              on: () => {},
              off: () => {},
              onNotification: () => {},
            };
            let startedFlag = false;
            // Patch the private factory so no real process is spawned.
            registry.createClient = () => stubClient;
            Object.defineProperty(stubClient, "currentState", {
              get: () => (startedFlag ? "ready" : "starting"),
            });

            const p1 = registry.acquire(workspace, profile);
            const p2 = registry.acquire(workspace, profile); // fires while starting

            // Release the gate so start() resolves and both promises settle.
            startedFlag = true;
            startGate();
            const [r1, r2] = await Promise.all([p1, p2]);

            assert(
              r1.client === stubClient && r2.client === stubClient,
              "concurrent acquires share the single in-flight client instance",
            );

            // Pre-fix bug: the second caller returned pendingAcquire without
            // incrementing activeRequests, so one release() dropped it to 0 and
            // armed the idle timer (and a manual idle would shut the server down).
            // With the fix, activeRequests == 2, so one release keeps it at 1.
            registry.release(workspace, profile.id);
            // Idle timer is 5ms. Pre-fix bug armed it immediately on activeRequests
            // hitting 0; with the fix activeRequests stays at 1, so no timer is armed
            // and shutdown() is never called. Waiting 40ms (>> 5ms) makes the
            // distinction deterministic.
            await new Promise((resolve) => setTimeout(resolve, 40));
            eq(
              shutdownCalls,
              0,
              "one release does not trigger shutdown while a second caller holds the client",
            );

            registry.release(workspace, profile.id);
          })();
        } finally {
          rmSync(workspace, { recursive: true, force: true });
        }
      },
    );

    // ---------------------------------------------------------------------------
    // LSP navigation and symbol tools (#96). Uses the fake-lsp fixture;
    // deterministic, no real language server or network.
    // ---------------------------------------------------------------------------
  },

  "LSP navigation and symbol tools (#96)": async (context) => {
    const { section, load } = context;

    await section("LSP navigation and symbol tools (#96)", async () => {
      const toolsMod = await load("extensions/lsp/tools.ts");
      const registryMod = await load("extensions/lsp/registry.ts");
      const profilesMod = await load("extensions/lsp/server-profiles.ts");

      assert(
        typeof toolsMod?.registerLspNavigationTools === "function",
        "lsp tools exports registerLspNavigationTools",
      );

      const fakeServer = FAKE_LSP_FIXTURE;
      const workspace = mkdtempSync(path.join(tmpdir(), "pi-lsp96-test-"));
      writeFileSync(path.join(workspace, "tsconfig.json"), "{}");
      const filePath = path.join(workspace, "target.ts");
      writeFileSync(filePath, "export const target = 1;\n");

      function fakeProfile(extra = {}) {
        const { args: extraArgs = [], ...rest } = extra;
        return {
          id: "typescript",
          label: "Fake TypeScript",
          enabled: true,
          command: FAKE_LSP_COMMAND,
          args: [fakeServer, ...extraArgs],
          rootMarkers: ["tsconfig.json"],
          ...rest,
        };
      }

      function makeRegistryDeps(profileExtra = {}, configExtra = {}) {
        const config = {
          enabled: true,
          mode: "auto",
          requestTimeoutMs: 2000,
          idleShutdownMs: 100000,
          workspaceSymbolLimit: 50,
          languages: {
            ...profilesMod.PROFILES,
            typescript: fakeProfile(profileExtra),
          },
          ...configExtra,
        };
        const registry = new registryMod.ServerRegistry({ config });
        return {
          config,
          registry,
          deps: { getConfig: () => config, getRegistry: () => registry },
        };
      }

      async function check(name, fn) {
        try {
          await fn();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          assert(false, name + " threw: " + detail);
        }
      }

      await check("lsp_definition: Location result", async () => {
        const { registry, deps } = makeRegistryDeps();
        const harness = createHarness();
        toolsMod.registerLspNavigationTools(harness.api, deps);
        const tool = harness.tools.get("lsp_definition");
        assert(Boolean(tool), "lsp_definition tool is registered");
        const context = harness.makeContext({ cwd: workspace });
        const result = await tool.execute(
          "call-1",
          { path: "target.ts", line: 0, character: 0 },
          undefined,
          undefined,
          context,
        );
        assert(
          result.content[0].text.includes("target.ts:5:3"),
          "definition points at the fake location",
        );
        await registry.shutdownAll();
      });

      await check("lsp_definition: LocationLink result", async () => {
        const { registry, deps } = makeRegistryDeps({
          args: ["--definition-links"],
        });
        const harness = createHarness();
        toolsMod.registerLspNavigationTools(harness.api, deps);
        const tool = harness.tools.get("lsp_definition");
        const context = harness.makeContext({ cwd: workspace });
        const result = await tool.execute(
          "call-2",
          { path: "target.ts", line: 0, character: 0, preferLinks: true },
          undefined,
          undefined,
          context,
        );
        assert(
          result.content[0].text.includes("target.ts:5:3"),
          "LocationLink result is normalised the same way as Location",
        );
        await registry.shutdownAll();
      });

      await check(
        "lsp_definition: capability gating without a server call",
        async () => {
          const { registry, deps } = makeRegistryDeps({
            args: ["--no-definition-provider"],
          });
          const harness = createHarness();
          toolsMod.registerLspNavigationTools(harness.api, deps);
          const tool = harness.tools.get("lsp_definition");
          const context = harness.makeContext({ cwd: workspace });
          const result = await tool.execute(
            "call-3",
            { path: "target.ts", line: 0, character: 0 },
            undefined,
            undefined,
            context,
          );
          assert(
            result.content[0].text.toLowerCase().includes("unterstützt"),
            "missing definitionProvider yields a soft-fail message instead of a request/crash",
          );
          await registry.shutdownAll();
        },
      );

      await check(
        "lsp_references: limit truncates with a count hint",
        async () => {
          const { registry, deps } = makeRegistryDeps();
          const harness = createHarness();
          toolsMod.registerLspNavigationTools(harness.api, deps);
          const tool = harness.tools.get("lsp_references");
          const context = harness.makeContext({ cwd: workspace });
          const result = await tool.execute(
            "call-4",
            { path: "target.ts", line: 0, character: 0, limit: 2 },
            undefined,
            undefined,
            context,
          );
          assert(
            result.content[0].text.includes("2 von 3 gezeigt"),
            "references are truncated to the limit with a hint",
          );
          await registry.shutdownAll();
        },
      );

      await check("lsp_hover: brief is shorter than full", async () => {
        const { registry, deps } = makeRegistryDeps();
        const harness = createHarness();
        toolsMod.registerLspNavigationTools(harness.api, deps);
        const tool = harness.tools.get("lsp_hover");
        const context = harness.makeContext({ cwd: workspace });
        const full = await tool.execute(
          "call-5",
          { path: "target.ts", line: 0, character: 0, verbosity: "full" },
          undefined,
          undefined,
          context,
        );
        const brief = await tool.execute(
          "call-6",
          { path: "target.ts", line: 0, character: 0, verbosity: "brief" },
          undefined,
          undefined,
          context,
        );
        assert(
          full.content[0].text.includes("Detailed hover contents"),
          "full hover includes the detail paragraph",
        );
        assert(
          brief.content[0].text.length <= full.content[0].text.length,
          "brief hover is not longer than full hover",
        );
        await registry.shutdownAll();
      });

      await check(
        "lsp_workspace_symbols: limit and TTL cache avoid a second request",
        async () => {
          const { registry, deps } = makeRegistryDeps();
          const harness = createHarness();
          toolsMod.registerLspNavigationTools(harness.api, deps);
          const tool = harness.tools.get("lsp_workspace_symbols");
          const context = harness.makeContext({ cwd: workspace });

          const first = await tool.execute(
            "call-7",
            { query: "target" },
            undefined,
            undefined,
            context,
          );
          assert(
            first.content[0].text.includes("target —"),
            "workspace symbol search returns the fake symbol",
          );
          assert(
            first.details?.cached === false,
            "first call is not served from cache",
          );

          const second = await tool.execute(
            "call-8",
            { query: "target" },
            undefined,
            undefined,
            context,
          );
          assert(
            second.details?.cached === true,
            "second identical call within TTL is served from cache",
          );
          await registry.shutdownAll();
        },
      );

      await check(
        "lsp_workspace_symbols: LRU cache stays bounded and clears expired entries",
        async () => {
          const { registry, deps } = makeRegistryDeps();
          const harness = createHarness();
          toolsMod.registerLspNavigationTools(harness.api, deps);
          const tool = harness.tools.get("lsp_workspace_symbols");
          const context = harness.makeContext({ cwd: workspace });
          const realNow = Date.now;
          let now = realNow();
          Date.now = () => now;
          try {
            for (let index = 0; index <= 100; index++) {
              await tool.execute(
                `lru-${index}`,
                { query: `symbol-${index}` },
                undefined,
                undefined,
                context,
              );
            }
            const newest = await tool.execute(
              "lru-newest",
              { query: "symbol-100" },
              undefined,
              undefined,
              context,
            );
            assert(
              newest.details?.cached === true,
              "the most recently inserted workspace-symbol query stays cached",
            );
            const oldest = await tool.execute(
              "lru-oldest",
              { query: "symbol-0" },
              undefined,
              undefined,
              context,
            );
            assert(
              oldest.details?.cached === false,
              "the 101st unique query evicts the oldest LRU entry",
            );
            now += 30_001;
            const expired = await tool.execute(
              "lru-expired",
              { query: "symbol-100" },
              undefined,
              undefined,
              context,
            );
            assert(
              expired.details?.cached === false,
              "expired workspace-symbol entries are purged before reuse",
            );
          } finally {
            Date.now = realNow;
            await registry.shutdownAll();
          }
        },
      );

      await check(
        "stale document version differs between two calls after a change",
        async () => {
          const { registry, deps } = makeRegistryDeps();
          const harness = createHarness();
          toolsMod.registerLspNavigationTools(harness.api, deps);
          const tool = harness.tools.get("lsp_hover");
          const context = harness.makeContext({ cwd: workspace });
          const staleFile = path.join(workspace, "stale.ts");
          writeFileSync(staleFile, "export const stale = 1;\n");

          const before = await tool.execute(
            "call-9",
            { path: "stale.ts", line: 0, character: 0 },
            undefined,
            undefined,
            context,
          );
          writeFileSync(
            staleFile,
            "export const stale = 2;\nexport const extra = 3;\n",
          );
          const after = await tool.execute(
            "call-10",
            { path: "stale.ts", line: 0, character: 0 },
            undefined,
            undefined,
            context,
          );
          assert(
            before.details?.version !== after.details?.version,
            "a file change between two calls is reflected in a different version tag",
          );
          await registry.shutdownAll();
        },
      );

      try {
        rmSync(workspace, { recursive: true, force: true });
      } catch {
        /* ignore temp cleanup errors */
      }
    });

    // ---------------------------------------------------------------------------
    // LSP command, status and trust (#97). Uses the fake-lsp fixture;
    // deterministic, no real language server or network.
    // ---------------------------------------------------------------------------
  },

  "LSP command, status and trust (#97)": async (context) => {
    const { section, load, lspControlCenter, lspExtensionMod } = context;

    await section("LSP command, status and trust (#97)", async () => {
      if (!lspExtensionMod) return;
      const registryMod = await load("extensions/lsp/registry.ts");
      const statusMod = await load("extensions/lsp/status.ts");

      assert(
        typeof lspExtensionMod.default === "function",
        "lsp index exports a default extension factory",
      );
      assert(
        typeof registryMod?.ServerRegistry.prototype.shutdownOne === "function",
        "registry exports shutdownOne",
      );
      assert(
        typeof statusMod?.computeLspStatus === "function",
        "lsp status exports computeLspStatus",
      );

      const fakeServer = FAKE_LSP_FIXTURE;

      // --- computeLspStatus: pure function, all four states ---
      const baseConfig = {
        enabled: true,
        mode: "auto",
        requestTimeoutMs: 2000,
        idleShutdownMs: 100000,
        workspaceSymbolLimit: 50,
        languages: {},
      };
      eq(
        statusMod.computeLspStatus({ ...baseConfig, enabled: false }, []),
        "aus",
        "disabled config is off",
      );
      eq(
        statusMod.computeLspStatus({ ...baseConfig, mode: "off" }, []),
        "aus",
        "mode off is off",
      );
      eq(
        statusMod.computeLspStatus(baseConfig, []),
        "leerlauf",
        "no entries is idle",
      );
      eq(
        statusMod.computeLspStatus(baseConfig, [
          { state: "ready" },
          { state: "starting" },
        ]),
        "1 aktiv",
        "counts only ready entries as active",
      );
      eq(
        statusMod.computeLspStatus(baseConfig, [
          { state: "ready" },
          { state: "degraded" },
        ]),
        "eingeschränkt",
        "any degraded entry reports degraded, even alongside a ready one",
      );

      // --- Trust gate: untrusted project never reads .pi/lsp.json ---
      // The same file, the same assertion target, only trust differs — so the
      // two cases share one shape and the gate is the single variable.
      {
        const disablingConfig = { ".pi/lsp.json": { enabled: false } };

        await withHarness(
          {
            extensions: [lspExtensionMod],
            context: { trusted: false },
            prefix: "pi-lsp97-trust-",
            files: disablingConfig,
          },
          async ({ harness, context }) => {
            harness.api.events.emit("aurora-ui/state/request", {
              type: "request",
              requestId: "lsp-state",
              sessionEpoch: "lsp-epoch",
              requester: "test",
            });
            // If the trust gate were broken and enabled:false got applied
            // anyway, /lsp status would report "aus" instead.
            await harness.commands.get("lsp")("status", context);
            const statusText = harness.notifications.at(-1)?.message ?? "";
            assert(
              statusText.includes("LSP: leerlauf") ||
                statusText.includes("LSP: 1 aktiv"),
              "untrusted project ignores .pi/lsp.json and keeps the default enabled config (got: " +
                statusText +
                ")",
            );
          },
        );

        // --- Trust gate: trusted project applies .pi/lsp.json ---
        await withHarness(
          {
            extensions: [lspExtensionMod],
            context: { trusted: true },
            prefix: "pi-lsp97-trusted-",
            files: disablingConfig,
          },
          async ({ harness, context }) => {
            await harness.commands.get("lsp")("status", context);
            const statusText = harness.notifications.at(-1)?.message ?? "";
            assert(
              statusText.includes("LSP: aus"),
              "trusted project applies .pi/lsp.json's enabled:false (got: " +
                statusText +
                ")",
            );
          },
        );
      }

      // --- /lsp on|off toggles config.enabled and stops/starts the registry ---
      {
        const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-onoff-"));
        writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
        writeFileSync(path.join(cwd, "a.ts"), "const a = 1;\n");

        const harness = createHarness();
        lspExtensionMod.default(harness.api);
        const context = harness.makeContext({ cwd, trusted: true });
        await harness.runHooks("session_start", {}, context);

        await harness.commands.get("lsp")("off", context);
        let statusText = harness.notifications.at(-1)?.message ?? "";
        assert(
          statusText.includes("deaktiviert"),
          "/lsp off confirms deactivation",
        );
        await harness.commands.get("lsp")("status", context);
        statusText = harness.notifications.at(-1)?.message ?? "";
        assert(
          statusText.includes("LSP: aus"),
          "/lsp off flips the status to off",
        );

        await harness.commands.get("lsp")("on", context);
        statusText = harness.notifications.at(-1)?.message ?? "";
        assert(statusText.includes("aktiviert"), "/lsp on confirms activation");
        await harness.commands.get("lsp")("status", context);
        statusText = harness.notifications.at(-1)?.message ?? "";
        assert(
          statusText.includes("LSP: leerlauf") ||
            statusText.includes("LSP: 1 aktiv"),
          "/lsp on flips the status back to idle/active",
        );

        await harness.runHooks("session_shutdown", {}, context);
        try {
          rmSync(cwd, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }

      // --- /lsp restart <id> and /lsp restart (all) ---
      {
        const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-restart-"));
        writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
        const filePath = path.join(cwd, "a.ts");
        writeFileSync(filePath, "const a = 1;\n");

        const fakeTsProfile = {
          id: "typescript",
          label: "Fake TypeScript",
          enabled: true,
          command: FAKE_LSP_COMMAND,
          args: [fakeServer],
          rootMarkers: ["tsconfig.json"],
        };
        const config = {
          enabled: true,
          mode: "auto",
          requestTimeoutMs: 2000,
          idleShutdownMs: 100000,
          workspaceSymbolLimit: 50,
          languages: { typescript: fakeTsProfile },
        };
        const registry = new registryMod.ServerRegistry({ config });
        await registry.acquire(cwd, fakeTsProfile);
        registry.release(cwd, fakeTsProfile.id);
        eq(registry.size, 1, "one server registered before restart");

        const stopped = await registry.shutdownOne(cwd, fakeTsProfile.id);
        assert(
          stopped === true,
          "shutdownOne reports it stopped a tracked entry",
        );
        eq(registry.size, 0, "shutdownOne removes the entry");

        const missing = await registry.shutdownOne(cwd, "does-not-exist");
        eq(missing, false, "shutdownOne is a no-op for an untracked key");

        const again = await registry.acquire(cwd, fakeTsProfile);
        assert(
          typeof again.client.pid === "number",
          "the server respawns lazily on next acquire",
        );
        await registry.shutdownAll();
        try {
          rmSync(cwd, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }

      // --- /lsp servers and /lsp log ---
      {
        const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-servers-"));
        const harness = createHarness();
        lspExtensionMod.default(harness.api);
        const context = harness.makeContext({ cwd, trusted: true });
        await harness.runHooks("session_start", {}, context);

        await harness.commands.get("lsp")("servers", context);
        let text = harness.notifications.at(-1)?.message ?? "";
        assert(
          text.includes("keine aktiven Server"),
          "/lsp servers reports no active servers initially",
        );

        await harness.commands.get("lsp")("log", context);
        text = harness.notifications.at(-1)?.message ?? "";
        assert(
          text.includes("kein Log"),
          "/lsp log reports empty log initially",
        );

        await harness.runHooks("session_shutdown", {}, context);
        try {
          rmSync(cwd, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }

      // --- resolveLspInteractiveCommand is the one resolver behind bare /lsp
      // and the Command Center guide, so a chosen action can no longer differ
      // depending on which entry point picked it ---
      {
        const restartHarness = createHarness({
          select: (labels) =>
            labels.find((label) => label.includes("Server neu starten")),
          input: () => "primary",
        });
        const restartContext = restartHarness.makeContext();
        restartContext.ui.custom = async () => {
          throw new Error("use deterministic select fallback");
        };
        eq(
          await lspControlCenter.resolveLspInteractiveCommand(restartContext),
          "restart primary",
          "restart threads the typed server id through the shared resolver",
        );

        const restartAllHarness = createHarness({
          select: (labels) =>
            labels.find((label) => label.includes("Server neu starten")),
          input: () => "  ",
        });
        const restartAllContext = restartAllHarness.makeContext();
        restartAllContext.ui.custom = async () => {
          throw new Error("use deterministic select fallback");
        };
        eq(
          await lspControlCenter.resolveLspInteractiveCommand(
            restartAllContext,
          ),
          "restart",
          "leaving the server id blank still restarts every server",
        );

        let statusInputCalls = 0;
        const statusHarness = createHarness({
          select: (labels) => labels.find((label) => label.includes("Status")),
          input: () => {
            statusInputCalls += 1;
            return undefined;
          },
        });
        const statusContext = statusHarness.makeContext();
        statusContext.ui.custom = async () => {
          throw new Error("use deterministic select fallback");
        };
        eq(
          await lspControlCenter.resolveLspInteractiveCommand(statusContext),
          "status",
          "non-restart choices resolve directly",
        );
        eq(
          statusInputCalls,
          0,
          "non-restart choices never prompt for a server id",
        );
      }

      // --- bare /lsp now reuses that resolver, so restart honors a typed id
      // instead of silently restarting every server (the pre-fix behavior) ---
      {
        const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-bare-menu-"));
        const harness = createHarness({
          select: (labels) =>
            labels.find((label) => label.includes("Server neu starten")),
          input: () => "ghost-server",
        });
        lspExtensionMod.default(harness.api);
        const context = harness.makeContext({ cwd, trusted: true });
        context.ui.custom = async () => {
          throw new Error("use deterministic select fallback");
        };
        await harness.runHooks("session_start", {}, context);

        await harness.commands.get("lsp")("", context);
        const text = harness.notifications.at(-1)?.message ?? "";
        assert(
          text.includes("kein laufender Server 'ghost-server'"),
          "bare /lsp restart targets exactly the typed server id (got: " +
            text +
            ")",
        );

        await harness.runHooks("session_shutdown", {}, context);
        try {
          rmSync(cwd, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }

      // --- A trusted project's .pi/lsp.json cannot choose the binary ---
      // resolveProfileOverrides is covered directly further up; this asserts
      // the same boundary through the extension, because that is the path a
      // repository actually takes: readProjectConfig -> buildConfig ->
      // resolveConfig. A rejected profile has to be logged and dropped, and
      // must not survive into the server list.
      await withHarness(
        {
          extensions: [lspExtensionMod],
          context: { trusted: true },
          prefix: "pi-lsp-command-gate-",
          files: {
            ".pi/lsp.json": {
              languages: { evil: { command: "/bin/sh", rootMarkers: ["."] } },
            },
          },
        },
        async ({ harness, context }) => {
          await harness.commands.get("lsp")("log", context);
          const logText = harness.notifications.at(-1)?.message ?? "";
          assert(
            /node_modules/.test(logText),
            "a project-chosen command is rejected with a logged reason (got: " +
              logText +
              ")",
          );

          await harness.commands.get("lsp")("servers", context);
          const serverText = harness.notifications.at(-1)?.message ?? "";
          assert(
            !serverText.includes("evil"),
            "the rejected profile never reaches the server list (got: " +
              serverText +
              ")",
          );
        },
      );

      // --- Unreadable .pi/lsp.json is reported and ignored, never fatal ---
      // Both branches fail closed to "no project config", so a broken file
      // degrades to the defaults instead of taking the session down.
      for (const [label, content, expected] of [
        ["invalid JSON", "{not-json", /failed to parse/],
        ["a JSON scalar", '"just a string"', /does not contain a JSON object/],
      ]) {
        await withHarness(
          {
            extensions: [lspExtensionMod],
            context: { trusted: true },
            prefix: "pi-lsp-badconfig-",
            files: { ".pi/lsp.json": content },
          },
          async ({ harness, context }) => {
            await harness.commands.get("lsp")("log", context);
            const logText = harness.notifications.at(-1)?.message ?? "";
            assert(
              expected.test(logText),
              `${label} in .pi/lsp.json is reported (got: ${logText})`,
            );

            await harness.commands.get("lsp")("status", context);
            const statusText = harness.notifications.at(-1)?.message ?? "";
            assert(
              !statusText.includes("aus"),
              `${label} falls back to the defaults instead of disabling LSP (got: ${statusText})`,
            );
          },
        );
      }

      // --- Footer status only appears in TUI mode ---
      for (const mode of ["json", "print", "rpc"]) {
        await withHarness(
          {
            extensions: [lspExtensionMod],
            context: { mode, hasUI: false, trusted: true },
            prefix: "pi-lsp97-nontui-",
          },
          ({ harness }) => {
            eq(
              harness.statusCalls.filter((c) => c.key === "lsp"),
              [],
              "lsp status is not published outside TUI mode (" + mode + ")",
            );
          },
        );
      }

      // --- session_shutdown leaves no orphan processes ---
      {
        const cwd = mkdtempSync(path.join(tmpdir(), "pi-lsp97-shutdown-"));
        writeFileSync(path.join(cwd, "tsconfig.json"), "{}");
        const filePath = path.join(cwd, "a.ts");
        writeFileSync(filePath, "const a = 1;\n");

        const fakeTsProfile = {
          id: "typescript",
          label: "Fake TypeScript",
          enabled: true,
          command: FAKE_LSP_COMMAND,
          args: [fakeServer],
          rootMarkers: ["tsconfig.json"],
        };
        const config = {
          enabled: true,
          mode: "auto",
          requestTimeoutMs: 2000,
          idleShutdownMs: 100000,
          workspaceSymbolLimit: 50,
          languages: { typescript: fakeTsProfile },
        };
        const registry = new registryMod.ServerRegistry({ config });
        const acquired = await registry.acquire(cwd, fakeTsProfile);
        registry.release(cwd, fakeTsProfile.id);
        assert(
          acquired.client.processRunning,
          "server is running before shutdown",
        );
        await registry.shutdownAll();
        assert(
          !acquired.client.processRunning,
          "no orphan process remains after shutdownAll",
        );
        try {
          rmSync(cwd, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    });
  },
};
