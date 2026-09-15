// Shared with app.tsx, so this module stays free of zod to keep the frontend
// bundle small.

/** Realtime channel the server publishes a catch on. */
export const CATCH_CHANNEL = "pokemon-caught";

export interface CatchEvent {
  catchId: number;
  speciesId: number;
  name: string;
  types: string[];
  spriteUrl: string | null;
  /** How many of this species you now have, including this one. */
  count: number;
  /** Distinct species caught so far. */
  caughtSpecies: number;
  totalSpecies: number;
  threadTitle: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parseCatchEvent(payload: unknown): CatchEvent | null {
  if (
    !isRecord(payload) ||
    !isCount(payload.catchId) ||
    !isCount(payload.speciesId) ||
    typeof payload.name !== "string" ||
    !Array.isArray(payload.types) ||
    !payload.types.every((type) => typeof type === "string") ||
    (payload.spriteUrl !== null && typeof payload.spriteUrl !== "string") ||
    !isCount(payload.count) ||
    !isCount(payload.caughtSpecies) ||
    !isCount(payload.totalSpecies) ||
    typeof payload.threadTitle !== "string"
  ) {
    return null;
  }
  return {
    catchId: payload.catchId,
    speciesId: payload.speciesId,
    name: payload.name,
    types: payload.types,
    spriteUrl: payload.spriteUrl,
    count: payload.count,
    caughtSpecies: payload.caughtSpecies,
    totalSpecies: payload.totalSpecies,
    threadTitle: payload.threadTitle,
  };
}
