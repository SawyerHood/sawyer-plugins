import { afterEach, describe, expect, it, vi } from "vitest";
import { MikuVoicePlayer } from "./voice-player";
import { MikuVoiceService, readVoiceRequest, renderVoice, speechText } from "./voice-server";
import { MIKU_VOICE_STORAGE_KEY, readMikuVoice, setMikuVoice, subscribeToMikuVoice } from "./voice-preference";
import { CompanionController } from "./companion";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("voice preferences", () => {
  it("defaults off, persists mute, and preserves explicit voice opt-in", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readMikuVoice(storage)).toBe(false);
    expect(readMikuVoice(null)).toBe(false);
    expect(readMikuVoice({ ...storage, getItem: () => { throw new Error("blocked"); } })).toBe(false);
    values.set(MIKU_VOICE_STORAGE_KEY, "unknown");
    expect(readMikuVoice(storage)).toBe(false);
    setMikuVoice(false, storage);
    expect(values.get(MIKU_VOICE_STORAGE_KEY)).toBe("muted");
    expect(readMikuVoice(storage)).toBe(false);
    setMikuVoice(true, storage);
    expect(readMikuVoice(storage)).toBe(true);
  });

  it("remembers changes when browser storage throws", () => {
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    setMikuVoice(false, storage);
    expect(readMikuVoice(storage)).toBe(false);
    setMikuVoice(true, storage);
    expect(readMikuVoice(storage)).toBe(true);
  });

  it("returns to muted when another tab removes or clears the saved preference", () => {
    const windowEvents = new EventTarget();
    vi.stubGlobal("window", windowEvents);
    const listener = vi.fn();
    const unsubscribe = subscribeToMikuVoice(listener);
    try {
      for (const key of [MIKU_VOICE_STORAGE_KEY, null]) {
        windowEvents.dispatchEvent(Object.assign(new Event("storage"), {
          key: MIKU_VOICE_STORAGE_KEY, newValue: "speaking",
        }));
        expect(listener).toHaveBeenLastCalledWith(true);
        windowEvents.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: null }));
        expect(listener).toHaveBeenLastCalledWith(false);
        expect(readMikuVoice(null)).toBe(false);
      }
    } finally {
      unsubscribe();
    }
  });
});

describe("voice input and rendering", () => {
  it("cleans emoji and smart punctuation without interpreting command text", () => {
    expect(speechText("Let’s dance—yay! ♪ ✨")).toBe("Let's dance, yay!");
    expect(speechText("$(touch /tmp/nope); [voice]" )).toBe("$(touch /tmp/nope); [voice]");
  });

  it("rejects malformed, oversized, and non-speaking requests", async () => {
    for (const body of ["not json", JSON.stringify({ text: "…♪" }), JSON.stringify({ text: "x".repeat(181) }), "x".repeat(4097)]) {
      await expect(readVoiceRequest(new Request("http://test/voice", { method: "POST", body }))).rejects.toThrow();
    }
    await expect(readVoiceRequest(new Request("http://test/voice", { method: "POST", body: JSON.stringify({ text: "Good job!" }) }))).resolves.toBe("Good job!");
  });

  it("deduplicates renders, caches results, and refuses work after disposal", async () => {
    let finish!: (value: Buffer) => void;
    const render = vi.fn((_text: string, _signal: AbortSignal) => new Promise<Buffer>((resolve) => { finish = resolve; }));
    const service = new MikuVoiceService(render);
    const first = service.synthesize("Hello! ♪");
    const second = service.synthesize("Hello!");
    expect(render).toHaveBeenCalledTimes(1);
    const bytes = Buffer.alloc(100);
    finish(bytes);
    await expect(first).resolves.toBe(bytes);
    await expect(second).resolves.toBe(bytes);
    await expect(service.synthesize("Hello!")).resolves.toBe(bytes);
    expect(render).toHaveBeenCalledTimes(1);
    service.dispose();
    expect(render.mock.calls[0]![1].aborted).toBe(true);
    await expect(service.synthesize("Hello!")).rejects.toThrow("stopped");
  });

  it("bounds concurrent rendering and clears failed work for retries", async () => {
    const render = vi.fn(async () => { throw new Error("missing ffmpeg"); });
    const service = new MikuVoiceService(render);
    await expect(service.synthesize("Hi!")).rejects.toThrow("missing ffmpeg");
    await expect(service.synthesize("Hi!")).rejects.toThrow("missing ffmpeg");
    expect(render).toHaveBeenCalledTimes(2);
    const pending = new MikuVoiceService(() => new Promise(() => undefined));
    void pending.synthesize("One");
    void pending.synthesize("Two");
    await expect(pending.synthesize("Three")).rejects.toThrow("busy");
    service.dispose(); pending.dispose();
  });

  it.skipIf(process.env.MIKU_TEST_VOICE !== "1")("renders the selected voice as non-silent PCM on a configured server", async () => {
    const bytes = await renderVoice("Hey Sawyer! Your task is complete.", new AbortController().signal);
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.length).toBeGreaterThan(20_000);
    let offset = 12;
    while (offset + 8 < bytes.length && bytes.toString("ascii", offset, offset + 4) !== "data") {
      const length = bytes.readUInt32LE(offset + 4);
      offset += 8 + length + (length % 2);
    }
    let peak = 0;
    for (let i = offset + 8; i + 1 < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    expect(peak).toBeGreaterThan(500);
    expect(peak).toBeLessThan(32767);
  }, 20_000);
});

describe("bubble-synchronized playback", () => {
  function setup() {
    const hold = vi.fn();
    const errors = vi.fn();
    let finish!: () => void;
    const transport = { ready: vi.fn(() => true), play: vi.fn((_text: string, _signal: AbortSignal) => new Promise<void>((resolve) => { finish = resolve; })) };
    const player = new MikuVoicePlayer(transport, hold, errors);
    return { player, transport, hold, errors, finish: () => finish() };
  }

  it("speaks once per bubble ID, including repeated identical lines", async () => {
    const { player, transport, hold, finish } = setup();
    player.sync(1, "Hi!"); player.sync(1, "Hi!");
    expect(transport.play).toHaveBeenCalledTimes(1);
    expect(hold).toHaveBeenLastCalledWith(1, true);
    finish(); await vi.waitFor(() => expect(hold).toHaveBeenLastCalledWith(1, false));
    player.sync(2, "Hi!");
    expect(transport.play).toHaveBeenCalledTimes(2);
    player.stop();
  });

  it("does not speak thinking markers or muted messages, and mute aborts immediately", () => {
    const { player, transport, hold } = setup();
    player.sync(1, "…"); player.sync(2, "♪");
    expect(transport.play).not.toHaveBeenCalled();
    player.sync(3, "Done!");
    const signal = transport.play.mock.calls[0]![1];
    player.setEnabled(false);
    expect(signal.aborted).toBe(true);
    expect(hold).toHaveBeenLastCalledWith(3, false);
    player.sync(4, "Muted"); player.setEnabled(true); player.sync(4, "Muted");
    expect(transport.play).toHaveBeenCalledTimes(1);
    player.stop();
  });

  it("waits for browser audio permission without holding the bubble", () => {
    const { player, transport, hold } = setup();
    transport.ready.mockReturnValue(false);
    player.sync(1, "Hi!"); expect(hold).not.toHaveBeenCalled();
    transport.ready.mockReturnValue(true);
    player.sync(1, "Hi!"); expect(hold).toHaveBeenCalledWith(1, true);
    player.stop();
  });

  it("releases a failed or hung renderer without leaving a stuck bubble", async () => {
    const { player, transport, hold, errors } = setup();
    transport.play.mockRejectedValueOnce(new Error("failed"));
    player.sync(1, "Hi!");
    await vi.waitFor(() => expect(hold).toHaveBeenLastCalledWith(1, false));
    expect(errors).toHaveBeenCalledTimes(1);
    vi.useFakeTimers(); player.sync(2, "Waiting");
    vi.advanceTimersByTime(25_000);
    expect(hold).toHaveBeenLastCalledWith(2, false);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("keeps bubbles FIFO through long audio without freezing movement or frames", () => {
    const controller = new CompanionController({ xRatio: 0.5, yRatio: 0.5, direction: 1 }, () => 0);
    controller.setBounds({ minX: 0, maxX: 5000, minY: 0, maxY: 4000 });
    controller.dispatch({ id: "one", at: 1, type: "brain-comment", speech: "First!" });
    const first = controller.tick(0, false);
    controller.holdSpeech(first.speechId, true);
    controller.dispatch({ id: "two", at: 2, type: "brain-comment", speech: "Next!" });
    const frames = new Set();
    for (let i = 0; i < 200; i++) frames.add(controller.tick(64, false).frame);
    const later = controller.tick(0, false);
    expect(later.bubble).toBe("First!");
    expect(later.x).not.toBe(first.x);
    expect(frames.size).toBeGreaterThan(2);
    controller.holdSpeech(first.speechId, false);
    for (let i = 0; i < 25; i++) controller.tick(64, false);
    expect(controller.tick(0, false).bubble).toBe("Next!");
    controller.holdSpeech(first.speechId, true); // Stale audio cannot hold the next line.
    for (let i = 0; i < 160; i++) controller.tick(64, false);
    expect(controller.tick(0, false).bubble).toBeNull();
  });
});
