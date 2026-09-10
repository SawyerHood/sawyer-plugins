export interface VoiceTransport {
  ready(): boolean;
  play(text: string, signal: AbortSignal): Promise<void>;
}

/** The bubble queue owns ordering; audio only speaks the currently visible item. */
export class MikuVoicePlayer {
  private enabled = true;
  private seenId = -1;
  private active: { id: number; abort: AbortController; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private transport: VoiceTransport,
    private hold: (id: number, held: boolean) => void,
    private onError: (error: unknown) => void,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  sync(id: number, text: string | null): void {
    if (this.active && (this.active.id !== id || text === null)) this.stop();
    if (this.seenId === id) return;
    if (!this.enabled || text === null || !/[a-z0-9]/i.test(text)) {
      this.seenId = id;
      return;
    }
    if (!this.transport.ready()) return;
    this.seenId = id;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      if (this.active?.abort === abort) {
        this.stop();
        this.onError(new Error("Miku's voice timed out; keeping this comment text-only."));
      }
    }, 25_000);
    this.active = { id, abort, timer };
    this.hold(id, true);
    void this.transport.play(text, abort.signal).catch((error: unknown) => {
      if (!abort.signal.aborted) this.onError(error);
    }).finally(() => {
      if (this.active?.abort === abort) this.stop();
    });
  }

  stop(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    clearTimeout(active.timer);
    active.abort.abort();
    this.hold(active.id, false);
  }
}

export class BrowserVoiceTransport implements VoiceTransport {
  private context: AudioContext | null = null;

  /** Must be called directly from a user gesture for browser audio policies. */
  unlock(): void {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
    } catch { /* Text remains available if Web Audio is unsupported. */ }
  }

  ready(): boolean { return this.context?.state === "running"; }

  async play(text: string, signal: AbortSignal): Promise<void> {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const response = await fetch("/api/v1/plugins/miku/http/voice", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }), signal,
    });
    if (!response.ok) {
      throw new Error("Miku's voice is unavailable. Check FFmpeg support on the BB server; bubbles still work.");
    }
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    if (signal.aborted) return;
    if (context.state !== "running") throw new Error("Click in BB to resume Miku's audio.");
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.7;
    source.connect(gain).connect(context.destination);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", cancel);
        source.onended = null;
        source.disconnect();
        gain.disconnect();
      };
      const finish = () => { cleanup(); resolve(); };
      const cancel = () => {
        try { source.stop(); } catch { /* The source may already have ended. */ }
        finish();
      };
      source.onended = finish;
      signal.addEventListener("abort", cancel, { once: true });
      try { source.start(); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  dispose(): void {
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }
}
