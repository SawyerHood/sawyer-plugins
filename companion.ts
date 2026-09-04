import {
  ANIMATION_CLIPS,
  clipDuration,
  type ClipId,
  type SpriteFrame,
} from "./sprites";

export type Direction = -1 | 1;

export type MikuEventType =
  | "thread-created"
  | "thread-active"
  | "thread-idle"
  | "thread-failed"
  | "thread-archived"
  | "interaction-pending"
  | "message-queued"
  | "message-dispatched"
  | "task-completed"
  | "brain-thinking"
  | "brain-comment"
  | "brain-dismiss"
  | "brain-failed"
  | "clicked";

export interface MikuEvent {
  id: string;
  type: MikuEventType;
  at: number;
  projectId?: string;
  threadId?: string;
  taskKey?: string;
  speech?: string;
}

export interface CompanionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SavedCompanionPosition {
  xRatio: number;
  yRatio: number;
  direction: Direction;
}

export interface CompanionSnapshot {
  x: number;
  y: number;
  direction: Direction;
  frame: SpriteFrame;
  mode: "walking" | "idle" | "reacting" | "dragging";
  bubble: string | null;
}

interface Point {
  x: number;
  y: number;
}

interface Reaction {
  event: MikuEvent;
  clip: ClipId;
  priority: number;
  speech: readonly string[];
}

const WALK_SPEED_PX_PER_SECOND = 58;
const MAX_REACTION_QUEUE = 6;
const MIN_SPEECH_DURATION_MS = 5_000;
const MAX_SPEECH_DURATION_MS = 10_000;
const IDLE_CLIPS: readonly ClipId[] = [
  "idle-blink",
  "idle-blink",
  "idle-hum",
  "idle-pose",
];

const EVENT_COOLDOWNS: Record<MikuEventType, number> = {
  "thread-created": 2_000,
  "thread-active": 3_000,
  "thread-idle": 3_000,
  "thread-failed": 5_000,
  "thread-archived": 2_000,
  "interaction-pending": 3_000,
  "message-queued": 4_000,
  "message-dispatched": 2_000,
  "task-completed": 800,
  "brain-thinking": 0,
  "brain-comment": 0,
  "brain-dismiss": 0,
  "brain-failed": 0,
  clicked: 450,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finiteRatio = (value: number): number =>
  Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;

export function isMikuEvent(value: unknown): value is MikuEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MikuEvent>;
  const types: readonly string[] = [
    "thread-created",
    "thread-active",
    "thread-idle",
    "thread-failed",
    "thread-archived",
    "interaction-pending",
    "message-queued",
    "message-dispatched",
    "task-completed",
    "brain-thinking",
    "brain-comment",
    "brain-dismiss",
    "brain-failed",
    "clicked",
  ];
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.type === "string" &&
    types.includes(candidate.type) &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at) &&
    (candidate.projectId === undefined || typeof candidate.projectId === "string") &&
    (candidate.threadId === undefined || typeof candidate.threadId === "string") &&
    (candidate.taskKey === undefined || typeof candidate.taskKey === "string") &&
    (candidate.speech === undefined ||
      (typeof candidate.speech === "string" && candidate.speech.length <= 180))
  );
}

function reactionFor(event: MikuEvent): Reaction {
  switch (event.type) {
    case "thread-created":
      return {
        event,
        clip: "greeting",
        priority: 25,
        speech: ["A fresh start! ♪", "New thread, new song!", "Let’s make something!"],
      };
    case "thread-active":
      return {
        event,
        clip: "attention",
        priority: 40,
        speech: ["Let’s do this! ♪", "I’m on it!", "Time to get to work!"],
      };
    case "thread-idle":
      return {
        event,
        clip: "pleased",
        priority: 60,
        speech: ["All done over here!", "That went nicely! ♪", "Ready for the next one!"],
      };
    case "thread-failed":
      return {
        event,
        clip: "stumble",
        priority: 100,
        speech: ["Oof… let’s try that again.", "That one tripped us up!", "I’ll recover!"],
      };
    case "thread-archived":
      return {
        event,
        clip: "greeting",
        priority: 20,
        speech: ["Filed away!", "Bye for now! ♪", "Into the archive it goes!"],
      };
    case "interaction-pending":
      return {
        event,
        clip: "attention",
        priority: 90,
        speech: ["I need your input!", "What do you think?", "Your turn! ♪"],
      };
    case "message-queued":
      return {
        event,
        clip: "patient",
        priority: 35,
        speech: ["I’ll hold that thought.", "Queued up!", "I can wait here ♪"],
      };
    case "message-dispatched":
      return {
        event,
        clip: "greeting",
        priority: 30,
        speech: ["Off it goes!", "Message sent! ♪", "Here we go!"],
      };
    case "task-completed":
      return {
        event,
        clip: "celebrate",
        priority: 80,
        speech: event.taskKey
          ? [`${event.taskKey} complete! ♪`, "Task complete—great job!", "Another one done!"]
          : ["Task complete! ♪", "Great job!", "Another one done!"],
      };
    case "brain-thinking":
      return {
        event,
        clip: "patient",
        priority: 95,
        speech: ["…"],
      };
    case "brain-comment":
      return {
        event,
        clip: "attention",
        priority: 100,
        speech: [event.speech ?? "♪"],
      };
    case "brain-dismiss":
      return {
        event,
        clip: "idle-blink",
        priority: 100,
        speech: [],
      };
    case "brain-failed":
      return {
        event,
        clip: "stumble",
        priority: 100,
        speech: ["My thoughts got tangled…"],
      };
    case "clicked":
      return {
        event,
        clip: "greeting",
        priority: 50,
        speech: ["Miku Miku! ♪", "Hi there!", "Need a little inspiration?", "You found me!"],
      };
  }
}

export class CompanionController {
  private readonly random: () => number;
  private bounds: CompanionBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private position: Point = { x: 0, y: 0 };
  private target: Point | null = null;
  private direction: Direction;
  private mode: "walking" | "idle" | "reacting" | "dragging" = "walking";
  private clipId: ClipId = "walk";
  private frameIndex = 0;
  private frameElapsed = 0;
  private stateRemaining = 0;
  private bubbleText: string | null = null;
  private bubbleRemaining = 0;
  private activeReactionType: MikuEventType | null = null;
  private reactionQueue: Reaction[] = [];
  private idleBag: ClipId[] = [];
  private lastIdleClip: ClipId | null = null;
  private clock = 0;
  private initialized = false;
  private readonly initialPosition: SavedCompanionPosition;
  private readonly lastEventAt = new Map<MikuEventType, number>();

  constructor(
    initialPosition: SavedCompanionPosition,
    random: () => number = Math.random,
  ) {
    this.initialPosition = {
      xRatio: finiteRatio(initialPosition.xRatio),
      yRatio: finiteRatio(initialPosition.yRatio),
      direction: initialPosition.direction === -1 ? -1 : 1,
    };
    this.direction = this.initialPosition.direction;
    this.random = random;
  }

  setBounds(bounds: CompanionBounds): void {
    this.bounds = {
      minX: Math.min(bounds.minX, bounds.maxX),
      maxX: Math.max(bounds.minX, bounds.maxX),
      minY: Math.min(bounds.minY, bounds.maxY),
      maxY: Math.max(bounds.minY, bounds.maxY),
    };
    if (!this.initialized) {
      this.position = {
        x:
          this.bounds.minX +
          (this.bounds.maxX - this.bounds.minX) * this.initialPosition.xRatio,
        y:
          this.bounds.minY +
          (this.bounds.maxY - this.bounds.minY) * this.initialPosition.yRatio,
      };
      this.initialized = true;
      this.pickTarget();
      return;
    }
    this.position.x = clamp(this.position.x, this.bounds.minX, this.bounds.maxX);
    this.position.y = clamp(this.position.y, this.bounds.minY, this.bounds.maxY);
    if (this.target !== null) {
      this.target.x = clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
      this.target.y = clamp(this.target.y, this.bounds.minY, this.bounds.maxY);
    }
  }

  dispatch(event: MikuEvent): boolean {
    if (event.type === "brain-dismiss") {
      this.reactionQueue = this.reactionQueue.filter(
        (reaction) => reaction.event.type !== "brain-thinking",
      );
      if (this.activeReactionType === "brain-thinking") {
        this.activeReactionType = null;
        this.bubbleText = null;
        this.bubbleRemaining = 0;
        if (this.mode !== "dragging") this.finishReaction();
      }
      return true;
    }
    const lastAt = this.lastEventAt.get(event.type);
    if (lastAt !== undefined && this.clock - lastAt < EVENT_COOLDOWNS[event.type]) {
      return false;
    }
    this.lastEventAt.set(event.type, this.clock);
    const reaction = reactionFor(event);

    if (event.type === "brain-comment" || event.type === "brain-failed") {
      this.reactionQueue = this.reactionQueue.filter(
        (queued) => queued.event.type !== "brain-thinking",
      );
    }

    const thinkingIsActive = this.activeReactionType === "brain-thinking";
    const shouldReplaceThinking =
      thinkingIsActive &&
      event.type !== "brain-thinking" &&
      this.mode !== "dragging";
    if (
      shouldReplaceThinking ||
      (this.bubbleText === null &&
        this.mode !== "reacting" &&
        this.mode !== "dragging")
    ) {
      this.startReaction(reaction);
      return true;
    }

    if (
      event.type === "brain-thinking" &&
      (thinkingIsActive ||
        this.reactionQueue.some(
          (queued) => queued.event.type === "brain-thinking",
        ))
    ) {
      return false;
    }

    if (this.reactionQueue.length >= MAX_REACTION_QUEUE) return false;
    this.reactionQueue.push(reaction);
    return true;
  }

  startDrag(): void {
    this.mode = "dragging";
    this.target = null;
    this.setClip("carried");
  }

  dragTo(x: number, y: number): void {
    if (this.mode !== "dragging") return;
    this.position.x = clamp(x, this.bounds.minX, this.bounds.maxX);
    this.position.y = clamp(y, this.bounds.minY, this.bounds.maxY);
  }

  endDrag(): void {
    if (this.mode !== "dragging") return;
    this.mode = "reacting";
    this.setClip("landing");
    const landingDuration = clipDuration("landing");
    const brainResponseIsWaiting =
      this.activeReactionType === "brain-thinking" &&
      this.reactionQueue.some(
        (reaction) =>
          reaction.event.type === "brain-comment" ||
          reaction.event.type === "brain-failed",
      );
    this.stateRemaining = landingDuration;
    if (brainResponseIsWaiting) {
      this.bubbleRemaining = Math.min(this.bubbleRemaining, landingDuration);
    }
  }

  tick(elapsedMs: number, reducedMotion: boolean): CompanionSnapshot {
    const elapsed = clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, 64);
    this.clock += elapsed;

    if (this.bubbleRemaining > 0) {
      this.bubbleRemaining -= elapsed;
      if (this.bubbleRemaining <= 0) {
        this.bubbleText = null;
        this.activeReactionType = null;
        if (this.mode !== "reacting" && this.mode !== "dragging") {
          const next = this.reactionQueue.shift();
          if (next !== undefined) this.startReaction(next);
        }
      }
    }

    if (this.mode === "reacting") {
      this.stateRemaining -= elapsed;
      if (this.stateRemaining <= 0) this.finishReaction();
    } else if (this.mode === "dragging") {
      // Pointer movement owns the position until release.
    } else if (!reducedMotion && this.mode === "walking") {
      this.advancePosition(elapsed);
    } else if (!reducedMotion && this.mode === "idle") {
      this.stateRemaining -= elapsed;
      if (this.stateRemaining <= 0) this.startWalking();
    }

    if (!reducedMotion) this.advanceFrame(elapsed);

    const visibleClip = reducedMotion && this.mode !== "reacting" ? "idle-static" : this.clipId;
    const clip = ANIMATION_CLIPS[visibleClip];
    const frameIndex = reducedMotion ? 0 : Math.min(this.frameIndex, clip.steps.length - 1);

    return {
      x: this.position.x,
      y: this.position.y,
      direction: this.direction,
      frame: clip.steps[frameIndex]!.frame,
      mode: this.mode,
      bubble: this.bubbleText,
    };
  }

  savedPosition(): SavedCompanionPosition {
    const width = Math.max(1, this.bounds.maxX - this.bounds.minX);
    const height = Math.max(1, this.bounds.maxY - this.bounds.minY);
    return {
      xRatio: finiteRatio((this.position.x - this.bounds.minX) / width),
      yRatio: finiteRatio((this.position.y - this.bounds.minY) / height),
      direction: this.direction,
    };
  }

  private startReaction(reaction: Reaction): void {
    this.mode = "reacting";
    this.activeReactionType = reaction.event.type;
    this.setClip(reaction.clip);
    this.bubbleText = this.pick(reaction.speech);
    const speechDuration =
      reaction.event.type === "brain-thinking"
        ? 120_000
        : clamp(
            4_300 + this.bubbleText.length * 62,
            MIN_SPEECH_DURATION_MS,
            MAX_SPEECH_DURATION_MS,
          );
    this.bubbleRemaining = speechDuration;
    // The animation and speech have independent lifetimes: play the reaction
    // once, then let Miku move naturally while the bubble keeps lingering.
    this.stateRemaining = clipDuration(reaction.clip);
  }

  private finishReaction(): void {
    const finishedLanding = this.clipId === "landing";
    if (this.bubbleText === null) {
      this.activeReactionType = null;
      const next = this.reactionQueue.shift();
      if (next !== undefined) {
        this.startReaction(next);
        return;
      }
    }
    if (finishedLanding) {
      this.startIdle(900 + this.random() * 900);
    } else {
      this.startWalking();
    }
  }

  private startWalking(): void {
    this.mode = "walking";
    this.setClip("walk");
    this.pickTarget();
  }

  private startIdle(duration = 2_400 + this.random() * 3_200): void {
    this.mode = "idle";
    this.stateRemaining = duration;
    if (this.idleBag.length === 0) this.refillIdleBag();
    let nextClip = this.idleBag.pop() ?? "idle-blink";
    if (nextClip === this.lastIdleClip && this.idleBag.length > 0) {
      const alternative = this.idleBag.pop()!;
      this.idleBag.unshift(nextClip);
      nextClip = alternative;
    }
    this.lastIdleClip = nextClip;
    this.setClip(nextClip);
  }

  private refillIdleBag(): void {
    this.idleBag = [...IDLE_CLIPS];
    for (let index = this.idleBag.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [this.idleBag[index], this.idleBag[swapIndex]] = [
        this.idleBag[swapIndex]!,
        this.idleBag[index]!,
      ];
    }
  }

  private setClip(clipId: ClipId): void {
    if (this.clipId === clipId) return;
    this.clipId = clipId;
    this.frameIndex = 0;
    this.frameElapsed = 0;
  }

  private advanceFrame(elapsed: number): void {
    const clip = ANIMATION_CLIPS[this.clipId];
    this.frameElapsed += elapsed;
    let guard = clip.steps.length + 1;
    while (guard > 0) {
      const step = clip.steps[this.frameIndex]!;
      if (this.frameElapsed < step.durationMs) break;
      this.frameElapsed -= step.durationMs;
      if (this.frameIndex < clip.steps.length - 1) {
        this.frameIndex += 1;
      } else if (clip.loop) {
        this.frameIndex = 0;
      } else {
        this.frameElapsed = 0;
        break;
      }
      guard -= 1;
    }
  }

  private advancePosition(elapsed: number): void {
    if (this.target === null) this.pickTarget();
    if (this.target === null) return;

    const deltaX = this.target.x - this.position.x;
    const deltaY = this.target.y - this.position.y;
    const distance = Math.hypot(deltaX, deltaY);
    const step = WALK_SPEED_PX_PER_SECOND * (elapsed / 1_000);
    if (distance <= Math.max(1, step)) {
      this.position = { ...this.target };
      this.target = null;
      this.startIdle();
      return;
    }

    const nextDirection: Direction = deltaX < 0 ? -1 : 1;
    if (Math.abs(deltaX) > 2) this.direction = nextDirection;
    this.position.x += (deltaX / distance) * step;
    this.position.y += (deltaY / distance) * step;
  }

  private pickTarget(): void {
    const width = this.bounds.maxX - this.bounds.minX;
    const height = this.bounds.maxY - this.bounds.minY;
    let candidate: Point = { ...this.position };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      candidate = {
        x: this.bounds.minX + this.random() * width,
        y: this.bounds.minY + this.random() * height,
      };
      const deltaX = candidate.x - this.position.x;
      const distance = Math.hypot(deltaX, candidate.y - this.position.y);
      if (distance >= Math.min(130, Math.max(width, height) * 0.45) && Math.abs(deltaX) >= Math.min(48, width * 0.2)) {
        break;
      }
    }

    // Side-facing art reads best with some horizontal travel, even when the
    // destination is mostly above or below the current position.
    if (width > 80 && Math.abs(candidate.x - this.position.x) < 36) {
      const offset = candidate.x < this.position.x ? -52 : 52;
      candidate.x = clamp(this.position.x + offset, this.bounds.minX, this.bounds.maxX);
    }
    this.target = candidate;
    if (Math.abs(candidate.x - this.position.x) > 2) {
      this.direction = candidate.x < this.position.x ? -1 : 1;
    }
  }

  private pick<T>(items: readonly T[]): T {
    const index = Math.min(items.length - 1, Math.floor(this.random() * items.length));
    return items[index]!;
  }
}
