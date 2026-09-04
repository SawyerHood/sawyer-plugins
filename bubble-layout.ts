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

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

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
