/**
 * Historische Risikoklassifikation des Systemprofils (`pis`).
 *
 * Die aktuelle PIS-Laufzeit verwendet diese Klassifikation nicht als
 * Freigabe- oder Sperrregel. Sie bleibt für Kompatibilität und Tests erhalten.
 *
 * Die Klassifikation ist eine Heuristik und erkennt nicht beliebig
 * verschleierten Code.
 */
import { basename } from "node:path";
import {
  isSensitivePathIdentity,
  isSensitiveReference,
  resolvePathScope,
} from "../shared/permission-policy.ts";
import {
  flattenTokens,
  shellCommands,
  systemBashNeedsApproval,
} from "../system-control/policy.ts";

export interface SystemOpenRisk {
  reason: string;
}

const DELETE_EXECUTABLES = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "srm",
  "wipe",
  "trash",
  "trash-put",
  "trash-empty",
]);
const DISK_EXECUTABLES = new Set([
  "dd",
  "mke2fs",
  "mkswap",
  "wipefs",
  "parted",
  "fdisk",
  "sfdisk",
  "gdisk",
  "sgdisk",
  "cfdisk",
  "blkdiscard",
  "cryptsetup",
  "lvremove",
  "vgremove",
  "pvremove",
  "mdadm",
]);
const PRIVILEGE_EXECUTABLES = new Set(["sudo", "su", "doas", "pkexec", "run0"]);
const POWER_EXECUTABLES = new Set([
  "reboot",
  "shutdown",
  "poweroff",
  "halt",
  "killall",
  "pkill",
]);
const SERVICE_MANAGERS = new Set(["systemctl", "loginctl", "machinectl"]);
const DESTRUCTIVE_SERVICE_ACTIONS = new Set([
  "stop",
  "disable",
  "mask",
  "kill",
  "poweroff",
  "reboot",
  "halt",
  "isolate",
  "emergency",
  "rescue",
  "suspend",
  "hibernate",
  "terminate-session",
  "terminate-user",
  "kexec",
]);
const PACKAGE_MANAGERS = new Set([
  "apt",
  "apt-get",
  "dnf",
  "yum",
  "pacman",
  "zypper",
  "brew",
  "flatpak",
  "snap",
]);
const PACKAGE_REMOVAL = new Set([
  "remove",
  "purge",
  "uninstall",
  "erase",
  "autoremove",
  "-R",
  "-Rs",
  "-Rns",
  "-Rdd",
]);
const GIT_FORCE_FLAGS = new Set([
  "--force",
  "-f",
  "--force-with-lease",
  "--delete",
  "-d",
  "--mirror",
  "--prune",
]);
/** Programme, die Dateien verändern: relevant, wenn sie Systempfade berühren. */
const WRITING_EXECUTABLES = new Set([
  "cp",
  "mv",
  "install",
  "ln",
  "tee",
  "touch",
  "truncate",
  "mkdir",
  "rsync",
  "tar",
  "unzip",
  "patch",
  "sed",
  "perl",
  "chmod",
  "chown",
  "chgrp",
  "setfacl",
  "mount",
  "umount",
]);
const COMMAND_PREFIXES = new Set([
  "env",
  "nohup",
  "time",
  "nice",
  "ionice",
  "command",
  "exec",
  "stdbuf",
  "setsid",
  "timeout",
]);
// Block-Geräte tragen Nummern und Suffixe (`/dev/sda1`, `/dev/nvme0n1p2`).
const BLOCK_DEVICE =
  "dev\\/(?:(?:sd|nvme|vd|hd|mmcblk|dm-|loop)[A-Za-z0-9_-]*|mapper|disk)";
const SYSTEM_PATH = new RegExp(
  `^\\/(?:etc|boot|usr|bin|sbin|lib|lib32|lib64|opt|root|sys|var\\/lib|proc\\/sys|${BLOCK_DEVICE})(?:\\/|$)`,
);
const SYSTEM_WRITE_REDIRECT = new RegExp(
  `(?:^|[^<>&0-9])>>?\\s*["']?\\/(?:etc|boot|usr|bin|sbin|lib|lib32|lib64|opt|root|sys|var\\/lib|proc\\/sys|${BLOCK_DEVICE})(?:\\/|\\b|$)`,
);
const DOWNLOAD_TO_SHELL =
  /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/i;

function executableOf(tokens: readonly string[]): string | undefined {
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    const name = basename(token);
    if (COMMAND_PREFIXES.has(name)) continue;
    return name;
  }
  return undefined;
}

function gitRisk(tokens: readonly string[]): string | undefined {
  const index = tokens.findIndex((token) => basename(token) === "git");
  if (index < 0) return undefined;
  const rest = tokens.slice(index + 1);
  const action = rest.find((token) => !token.startsWith("-"));
  const flags = rest.filter((token) => token.startsWith("-"));
  switch (action) {
    case "clean":
      return "git clean löscht unversionierte Dateien";
    case "reset":
      return flags.includes("--hard")
        ? "git reset --hard verwirft Änderungen"
        : undefined;
    case "push":
      // `:branch` löscht, `+refspec` erzwingt den Push.
      return flags.some((flag) => GIT_FORCE_FLAGS.has(flag)) ||
        rest.some((token) => /^[:+][^\s]+$/.test(token))
        ? "git push mit Force/Löschen überschreibt oder löscht Remote-Stände"
        : undefined;
    case "branch":
      return flags.includes("-D") || flags.includes("--delete")
        ? "git branch -D löscht einen Branch"
        : undefined;
    case "stash":
      return rest.includes("drop") || rest.includes("clear")
        ? "git stash drop/clear löscht gesicherte Änderungen"
        : undefined;
    case "filter-branch":
    case "filter-repo":
      return "Historienumschreibung";
    case "reflog":
      return rest.includes("expire") || rest.includes("delete")
        ? "git reflog expire/delete entfernt Wiederherstellungspunkte"
        : undefined;
    default:
      return undefined;
  }
}

/** Liefert den Grund, warum ein Shell-Kommando vorab bestätigt werden muss. */
export function systemOpenBashRisk(
  command: string,
): SystemOpenRisk | undefined {
  if (DOWNLOAD_TO_SHELL.test(command))
    return { reason: "Download wird direkt in eine Shell geleitet" };
  if (isSensitiveReference(command))
    return { reason: "Zugriff auf Secrets oder Zugangsdaten" };
  if (systemBashNeedsApproval(command))
    return { reason: "Geschütztes Systemkommando (NixOS-Aktivierung/sudo)" };
  if (SYSTEM_WRITE_REDIRECT.test(command))
    return { reason: "Schreibzugriff auf einen Systempfad oder ein Gerät" };

  const segments = shellCommands(command);
  for (const segment of [...segments, flattenTokens(segments, 0)]) {
    const executable = executableOf(segment);
    if (!executable) continue;
    const names = new Set(segment.map((token) => basename(token)));
    for (const name of names) {
      if (DELETE_EXECUTABLES.has(name)) return { reason: `Löschen (${name})` };
      if (DISK_EXECUTABLES.has(name) || name.startsWith("mkfs"))
        return { reason: `Datenträger-/Partitionsoperation (${name})` };
      if (PRIVILEGE_EXECUTABLES.has(name))
        return { reason: `Erhöhte Rechte (${name})` };
      if (POWER_EXECUTABLES.has(name))
        return { reason: `Strom- oder Prozesssteuerung (${name})` };
      if (name === "nix-collect-garbage")
        return { reason: "nix-collect-garbage löscht Store-Pfade" };
    }
    if (segment.includes("-delete"))
      return { reason: "find -delete löscht Dateien" };
    const git = gitRisk(segment);
    if (git) return { reason: git };
    if (
      SERVICE_MANAGERS.has(executable) &&
      segment.some((token) => DESTRUCTIVE_SERVICE_ACTIONS.has(token))
    )
      return { reason: `Dienst-/Sitzungssteuerung (${executable})` };
    if (
      PACKAGE_MANAGERS.has(executable) &&
      segment.some((token) => PACKAGE_REMOVAL.has(token))
    )
      return { reason: `Paketentfernung (${executable})` };
    if (
      executable === "nix" &&
      segment.includes("store") &&
      (segment.includes("gc") || segment.includes("delete"))
    )
      return { reason: "nix store gc/delete löscht Store-Pfade" };
    if (
      (executable === "chmod" ||
        executable === "chown" ||
        executable === "chgrp") &&
      segment.some((token) => token === "-R" || token === "--recursive")
    )
      return { reason: `Rekursive Rechteänderung (${executable})` };
    if (
      WRITING_EXECUTABLES.has(executable) &&
      segment.some((token) => SYSTEM_PATH.test(token))
    )
      return { reason: "Schreibzugriff auf einen Systempfad oder ein Gerät" };
  }
  return undefined;
}

/** Datei-Tool-Zugriff: nur Secrets und (beim Schreiben) Systempfade fragen. */
export function systemOpenFileRisk(
  operation: "read" | "write",
  rawPath: string,
  cwd: string,
): SystemOpenRisk | undefined {
  const identity = resolvePathScope(rawPath, cwd);
  if (isSensitivePathIdentity(rawPath, identity))
    return { reason: "Zugriff auf Secrets oder Zugangsdaten" };
  // Lexikalisch und kanonisch prüfen: unter NixOS zeigt /etc/* in den Store.
  if (
    operation === "write" &&
    [identity.lexicalPath, identity.canonicalPath].some(
      (target) => target !== undefined && SYSTEM_PATH.test(target),
    )
  )
    return { reason: "Schreibzugriff auf einen Systempfad" };
  return undefined;
}
