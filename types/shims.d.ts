// Ambient shim for `tsc --noEmit` (#39).
//
// `@earendil-works/pi-agent-core` is declared as a dependency by
// `@earendil-works/pi-coding-agent` (whose .d.ts files import types from it
// pervasively), but it is not present under npm/node_modules in this dev
// install. This is a pre-existing environment gap unrelated to the
// subagents work — see docs/subagents.md "Remaining Risks". Declaring it as
// an ambient module (all exports `any`) lets the real typecheck run against
// our own source instead of failing on this unresolved transitive package.
declare module "@earendil-works/pi-agent-core" {
  export type AgentMessage = any;
  export type ThinkingLevel = any;
  export type AgentToolResult<TDetails = unknown> = any;
  export type AgentToolUpdateCallback<TDetails = unknown> = any;
  export type ToolExecutionMode = any;
}
