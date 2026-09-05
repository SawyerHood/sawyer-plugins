export const MIKU_WALKING_STORAGE_KEY = "bb-plugin-miku:walking-enabled";

const MIKU_WALKING_EVENT = "bb-plugin-miku:walking-change";

type MovementStorage = Pick<Storage, "getItem" | "setItem">;

export function decodeMikuWalking(value: string | null): boolean {
  return value !== "stationary";
}

function browserStorage(): MovementStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMikuWalking(
  storage: MovementStorage | null = browserStorage(),
): boolean {
  if (storage === null) return true;
  try {
    return decodeMikuWalking(storage.getItem(MIKU_WALKING_STORAGE_KEY));
  } catch {
    return true;
  }
}

export function setMikuWalking(
  walking: boolean,
  storage: MovementStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(
      MIKU_WALKING_STORAGE_KEY,
      walking ? "walking" : "stationary",
    );
  } catch {
    // Storage can be unavailable; the in-page event still updates the overlay.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MIKU_WALKING_EVENT, { detail: { walking } }),
    );
  }
}

export function toggleMikuWalking(): boolean {
  const walking = !readMikuWalking();
  setMikuWalking(walking);
  return walking;
}

export function subscribeToMikuWalking(
  listener: (walking: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onWalkingChange = (event: Event) => {
    const detail = (event as CustomEvent<{ walking?: unknown }>).detail;
    if (typeof detail?.walking === "boolean") listener(detail.walking);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === MIKU_WALKING_STORAGE_KEY) {
      listener(decodeMikuWalking(event.newValue));
    }
  };

  window.addEventListener(MIKU_WALKING_EVENT, onWalkingChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MIKU_WALKING_EVENT, onWalkingChange);
    window.removeEventListener("storage", onStorage);
  };
}
