import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  definePluginApp,
  useBbContext,
  useRealtime,
} from "@get-bb/plugin-sdk/app";
import {
  CompanionController,
  isMikuEvent,
  type MikuEvent,
  type SavedCompanionPosition,
} from "./companion";
import { CANVAS_HEIGHT, CANVAS_WIDTH, type SpriteFrame } from "./sprites";
import {
  readMikuVisibility,
  subscribeToMikuVisibility,
  toggleMikuVisibility,
} from "./visibility";
import "./app.css";

const ASSET_URL = "/api/v1/plugins/miku/http/assets/miku.png";
const EDGE_INSET_PX = 12;
const BUBBLE_SAFE_TOP_PX = 62;
const STORAGE_KEY = "bb-plugin-miku:position-v2";
const LEGACY_STORAGE_KEY = "bb-plugin-miku:position";

function readSavedPosition(): SavedCompanionPosition {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<SavedCompanionPosition>
      | null;
    if (
      value !== null &&
      typeof value.xRatio === "number" &&
      Number.isFinite(value.xRatio) &&
      typeof value.yRatio === "number" &&
      Number.isFinite(value.yRatio) &&
      (value.direction === -1 || value.direction === 1)
    ) {
      return {
        xRatio: Math.min(1, Math.max(0, value.xRatio)),
        yRatio: Math.min(1, Math.max(0, value.yRatio)),
        direction: value.direction,
      };
    }

    const legacy = JSON.parse(
      window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null",
    ) as { ratio?: unknown; direction?: unknown } | null;
    if (
      legacy !== null &&
      typeof legacy.ratio === "number" &&
      Number.isFinite(legacy.ratio) &&
      (legacy.direction === -1 || legacy.direction === 1)
    ) {
      return {
        xRatio: Math.min(1, Math.max(0, legacy.ratio)),
        yRatio: 0.78,
        direction: legacy.direction,
      };
    }
  } catch {
    // Storage is optional; a fresh starting point is perfectly fine.
  }
  return { xRatio: 0.12, yRatio: 0.78, direction: 1 };
}

function persistPosition(position: SavedCompanionPosition): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Private browsing and storage policies can make localStorage unavailable.
  }
}

/** Remove the source art's flat blue matte without modifying the original PNG. */
async function prepareSpriteSheet(signal: AbortSignal): Promise<HTMLCanvasElement> {
  const response = await fetch(ASSET_URL, { signal });
  if (!response.ok) throw new Error(`Miku sprite request failed (${response.status})`);

  const bitmap = await createImageBitmap(await response.blob());
  if (signal.aborted) {
    bitmap.close();
    throw new DOMException("Aborted", "AbortError");
  }

  const sheet = document.createElement("canvas");
  sheet.width = bitmap.width;
  sheet.height = bitmap.height;
  const context = sheet.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    bitmap.close();
    throw new Error("Miku needs Canvas 2D support");
  }

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pixels = context.getImageData(0, 0, sheet.width, sheet.height);
  const background = pixels.data.slice(0, 3);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const distance =
      Math.abs(pixels.data[index]! - background[0]!) +
      Math.abs(pixels.data[index + 1]! - background[1]!) +
      Math.abs(pixels.data[index + 2]! - background[2]!);
    if (distance <= 9) pixels.data[index + 3] = 0;
  }
  context.putImageData(pixels, 0, 0);
  return sheet;
}

function eventBelongsHere(event: MikuEvent, projectId: string | null): boolean {
  return !(
    event.projectId !== undefined &&
    projectId !== null &&
    event.projectId !== projectId
  );
}

function MikuOverlay() {
  const { projectId } = useBbContext();
  const [visible, setVisible] = useState(readMikuVisibility);
  const walkerRef = useRef<HTMLButtonElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const controllerRef = useRef<CompanionController | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useRealtime("companion-events", (payload) => {
    if (!isMikuEvent(payload) || !eventBelongsHere(payload, projectId)) return;
    controllerRef.current?.dispatch(payload);
  });

  useEffect(() => subscribeToMikuVisibility(setVisible), []);

  useEffect(() => {
    if (!visible) return;

    const walker = walkerRef.current;
    const sprite = spriteRef.current;
    const canvas = canvasRef.current;
    const bubble = bubbleRef.current;
    if (walker === null || sprite === null || canvas === null || bubble === null) {
      return;
    }

    const abortController = new AbortController();
    const { signal } = abortController;
    const context = canvas.getContext("2d");
    if (context === null) return () => abortController.abort();

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    context.imageSmoothingEnabled = false;

    const controller = new CompanionController(readSavedPosition());
    controllerRef.current = controller;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let previousTime = 0;
    let sheet: HTMLCanvasElement | null = null;
    let lastFrame: SpriteFrame | null = null;
    let lastBubble: string | null = null;

    const updateBounds = () => {
      controller.setBounds({
        minX: EDGE_INSET_PX,
        maxX: Math.max(
          EDGE_INSET_PX,
          window.innerWidth - walker.offsetWidth - EDGE_INSET_PX,
        ),
        minY: BUBBLE_SAFE_TOP_PX,
        maxY: Math.max(
          BUBBLE_SAFE_TOP_PX,
          window.innerHeight - walker.offsetHeight - EDGE_INSET_PX,
        ),
      });
    };

    const draw = (frame: SpriteFrame) => {
      if (sheet === null || frame === lastFrame) return;
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      const destinationX = Math.round((CANVAS_WIDTH - frame.width) / 2);
      const destinationY = CANVAS_HEIGHT - frame.height;
      context.drawImage(
        sheet,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        destinationX,
        destinationY,
        frame.width,
        frame.height,
      );
      lastFrame = frame;
    };

    const render = (elapsed: number) => {
      const snapshot = controller.tick(elapsed, reducedMotion.matches);
      walker.style.transform = `translate3d(${Math.round(snapshot.x)}px, ${Math.round(snapshot.y)}px, 0)`;
      walker.dataset.mode = snapshot.mode;
      walker.dataset.bubbleSide =
        snapshot.x + walker.offsetWidth / 2 > window.innerWidth / 2 ? "left" : "right";
      sprite.dataset.direction = snapshot.direction === 1 ? "right" : "left";
      if (snapshot.bubble !== lastBubble) {
        bubble.textContent = snapshot.bubble ?? "";
        bubble.dataset.visible = snapshot.bubble === null ? "false" : "true";
        lastBubble = snapshot.bubble;
      }
      draw(snapshot.frame);
    };

    const animate = (time: number) => {
      if (signal.aborted) return;
      if (previousTime === 0) previousTime = time;
      const elapsed = Math.min(64, time - previousTime);
      previousTime = time;
      render(elapsed);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const onResize = () => {
      updateBounds();
      render(0);
    };

    const onMotionPreferenceChange = () => render(0);

    updateBounds();
    render(0);
    window.addEventListener("resize", onResize, { signal });
    reducedMotion.addEventListener("change", onMotionPreferenceChange, { signal });

    void prepareSpriteSheet(signal)
      .then((prepared) => {
        if (signal.aborted) return;
        sheet = prepared;
        lastFrame = null;
        walker.dataset.ready = "true";
        render(0);
      })
      .catch((error: unknown) => {
        if (!signal.aborted) console.error("Could not prepare Miku's sprites", error);
      });

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      persistPosition(controller.savedPosition());
      controllerRef.current = null;
      abortController.abort();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [visible]);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || controllerRef.current === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    controllerRef.current.startDrag();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
      drag.moved = true;
    }
    controllerRef.current?.dragTo(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
    );
    event.preventDefault();
  };

  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    controllerRef.current?.endDrag();
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    suppressClickRef.current = false;
    controllerRef.current?.endDrag();
  };

  const greet = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    controllerRef.current?.dispatch({
      id: crypto.randomUUID(),
      type: "clicked",
      at: Date.now(),
    });
  };

  return visible ? (
    <div className="miku-overlay" aria-live="polite" aria-atomic="true">
      <button
        ref={walkerRef}
        className="miku-companion"
        type="button"
        aria-label="Hatsune Miku is exploring the app. Say hello."
        title="Say hi to Miku"
        data-bubble-side="right"
        onClick={greet}
        onPointerCancel={cancelDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
      >
        <span ref={bubbleRef} className="miku-bubble" data-visible="false" />
        <span ref={spriteRef} className="miku-sprite" data-direction="right">
          <canvas aria-hidden="true" ref={canvasRef} />
        </span>
        <span className="miku-shadow" aria-hidden="true" />
      </button>
    </div>
  ) : null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "walking-miku",
    component: MikuOverlay,
  });
  app.slots.commandPaletteAction({
    id: "toggle-miku-visibility",
    title: "Miku: toggle companion visibility",
    run: () => {
      toggleMikuVisibility();
    },
  });
});
