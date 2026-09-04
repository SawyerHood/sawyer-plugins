import { describe, expect, it } from "vitest";
import {
  findCompletedTaskEvents,
  type TaskSnapshot,
} from "./task-events";

function snapshot(status: string, linkedBbProjectId: string | null): TaskSnapshot {
  return {
    linkedBbProjectId,
    task: {
      id: "task-1",
      key: "MIKU-39",
      status,
      projectId: "tasks-project",
    },
  };
}

describe("findCompletedTaskEvents", () => {
  it("does not celebrate the initial baseline", () => {
    const current = new Map([["task-1", snapshot("done", "proj_one")]]);
    expect(findCompletedTaskEvents(null, current)).toEqual([]);
  });

  it("emits only a real transition into done", () => {
    const previous = new Map([["task-1", snapshot("in_progress", "proj_one")]]);
    const current = new Map([["task-1", snapshot("done", "proj_one")]]);

    expect(findCompletedTaskEvents(previous, current)).toEqual([
      { taskKey: "MIKU-39", projectId: "proj_one" },
    ]);
    expect(findCompletedTaskEvents(current, current)).toEqual([]);
  });

  it("supports unlinked Tasks projects without inventing a bb project id", () => {
    const previous = new Map([["task-1", snapshot("todo", null)]]);
    const current = new Map([["task-1", snapshot("done", null)]]);
    expect(findCompletedTaskEvents(previous, current)).toEqual([
      { taskKey: "MIKU-39" },
    ]);
  });
});
