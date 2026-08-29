/**
 * Ausschließlich für den Electron-Dialog-Smoke: erzeugt einen echten,
 * providerfreien RPC-Select-Dialog ohne Produktions-Extensions zu laden.
 */
export default function rpcDialogSmokeExtension(pi) {
  pi.registerCommand("gui-smoke-dialog", {
    description: "Test-only RPC dialog smoke command",
    handler: async (_args, ctx) => {
      await ctx.ui.select("GUI smoke dialog", ["Dismiss"]);
    },
  });
  pi.registerCommand("gui-smoke-editor", {
    description: "Test-only unsupported editor dialog",
    handler: async (_args, ctx) => {
      await ctx.ui.editor("GUI smoke editor", "prefilled");
    },
  });
  pi.registerCommand("gui-smoke-noop", {
    description: "Test-only local command without an agent turn",
    handler: async () => {},
  });
}
