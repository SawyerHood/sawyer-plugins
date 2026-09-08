import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const VOICE_FILTER =
  "rubberband=pitch=1.58:tempo=1.06,vibrato=f=5.5:d=0.22,chorus=0.7:0.85:22:0.18:0.8:1.4,volume=4dB";
const MAX_AUDIO_BYTES = 2_000_000;
const MAX_CACHE_ENTRIES = 24;

export function speechText(text: string): string {
  return text.normalize("NFKD")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[—–]/g, ", ").replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
}

function ffmpeg(input: Buffer, args: string[], signal: AbortSignal, cwd?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", ...args], {
      stdio: ["pipe", "pipe", "pipe"], signal, killSignal: "SIGKILL", cwd,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => child.kill("SIGKILL"), 8_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    // Do not log stderr: synthesis errors may repeat private bubble text.
    child.stderr.resume();
    child.stdin.on("error", () => undefined); // An early process exit can close stdin.
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Voice needs FFmpeg with Flite and Rubber Band on the BB server."));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || size > MAX_AUDIO_BYTES || size < 44) {
        reject(new Error("Voice rendering failed. Check the server's FFmpeg Flite and Rubber Band support."));
      } else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

/** Same two stages as audition 05. Text is file data, never shell/filter syntax. */
export async function renderVoice(text: string, signal: AbortSignal): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "bb-miku-voice-"));
  try {
    await writeFile(join(directory, "speech.txt"), text, { mode: 0o600 });
    const base = await ffmpeg(Buffer.alloc(0), [
      "-f", "lavfi", "-i", "flite=textfile=speech.txt:voice=slt",
      "-af", "loudnorm=I=-18:TP=-2:LRA=7", "-ar", "24000", "-f", "wav", "pipe:1",
    ], signal, directory);
    return await ffmpeg(base, [
      "-i", "pipe:0", "-af", VOICE_FILTER, "-ar", "24000", "-f", "wav", "pipe:1",
    ], signal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Bounded, memory-only cache; identical requests share one render across tabs. */
export class MikuVoiceService {
  private cache = new Map<string, Buffer>();
  private pending = new Map<string, Promise<Buffer>>();
  private abort = new AbortController();

  constructor(private render = renderVoice) {}

  async synthesize(input: string): Promise<Buffer> {
    if (this.abort.signal.aborted) throw new Error("Voice service stopped.");
    if (input.length > 180) throw new Error("Speech must be at most 180 characters.");
    const text = speechText(input);
    if (!/[a-z0-9]/i.test(text)) throw new Error("No speakable English text.");
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;
    const pending = this.pending.get(text);
    if (pending !== undefined) return pending;
    if (this.pending.size >= 2) throw new Error("Voice renderer is busy. This comment will stay text-only.");
    const job = this.render(text, this.abort.signal);
    this.pending.set(text, job);
    try {
      const bytes = await job;
      if (bytes.length > MAX_AUDIO_BYTES) throw new Error("Voice output was too large.");
      if (!this.abort.signal.aborted) {
        if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(text, bytes);
      }
      return bytes;
    } finally {
      this.pending.delete(text);
    }
  }

  dispose(): void {
    this.abort.abort();
    this.cache.clear();
  }
}

export async function readVoiceRequest(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing speech text.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        throw new Error("Speech request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof value !== "object" || value === null || !("text" in value) ||
      typeof value.text !== "string" || value.text.length > 180 || !/[a-z0-9]/i.test(speechText(value.text))) {
    throw new Error("Provide 1–180 characters of speakable English text.");
  }
  return value.text;
}
