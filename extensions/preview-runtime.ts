import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOCAL_PANDOC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../npm/vendor/pandoc-3.9.0.2/bin/pandoc",
);

export function resolveLocalPandocPath(): string | undefined {
  return existsSync(LOCAL_PANDOC_PATH) ? LOCAL_PANDOC_PATH : undefined;
}

export default function previewRuntimeExtension(_pi: ExtensionAPI): void {
  if (process.env.PANDOC_PATH) return;
  const localPandoc = resolveLocalPandocPath();
  if (localPandoc) process.env.PANDOC_PATH = localPandoc;
}
