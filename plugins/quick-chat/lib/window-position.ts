// Title-bar dragging for the quick chat window. Until the user drags it, the
// window keeps its CSS corner placement. A dropped window is anchored to its
// nearest horizontal and vertical edges, so resizing the browser keeps it the
// same distance from that corner instead of leaving it floating mid-screen.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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

export interface WindowAnchor {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
  /** Distance from the `horizontal` edge. */
  x: number;
  /** Distance from the `vertical` edge. */
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const ANCHOR_STORAGE_KEY = "bb-plugin-quick-chat:window-anchor";
const VIEWPORT_MARGIN = 8;
/** The resting distance from an edge; matches the default `bottom-4 right-4`. */
export const EDGE_GAP = 16;
/** Dropping the window this close to an edge locks it at `EDGE_GAP`. */
export const SNAP_DISTANCE = 32;
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

function snapToEdge(distance: number): number {
  return distance <= SNAP_DISTANCE ? EDGE_GAP : Math.round(distance);
}

/** Anchors a dropped top-left position to the edges nearest its center. */
export function anchorFromPosition(
  position: WindowPosition,
  size: Size,
  viewport: Size,
): WindowAnchor {
  const right = viewport.width - position.x - size.width;
  const bottom = viewport.height - position.y - size.height;
  const horizontal =
    position.x + size.width / 2 < viewport.width / 2 ? "left" : "right";
  const vertical =
    position.y + size.height / 2 < viewport.height / 2 ? "top" : "bottom";
  return {
    horizontal,
    vertical,
    x: snapToEdge(horizontal === "left" ? position.x : right),
    y: snapToEdge(vertical === "top" ? position.y : bottom),
  };
}

/** Pulls an anchor in when the viewport is too small for its offsets. */
export function clampAnchor(
  anchor: WindowAnchor,
  size: Size,
  viewport: Size,
  margin = VIEWPORT_MARGIN,
): WindowAnchor {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    ...anchor,
    x: Math.min(Math.max(anchor.x, margin), maxX),
    y: Math.min(Math.max(anchor.y, margin), maxY),
  };
}

export function anchorStyle(anchor: WindowAnchor): CSSProperties {
  return {
    left: anchor.horizontal === "left" ? anchor.x : "auto",
    right: anchor.horizontal === "right" ? anchor.x : "auto",
    top: anchor.vertical === "top" ? anchor.y : "auto",
    bottom: anchor.vertical === "bottom" ? anchor.y : "auto",
  };
}

export function parseStoredAnchor(value: string | null): WindowAnchor | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as Partial<WindowAnchor> | null;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed.horizontal === "left" || parsed.horizontal === "right") &&
      (parsed.vertical === "top" || parsed.vertical === "bottom") &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return {
        horizontal: parsed.horizontal,
        vertical: parsed.vertical,
        x: parsed.x as number,
        y: parsed.y as number,
      };
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

function readStoredAnchor(): WindowAnchor | null {
  try {
    return parseStoredAnchor(window.localStorage.getItem(ANCHOR_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeAnchor(anchor: WindowAnchor | null): void {
  try {
    if (anchor === null) window.localStorage.removeItem(ANCHOR_STORAGE_KEY);
    else window.localStorage.setItem(ANCHOR_STORAGE_KEY, JSON.stringify(anchor));
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

interface Layout {
  size: Size;
  viewport: Size;
}

export function useDraggableWindow(windowRef: RefObject<HTMLElement | null>) {
  const compact = useIsCompactViewport();
  // The user's chosen placement. Kept unclamped, so a window squeezed by a
  // small viewport returns to its offsets when the viewport grows again.
  const [anchor, setAnchor] = useState<WindowAnchor | null>(readStoredAnchor);
  // The live top-left position while a drag is in progress.
  const [dragPosition, setDragPosition] = useState<WindowPosition | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const dragOffset = useRef<WindowPosition | null>(null);
  const latestDragPosition = useRef<WindowPosition | null>(null);
  const lastPress = useRef<Press | null>(null);

  const measure = useCallback((): Layout | null => {
    const element = windowRef.current;
    if (element === null) return null;
    const { width, height } = element.getBoundingClientRect();
    return { size: { width, height }, viewport: viewportSize() };
  }, [windowRef]);

  useLayoutEffect(() => {
    const update = () => setLayout(measure());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [measure]);

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
      setAnchor(null);
      storeAnchor(null);
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
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const offset = dragOffset.current;
    const current = measure();
    if (offset === null || current === null) return;
    const next = clampPosition(
      { x: event.clientX - offset.x, y: event.clientY - offset.y },
      current.size,
      current.viewport,
    );
    latestDragPosition.current = next;
    setDragPosition(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragOffset.current === null) return;
    dragOffset.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const dropped = latestDragPosition.current;
    latestDragPosition.current = null;
    const current = measure();
    if (dropped !== null && current !== null) {
      const next = anchorFromPosition(dropped, current.size, current.viewport);
      setAnchor(next);
      storeAnchor(next);
    }
    setDragPosition(null);
  };

  let style: CSSProperties | undefined;
  if (compact) {
    style = undefined;
  } else if (dragPosition !== null) {
    style = { left: dragPosition.x, top: dragPosition.y, right: "auto", bottom: "auto" };
  } else if (anchor !== null) {
    style = anchorStyle(
      layout === null ? anchor : clampAnchor(anchor, layout.size, layout.viewport),
    );
  }

  return {
    style,
    dragging: dragPosition !== null,
    draggable: !compact,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
