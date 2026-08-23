// Composed runtime test sections. Section bodies live in ./runtime/*.
import { targetConfigSections } from "./runtime/target-config.mjs";
import { installerSections } from "./runtime/installer.mjs";
import { setupCoreSections } from "./runtime/setup-core.mjs";
import { verificationSections } from "./runtime/verification.mjs";
import { subagentsSkillsSections } from "./runtime/subagents-skills.mjs";
import { controlPlaneSections } from "./runtime/control-plane.mjs";
import { askUserSections } from "./runtime/ask-user.mjs";
import { auroraUiSections } from "./runtime/aurora-ui.mjs";
import { resilienceSections } from "./runtime/resilience.mjs";

export const runtimeSections = {
  ...targetConfigSections,
  ...installerSections,
  ...setupCoreSections,
  ...verificationSections,
  ...subagentsSkillsSections,
  ...controlPlaneSections,
  ...askUserSections,
  ...auroraUiSections,
  ...resilienceSections,
};
