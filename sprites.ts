export interface SpriteFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnimationStep {
  readonly frame: SpriteFrame;
  readonly durationMs: number;
}

export interface AnimationClip {
  readonly steps: readonly AnimationStep[];
  readonly loop: boolean;
}

const frame = (
  x: number,
  y: number,
  width: number,
  height: number,
): SpriteFrame => ({ x, y, width, height });

const TOP = [
  frame(2, 1, 53, 63),
  frame(61, 1, 52, 63),
  frame(119, 1, 53, 63),
  frame(179, 1, 52, 63),
  frame(242, 1, 49, 63),
  frame(301, 1, 51, 63),
  frame(360, 1, 51, 63),
  frame(420, 1, 51, 63),
  frame(478, 1, 51, 63),
  frame(535, 1, 51, 63),
  frame(592, 1, 53, 63),
  frame(651, 1, 52, 63),
  frame(709, 1, 53, 63),
  frame(769, 1, 52, 63),
  frame(832, 1, 49, 63),
  frame(891, 1, 51, 63),
  frame(950, 1, 51, 63),
  frame(1010, 1, 51, 63),
  frame(1068, 1, 51, 63),
  frame(1125, 1, 51, 63),
] as const;

const WALK = [
  frame(14, 66, 59, 59),
  frame(93, 68, 58, 64),
  frame(173, 68, 56, 64),
  frame(248, 69, 59, 63),
  frame(320, 66, 61, 61),
  frame(389, 67, 70, 64),
  frame(463, 68, 74, 63),
  frame(548, 69, 67, 62),
] as const;

const AIR = [
  frame(17, 176, 55, 54),
  frame(98, 165, 46, 66),
  frame(178, 165, 42, 66),
  frame(246, 166, 56, 65),
  frame(313, 164, 69, 67),
  frame(395, 135, 66, 96),
  frame(484, 134, 55, 97),
  frame(552, 155, 71, 75),
  frame(634, 175, 61, 55),
] as const;

const DANCE = [
  frame(18, 236, 62, 70),
  frame(84, 231, 75, 75),
  frame(181, 231, 58, 75),
  frame(260, 231, 86, 75),
  frame(346, 231, 78, 69),
  frame(430, 231, 76, 70),
  frame(516, 231, 69, 70),
  frame(609, 239, 60, 62),
] as const;

const FALL = [
  frame(3, 370, 58, 58),
  frame(87, 371, 66, 56),
  frame(178, 397, 79, 31),
] as const;

const REACTION = [
  frame(14, 432, 59, 64),
  frame(96, 431, 52, 65),
  frame(174, 428, 59, 68),
  frame(247, 428, 67, 68),
  frame(337, 434, 60, 62),
  frame(426, 433, 55, 63),
  frame(515, 432, 59, 64),
  frame(608, 431, 52, 65),
  frame(691, 434, 59, 62),
  frame(778, 434, 61, 62),
  frame(863, 434, 60, 62),
  frame(947, 433, 55, 63),
] as const;

const steps = (
  frames: readonly SpriteFrame[],
  durationMs: number,
): readonly AnimationStep[] => frames.map((item) => ({ frame: item, durationMs }));

export const ANIMATION_CLIPS = {
  "idle-static": { steps: steps([TOP[0]], 1_000), loop: true },
  "idle-blink": {
    steps: [
      { frame: TOP[0], durationMs: 720 },
      { frame: TOP[12], durationMs: 90 },
      { frame: TOP[13], durationMs: 120 },
      { frame: TOP[12], durationMs: 90 },
      { frame: TOP[1], durationMs: 620 },
    ],
    loop: true,
  },
  "idle-hum": {
    steps: [
      { frame: TOP[15], durationMs: 260 },
      { frame: TOP[16], durationMs: 180 },
      { frame: TOP[17], durationMs: 250 },
      { frame: TOP[18], durationMs: 180 },
      { frame: TOP[19], durationMs: 320 },
      { frame: TOP[17], durationMs: 220 },
    ],
    loop: true,
  },
  "idle-pose": {
    steps: [
      { frame: REACTION[0], durationMs: 420 },
      { frame: REACTION[1], durationMs: 500 },
      { frame: REACTION[2], durationMs: 420 },
      { frame: REACTION[1], durationMs: 500 },
    ],
    loop: true,
  },
  walk: { steps: steps(WALK, 110), loop: true },
  carried: {
    // Stay visibly airborne for as long as the pointer is held. Cycling the
    // jump frames here reads as repeated landing while the user is dragging.
    steps: [{ frame: FALL[0], durationMs: 1_000 }],
    loop: true,
  },
  landing: {
    steps: [
      { frame: AIR[8], durationMs: 160 },
      { frame: AIR[0], durationMs: 220 },
      { frame: REACTION[0], durationMs: 260 },
    ],
    loop: false,
  },
  attention: { steps: steps(AIR, 105), loop: false },
  celebrate: {
    steps: [...steps(DANCE, 105), ...steps(DANCE.slice(3, 7), 105)],
    loop: false,
  },
  pleased: {
    steps: [
      { frame: REACTION[2], durationMs: 180 },
      { frame: REACTION[3], durationMs: 260 },
      { frame: REACTION[4], durationMs: 500 },
      { frame: REACTION[3], durationMs: 240 },
    ],
    loop: false,
  },
  greeting: {
    steps: [
      { frame: REACTION[6], durationMs: 180 },
      { frame: REACTION[8], durationMs: 300 },
      { frame: REACTION[9], durationMs: 300 },
      { frame: REACTION[6], durationMs: 240 },
    ],
    loop: false,
  },
  patient: {
    steps: [
      { frame: TOP[3], durationMs: 380 },
      { frame: TOP[4], durationMs: 480 },
      { frame: TOP[5], durationMs: 380 },
      { frame: TOP[4], durationMs: 480 },
    ],
    loop: false,
  },
  stumble: {
    steps: [
      { frame: FALL[0], durationMs: 160 },
      { frame: FALL[1], durationMs: 220 },
      { frame: FALL[2], durationMs: 760 },
      { frame: FALL[0], durationMs: 260 },
      { frame: REACTION[0], durationMs: 260 },
    ],
    loop: false,
  },
} as const satisfies Record<string, AnimationClip>;

export type ClipId = keyof typeof ANIMATION_CLIPS;

export const CANVAS_WIDTH = 92;
export const CANVAS_HEIGHT = 102;

export function clipDuration(clipId: ClipId): number {
  return ANIMATION_CLIPS[clipId].steps.reduce(
    (total, step) => total + step.durationMs,
    0,
  );
}
