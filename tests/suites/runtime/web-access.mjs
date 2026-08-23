import { readFileSync } from "node:fs";
import path from "node:path";
import { assert, eq } from "../../shared/assertions.mjs";
import { createHarness } from "../../shared/harness.mjs";
import { ROOT } from "../../shared/jiti-loader.mjs";

/**
 * Web capability (pi-web-access): genau web_search + fetch_content als
 * extern read-only Klasse. Prüft die harten Eingabegrenzen, die Stufenlogik
 * im Work Mode, die Plan-Mode-Freigabe und die Trust-Trennung.
 */
export const webAccessSections = {
  "web tool capability and boundaries": async (context) => {
    const { section, load, modePermissions } = context;

    await section("web tool capability and boundaries", async () => {
      const webTools = await load("extensions/permissions/web-tools.ts");
      const toolPolicy = await load("extensions/permissions/tool-policy.ts");
      const workflowPolicy = await load(
        "extensions/permissions/workflow-policy.ts",
      );
      if (!webTools || !toolPolicy || !workflowPolicy) return;

      // --- Konfigurationsvertrag -----------------------------------------
      const config = JSON.parse(
        readFileSync(path.join(ROOT, "web-search.json"), "utf8"),
      );
      eq(config.workflow, "none", "search workflow has no curator/summary");
      eq(config.autoOpenBrowser, false, "web access never auto-opens a browser");
      eq(config.allowBrowserCookies, false, "browser cookies stay disabled");
      eq(config.tools, {
        webSearch: { enabled: true },
        sourceCheck: { enabled: false },
        fetchContent: { enabled: true },
        getSearchContent: { enabled: false },
      }, "only web_search and fetch_content are enabled");
      eq(config.commands, {
        websearch: { enabled: false },
        curator: { enabled: false },
        "google-account": { enabled: false },
        search: { enabled: false },
      }, "all public web commands stay disabled");
      eq(config.githubClone, { enabled: false }, "GitHub cloning stays disabled");
      eq(config.youtube, { enabled: false }, "YouTube stays disabled");
      eq(config.video, { enabled: false }, "video stays disabled");
      eq(
        config.fetchRouting,
        { allowRemoteHostedProviders: false },
        "remote hosted fetch providers stay disabled",
      );
      eq(config.ssrf, { trustEnvProxy: false }, "SSRF proxy trust stays disabled");

      // --- Harte Eingabegrenze für fetch_content -------------------------
      const assess = (input) =>
        webTools.assessWebToolInput({ toolName: "fetch_content", input });

      assert(
        !assess({ url: "https://example.test/docs" }).blocked,
        "an https URL passes the hard input boundary",
      );
      assert(
        !assess({ url: "http://example.test/docs" }).blocked,
        "an http URL passes the hard input boundary",
      );
      assert(
        !assess({ urls: ["https://a.test/x", "https://b.test/y"] }).blocked,
        "an https URL list passes the hard input boundary",
      );
      assert(
        assess({ url: "/etc/passwd" }).blocked,
        "a local absolute path is a hard block",
      );
      assert(
        assess({ url: "file:///etc/passwd" }).blocked,
        "file:// is a hard block",
      );
      assert(
        assess({ urls: ["https://a.test/x", "/etc/shadow"] }).blocked,
        "one local entry in the URL list is a hard block",
      );
      assert(
        assess({ url: "https://a.test/x", auth: true }).blocked,
        "auth: true is a hard block",
      );
      assert(
        assess({ url: "https://a.test/x", auth: "profile" }).blocked,
        "an auth profile is a hard block",
      );
      assert(
        !assess({ url: "https://a.test/x", auth: false }).blocked,
        "auth: false means no auth and passes",
      );
      const assessSearch = (input) =>
        webTools.assessWebToolInput({ toolName: "web_search", input });
      assert(
        !assessSearch({ query: "anything" }).blocked,
        "web_search works with its configured workflow",
      );
      assert(
        !assessSearch({ query: "anything", workflow: "none" }).blocked,
        "web_search may explicitly retain workflow none",
      );
      assert(
        assessSearch({ query: "anything", workflow: "summary-review" }).blocked,
        "web_search cannot re-enable the curator workflow",
      );
      assert(
        assessSearch({ query: "anything", workflow: "auto-summary" }).blocked,
        "web_search cannot re-enable a summary model",
      );

      // --- Work-Mode-Stufenlogik (decideTool) ---------------------------
      const decide = (level, toolName, input = {}) =>
        toolPolicy.decideTool(level, { toolName, input }, process.cwd(), {
          unknownTools: "ask",
          bash: "allow",
        });

      for (const toolName of ["web_search", "fetch_content"]) {
        eq(
          decide("project-write", toolName).action,
          "allow",
          `${toolName} is allowed at project-write`,
        );
        eq(
          decide("confirm-all", toolName).action,
          "ask",
          `${toolName} asks at confirm-all`,
        );
        eq(
          decide("readonly", toolName).action,
          "block",
          `${toolName} is blocked at readonly`,
        );
      }

      // --- Plan Mode: extern read-only läuft durch ----------------------
      const planGuard = (workflow, event) =>
        workflowPolicy.planModeMutationGuard(workflow, "project-write", event, process.cwd());

      for (const mode of ["simple_plan", "detailed_plan"]) {
        const planning = { mode };
        assert(
          !planGuard(planning, {
            toolName: "web_search",
            input: { query: "x" },
          }).blocked,
          `web_search is permitted in trusted ${mode}`,
        );
        assert(
          !planGuard(planning, {
            toolName: "fetch_content",
            input: { url: "https://example.test/" },
          }).blocked,
          `fetch_content is permitted in trusted ${mode}`,
        );
        assert(
          planGuard(planning, {
            toolName: "write",
            input: { path: "extensions/example.ts" },
          }).blocked,
          `mutating tools stay blocked in ${mode}`,
        );
      }

      // --- Trust-Trennung: echter Permission-Hook -----------------------
      if (modePermissions) {
        const harness = createHarness();
        modePermissions.default(harness.api);
        const untrusted = harness.makeContext({
          cwd: process.cwd(),
          trusted: false,
        });
        await harness.runHooks("session_start", {}, untrusted);
        for (const [toolName, input] of [
          ["web_search", { query: "current docs" }],
          ["fetch_content", { url: "https://example.test/" }],
        ]) {
          const [result] = await harness.runHooks(
            "tool_call",
            { toolName, input },
            untrusted,
          );
          assert(
            result?.block === true && /Trust-Grenze/.test(result.reason ?? ""),
            `${toolName} is hard-blocked in an untrusted project`,
          );
        }

        const trustedHarness = createHarness();
        modePermissions.default(trustedHarness.api);
        const trusted = trustedHarness.makeContext({
          cwd: process.cwd(),
          trusted: true,
        });
        await trustedHarness.runHooks("session_start", {}, trusted);
        const [workflowOverride] = await trustedHarness.runHooks(
          "tool_call",
          {
            toolName: "web_search",
            input: { query: "current docs", workflow: "auto-summary" },
          },
          trusted,
        );
        assert(
          workflowOverride?.block === true &&
            /workflow.*none/.test(workflowOverride.reason ?? ""),
          "the real guard blocks a trusted auto-summary workflow override",
        );
      }
      assert(
        webTools.WEB_TOOLS.size === 2 &&
          webTools.WEB_TOOLS.has("web_search") &&
          webTools.WEB_TOOLS.has("fetch_content"),
        "the web capability class contains exactly the two pi-web-access tools",
      );

      // --- Plan-Mode-Liste enthält beide Tools, Work-Modes unverändert --
      const planning = { mode: "detailed_plan" };
      eq(
        workflowPolicy.planModeMutationGuard(planning, "project-write", {
          toolName: "bash",
          input: { command: "touch unexpected-plan-mutation" },
        }, process.cwd()).blocked,
        true,
        "plan mode blocks mutating bash commands",
      );
    });
  },
};
