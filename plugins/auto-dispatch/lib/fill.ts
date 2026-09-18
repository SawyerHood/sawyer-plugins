// Auto-fill: what the composer is asked to select for a routing decision, and
// how to say what it settled on. The composer may not take every value as
// given: it lowers a permission mode above the machine's limit, moves a
// reasoning level the model lacks to the nearest one it has, and so on.
import type { ExperimentalComposerSelection } from "@get-bb/plugin-sdk/app";
import type { DecisionSummary } from "../server";
import { REASONING_LEVELS } from "./reasoning";

/** The composer selection that carries out `decision`. Permission mode is left to the user. */
export function selectionFor(decision: DecisionSummary): ExperimentalComposerSelection {
  // A reasoning pick is labelled with its level.
  const reasoningLevel = REASONING_LEVELS.find((level) => level === decision.reasoning.label);
  if (reasoningLevel === undefined) {
    throw new Error(`Jev picked an unknown reasoning level, “${decision.reasoning.label}”.`);
  }
  return {
    projectId: decision.project.id,
    environment: {
      type: "provider",
      environmentProviderId: decision.environment.id,
      // Not applied: the composer keeps its own inputs, such as the branch to start from.
      inputs: {},
      machine: { type: "existing", hostId: decision.machine.id },
    },
    providerId: decision.model.providerId,
    model: decision.model.model,
    reasoningLevel,
  };
}

function placement(selection: ExperimentalComposerSelection): string {
  const environment = selection.environment;
  if (environment?.type !== "provider") return JSON.stringify(environment ?? null);
  const machine = environment.machine?.type === "existing" ? environment.machine.hostId : "";
  return `${environment.environmentProviderId} on ${machine}`;
}

/**
 * One line saying where the composer now points, from Jev's labels where the
 * composer took the value as asked and from the composer's own value, marked,
 * where it did not. `changed` counts the latter.
 */
export function describeFill(
  decision: DecisionSummary,
  requested: ExperimentalComposerSelection,
  settled: ExperimentalComposerSelection,
): { line: string; changed: number } {
  let changed = 0;
  const part = (label: string, kept: boolean, actual: string | undefined) => {
    if (kept) return label;
    changed += 1;
    return `${actual ?? "unchanged"} (not ${label})`;
  };
  const line = [
    part(decision.project.label, settled.projectId === requested.projectId, settled.projectId),
    part(
      `${decision.machine.label} · ${decision.environment.label}`,
      placement(settled) === placement(requested),
      settled.environment === undefined ? undefined : placement(settled),
    ),
    part(
      decision.model.label,
      settled.providerId === requested.providerId && settled.model === requested.model,
      settled.model,
    ),
    part(
      decision.reasoning.label,
      settled.reasoningLevel === requested.reasoningLevel,
      settled.reasoningLevel,
    ),
  ].join(" · ");
  return { line, changed };
}
