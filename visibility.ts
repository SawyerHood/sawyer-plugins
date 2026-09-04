export const MIKU_VISIBILITY_STORAGE_KEY = "bb-plugin-miku:visible";

const MIKU_VISIBILITY_EVENT = "bb-plugin-miku:visibility-change";

type VisibilityStorage = Pick<Storage, "getItem" | "setItem">;

export function decodeMikuVisibility(value: string | null): boolean {
  return value !== "hidden";
}

function browserStorage(): VisibilityStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMikuVisibility(
  storage: VisibilityStorage | null = browserStorage(),
): boolean {
  if (storage === null) return true;
  try {
    return decodeMikuVisibility(storage.getItem(MIKU_VISIBILITY_STORAGE_KEY));
  } catch {
    return true;
  }
}

export function setMikuVisibility(
  visible: boolean,
  storage: VisibilityStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(MIKU_VISIBILITY_STORAGE_KEY, visible ? "visible" : "hidden");
  } catch {
    // Storage can be unavailable; the in-page event still updates the overlay.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MIKU_VISIBILITY_EVENT, { detail: { visible } }),
    );
  }
}

export function toggleMikuVisibility(): boolean {
  const visible = !readMikuVisibility();
  setMikuVisibility(visible);
  return visible;
}

export function subscribeToMikuVisibility(
  listener: (visible: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onVisibilityChange = (event: Event) => {
    const detail = (event as CustomEvent<{ visible?: unknown }>).detail;
    if (typeof detail?.visible === "boolean") listener(detail.visible);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === MIKU_VISIBILITY_STORAGE_KEY) {
      listener(decodeMikuVisibility(event.newValue));
    }
  };

  window.addEventListener(MIKU_VISIBILITY_EVENT, onVisibilityChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MIKU_VISIBILITY_EVENT, onVisibilityChange);
    window.removeEventListener("storage", onStorage);
  };
}
