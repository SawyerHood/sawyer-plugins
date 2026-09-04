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
  arrowLeft: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function calculateBubbleLayout(input: BubbleLayoutInput): BubbleLayout {
  const anchorX = input.companionWidth / 2;
  const roomOnRight = input.viewportWidth - (input.companionX + anchorX);
  const roomOnLeft = input.companionX + anchorX;
  const placeOnRight =
    roomOnRight >= input.bubbleWidth + 8 || roomOnRight >= roomOnLeft;
  const idealLocalLeft = placeOnRight
    ? anchorX + 4
    : anchorX - input.bubbleWidth - 4;
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
  const arrowCenter = clamp(
    anchorX - localLeft,
    18,
    Math.max(18, input.bubbleWidth - 18),
  );

  return {
    localLeft,
    localTop,
    arrowLeft: arrowCenter - 6,
  };
}
