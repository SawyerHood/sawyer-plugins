import { randomUUID } from "node:crypto";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostContract,
  rpcContract,
  sessionSchema,
  type PreviewOutput,
  type RecordingOutput,
  type RunOutput,
  type Session,
} from "./contracts.js";
import { parseCli, commands, type CliMethod } from "./cli.js";
import { checkArgs } from "./guard.js";
import { previewDirective } from "./preview-directive.js";

const desktopSchema = z
  .object({
    hostId: z.string(),
    instanceId: z.string(),
    generation: z.string(),
    threadId: z.string(),
    leaseId: z.string(),
    tabId: z.string(),
    owned: z.boolean(),
    profileId: z.string().nullable(),
  })
  .strict();
const recordSchema = z
  .object({
    session: sessionSchema,
    desktop: desktopSchema.nullable(),
    lastUsed: z.number(),
    cleanupPending: z.boolean(),
  })
  .strict();
type RecordEntry = z.infer<typeof recordSchema>;
const ttlMs = 30 * 60_000;
const idleTimeoutMs = 5 * 60_000;
const previewWaitMs = 5_000;
const keyFor = (threadId: string, sessionId: string) =>
  `sessions/${encodeURIComponent(threadId)}/${sessionId}`;

export default async function agentBrowserPlugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const desktop = bb.sdk.experimental_desktopBrowsers;
  const active = new Map<string, RecordEntry>();
  const busy = new Map<string, number>();
  const pending = new Set<Promise<void>>();
  const cleanup = new Map<string, Promise<Session>>();
  const subscriptions = new Map<string, { dispose(): void }>();
  const lifecycle = new AbortController();
  const threadLifecycles = new Map<string, AbortController>();
  const save = (record: RecordEntry) =>
    bb.storage.kv.set(
      keyFor(record.session.threadId, record.session.id),
      record,
    );
  async function owned(threadId: string, sessionId: string) {
    const record = recordSchema.parse(
      await bb.storage.kv.get(keyFor(threadId, sessionId)),
    );
    if (record.session.threadId !== threadId || record.session.id !== sessionId)
      throw new Error("Session does not belong to this thread");
    return active.get(sessionId) ?? record;
  }
  async function finish(record: RecordEntry, state: "stopped" | "closed") {
    const existing = cleanup.get(record.session.id);
    if (existing) {
      await existing;
      return finish(record, state);
    }
    const previous = recordSchema.safeParse(
      await bb.storage.kv.get(
        keyFor(record.session.threadId, record.session.id),
      ),
    );
    const concurrent = cleanup.get(record.session.id);
    if (concurrent) {
      await concurrent;
      return finish(record, state);
    }
    if (
      previous.success &&
      previous.data.session.state === "closed" &&
      !previous.data.cleanupPending
    )
      return previous.data.session;
    const work = (async () => {
      const { session } = record;
      if (state === "closed") active.delete(session.id);
      else active.set(session.id, record);
      subscriptions.get(session.id)?.dispose();
      subscriptions.delete(session.id);
      session.state = state;
      record.cleanupPending = true;
      await save(record);
      const target = record.desktop;
      const scope = target
        ? {
            hostId: target.hostId,
            instanceId: target.instanceId,
            generation: target.generation,
            threadId: target.threadId,
          }
        : null;
      const results = await Promise.allSettled([
        host.call(
          "close",
          { sessionId: session.id },
          { hostId: session.hostId, signal: AbortSignal.timeout(10_000) },
        ),
        ...(target && scope
          ? [desktop.releaseControl({ ...scope, leaseId: target.leaseId })]
          : []),
      ]);
      if (state === "closed" && target?.owned && scope) {
        const tabs = await desktop.listTabs(scope);
        const ownedTabs = tabs.tabs.filter(
          (tab) =>
            tab.tabId === target.tabId ||
            (target.profileId !== null &&
              tab.profile.kind === "automation" &&
              tab.profile.id === target.profileId),
        );
        results.push(
          ...(await Promise.allSettled(
            ownedTabs.map((tab) =>
              desktop.closeTab({ ...scope, tabId: tab.tabId }),
            ),
          )),
        );
      }
      record.cleanupPending = results.some(
        (result) => result.status === "rejected",
      );
      await save(record);
      if (record.cleanupPending)
        bb.log.warn(
          `agent-browser cleanup on host ${session.hostId} incomplete; host expiry and lease revocation remain active.`,
        );
      return session;
    })();
    cleanup.set(record.session.id, work);
    try {
      return await work;
    } finally {
      cleanup.delete(record.session.id);
    }
  }
  for (const key of await bb.storage.kv.list("sessions/")) {
    const parsed = recordSchema.safeParse(await bb.storage.kv.get(key));
    if (!parsed.success) continue;
    if (parsed.data.session.state === "closed" && !parsed.data.cleanupPending)
      continue;
    await finish(parsed.data, "closed").catch(() =>
      bb.log.warn(
        "agent-browser restart cleanup will need the owning desktop to reconnect",
      ),
    );
  }
  async function open(
    input: z.output<typeof rpcContract.open.input>,
    signal: AbortSignal,
  ): Promise<Session> {
    let threadLifecycle = threadLifecycles.get(input.threadId);
    if (!threadLifecycle) {
      threadLifecycle = new AbortController();
      threadLifecycles.set(input.threadId, threadLifecycle);
    }
    signal = AbortSignal.any([signal, threadLifecycle.signal]);
    signal.throwIfAborted();
    await bb.sdk.threads.get({ threadId: input.threadId });
    if (active.size >= 64)
      throw new Error(
        "Browser session limit reached; close an existing session",
      );
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      threadId: input.threadId,
      hostId: input.selection.hostId,
      backend: input.selection.backend,
      state: "ready",
      inputMode: input.inputMode,
      cursor: false,
      cursorDetail: null,
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    const record: RecordEntry = {
      session,
      desktop: null,
      lastUsed: now,
      cleanupPending: false,
    };
    let connectionUrl: string | undefined;
    let created: {
      hostId: string;
      instanceId: string;
      generation: string;
      threadId: string;
      tabId: string;
    } | null = null;
    try {
      if (input.selection.backend === "desktop") {
        const selection = input.selection;
        const { instances } = await desktop.listInstances({
          hostId: selection.hostId,
        });
        const instance = instances.find(
          (candidate) => candidate.instanceId === selection.instanceId,
        );
        if (!instance)
          throw new Error(
            "Selected desktop is unavailable; choose a connected instance explicitly",
          );
        const scope = {
          hostId: selection.hostId,
          instanceId: instance.instanceId,
          generation: instance.generation,
          threadId: input.threadId,
        };
        let tabId = selection.tabId;
        let profileId: string | null = null;
        if (!tabId) {
          const result = await desktop.createTab({
            ...scope,
            url: "about:blank",
            presentation: "hidden",
          });
          tabId = result.tab.tabId;
          profileId =
            result.tab.profile.kind === "automation"
              ? result.tab.profile.id
              : null;
          created = { ...scope, tabId };
        }
        const lease = await desktop.acquireControl({
          ...scope,
          tabIds: [tabId],
          controllerLabel: "agent-browser",
          ttlMs,
          allowPersonal: selection.tabId !== undefined,
        });
        record.desktop = {
          ...scope,
          leaseId: lease.leaseId,
          tabId,
          owned: selection.tabId === undefined,
          profileId,
        };
        const connection = await desktop.openConnection({
          ...scope,
          leaseId: lease.leaseId,
        });
        if (connection.hostId !== scope.hostId)
          throw new Error(
            "Desktop connection returned a different execution host",
          );
        connectionUrl = connection.wsEndpoint;
        session.expiresAt = Math.min(
          session.expiresAt,
          lease.expiresAt,
          connection.expiresAt,
        );
      }
      await save(record);
      active.set(session.id, record);
      while (true) {
        const runtime = await host.call(
          "prepare",
          { chrome: connectionUrl === undefined },
          { hostId: session.hostId, signal },
        );
        if (runtime.status === "ready") break;
        bb.log.info(
          `agent-browser runtime on host ${session.hostId}: ${runtime.detail}`,
        );
      }
      const opened = await host.call(
        "open",
        {
          sessionId: session.id,
          ...(connectionUrl === undefined ? {} : { connectionUrl }),
          inputMode: input.inputMode,
          cursor: input.cursor,
          ignoreHttpsErrors: input.ignoreHttpsErrors,
          expiresAt: session.expiresAt,
          idleTimeoutMs,
        },
        { hostId: session.hostId, signal },
      );
      signal.throwIfAborted();
      session.cursor = opened.cursor.enabled;
      session.cursorDetail = opened.cursor.detail;
      await save(record);
      if (record.desktop) {
        const target = record.desktop;
        subscriptions.set(
          session.id,
          desktop.subscribe({
            hostId: target.hostId,
            instanceId: target.instanceId,
            generation: target.generation,
            threadId: target.threadId,
            onChange(result) {
              if (
                !result.tabs.some(
                  (tab) => tab.control?.leaseId === target.leaseId,
                )
              )
                void finish(record, "stopped").catch(() => {});
            },
            onError() {
              void finish(record, "stopped").catch(() => {});
            },
          }),
        );
      }
      return session;
    } catch (error) {
      await finish(record, "closed").catch(() => {});
      if (created && !record.desktop)
        await desktop.closeTab(created).catch(() => {});
      throw error;
    }
  }
  /**
   * Host work on a ready session. A thrown host error means the runtime is
   * gone, so the session stops; command failures come back as values.
   */
  async function work<T>(
    input: { threadId: string; sessionId: string },
    call: (record: RecordEntry) => Promise<T>,
  ): Promise<T> {
    const record = await owned(input.threadId, input.sessionId);
    if (
      record.session.state !== "ready" ||
      Date.now() >= record.session.expiresAt
    )
      throw new Error("Session stopped or expired; open a new session");
    busy.set(input.sessionId, (busy.get(input.sessionId) ?? 0) + 1);
    try {
      return await call(record);
    } catch (error) {
      await finish(record, "stopped");
      throw error;
    } finally {
      const remaining = (busy.get(input.sessionId) ?? 1) - 1;
      if (remaining > 0) busy.set(input.sessionId, remaining);
      else busy.delete(input.sessionId);
      const current = active.get(input.sessionId);
      if (current) {
        current.lastUsed = Date.now();
        await save(current);
      }
    }
  }
  function run(
    input: z.output<typeof rpcContract.run.input>,
    signal: AbortSignal,
  ): Promise<RunOutput> {
    checkArgs(input.args);
    return work(input, async (record) => {
      const { output, cursor } = await host.call(
        "run",
        {
          sessionId: input.sessionId,
          args: input.args,
          timeoutMs: input.timeoutMs,
        },
        { hostId: record.session.hostId, signal },
      );
      // The host starts a cursor that failed on open once a page has painted.
      record.session.cursor = cursor.enabled;
      record.session.cursorDetail = cursor.detail;
      return output;
    });
  }
  async function recording(
    input: z.output<typeof rpcContract.recording.input>,
    signal: AbortSignal,
  ): Promise<RecordingOutput> {
    const { session } = await owned(input.threadId, input.sessionId);
    if (session.state === "ready" && !session.cursor)
      return {
        recording: null,
        detail: `This session has no recording. ${session.cursorDetail ?? ""}`
          .trim()
          .slice(0, 400),
      };
    return work(input, (record) =>
      host.call(
        "recording",
        { sessionId: input.sessionId },
        { hostId: record.session.hostId, signal },
      ),
    );
  }
  async function preview(
    input: z.output<typeof rpcContract.preview.input>,
    signal: AbortSignal,
  ): Promise<PreviewOutput> {
    const { session } = await owned(input.threadId, input.sessionId);
    if (
      session.backend !== "local" ||
      session.state !== "ready" ||
      Date.now() >= session.expiresAt
    )
      return { session, frame: null };
    const { frame } = await host.call(
      "preview",
      {
        sessionId: session.id,
        afterSequence: input.afterSequence,
        waitMs: previewWaitMs,
        size: input.size,
      },
      { hostId: session.hostId, signal },
    );
    return { session, frame };
  }
  function handlers(
    signal: AbortSignal,
  ): PluginRpcHandlers<typeof rpcContract> {
    return {
      open: (input) => open(input, signal),
      async list({ threadId }) {
        const records = await Promise.all(
          (
            await bb.storage.kv.list(
              `sessions/${encodeURIComponent(threadId)}/`,
            )
          )
            .slice(-64)
            .map(
              async (key) =>
                recordSchema.parse(await bb.storage.kv.get(key)).session,
            ),
        );
        return records;
      },
      run: (input) => run(input, signal),
      screenshot: (input) =>
        work(input, (record) =>
          host.call(
            "screenshot",
            {
              sessionId: input.sessionId,
              full: input.full,
              annotate: input.annotate,
            },
            { hostId: record.session.hostId, signal },
          ),
        ),
      recording: (input) => recording(input, signal),
      preview: (input) => preview(input, signal),
      stop: async (input) =>
        finish(await owned(input.threadId, input.sessionId), "stopped"),
      close: async (input) =>
        finish(await owned(input.threadId, input.sessionId), "closed"),
    };
  }
  bb.rpc.register(rpcContract, handlers(lifecycle.signal));
  function dispatch(method: CliMethod, input: unknown, signal: AbortSignal) {
    const h = handlers(signal);
    switch (method) {
      case "open":
        return h.open(rpcContract.open.input.parse(input));
      case "list":
        return h.list(rpcContract.list.input.parse(input));
      case "run":
        return h.run(rpcContract.run.input.parse(input));
      case "screenshot":
        return h.screenshot(rpcContract.screenshot.input.parse(input));
      case "recording":
        return h.recording(rpcContract.recording.input.parse(input));
      case "preview":
        return h.preview(rpcContract.preview.input.parse(input));
      case "stop":
        return h.stop(rpcContract.stop.input.parse(input));
      case "close":
        return h.close(rpcContract.close.input.parse(input));
    }
  }
  bb.agents.configure(() => ({
    tools: [],
    skills: ["agent-browser"],
    instructions:
      "When `bb agent-browser open` returns a previewDirective, copy it into your next response exactly once as a standalone line before you continue working. Do not wrap it in backticks or a code fence, and do not invent or edit the session ID. The directive shows the user a live view of that headless browser in BB chat. Desktop sessions return no directive.",
  }));
  bb.cli.register({
    name: "agent-browser",
    summary:
      "Thread-owned agent-browser sessions with a live preview, and an optional visible cursor and recording",
    commands,
    async run(argv, context) {
      try {
        const parsed = parseCli(argv, context.threadId);
        const result = await dispatch(
          parsed.method,
          parsed.input,
          AbortSignal.any([
            context.signal ?? new AbortController().signal,
            lifecycle.signal,
          ]),
        );
        const hostId = async () =>
          (await owned(parsed.input.threadId, parsed.input.sessionId!)).session
            .hostId;
        if (parsed.method === "open") {
          const session = rpcContract.open.output.parse(result);
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ...session,
              ...(session.backend === "local"
                ? { previewDirective: previewDirective(session.id) }
                : {}),
            }),
          };
        }
        if (parsed.method === "run" || parsed.method === "screenshot") {
          const output = rpcContract.run.output.parse(result);
          // `run` relays agent-browser's own output, which is already written
          // for agents; --json wraps it with the exit code and host.
          if (parsed.method === "run" && !parsed.json)
            return output.exitCode === 0
              ? { exitCode: 0, stdout: output.text }
              : { exitCode: output.exitCode, stderr: output.text };
          return {
            exitCode: output.exitCode,
            stdout: JSON.stringify({ ...output, hostId: await hostId() }),
          };
        }
        if (parsed.method === "recording") {
          const output = rpcContract.recording.output.parse(result);
          if (!output.recording)
            return {
              exitCode: 1,
              stderr: output.detail ?? "No recording is available",
            };
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ...output.recording,
              hostId: await hostId(),
            }),
          };
        }
        if (parsed.method === "preview") {
          const { session, frame } = rpcContract.preview.output.parse(result);
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              session,
              frame: frame && {
                sequence: frame.sequence,
                mimeType: frame.mimeType,
                width: frame.width,
                height: frame.height,
                url: frame.url,
                title: frame.title,
                bytes: Buffer.byteLength(frame.data, "base64"),
              },
            }),
          };
        }
        return { exitCode: 0, stdout: JSON.stringify(result) };
      } catch (error) {
        return {
          exitCode: 1,
          stderr:
            error instanceof Error ? error.message : "Browser command failed",
        };
      }
    },
  });
  for (const event of [
    "thread.archived",
    "thread.deleted",
    "thread.failed",
  ] as const) {
    bb.events.on(event, async ({ thread }) => {
      threadLifecycles.get(thread.id)?.abort();
      threadLifecycles.delete(thread.id);
      const results = await Promise.allSettled(
        [...active.values()]
          .filter((record) => record.session.threadId === thread.id)
          .map((record) => finish(record, "closed")),
      );
      if (results.some((result) => result.status === "rejected")) {
        bb.log.warn(
          `agent-browser cleanup for thread ${thread.id} needs its host to reconnect`,
        );
      }
    });
  }
  const timer = setInterval(() => {
    for (const record of active.values()) {
      if (
        Date.now() < record.session.expiresAt &&
        (busy.get(record.session.id) ||
          Date.now() - record.lastUsed < idleTimeoutMs)
      )
        continue;
      const work = finish(record, "closed").then(
        () => {},
        () => {},
      );
      pending.add(work);
      void work.finally(() => pending.delete(work));
    }
  }, 1000);
  timer.unref();
  host.experimental_onWorkerExit(async ({ hostId }) => {
    await Promise.all(
      [...active.values()]
        .filter((record) => record.session.hostId === hostId)
        .map((record) => finish(record, "closed")),
    );
  });
  bb.onDispose(async () => {
    lifecycle.abort();
    clearInterval(timer);
    await Promise.allSettled(
      [...active.values()].map((record) => finish(record, "closed")),
    );
    await Promise.allSettled(pending);
  });
}
