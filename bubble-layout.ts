export interface BubbleLayoutInput {
  companionX: number;
  companionY: number;
  companionWidth: number;
  bubbleWidth: number;
  bubbleHeight: number;
  viewportWidth: number;
  viewportMargin: number;
  anchorY: number;
}

export interface BubbleLayout {
  localLeft: number;
  localTop: number;
}

export type BubbleMotionMode = "walking" | "idle" | "reacting" | "dragging";

export interface BubbleAnchorInput {
  frameHeight: number;
  canvasHeight: number;
  renderedHeight: number;
  gap: number;
  mode: BubbleMotionMode;
}

// Walk and idle crops vary by a few pixels even though Miku's apparent body
// height is steady. A shared silhouette prevents that crop noise from moving
// the bubble on every animation frame.
const AMBIENT_SPRITE_HEIGHT = 64;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function calculateBubbleAnchorY(input: BubbleAnchorInput): number {
  const spriteHeight =
    input.mode === "walking" || input.mode === "idle"
      ? AMBIENT_SPRITE_HEIGHT
      : input.frameHeight;
  const renderedScale = input.renderedHeight / input.canvasHeight;
  return (input.canvasHeight - spriteHeight) * renderedScale - input.gap;
}

export function calculateBubbleLayout(input: BubbleLayoutInput): BubbleLayout {
  const anchorX = input.companionWidth / 2;
  const idealLocalLeft = anchorX - input.bubbleWidth / 2;
  const maximumViewportLeft = Math.max(
    input.viewportMargin,
    input.viewportWidth - input.bubbleWidth - input.viewportMargin,
  );
  const viewportLeft = clamp(
    input.companionX + idealLocalLeft,
    input.viewportMargin,
    maximumViewportLeft,
  );
  const localLeft = viewportLeft - input.companionX;
  const localTop = Math.max(
    input.viewportMargin - input.companionY,
    input.anchorY - input.bubbleHeight,
  );

  return {
    localLeft,
    localTop,
  };
}
