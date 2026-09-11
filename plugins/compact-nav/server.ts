import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function compactNav(bb: BbPluginApi) {
  bb.settings.define({
    inlineHeader: {
      type: "boolean",
      label: "Place icons beside sidebar toggle",
      description: "Fit navigation between the sidebar toggle and back/forward arrows, wrapping extra icons below.",
      default: false,
    },
  });
}
