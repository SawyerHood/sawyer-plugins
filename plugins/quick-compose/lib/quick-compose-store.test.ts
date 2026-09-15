import { describe, expect, it } from "vitest";
import { quickCompose } from "./quick-compose-store";

describe("quickCompose", () => {
  it("toggles open with the project in view and closes on the next toggle", () => {
    quickCompose.toggle("proj_1");
    expect(quickCompose.getState()).toMatchObject({ open: true, projectId: "proj_1" });

    quickCompose.toggle("proj_2");
    expect(quickCompose.getState()).toMatchObject({ open: false, projectId: "proj_1" });
  });

  it("requests focus every time it opens", () => {
    quickCompose.open(null);
    const first = quickCompose.getState().focusRequest;
    quickCompose.close();
    quickCompose.open(null);
    expect(quickCompose.getState().focusRequest).toBe(first + 1);
    expect(quickCompose.getState().projectId).toBeNull();
    quickCompose.close();
  });
});
