import { beforeEach, describe, expect, it } from "vitest";
import { quickCompose } from "./quick-compose-store";

const inProject1 = { projectId: "proj_1", threadId: null };
const onThread1 = { projectId: "proj_1", threadId: "thr_1" };
const onThread2 = { projectId: "proj_2", threadId: "thr_2" };

describe("quickCompose", () => {
  beforeEach(() => {
    quickCompose.finish("new-thread");
    quickCompose.finish("handoff");
  });

  it("toggles open with the project in view and closes on the next toggle", () => {
    quickCompose.toggle("new-thread", inProject1);
    expect(quickCompose.getState()).toMatchObject({
      active: "new-thread",
      sessions: { "new-thread": { projectId: "proj_1", edited: false } },
    });

    quickCompose.toggle("new-thread", onThread2);
    expect(quickCompose.getState().active).toBeNull();
  });

  it("re-seeds an untouched session on the next open", () => {
    quickCompose.open("new-thread", inProject1);
    const first = quickCompose.getState().sessions["new-thread"]!;
    quickCompose.close();
    expect(quickCompose.getState().sessions["new-thread"]).toBeNull();

    quickCompose.open("new-thread", onThread2);
    const second = quickCompose.getState().sessions["new-thread"]!;
    expect(second.projectId).toBe("proj_2");
    expect(second.id).not.toBe(first.id);
  });

  it("keeps an edited session across dismissals until it is finished", () => {
    quickCompose.open("new-thread", inProject1);
    quickCompose.markEdited("new-thread");
    const edited = quickCompose.getState().sessions["new-thread"]!;
    quickCompose.close();

    quickCompose.open("new-thread", onThread2);
    expect(quickCompose.getState().sessions["new-thread"]).toBe(edited);

    quickCompose.finish("new-thread");
    expect(quickCompose.getState()).toMatchObject({
      active: null,
      sessions: { "new-thread": null },
    });
  });

  it("starts a handoff for the thread in view and keeps sessions independent", () => {
    quickCompose.open("new-thread", inProject1);
    quickCompose.markEdited("new-thread");
    quickCompose.toggle("handoff", onThread1);
    expect(quickCompose.getState()).toMatchObject({
      active: "handoff",
      sessions: {
        "new-thread": { edited: true },
        handoff: { projectId: "proj_1", sourceThreadId: "thr_1" },
      },
    });
  });

  it("resumes an edited handoff only on its own thread", () => {
    quickCompose.open("handoff", onThread1);
    quickCompose.markEdited("handoff");
    const edited = quickCompose.getState().sessions.handoff!;

    quickCompose.toggle("handoff", onThread2);
    expect(quickCompose.getState()).toMatchObject({
      active: "handoff",
      sessions: { handoff: { sourceThreadId: "thr_2", edited: false } },
    });

    quickCompose.close();
    quickCompose.open("handoff", onThread1);
    expect(quickCompose.getState().sessions.handoff).not.toBe(edited);
  });

  it("requests focus every time it opens", () => {
    quickCompose.open("new-thread", inProject1);
    const first = quickCompose.getState().focusRequest;
    quickCompose.close();
    quickCompose.open("handoff", onThread1);
    expect(quickCompose.getState().focusRequest).toBe(first + 1);
  });
});
