// Composed runtime test sections. Section bodies live in ./runtime/*.
import { targetConfigSections } from "./runtime/target-config.mjs";
import { installerSections } from "./runtime/installer.mjs";
import { setupCoreSections } from "./runtime/setup-core.mjs";
import { verificationSections } from "./runtime/verification.mjs";
import { subagentsSkillsSections } from "./runtime/subagents-skills.mjs";
import { controlPlaneSections } from "./runtime/control-plane.mjs";
import { askUserSections } from "./runtime/ask-user.mjs";
import { auroraUiSections } from "./runtime/aurora-ui.mjs";
import { auroraInspectorSections } from "./runtime/aurora-inspector.mjs";
import { resilienceSections } from "./runtime/resilience.mjs";
import { webAccessSections } from "./runtime/web-access.mjs";
import { shortcutsSections } from "./runtime/shortcuts.mjs";

export const runtimeSections = {
  ...targetConfigSections,
  ...installerSections,
  ...setupCoreSections,
  ...verificationSections,
  ...subagentsSkillsSections,
  ...controlPlaneSections,
  ...askUserSections,
  ...auroraUiSections,
  ...auroraInspectorSections,
  ...resilienceSections,
  ...webAccessSections,
  ...shortcutsSections,
};
