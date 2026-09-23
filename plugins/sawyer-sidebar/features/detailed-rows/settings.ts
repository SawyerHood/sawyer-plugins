import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const DETAILED_ROWS_SETTING = "detailedRows";

/** Declares the plugin's settings; bb renders them under Settings → Plugins. */
export function defineSawyerSidebarSettings(bb: BbPluginApi): void {
  bb.settings.define({
    [DETAILED_ROWS_SETTING]: {
      type: "boolean",
      label: "Detailed mode",
      description:
        "Show each thread as a three-line card: project and status, then the title, then the branch or pull request with the machine and agent provider.",
      default: false,
    },
  });
}
