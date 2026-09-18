// What the composer is asked to select for a routing decision. The composer has
// the last word: it lowers a permission mode above the machine's limit, moves a
// reasoning level the model lacks to the nearest one it has, and so on, and its
// pickers show what it settled on.
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
  return `${selection.projectId ?? ""} ${environment.environmentProviderId} on ${machine}`;
}

/**
 * What to set now that Jev's answer has gone from `previous` to `next`: only
 * what changed, so a picker changed by hand stays as it was left until Jev's
 * answer for it changes. Empty when there is nothing to set.
 */
export function changedSelection(
  previous: ExperimentalComposerSelection | null,
  next: ExperimentalComposerSelection,
): ExperimentalComposerSelection {
  // A move sets everything again: BB remembers the environment per project,
  // and each machine has its own model catalog to reconcile against.
  if (previous === null || placement(previous) !== placement(next)) return next;
  const sameModel =
    previous.providerId === next.providerId &&
    previous.model === next.model &&
    previous.reasoningLevel === next.reasoningLevel;
  if (sameModel) return {};
  // Effort is chosen per model, so the three travel together.
  return { providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel };
}
