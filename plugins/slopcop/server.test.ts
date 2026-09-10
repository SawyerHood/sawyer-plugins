import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

vi.mock("./lib/gh", () => ({
  createGhClient: () => ({ authenticatedLogin: async () => null }),
}));
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  vi.unstubAllGlobals();
});
const channel = "100000000000000002";
const guild = "100000000000000001";
const snowflake = (time: number) =>
  (BigInt(time - 1420070400000) << 22n).toString();
const request = {
  projectId: "project",
  providerId: "codex",
  model: "test-model",
};

async function setup() {
  const spawn = vi.fn(async () =>
    makeThreadResponse({
      id: `thread-${spawn.mock.calls.length}`,
      status: "active",
    }),
  );
  const host = createFakePluginHost({
    settings: {
      discordBotToken: "test-secret",
      maxConcurrentReviews: "1",
      botGhPath: "~/.slopcop/slopcop-gh",
    },
    sdk: {
      threads: {
        spawn,
        get: async ({ threadId }) =>
          makeThreadResponse({ id: threadId, status: "idle" }),
      },
    },
  });
  hosts.push(host);
  await plugin(host.bb);
  const saved = (await host.harness.behavior.callRpc("saveRule", {
    id: null,
    rule: {
      name: "Discord intake",
      triggers: ["discord_post_created"],
      discordChannelId: channel,
      mode: "live",
      prompt: "Summarize this report",
      request,
    },
  })) as { rule: { id: string } };
  const time = Date.now() + 1;
  const messages = [0, 1].map((index) => ({
    id: snowflake(time + index),
    content: `Report ${index}`,
    type: 0,
    author: { id: guild, username: "reporter" },
    attachments: [],
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith(`/channels/${channel}`)
          ? { id: channel, guild_id: guild, type: 0 }
          : messages,
      ),
    ),
  );
  return { host, spawn, saved };
}

describe("Discord trigger integration", () => {
  it("queues at capacity, dispatches once per post across polls, and completes without GitHub verification", async () => {
    const { host, spawn } = await setup();
    let service = host.harness.behavior.runService("watcher");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    service.controller.abort();
    await service.done;
    expect(spawn.mock.calls[0][0].prompt).toContain("~/.slopcop/slopcop-gh");
    expect(spawn.mock.calls[0][0].prompt).not.toContain("test-secret");
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thread-1" }),
      lastAssistantText: "Handled the report",
    });
    const first = (await host.harness.behavior.callRpc("listRuns", {})) as {
      runs: { status: string; detail: string; targetKind: string }[];
    };
    expect(first.runs[0]).toMatchObject({
      status: "completed",
      detail: "Handled the report",
      targetKind: "discord_post",
    });
    service = host.harness.behavior.runService("watcher");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    service.controller.abort();
    await service.done;
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thread-2" }),
      lastAssistantText: "Done",
    });
    service = host.harness.behavior.runService("watcher");
    await vi.waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(6),
    );
    service.controller.abort();
    await service.done;
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("validates channel configuration and allows a Discord rule without a repository", async () => {
    const { host, saved } = await setup();
    expect(saved.rule.id).toBeTruthy();
    await expect(
      host.harness.behavior.callRpc("saveRule", {
        id: null,
        rule: {
          name: "invalid",
          triggers: ["discord_post_created"],
          discordChannelId: "invalid",
          request,
        },
      }),
    ).rejects.toThrow();
    await expect(
      host.harness.behavior.callRpc("saveRule", {
        id: null,
        rule: {
          name: "mixed",
          triggers: ["discord_post_created", "new_issue"],
          discordChannelId: channel,
          request,
        },
      }),
    ).rejects.toThrow();
    expect(
      host.harness.inspection.registrations.settingsDescriptors.discordBotToken
        .secret,
    ).toBe(true);
  });

  it("recovers an idle agent after reload and dispatches the durable pending post", async () => {
    const { host, spawn } = await setup();
    const service = host.harness.behavior.runService("watcher");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    service.controller.abort();
    await service.done;
    const replacement = await host.harness.lifecycle.reload(plugin);
    hosts.push(replacement);
    replacement.harness.inspection.sdk.stub("threads.output", async () => ({
      output: "Finished while plugin was offline",
    }));
    const resumed = replacement.harness.behavior.runService("watcher");
    await vi.waitFor(() =>
      expect(
        spawn,
        JSON.stringify(replacement.harness.inspection.logEntries),
      ).toHaveBeenCalledTimes(2),
    );
    resumed.controller.abort();
    await resumed.done;
    const result = (await replacement.harness.behavior.callRpc(
      "listRuns",
      {},
    )) as { runs: { status: string; detail: string }[] };
    expect(result.runs).toContainEqual(
      expect.objectContaining({
        status: "completed",
        detail: "Finished while plugin was offline",
      }),
    );
  });

  it("records shadow output without imposing GitHub marker verification", async () => {
    const { host, spawn, saved } = await setup();
    await host.harness.behavior.callRpc("saveRule", {
      id: saved.rule.id,
      rule: {
        name: "Discord intake",
        triggers: ["discord_post_created"],
        discordChannelId: channel,
        mode: "shadow",
        prompt: "Sync to an issue",
        request,
      },
    });
    const service = host.harness.behavior.runService("watcher");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    service.controller.abort();
    await service.done;
    expect(spawn.mock.calls[0][0].prompt).toContain("SHADOW MODE");
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thread-1" }),
      lastAssistantText: "Would create an issue",
    });
    const result = (await host.harness.behavior.callRpc("listRuns", {})) as {
      runs: { status: string; detail: string }[];
    };
    expect(result.runs[0]).toMatchObject({
      status: "shadowed",
      detail: "Would create an issue",
    });
  });
});
