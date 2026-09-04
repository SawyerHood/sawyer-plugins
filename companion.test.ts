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

  it("lets a failure interrupt a lower-priority reaction", () => {
    const controller = new CompanionController(
      { xRatio: 0.5, yRatio: 0.5, direction: 1 },
      () => 0,
    );
    controller.setBounds({ minX: 0, maxX: 400, minY: 0, maxY: 300 });

    expect(controller.dispatch(event("thread-active"))).toBe(true);
    expect(controller.dispatch(event("thread-failed"))).toBe(true);
    const snapshot = controller.tick(0, false);

    expect(snapshot.mode).toBe("reacting");
    expect(snapshot.bubble).toBe("Oof… let’s try that again.");
    expect(snapshot.frame.y).toBe(370);
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
});

describe("isMikuEvent", () => {
  it("accepts the bounded realtime shape and rejects malformed payloads", () => {
    expect(isMikuEvent({ id: "1", type: "thread-idle", at: 123 })).toBe(true);
    expect(isMikuEvent({ id: "1", type: "surprise", at: 123 })).toBe(false);
    expect(isMikuEvent({ id: "1", type: "thread-idle", at: "soon" })).toBe(false);
  });
});
