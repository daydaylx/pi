import { resolveRuntimeRoot } from "../../shared/runtime-resolution.mjs";

function runtimeArgument(argv) {
  const index = argv.indexOf("--runtime");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value) throw new Error("--runtime benötigt einen Pfad");
  if (argv.length !== 2) throw new Error("Nur --runtime <pfad> wird unterstützt");
  return value;
}

export function resolveRuntimeForRuntimeTest(
  argv = process.argv.slice(2),
  env = process.env,
) {
  return resolveRuntimeRoot({ runtime: runtimeArgument(argv), env });
}
