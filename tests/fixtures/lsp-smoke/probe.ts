// LSP smoke fixture for the TypeScript / JavaScript language server.
//
// Deterministic symbols so `lsp_definition` / `lsp_hover` have stable targets,
// plus one real type error so the server publishes a diagnostic.

export function answer(): number {
  return 42;
}

const value = answer();

// Intentional undefined symbol -> real diagnostic from typescript-language-server.
console.log(undefinedSymbol);
