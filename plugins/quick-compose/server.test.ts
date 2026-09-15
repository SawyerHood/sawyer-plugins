import { describe, expect, it } from "vitest";
import { newThreadRequestSchema } from "./server";

const request = {
  projectId: "proj_1",
  providerId: "claude-code",
  model: "sonnet",
  input: [{ type: "text", text: "Fix the flaky test" }],
  environment: { type: "project-default" },
};

describe("newThreadRequestSchema", () => {
  it("accepts a composer request", () => {
    expect(newThreadRequestSchema.safeParse(request).success).toBe(true);
  });

  it("rejects requests missing load-bearing fields", () => {
    expect(newThreadRequestSchema.safeParse({ ...request, projectId: "" }).success).toBe(false);
    expect(newThreadRequestSchema.safeParse({ ...request, input: [] }).success).toBe(false);
    expect(newThreadRequestSchema.safeParse({ ...request, environment: undefined }).success).toBe(
      false,
    );
  });
});
