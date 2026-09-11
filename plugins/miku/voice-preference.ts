export const MIKU_VOICE_STORAGE_KEY = "bb-plugin-miku:voice-enabled";
const CHANGE_EVENT = "bb-plugin-miku:voice-change";
type VoiceStorage = Pick<Storage, "getItem" | "setItem">;
let sessionPreference: boolean | undefined;
let sessionOnly = false;

function browserStorage(): VoiceStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readMikuVoice(storage: VoiceStorage | null = browserStorage()): boolean {
  if (sessionOnly) return sessionPreference ?? false;
  try {
    if (storage) return storage.getItem(MIKU_VOICE_STORAGE_KEY) === "speaking";
  } catch { /* Keep the toggle usable when storage is blocked. */ }
  return sessionPreference ?? false;
}

export function setMikuVoice(enabled: boolean, storage: VoiceStorage | null = browserStorage()): void {
  sessionPreference = enabled;
  try {
    storage?.setItem(MIKU_VOICE_STORAGE_KEY, enabled ? "speaking" : "muted");
    sessionOnly = storage === null;
  } catch { sessionOnly = true; }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { enabled } }));
  }
}

export function toggleMikuVoice(): boolean {
  const enabled = !readMikuVoice();
  setMikuVoice(enabled);
  return enabled;
}

export function subscribeToMikuVoice(listener: (enabled: boolean) => void): () => void {
  const onChange = (event: Event) => {
    const enabled: unknown = (event as CustomEvent<{ enabled?: unknown }>).detail?.enabled;
    if (typeof enabled === "boolean") listener(enabled);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === MIKU_VOICE_STORAGE_KEY || event.key === null) {
      sessionPreference = event.newValue === "speaking";
      sessionOnly = false;
      listener(sessionPreference);
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
