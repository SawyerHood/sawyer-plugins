// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginProvidersState } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ThreadProviderIcon } from "./ThreadProviderIcon.js";

type ProviderInfo = PluginProvidersState["providers"][number];

const claudeCode = {
  id: "claude-code",
  displayName: "Claude Code",
  logoUrl: "/api/v1/system/providers/claude-code/logo",
} as ProviderInfo;

function renderIcon(providerId: string, providers: ProviderInfo[]) {
  return renderSlot(
    { component: ThreadProviderIcon },
    { providerId },
    { providers: { status: "ready", providers } },
  );
}

afterEach(cleanup);

describe("ThreadProviderIcon", () => {
  it("draws the thread's agent provider from the provider directory", () => {
    const { container } = renderIcon("claude-code", [claudeCode]);
    const icon = container.querySelector("[data-provider-kind]");
    expect(icon?.getAttribute("data-provider-kind")).toBe("agent");
    expect(icon?.getAttribute("data-provider-id")).toBe("claude-code");
    expect(icon?.getAttribute("data-provider-logo")).toBe(claudeCode.logoUrl);
  });

  it("falls back to the generic glyph for a provider it cannot find", () => {
    const { container } = renderIcon("retired-provider", [claudeCode]);
    const icon = container.querySelector("[data-provider-kind]");
    expect(icon?.getAttribute("data-provider-id")).toBe("retired-provider");
    expect(icon?.getAttribute("data-provider-logo")).toBeNull();
    expect(icon?.getAttribute("data-provider-fallback")).toBe("Bot");
  });

  it("stays click-through so the row link takes the click", () => {
    const { container } = renderIcon("claude-code", [claudeCode]);
    const wrapper = container.querySelector(
      "[data-sidebar-thread-provider-icon]",
    );
    expect(wrapper?.className).toContain("pointer-events-none");
  });
});
