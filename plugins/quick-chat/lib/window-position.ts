// Title-bar dragging for the quick chat window. Until the user drags it, the
// window keeps its CSS corner placement; after that its top-left corner is
// remembered per browser and kept inside the viewport.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export interface WindowPosition {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const POSITION_STORAGE_KEY = "bb-plugin-quick-chat:window-position";
const VIEWPORT_MARGIN = 8;
/** Matches Tailwind's `max-sm`, where the window fills the screen instead. */
const COMPACT_QUERY = "(max-width: 639.98px)";

export function clampPosition(
  position: WindowPosition,
  size: Size,
  viewport: Size,
  margin = VIEWPORT_MARGIN,
): WindowPosition {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.min(Math.max(position.x, margin), maxX),
    y: Math.min(Math.max(position.y, margin), maxY),
  };
}

export function parseStoredPosition(value: string | null): WindowPosition | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Number.isFinite((parsed as WindowPosition).x) &&
      Number.isFinite((parsed as WindowPosition).y)
    ) {
      return { x: (parsed as WindowPosition).x, y: (parsed as WindowPosition).y };
    }
  } catch {
    // Fall through to the default placement.
  }
  return null;
}

interface Press {
  x: number;
  y: number;
  at: number;
}

const DOUBLE_PRESS_MS = 400;
const DOUBLE_PRESS_SLOP_PX = 4;

export function isDoublePress(previous: Press | null, current: Press): boolean {
  return (
    previous !== null &&
    current.at - previous.at <= DOUBLE_PRESS_MS &&
    Math.abs(current.x - previous.x) <= DOUBLE_PRESS_SLOP_PX &&
    Math.abs(current.y - previous.y) <= DOUBLE_PRESS_SLOP_PX
  );
}

function readStoredPosition(): WindowPosition | null {
  try {
    return parseStoredPosition(window.localStorage.getItem(POSITION_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storePosition(position: WindowPosition | null): void {
  try {
    if (position === null) window.localStorage.removeItem(POSITION_STORAGE_KEY);
    else window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Storage can be unavailable; the position simply won't survive a reload.
  }
}

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function useIsCompactViewport(): boolean {
  const [compact, setCompact] = useState(
    () => window.matchMedia(COMPACT_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return compact;
}

export function useDraggableWindow(windowRef: RefObject<HTMLElement | null>) {
  const compact = useIsCompactViewport();
  const [position, setPosition] = useState<WindowPosition | null>(
    readStoredPosition,
  );
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<WindowPosition | null>(null);
  const draggedPosition = useRef<WindowPosition | null>(null);
  const lastPress = useRef<Press | null>(null);

  const clampToWindow = useCallback(
    (next: WindowPosition) => {
      const element = windowRef.current;
      if (element === null) return next;
      const { width, height } = element.getBoundingClientRect();
      return clampPosition(next, { width, height }, viewportSize());
    },
    [windowRef],
  );

  // Keep a remembered position on screen after mount and on resize.
  useEffect(() => {
    if (compact || position === null) return;
    const reclamp = () =>
      setPosition((current) => (current === null ? null : clampToWindow(current)));
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [compact, position === null, clampToWindow]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (compact || event.button !== 0) return;
    if ((event.target as Element).closest("button, a, input, textarea")) return;
    // A second press soon after the first returns the window to its corner.
    // Detected here rather than with dblclick, which pointer capture can
    // swallow because mousedown and mouseup land on different elements.
    const previous = lastPress.current;
    lastPress.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    if (isDoublePress(previous, lastPress.current)) {
      lastPress.current = null;
      setPosition(null);
      storePosition(null);
      return;
    }
    const element = windowRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    dragOffset.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const offset = dragOffset.current;
    if (offset === null) return;
    const next = clampToWindow({
      x: event.clientX - offset.x,
      y: event.clientY - offset.y,
    });
    draggedPosition.current = next;
    setPosition(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragOffset.current === null) return;
    dragOffset.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    if (draggedPosition.current !== null) storePosition(draggedPosition.current);
    draggedPosition.current = null;
  };

  const style: CSSProperties | undefined =
    compact || position === null
      ? undefined
      : { left: position.x, top: position.y, right: "auto", bottom: "auto" };

  return {
    style,
    dragging,
    draggable: !compact,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
