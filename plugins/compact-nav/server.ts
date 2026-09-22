import type { BbPluginApi } from "@get-bb/plugin-sdk";

const SLOT_KEY = "compact-nav/icons";
const SIDEBAR_PREFERENCES = [
  "sidebar.navigationProvider",
  "sidebar.headerProvider",
] as const;

export default function compactNav(bb: BbPluginApi) {
  bb.onInstall(async () => {
    const { preferences } = await bb.sdk.system.uiPreferences.list();
    for (const key of SIDEBAR_PREFERENCES) {
      await bb.sdk.system.uiPreferences.set({
        key,
        value: SLOT_KEY,
        expectedRevision: preferences[key].revision,
      });
    }
  });
}
