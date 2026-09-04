import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BrainSelection } from "./brain-contract";
import type { MikuEventType } from "./companion";

export interface BrainConfig extends BrainSelection {
  enabled: boolean;
  threadId: string | null;
  autonomousMinutes: number;
}

export interface AppActivity {
  kind: string;
  summary: string;
  projectId?: string;
  threadId?: string;
}

export const DEFAULT_BRAIN_SELECTION: BrainSelection = {
  providerId: "codex",
  model: "gpt-5.6-sol",
  reasoningLevel: "low",
  serviceTier: "default",
  permissionMode: "auto",
};

const BATCH_WINDOW_MS = 1_000;
const MAX_BATCH_SIZE = 16;
const MAX_SUMMARY_LENGTH = 1_200;
const MAX_SPEECH_LENGTH = 180;
const BRAIN_TIMEOUT_MS = 120_000;

export const BRAIN_INTRO_PROMPT = `You are the voice of a tiny Hatsune Miku companion who lives in the BB agentic IDE.
You receive batches of real app activity. Reply with exactly one playful, useful speech-bubble line in Miku's voice, at most 140 characters. Mention concrete task or thread details when natural. Do not use Markdown, quotes, role labels, or a preamble. Never call tools or change files. If there is genuinely nothing worth saying, reply exactly [silent]. For this setup message, reply exactly [ready].`;

function cleanInline(value: string, limit: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1)}…`;
}

export function formatActivityBatch(activities: readonly AppActivity[]): string {
  const lines = activities.slice(0, MAX_BATCH_SIZE).map((activity, index) => {
    const scope = activity.threadId ? ` [thread ${activity.threadId}]` : "";
    return `${index + 1}. ${activity.kind}${scope}: ${cleanInline(activity.summary, MAX_SUMMARY_LENGTH)}`;
  });
  return `APP ACTIVITY BATCH (${lines.length} events)\n${lines.join("\n")}\n\nReply with one speech-bubble line. Use [silent] only if none of this is worth commenting on.`;
}

export function formatAutonomousPrompt(): string {
  return "PERIODIC CHECK-IN: Based on your memory of recent app activity, say one timely, short Miku-style line. Do not invent a specific event. Reply [silent] if there is nothing useful to add.";
}

export function sanitizeBrainSpeech(output: string | null): string | null {
  if (output === null) return null;
  let value = output.trim();
  if (/^\[(silent|ready)\][.!]?$/i.test(value)) return null;
  value = value
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(/\r?\n/)[0]!
    .replace(/^\s*(?:miku\s*:\s*)/i, "")
    .replace(/^(["'“”‘’])(.*)\1$/, "$2")
    .replace(/[*_`#]/g, "")
    .trim();
  if (value.length === 0 || /^\[(silent|ready)\]$/i.test(value)) return null;
  return value.length <= MAX_SPEECH_LENGTH
    ? value
    : `${value.slice(0, MAX_SPEECH_LENGTH - 1)}…`;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

export class MikuBrainCoordinator {
  private readonly queue: AppActivity[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private ambientTimer: ReturnType<typeof setInterval> | null = null;
  private signal: AbortSignal | null = null;
  private activeThreadId: string | null = null;
  private initialSend: Promise<void> | null = null;
  private lastAutonomousAt = Date.now();

  constructor(
    private readonly bb: BbPluginApi,
    private readonly getConfig: () => BrainConfig,
    private readonly publish: (
      type: MikuEventType,
      details?: { speech?: string },
    ) => void,
  ) {}

  enqueue(activity: AppActivity): boolean {
    const config = this.getConfig();
    if (!config.enabled || config.threadId === null || activity.threadId === config.threadId) {
      return false;
    }
    if (this.queue.length >= MAX_BATCH_SIZE) this.queue.shift();
    this.queue.push(activity);
    if (this.batchTimer === null) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null;
        void this.flushQueuedActivity();
      }, BATCH_WINDOW_MS);
    }
    return true;
  }

  async run(signal: AbortSignal): Promise<void> {
    this.signal = signal;
    this.lastAutonomousAt = Date.now();
    this.ambientTimer = setInterval(() => this.maybeCheckIn(), 30_000);
    await waitForAbort(signal);
    if (this.batchTimer !== null) clearTimeout(this.batchTimer);
    if (this.ambientTimer !== null) clearInterval(this.ambientTimer);
    this.batchTimer = null;
    this.ambientTimer = null;
    this.queue.length = 0;
    const threadId = this.activeThreadId;
    if (threadId !== null) {
      await this.bb.sdk.threads.stop({ threadId }).catch(() => undefined);
    }
  }

  private maybeCheckIn(): void {
    const config = this.getConfig();
    if (
      !config.enabled ||
      config.threadId === null ||
      config.autonomousMinutes <= 0 ||
      this.queue.length > 0
    ) {
      return;
    }
    const now = Date.now();
    if (now - this.lastAutonomousAt < config.autonomousMinutes * 60_000) return;
    this.lastAutonomousAt = now;
    void this.dispatchPrompt(formatAutonomousPrompt(), config);
  }

  private async flushQueuedActivity(): Promise<void> {
    if (this.queue.length === 0) return;
    const activities = this.queue.splice(0, this.queue.length);
    const config = this.getConfig();
    if (!config.enabled || config.threadId === null) return;
    this.lastAutonomousAt = Date.now();
    await this.dispatchPrompt(formatActivityBatch(activities), config);
  }

  private async dispatchPrompt(prompt: string, config: BrainConfig): Promise<void> {
    if (this.signal?.aborted) return;
    if (this.activeThreadId === config.threadId) {
      await this.steer(prompt, config);
      return;
    }
    if (this.activeThreadId !== null) {
      this.queue.push({ kind: "follow-up", summary: prompt });
      return;
    }
    await this.startResponse(prompt, config);
  }

  private selectionArgs(config: BrainConfig) {
    return {
      model: config.model,
      reasoningLevel: config.reasoningLevel,
      permissionMode: config.permissionMode,
      ...(config.serviceTier === null ? {} : { serviceTier: config.serviceTier }),
    };
  }

  private async steer(prompt: string, config: BrainConfig): Promise<void> {
    try {
      await this.initialSend;
      if (this.activeThreadId !== config.threadId || this.signal?.aborted) return;
      await this.bb.sdk.threads.send({
        threadId: config.threadId!,
        mode: "steer-if-active",
        input: [{ type: "text", text: prompt, mentions: [] }],
        ...this.selectionArgs(config),
      });
    } catch (error) {
      this.bb.log.warn(`Could not steer Miku's brain: ${String(error)}`);
    }
  }

  private async startResponse(prompt: string, config: BrainConfig): Promise<void> {
    const threadId = config.threadId!;
    this.activeThreadId = threadId;
    this.publish("brain-thinking");
    try {
      this.initialSend = this.bb.sdk.threads
        .send({
          threadId,
          mode: "start",
          input: [{ type: "text", text: prompt, mentions: [] }],
          ...this.selectionArgs(config),
        })
        .then(() => undefined);
      await this.initialSend;
      await this.bb.sdk.threads.wait({
        threadId,
        status: "idle",
        timeoutMs: BRAIN_TIMEOUT_MS,
        ...(this.signal === null ? {} : { signal: this.signal }),
      });
      const { output } = await this.bb.sdk.threads.output({ threadId });
      const speech = sanitizeBrainSpeech(output);
      const latest = this.getConfig();
      if (!latest.enabled || latest.threadId !== threadId) {
        this.publish("brain-dismiss");
      } else if (speech === null) {
        this.publish("brain-dismiss");
      } else {
        this.publish("brain-comment", { speech });
      }
    } catch (error) {
      if (!this.signal?.aborted) {
        this.bb.log.warn(`Miku's brain could not respond: ${String(error)}`);
        this.publish("brain-failed");
      }
    } finally {
      this.initialSend = null;
      this.activeThreadId = null;
      await this.bb.sdk.threads.stop({ threadId }).catch(() => undefined);
      if (this.queue.length > 0 && this.batchTimer === null) {
        this.batchTimer = setTimeout(() => {
          this.batchTimer = null;
          void this.flushQueuedActivity();
        }, BATCH_WINDOW_MS);
      }
    }
  }
}
