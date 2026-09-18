import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { rpcContract } from "./contracts.js";

const ready = { status: "ready", version: "0.38.1-test" };
const on = { enabled: true, detail: null };

async function setup() {
  const worker = vi.fn(
    async ({ method }: { method: string }): Promise<unknown> =>
      method === "run"
        ? { output: { text: "done", images: [], exitCode: 0 }, cursor: on }
        : method === "prepare"
          ? ready
          : method === "open"
            ? { cursor: { enabled: true, detail: null } }
            : null,
  );
  const host = createFakePluginHost({
    pluginId: "agent-browser",
    agentSkillIds: ["agent-browser"],
    experimental_callHostRpc: worker,
  });
  host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thread-test" }),
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.listInstances",
    async () => ({
      instances: [
        {
          hostId: "desktop-host",
          instanceId: "desktop",
          generation: "generation",
          label: "Desktop",
        },
      ],
    }),
  );
  host.harness.sdk.stub("experimental_desktopBrowsers.createTab", async () => ({
    tab: {
      tabId: "created",
      threadId: "thread-test",
      url: "about:blank",
      title: "",
      control: null,
      profile: { kind: "automation", id: "profile" },
      presentation: "hidden",
    },
  }));
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.acquireControl",
    async () => ({ leaseId: "lease", expiresAt: Date.now() + 60_000 }),
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.openConnection",
    async () => ({
      hostId: "desktop-host",
      expiresAt: Date.now() + 60_000,
      wsEndpoint: "ws://127.0.0.1:9999/cdp?token=secret",
    }),
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.releaseControl",
    async (input) => {
      expect(Object.keys(input).sort()).toEqual([
        "generation",
        "hostId",
        "instanceId",
        "leaseId",
        "threadId",
      ]);
      return { ok: true };
    },
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.closeTab",
    async (input) => {
      expect(Object.keys(input).sort()).toEqual([
        "generation",
        "hostId",
        "instanceId",
        "tabId",
        "threadId",
      ]);
      return { ok: true };
    },
  );
  host.harness.sdk.stub("experimental_desktopBrowsers.subscribe", () => ({
    dispose() {},
  }));
  host.harness.sdk.stub("experimental_desktopBrowsers.listTabs", async () => ({
    tabs: [
      { tabId: "created", profile: { kind: "automation", id: "profile" } },
    ],
  }));
  await plugin(host.bb);
  async function open(tabId?: string) {
    const result = await host.harness.behavior.callRpc("open", {
      threadId: "thread-test",
      selection: {
        backend: "desktop",
        hostId: "desktop-host",
        instanceId: "desktop",
        ...(tabId ? { tabId } : {}),
      },
    });
    return rpcContract.open.output.parse(result);
  }
  return { ...host, worker, open };
}

describe("server session ownership", () => {
  it("returns browser-host image paths through the CLI without registering tools", async () => {
    const h = await setup();
    try {
      const session = await h.open();
      const images = [
        {
          path: "/tmp/browser-session/tmp/capture.jpg",
          mimeType: "image/jpeg",
          width: 640,
          height: 400,
        },
      ];
      h.worker.mockResolvedValueOnce({ text: "captured", images, exitCode: 0 });
      const result = await h.harness.behavior.runCli(
        ["screenshot", session.id, "--full"],
        { threadId: "thread-test" },
      );
      expect(result.exitCode).toBe(0);
      expect(h.worker).toHaveBeenLastCalledWith(
        expect.objectContaining({
          hostId: "desktop-host",
          method: "screenshot",
          input: { sessionId: session.id, full: true, annotate: false },
        }),
      );
      expect(JSON.parse(result.stdout)).toEqual({
        text: "captured",
        images,
        exitCode: 0,
        hostId: "desktop-host",
      });
      expect(h.harness.registrations.agentTools).toEqual([]);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("routes to the desktop host without exposing the connection and preserves a handed-off tab", async () => {
    const h = await setup();
    try {
      const session = await h.open("personal");
      expect(JSON.stringify(session)).not.toContain("secret");
      expect(h.worker).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "desktop-host",
          method: "open",
          input: expect.objectContaining({
            connectionUrl: "ws://127.0.0.1:9999/cdp?token=secret",
            inputMode: "instant",
            cursor: false,
            ignoreHttpsErrors: false,
          }),
        }),
      );
      await h.harness.behavior.callRpc("close", {
        threadId: "thread-test",
        sessionId: session.id,
      });
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
      ).toHaveLength(0);
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.releaseControl"),
      ).toHaveLength(1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("denies cross-thread RPC and CLI access before calling the worker", async () => {
    const h = await setup();
    try {
      const session = await h.open();
      await expect(
        h.harness.behavior.callRpc("run", {
          threadId: "other",
          sessionId: session.id,
          args: ["snapshot"],
        }),
      ).rejects.toThrow();
      const denied = await h.harness.behavior.runCli(
        ["run", session.id, "--thread", "thread-test", "--", "snapshot"],
        { threadId: "other" },
      );
      expect(denied.exitCode).toBe(1);
      expect(denied.stderr).toContain("another thread");
      expect(
        h.worker.mock.calls.filter(([call]) => call.method === "run"),
      ).toHaveLength(0);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it.each(["thread.archived", "thread.deleted", "thread.failed"] as const)(
    "%s closes only the owning thread's sessions",
    async (event) => {
      const h = await setup();
      try {
        const session = await h.open("personal");
        const other = rpcContract.open.output.parse(
          await h.harness.behavior.callRpc("open", {
            threadId: "other",
            selection: { backend: "local", hostId: "local-host" },
          }),
        );
        await h.harness.behavior.emitThreadEvent("thread.idle", {
          thread: makeThreadResponse({ id: "thread-test" }),
          lastAssistantText: null,
        });
        expect(
          h.worker.mock.calls.filter(([call]) => call.method === "close"),
        ).toHaveLength(0);
        await h.harness.behavior.emitThreadEvent(event, {
          thread: makeThreadResponse({ id: "thread-test" }),
          error: null,
        });
        const own = rpcContract.list.output.parse(
          await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
        );
        const remaining = rpcContract.list.output.parse(
          await h.harness.behavior.callRpc("list", { threadId: "other" }),
        );
        expect(own.find((entry) => entry.id === session.id)?.state).toBe(
          "closed",
        );
        expect(remaining.find((entry) => entry.id === other.id)?.state).toBe(
          "ready",
        );
        expect(
          h.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
        ).toHaveLength(0);
      } finally {
        await h.harness.lifecycle.dispose();
      }
    },
  );
  it("concurrent stop and close leave the session closed", async () => {
    const h = await setup();
    try {
      const session = await h.open();
      const input = { threadId: "thread-test", sessionId: session.id };
      await Promise.all([
        h.harness.behavior.callRpc("stop", input),
        h.harness.behavior.callRpc("close", input),
      ]);
      const sessions = rpcContract.list.output.parse(
        await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
      );
      expect(sessions.find((entry) => entry.id === session.id)?.state).toBe(
        "closed",
      );
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("waits for the browser host to finish installing the runtime before opening", async () => {
    const h = await setup();
    try {
      let polls = 0;
      h.worker.mockImplementation(async ({ method }) => {
        if (method === "prepare")
          return ++polls < 3
            ? { status: "installing", detail: `step ${polls}` }
            : ready;
        return method === "open"
          ? { cursor: { enabled: true, detail: null } }
          : null;
      });
      await h.open();
      const methods = h.worker.mock.calls.map(([call]) => call.method);
      expect(methods.filter((method) => method === "prepare")).toHaveLength(3);
      // Desktop sessions attach to BB's browser, so the host skips Chrome.
      expect(
        h.worker.mock.calls.find(([call]) => call.method === "prepare")![0],
      ).toMatchObject({ input: { chrome: false } });
      expect(methods.indexOf("open")).toBeGreaterThan(
        methods.lastIndexOf("prepare"),
      );
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("cleans up a newly created tab when worker launch fails", async () => {
    const h = await setup();
    try {
      h.worker.mockImplementation(async ({ method }) => {
        if (method === "open") throw new Error("failed startup");
        if (method === "prepare") return ready;
        return null;
      });
      await expect(h.open()).rejects.toThrow("failed startup");
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
      ).toHaveLength(1);
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.releaseControl"),
      ).toHaveLength(1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
});
describe("server agent-browser commands", () => {
  async function openLocal(h: Awaited<ReturnType<typeof setup>>) {
    return rpcContract.open.output.parse(
      await h.harness.behavior.callRpc("open", {
        threadId: "thread-test",
        selection: { backend: "local", hostId: "local-host" },
      }),
    );
  }
  it("relays agent-browser's own output, and wraps it only for --json", async () => {
    const h = await setup();
    try {
      const session = await openLocal(h);
      h.worker.mockResolvedValueOnce({
        output: { text: '- button "Save" [ref=e2]', images: [], exitCode: 0 },
        cursor: on,
      });
      const plain = await h.harness.behavior.runCli(
        ["run", session.id, "--timeout-ms", "90000", "--", "snapshot", "-i"],
        { threadId: "thread-test" },
      );
      expect(plain).toMatchObject({
        exitCode: 0,
        stdout: '- button "Save" [ref=e2]',
      });
      expect(h.worker).toHaveBeenLastCalledWith(
        expect.objectContaining({
          hostId: "local-host",
          method: "run",
          input: {
            sessionId: session.id,
            args: ["snapshot", "-i"],
            timeoutMs: 90_000,
          },
        }),
      );
      h.worker.mockResolvedValueOnce({
        output: { text: "✗ Unknown ref: e9", images: [], exitCode: 1 },
        cursor: on,
      });
      const failed = await h.harness.behavior.runCli(
        ["run", session.id, "click", "@e9"],
        { threadId: "thread-test" },
      );
      expect(failed).toMatchObject({
        exitCode: 1,
        stderr: "✗ Unknown ref: e9",
      });
      const wrapped = await h.harness.behavior.runCli(
        ["run", session.id, "--json", "--", "get", "url"],
        { threadId: "thread-test" },
      );
      expect(JSON.parse(wrapped.stdout)).toEqual({
        text: "done",
        images: [],
        exitCode: 0,
        hostId: "local-host",
      });
      const sessions = rpcContract.list.output.parse(
        await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
      );
      expect(sessions[0]?.state).toBe("ready");
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("refuses guarded commands over RPC and the CLI before calling the worker", async () => {
    const h = await setup();
    try {
      const session = await openLocal(h);
      await expect(
        h.harness.behavior.callRpc("run", {
          threadId: "thread-test",
          sessionId: session.id,
          args: ["record", "stop"],
        }),
      ).rejects.toThrow("bb agent-browser recording");
      const denied = await h.harness.behavior.runCli(
        ["run", session.id, "--", "open", "https://x.test", "--headed"],
        { threadId: "thread-test" },
      );
      expect(denied.exitCode).toBe(1);
      expect(denied.stderr).toContain("--headed");
      expect(
        h.worker.mock.calls.filter(([call]) => call.method === "run"),
      ).toHaveLength(0);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("stops the session when the host runtime fails", async () => {
    const h = await setup();
    try {
      const session = await openLocal(h);
      h.worker.mockRejectedValueOnce(new Error("daemon exited"));
      const result = await h.harness.behavior.runCli(
        ["run", session.id, "--", "snapshot"],
        { threadId: "thread-test" },
      );
      expect(result).toMatchObject({ exitCode: 1, stderr: "daemon exited" });
      const sessions = rpcContract.list.output.parse(
        await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
      );
      expect(sessions[0]?.state).toBe("stopped");
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("returns the finished recording take with its host", async () => {
    const h = await setup();
    try {
      const session = await openLocal(h);
      const recording = {
        path: "/tmp/ab-x/recordings/take-1.webm",
        mimeType: "video/webm",
        bytes: 4096,
      };
      h.worker.mockResolvedValueOnce({ recording, detail: null });
      const result = await h.harness.behavior.runCli(
        ["recording", session.id],
        { threadId: "thread-test" },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        ...recording,
        hostId: "local-host",
      });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("records why a session has no cursor and answers recording without the worker", async () => {
    const h = await setup();
    try {
      h.worker.mockImplementation(async ({ method }) =>
        method === "prepare"
          ? ready
          : method === "open"
            ? { cursor: { enabled: false, detail: "ffmpeg not found on PATH" } }
            : null,
      );
      const opened = await h.harness.behavior.runCli(
        ["open", "--machine", "local-host", "--input-mode", "smooth"],
        { threadId: "thread-test" },
      );
      const session = JSON.parse(opened.stdout);
      expect(session).toMatchObject({
        inputMode: "smooth",
        cursor: false,
        cursorDetail: "ffmpeg not found on PATH",
      });
      const result = await h.harness.behavior.runCli(
        ["recording", session.id],
        { threadId: "thread-test" },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("ffmpeg not found on PATH");
      expect(
        h.worker.mock.calls.filter(([call]) => call.method === "recording"),
      ).toHaveLength(0);
      const sessions = rpcContract.list.output.parse(
        await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
      );
      expect(sessions[0]?.state).toBe("ready");
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("records a cursor that starts after the first page", async () => {
    const h = await setup();
    try {
      h.worker.mockImplementation(async ({ method }) =>
        method === "prepare"
          ? ready
          : method === "open"
            ? { cursor: { enabled: false, detail: "screenshot timed out" } }
            : method === "run"
              ? {
                  output: { text: "✓ Example", images: [], exitCode: 0 },
                  cursor: on,
                }
              : null,
      );
      const session = await openLocal(h);
      expect(session).toMatchObject({
        cursor: false,
        cursorDetail: "screenshot timed out",
      });
      await h.harness.behavior.runCli(
        ["run", session.id, "--", "open", "https://example.com"],
        { threadId: "thread-test" },
      );
      const sessions = rpcContract.list.output.parse(
        await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
      );
      expect(sessions[0]).toMatchObject({ cursor: true, cursorDetail: null });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("passes open options to the host", async () => {
    const h = await setup();
    try {
      await h.harness.behavior.runCli(
        ["open", "--machine", "local-host", "--cursor", "--ignore-https-errors"],
        { threadId: "thread-test" },
      );
      expect(
        h.worker.mock.calls.find(([call]) => call.method === "open")![0],
      ).toMatchObject({
        hostId: "local-host",
        input: {
          inputMode: "human",
          cursor: true,
          ignoreHttpsErrors: true,
          idleTimeoutMs: 300_000,
        },
      });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
});
describe("server live preview", () => {
  const frame = {
    sequence: 7,
    mimeType: "image/jpeg" as const,
    data: Buffer.from("jpeg-bytes").toString("base64"),
    width: 1280,
    height: 720,
    url: "https://example.test/cart",
    title: "Cart",
  };
  async function openLocal(
    h: Awaited<ReturnType<typeof setup>>,
    threadId = "thread-test",
  ) {
    return rpcContract.open.output.parse(
      await h.harness.behavior.callRpc("open", {
        threadId,
        selection: { backend: "local", hostId: "local-host" },
      }),
    );
  }
  it("long-polls the browser host for headless frames only", async () => {
    const h = await setup();
    try {
      const desktop = await h.open();
      const local = await openLocal(h);
      h.worker.mockImplementation(async ({ method }) =>
        method === "preview" ? { frame } : null,
      );
      expect(
        await h.harness.behavior.callRpc("preview", {
          threadId: "thread-test",
          sessionId: local.id,
          afterSequence: 6,
          size: "full",
        }),
      ).toEqual({ session: local, frame });
      expect(h.worker).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "local-host",
          method: "preview",
          input: {
            sessionId: local.id,
            afterSequence: 6,
            waitMs: 5_000,
            size: "full",
          },
        }),
      );
      expect(
        await h.harness.behavior.callRpc("preview", {
          threadId: "thread-test",
          sessionId: desktop.id,
        }),
      ).toEqual({ session: desktop, frame: null });
      await expect(
        h.harness.behavior.callRpc("preview", {
          threadId: "other",
          sessionId: local.id,
        }),
      ).rejects.toThrow();
      await h.harness.behavior.callRpc("close", {
        threadId: "thread-test",
        sessionId: local.id,
      });
      expect(
        await h.harness.behavior.callRpc("preview", {
          threadId: "thread-test",
          sessionId: local.id,
        }),
      ).toMatchObject({ session: { state: "closed" }, frame: null });
      expect(
        h.worker.mock.calls.filter(([call]) => call.method === "preview"),
      ).toHaveLength(1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("hands agents an inline preview directive for headless sessions only", async () => {
    const h = await setup();
    try {
      const local = await h.harness.behavior.runCli(
        ["open", "--machine", "local-host"],
        { threadId: "thread-test" },
      );
      expect(local.exitCode).toBe(0);
      const opened = JSON.parse(local.stdout);
      expect(opened.previewDirective).toBe(
        `::agent-browser-preview{session="${opened.id}"}`,
      );
      expect(opened).toMatchObject({ backend: "local", inputMode: "instant" });
      expect(
        h.worker.mock.calls.find(([call]) => call.method === "prepare")![0],
      ).toMatchObject({ hostId: "local-host", input: { chrome: true } });
      const desktop = await h.harness.behavior.runCli(
        ["open", "--machine", "desktop-host", "--desktop", "desktop"],
        { threadId: "thread-test" },
      );
      expect(desktop.exitCode).toBe(0);
      expect(JSON.parse(desktop.stdout)).not.toHaveProperty("previewDirective");
      const agent = await h.harness.behavior.resolveAgentConfiguration(
        makePluginAgentConfigurationContext(),
      );
      expect(agent.skills).toEqual(["agent-browser"]);
      expect(agent.instructions).toMatch(/previewDirective.*exactly once/);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("describes the live frame through the CLI without image bytes", async () => {
    const h = await setup();
    try {
      const local = await openLocal(h);
      h.worker.mockImplementation(async ({ method }) =>
        method === "preview" ? { frame } : null,
      );
      const result = await h.harness.behavior.runCli(
        ["preview", local.id, "--after", "6"],
        { threadId: "thread-test" },
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain(frame.data);
      expect(JSON.parse(result.stdout)).toEqual({
        session: local,
        frame: {
          sequence: 7,
          mimeType: "image/jpeg",
          width: 1280,
          height: 720,
          url: frame.url,
          title: "Cart",
          bytes: 10,
        },
      });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
});
