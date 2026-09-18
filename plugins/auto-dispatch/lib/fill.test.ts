import { describe, expect, it } from "vitest";
import type { DecisionSummary } from "../server";
import { describeFill, selectionFor } from "./fill";

const pick = (label: string) => ({
  label,
  source: "jev" as const,
  probability: 0.9,
  confidence: 0.9,
  alternatives: [],
});

const decision: DecisionSummary = {
  project: { ...pick("bb"), id: "proj_bb" },
  machine: { ...pick("bee"), id: "host_bee" },
  model: { ...pick("Fable"), providerId: "claude-code", model: "fable" },
  reasoning: pick("max"),
  environment: { ...pick("Worktree"), id: "git-worktree" },
  latencyMs: 300,
  timings: [],
};

describe("selectionFor", () => {
  it("asks for the decision's project, machine, environment, model, and effort", () => {
    expect(selectionFor(decision)).toEqual({
      projectId: "proj_bb",
      environment: {
        type: "provider",
        environmentProviderId: "git-worktree",
        inputs: {},
        machine: { type: "existing", hostId: "host_bee" },
      },
      providerId: "claude-code",
      model: "fable",
      reasoningLevel: "max",
    });
  });

  it("leaves permission mode to the user", () => {
    expect(selectionFor(decision)).not.toHaveProperty("permissionMode");
  });

  it("refuses a reasoning level BB does not know", () => {
    expect(() => selectionFor({ ...decision, reasoning: pick("galaxy") })).toThrow(/unknown/);
  });
});

describe("describeFill", () => {
  const requested = selectionFor(decision);

  it("uses Jev's labels when the composer took every value", () => {
    expect(describeFill(decision, requested, { ...requested, permissionMode: "auto" })).toEqual({
      line: "bb · bee · Worktree · Fable · max",
      changed: 0,
    });
  });

  it("says what the composer settled on instead", () => {
    const settled = {
      ...requested,
      reasoningLevel: "high" as const,
      environment: {
        type: "provider" as const,
        environmentProviderId: "project-checkout",
        inputs: { branch: "main" },
        machine: { type: "existing" as const, hostId: "host_bee" },
      },
    };
    expect(describeFill(decision, requested, settled)).toEqual({
      line: "bb · project-checkout on host_bee (not bee · Worktree) · Fable · high (not max)",
      changed: 2,
    });
  });

  it("marks a field the composer does not have", () => {
    const { projectId: _projectId, environment: _environment, ...execution } = requested;
    expect(describeFill(decision, requested, execution).line).toBe(
      "unchanged (not bb) · unchanged (not bee · Worktree) · Fable · max",
    );
  });
});
