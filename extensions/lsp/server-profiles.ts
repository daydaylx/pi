/**
 * Built-in server profiles for the optional LSP integration.
 *
 * Each profile ships with the security-defaults required by the plan §9:
 * - TypeScript: automatic type acquisition disabled.
 * - Python: no unsafe execution.
 * - Go, Rust, C/C++, Java: default `enabled: false` / opt-in only.
 * - Rust: cargo build scripts and proc macros disabled.
 *
 * Profiles are static data — command strings are never constructed from
 * untrusted project values (see `process.ts` for separated command/args).
 *
 * Issue #94 — configuration, root detection and registry.
 */

import type { ServerProfile } from "./types.ts";

export const PROFILES: Record<string, ServerProfile> = {
  typescript: {
    id: "typescript",
    label: "TypeScript / JavaScript",
    enabled: true,
    command: "typescript-language-server",
    args: ["--stdio"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    initializationOptions: {
      disableAutomaticTypingAcquisition: true,
      maxTsServerMemory: 1536,
    },
    notes:
      "Requires typescript-language-server and typescript installed globally.",
  },
  python: {
    id: "python",
    label: "Python",
    enabled: true,
    command: "pyright-langserver",
    args: ["--stdio"],
    rootMarkers: ["pyrightconfig.json", "pyproject.toml", "requirements.txt"],
    notes: "Requires pyright installed globally (npm install -g pyright).",
  },
  go: {
    id: "go",
    label: "Go",
    enabled: false,
    command: "gopls",
    args: [],
    rootMarkers: ["go.mod", "go.sum", ".go"],
    notes:
      "Opt-in only. gopls can execute toolchain commands; do not enable in untrusted projects.",
  },
  rust: {
    id: "rust",
    label: "Rust",
    enabled: false,
    command: "rust-analyzer",
    args: [],
    rootMarkers: ["Cargo.toml", "rust-project.json"],
    settings: {
      "rust-analyzer": {
        cargo: { buildScripts: { enable: false } },
        procMacro: { enable: false },
      },
    },
    notes:
      "Opt-in only. Build scripts and proc macros are disabled by default for safety.",
  },
  c: {
    id: "c",
    label: "C / C++",
    enabled: false,
    command: "clangd",
    args: [],
    rootMarkers: [
      "compile_commands.json",
      "CMakeLists.txt",
      "Makefile",
      ".clangd",
    ],
    notes:
      "Opt-in only. Requires a working compile-command database; missing one gives poor results.",
  },
  java: {
    id: "java",
    label: "Java",
    enabled: false,
    command: "eclipse.jdt.ls",
    args: [],
    rootMarkers: ["pom.xml", "build.gradle", ".project"],
    notes:
      "Opt-in only. Requires a Java runtime and Eclipse JDT LS installation; resource-intensive.",
  },
};
