export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // Owner and status/error come from the latest record for this job.
  owner: string | null;
  // All valid records for this job, including retry records.
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // The latest record's error, or null when that record has no error.
  lastError: string | null;
  // Earliest/latest timestamps, preserving their original log offsets.
  firstAt: string;
  lastAt: string;
};

// Counts of valid log records by status, not counts of job rows.
export type DigestCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type NightDigest = {
  // One row per job, sorted by job in ascending string order.
  rows: DigestRow[];
  // Nonblank lines that fail JSON parsing or record validation.
  badLines: number;
  counts: DigestCounts;
};

/**
 * Synchronously read runs/<night>.jsonl; night must be YYYY-MM-DD.
 * Return null for a missing file or invalid night, but an empty NightDigest
 * for an existing empty file. Other filesystem errors propagate.
 * Aggregate records chronologically; a later line wins timestamp ties.
 * Blank lines are ignored. Invalid records increase badLines and are skipped.
 * Implemented as readNight in src/digest/reader.ts.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
