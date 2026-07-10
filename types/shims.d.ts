// Ambient shim for `tsc --noEmit` (#39).
//
// Primary mechanism: tsconfig.json `paths` resolves the @earendil-works/*
// packages (and `typebox`) to the globally-installed pi packages for REAL
// type-checking. This ambient declaration is only a portable fallback for
// environments where the global install path in tsconfig.json does not exist
// (e.g. a fresh checkout without the global pi install) – it keeps tsc green
// by declaring pi-agent-core as `any` instead of failing on an unresolved
// transitive package. When the global path resolves (the normal case), the
// real .d.ts shadow this declaration entirely.
declare module "@earendil-works/pi-agent-core" {
  export type AgentMessage = any;
  export type ThinkingLevel = any;
  export type AgentToolResult<TDetails = unknown> = any;
  export type AgentToolUpdateCallback<TDetails = unknown> = any;
  export type ToolExecutionMode = any;
}
