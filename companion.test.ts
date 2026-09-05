import { describe, expect, it } from "vitest";
import {
  CompanionController,
  isMikuEvent,
  type MikuEvent,
} from "./companion";

function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0.5;
}

function event(type: MikuEvent["type"], id: string = type): MikuEvent {
  return { id, type, at: 1_000 };
}

describe("CompanionController", () => {
  it("walks toward two-dimensional waypoints", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      sequenceRandom([0.9, 0.1]),
    );
    controller.setBounds({ minX: 0, maxX: 500, minY: 0, maxY: 400 });
    const initial = controller.tick(0, false);
    let current = initial;
    for (let index = 0; index < 24; index += 1) current = controller.tick(64, false);

    expect(current.x).toBeGreaterThan(initial.x);
    expect(current.y).toBeLessThan(initial.y);
    expect(current.mode).toBe("walking");
  });

  it("keeps animating in place when walking is disabled and resumes on toggle", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      sequenceRandom([0.9, 0.1, 0.7, 0.3]),
    );
    controller.setBounds({ minX: 0, maxX: 500, minY: 0, maxY: 400 });
    const initial = controller.tick(0, false);
    controller.setWalkingEnabled(false);

    let stationary = controller.tick(0, false);
    const stationaryFrame = stationary.frame;
    for (let index = 0; index < 24; index += 1) {
      stationary = controller.tick(64, false);
    }

    expect(stationary.mode).toBe("idle");
    expect(stationary.x).toBe(initial.x);
    expect(stationary.y).toBe(initial.y);
    expect(stationary.frame).not.toBe(stationaryFrame);

    controller.setWalkingEnabled(true);
    let moving = controller.tick(0, false);
    for (let index = 0; index < 12; index += 1) {
      moving = controller.tick(64, false);
    }
    expect(moving.mode).toBe("walking");
    expect(moving.x === initial.x && moving.y === initial.y).toBe(false);
  });

  it("keeps advancing walk frames after changing direction", () => {
    const controller = new CompanionController(
      { xRatio: 0.8, yRatio: 0.5, direction: 1 },
      sequenceRandom([0.1, 0.8]),
    );
    controller.setBounds({ minX: 0, maxX: 500, minY: 0, maxY: 300 });
    const turned = controller.tick(16, false);
    const firstFrame = turned.frame;
    controller.tick(64, false);
    const later = controller.tick(64, false);

    expect(turned.direction).toBe(-1);
    expect(later.direction).toBe(-1);
    expect(later.frame).not.toBe(firstFrame);
  });

  it("queues new speech without replacing the message currently on screen", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 0, maxX: 400, minY: 0, maxY: 300 });

    expect(controller.dispatch(event("thread-active"))).toBe(true);
    expect(controller.dispatch(event("thread-failed"))).toBe(true);
    const initial = controller.tick(0, false);

    expect(initial.mode).toBe("reacting");
    expect(initial.bubble).toBe("Let’s do this! ♪");
    for (let index = 0; index < 64; index += 1) controller.tick(64, false);
    expect(controller.tick(0, false).bubble).toBe("Let’s do this! ♪");
    for (let index = 0; index < 40; index += 1) controller.tick(64, false);
    expect(controller.tick(0, false).bubble).toBe("Oof… let’s try that again.");
  });

  it("resumes walking after a short reaction while its speech lingers", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 0, maxX: 400, minY: 0, maxY: 300 });
    controller.dispatch(event("clicked"));

    for (let index = 0; index < 18; index += 1) controller.tick(64, false);
    const first = controller.tick(0, false);
    for (let index = 0; index < 5; index += 1) controller.tick(64, false);
    const later = controller.tick(0, false);

    expect(first.bubble).toBe("Miku Miku! ♪");
    expect(later.bubble).toBe(first.bubble);
    expect(first.mode).toBe("walking");
    expect(later.x).not.toBe(first.x);
    expect(later.frame).not.toBe(first.frame);
  });

  it("deduplicates event bursts with per-event cooldowns", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 0, maxX: 400, minY: 0, maxY: 300 });

    expect(controller.dispatch(event("clicked", "one"))).toBe(true);
    expect(controller.dispatch(event("clicked", "two"))).toBe(false);
  });

  it("pauses autonomous movement while dragged and clamps to the viewport", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0.5,
    );
    controller.setBounds({ minX: 10, maxX: 300, minY: 40, maxY: 220 });
    controller.startDrag();
    controller.dragTo(999, -100);
    const dragged = controller.tick(500, false);

    expect(dragged.mode).toBe("dragging");
    expect(dragged.x).toBe(300);
    expect(dragged.y).toBe(40);
    expect(dragged.frame).toMatchObject({ x: 3, y: 370, width: 58, height: 58 });

    controller.endDrag();
    expect(controller.tick(0, false).mode).toBe("reacting");
    for (let index = 0; index < 12; index += 1) controller.tick(64, false);
    expect(controller.tick(0, false).mode).toBe("idle");
  });

  it("keeps an active speech bubble visible while Miku is dragged", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 10, maxX: 300, minY: 40, maxY: 220 });
    controller.dispatch(event("clicked"));
    const message = controller.tick(0, false).bubble;

    controller.startDrag();
    controller.dragTo(10, 40);
    expect(controller.tick(250, false).bubble).toBe(message);
    controller.endDrag();
    expect(controller.tick(250, false).bubble).toBe(message);
  });

  it("queues a brain response without interrupting an active drag", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 10, maxX: 300, minY: 40, maxY: 220 });
    controller.dispatch(event("brain-thinking"));
    controller.startDrag();
    controller.dispatch({
      ...event("brain-comment"),
      speech: "I finished thinking!",
    });

    expect(controller.tick(0, false)).toMatchObject({
      mode: "dragging",
      bubble: "…",
    });
    controller.endDrag();
    for (let index = 0; index < 11; index += 1) controller.tick(64, false);
    expect(controller.tick(0, false).bubble).toBe("I finished thinking!");
  });

  it("stays in place when reduced motion is requested but still speaks", () => {
    const controller = new CompanionController(
      { xRatio: 0.25, yRatio: 0.75, direction: 1 },
      sequenceRandom([0.9, 0.1]),
    );
    controller.setBounds({ minX: 0, maxX: 400, minY: 0, maxY: 300 });
    const initial = controller.tick(0, true);
    controller.dispatch(event("task-completed"));
    let current = initial;
    for (let index = 0; index < 12; index += 1) current = controller.tick(64, true);

    expect(current.x).toBe(initial.x);
    expect(current.y).toBe(initial.y);
    expect(current.bubble).not.toBeNull();
  });

  it("holds a thinking bubble until the brain responds", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 0, maxX: 400, minY: 0, maxY: 300 });

    controller.dispatch(event("brain-thinking"));
    for (let index = 0; index < 30; index += 1) controller.tick(64, false);
    expect(controller.tick(0, false).bubble).toBe("…");

    controller.dispatch({
      ...event("brain-comment"),
      speech: "The tests are sparkling! ♪",
    });
    expect(controller.tick(0, false).bubble).toBe("The tests are sparkling! ♪");
  });

  it("never replaces visible speech with a pending thinking indicator", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 0, maxX: 400, minY: 0, maxY: 300 });

    controller.dispatch(event("thread-idle"));
    const visibleMessage = controller.tick(0, false).bubble;
    controller.dispatch(event("brain-thinking"));
    expect(controller.tick(0, false).bubble).toBe(visibleMessage);

    controller.dispatch({
      ...event("brain-comment"),
      speech: "I saw that finish—nice work!",
    });
    expect(controller.tick(0, false).bubble).toBe(visibleMessage);
    for (let index = 0; index < 110; index += 1) controller.tick(64, false);
    expect(controller.tick(0, false).bubble).toBe("I saw that finish—nice work!");
  });
});

describe("isMikuEvent", () => {
  it("accepts the bounded realtime shape and rejects malformed payloads", () => {
    expect(isMikuEvent({ id: "1", type: "thread-idle", at: 123 })).toBe(true);
    expect(isMikuEvent({ id: "1", type: "surprise", at: 123 })).toBe(false);
    expect(isMikuEvent({ id: "1", type: "thread-idle", at: "soon" })).toBe(false);
  });
});
