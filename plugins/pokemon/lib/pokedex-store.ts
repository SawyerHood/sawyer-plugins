import type Database from "better-sqlite3";
import { dexEntrySchema, type DexEntry, type SpeciesRef } from "./pokeapi";

/** Append-only: never edit or reorder a shipped statement. */
export const MIGRATIONS = [
  `CREATE TABLE species (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL
  )`,
  `CREATE TABLE catches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL UNIQUE,
    thread_title TEXT NOT NULL,
    species_id INTEGER NOT NULL,
    caught_at INTEGER NOT NULL
  )`,
  `CREATE INDEX catches_by_species ON catches (species_id, caught_at)`,
  `CREATE TABLE dex_entries (
    species_id INTEGER PRIMARY KEY,
    entry TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )`,
  `CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

const SPECIES_SYNCED_AT = "species-synced-at";

export interface CatchRecord {
  id: number;
  threadId: string;
  threadTitle: string;
  speciesId: number;
  caughtAt: number;
}

export interface SpeciesTally {
  speciesId: number;
  count: number;
  firstCaughtAt: number;
  lastCaughtAt: number;
}

interface CatchRow {
  id: number;
  thread_id: string;
  thread_title: string;
  species_id: number;
  caught_at: number;
}

interface TallyRow {
  species_id: number;
  count: number;
  first_caught_at: number;
  last_caught_at: number;
}

function toCatchRecord(row: CatchRow): CatchRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    threadTitle: row.thread_title,
    speciesId: row.species_id,
    caughtAt: row.caught_at,
  };
}

function toTally(row: TallyRow): SpeciesTally {
  return {
    speciesId: row.species_id,
    count: row.count,
    firstCaughtAt: row.first_caught_at,
    lastCaughtAt: row.last_caught_at,
  };
}

function parseEntry(json: string): DexEntry | null {
  try {
    const parsed = dexEntrySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const TALLY_COLUMNS = `species_id, COUNT(*) AS count,
  MIN(caught_at) AS first_caught_at, MAX(caught_at) AS last_caught_at`;

export class PokedexStore {
  constructor(private readonly db: Database.Database) {}

  speciesIds(): number[] {
    return this.db
      .prepare<[], { id: number }>("SELECT id FROM species ORDER BY id")
      .all()
      .map((row) => row.id);
  }

  speciesSlug(speciesId: number): string | null {
    return (
      this.db
        .prepare<[number], { slug: string }>("SELECT slug FROM species WHERE id = ?")
        .get(speciesId)?.slug ?? null
    );
  }

  speciesSyncedAt(): number | null {
    const row = this.db
      .prepare<[string], { value: string }>("SELECT value FROM meta WHERE key = ?")
      .get(SPECIES_SYNCED_AT);
    const value = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(value) ? value : null;
  }

  replaceSpecies(species: readonly SpeciesRef[], syncedAt: number): void {
    const insert = this.db.prepare("INSERT INTO species (id, slug) VALUES (?, ?)");
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM species").run();
      for (const { id, slug } of species) insert.run(id, slug);
      this.db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .run(SPECIES_SYNCED_AT, String(syncedAt));
    })();
  }

  hasCatchForThread(threadId: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM catches WHERE thread_id = ?").get(threadId) !==
      undefined
    );
  }

  /** Records a catch, or returns null when the thread already earned one. */
  recordCatch(input: Omit<CatchRecord, "id">): CatchRecord | null {
    const result = this.db
      .prepare(
        `INSERT INTO catches (thread_id, thread_title, species_id, caught_at)
         VALUES (?, ?, ?, ?) ON CONFLICT (thread_id) DO NOTHING`,
      )
      .run(input.threadId, input.threadTitle, input.speciesId, input.caughtAt);
    if (result.changes === 0) return null;
    return { id: Number(result.lastInsertRowid), ...input };
  }

  tallies(): SpeciesTally[] {
    return this.db
      .prepare<[], TallyRow>(
        `SELECT ${TALLY_COLUMNS} FROM catches GROUP BY species_id ORDER BY species_id`,
      )
      .all()
      .map(toTally);
  }

  tally(speciesId: number): SpeciesTally | null {
    const row = this.db
      .prepare<[number], TallyRow>(
        `SELECT ${TALLY_COLUMNS} FROM catches WHERE species_id = ? GROUP BY species_id`,
      )
      .get(speciesId);
    return row === undefined ? null : toTally(row);
  }

  totalCatches(): number {
    return this.db
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM catches")
      .get()!.count;
  }

  catchHistory(speciesId: number, limit: number): CatchRecord[] {
    return this.db
      .prepare<[number, number], CatchRow>(
        `SELECT * FROM catches WHERE species_id = ? ORDER BY caught_at DESC, id DESC LIMIT ?`,
      )
      .all(speciesId, limit)
      .map(toCatchRecord);
  }

  recentCatches(limit: number): CatchRecord[] {
    return this.db
      .prepare<[number], CatchRow>(
        "SELECT * FROM catches ORDER BY caught_at DESC, id DESC LIMIT ?",
      )
      .all(limit)
      .map(toCatchRecord);
  }

  /** A cached entry, or null when it is missing or no longer matches the schema. */
  entry(speciesId: number): DexEntry | null {
    const row = this.db
      .prepare<[number], { entry: string }>(
        "SELECT entry FROM dex_entries WHERE species_id = ?",
      )
      .get(speciesId);
    return row === undefined ? null : parseEntry(row.entry);
  }

  entries(speciesIds: readonly number[]): Map<number, DexEntry> {
    const wanted = new Set(speciesIds);
    const entries = new Map<number, DexEntry>();
    const rows = this.db
      .prepare<[], { species_id: number; entry: string }>(
        "SELECT species_id, entry FROM dex_entries",
      )
      .all();
    for (const row of rows) {
      if (!wanted.has(row.species_id)) continue;
      const entry = parseEntry(row.entry);
      if (entry !== null) entries.set(row.species_id, entry);
    }
    return entries;
  }

  saveEntry(entry: DexEntry, fetchedAt: number): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO dex_entries (species_id, entry, fetched_at) VALUES (?, ?, ?)",
      )
      .run(entry.id, JSON.stringify(entry), fetchedAt);
  }
}
