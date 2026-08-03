import { spawnSync } from "node:child_process";

export function validateStackManifest(manifest, { root } = {}) {
  if (
    manifest.schemaVersion !== "2.0.0" ||
    !/^P4(?:-production)?$/.test(manifest.seriesId ?? "")
  )
    throw new Error("Invalid P4 stack manifest series.");
  if (
    !/^[0-9a-f]{40}$/.test(manifest.reference ?? "") ||
    spawnSync("git", ["cat-file", "-e", `${manifest.reference}^{commit}`], {
      cwd: root,
    }).status !== 0
  )
    throw new Error("P4 stack reference is unavailable.");
  for (const role of ["main", "investigator", "debugger", "verifier"]) {
    const value = manifest.roles?.[role];
    if (
      !value ||
      (value.enabled !== false &&
        (typeof value.model !== "string" || typeof value.thinking !== "string"))
    )
      throw new Error(`P4 stack role '${role}' is not explicitly pinned.`);
  }
  if (
    !Array.isArray(manifest.runs) ||
    !manifest.runs.length ||
    manifest.runs.some(
      (run) =>
        run.stackMode !==
        (manifest.seriesId === "P4" ? "same-model" : "production-stack"),
    )
  )
    throw new Error("P4 stack runs do not match their declared stack mode.");
  return true;
}
