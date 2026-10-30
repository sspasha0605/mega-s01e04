import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const fixtureDir = fileURLToPath(new URL('../runs/', import.meta.url));
const tempDirs: string[] = [];

function runsDir(source = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, `${night}.jsonl`), source);
  return dir;
}

function log(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { at: '2026-10-29T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook', ...overrides };
}

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('night log reader', () => {
  it('reads the real night into five sorted jobs and counts its malformed line', () => {
    expect(readNight(fixtureDir, night)).toEqual({
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('compares instants across offsets and late lines while preserving original timestamps', () => {
    const dir = runsDir(jsonl([
      log({ at: '2026-10-29T01:00:00Z', status: 'fail', error: 'latest error', owner: null }),
      log({ at: '2026-10-29T02:30:00+02:00', status: 'retry', error: 'older error' }),
      log({ at: '2026-10-28T23:30:00Z' }),
    ]));
    expect(readNight(dir, night)).toEqual({
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{ job: 'lane/sync', owner: null, runs: 3, retries: 1,
        lastStatus: 'fail', lastError: 'latest error',
        firstAt: '2026-10-28T23:30:00Z', lastAt: '2026-10-29T01:00:00Z' }],
    });
  });

  it('uses the later line for equal instants and clears errors after recovery', () => {
    const dir = runsDir(jsonl([
      log({ at: '2026-10-29T02:00:00+01:00', status: 'retry', error: 'temporary' }),
      log({ at: '2026-10-29T01:00:00Z', owner: null }),
    ]));
    expect(readNight(dir, night)?.rows[0]).toEqual({
      job: 'lane/sync', owner: null, runs: 2, retries: 1, lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T02:00:00+01:00', lastAt: '2026-10-29T01:00:00Z',
    });
  });

  it('skips invalid JSON and invalid schemas without losing valid records', () => {
    const invalid = [
      null, [], 42, {}, log({ at: null }), log({ at: 'not-a-time' }),
      log({ at: '2026-02-30T01:00:00Z' }), log({ at: '2026-10-29T01:00:00' }),
      log({ at: '2026-10-29T24:00:00Z' }), log({ job: '' }), log({ job: 1 }),
      log({ status: 'unknown' }), log({ status: ['ok'] }), log({ owner: 1 }),
      log({ owner: undefined }), log({ error: null }), log({ error: 123 }),
    ];
    const dir = runsDir(`${jsonl([log(), ...invalid])}\n{broken\n${jsonl([log({ job: 'other', owner: null })])}\n`);
    const digest = readNight(dir, night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest?.rows.map((row) => row.job)).toEqual(['lane/sync', 'other']);
  });

  it('ignores blank lines and accepts CRLF and an unterminated final line', () => {
    const dir = runsDir(`\r\n  \r\n${JSON.stringify(log())}\r\n\t\r\n${JSON.stringify(log())}`);
    expect(readNight(dir, night)).toMatchObject({ badLines: 0, counts: { ok: 2, retry: 0, fail: 0 }, rows: [{ runs: 2 }] });
  });

  it('distinguishes an existing empty file from a missing night or directory', () => {
    const dir = runsDir();
    expect(readNight(dir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-27')).toBeNull();
    expect(readNight(join(dir, 'missing'), night)).toBeNull();
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28.jsonl', '2026-02-30', '2026-13-01', ''])('rejects invalid night %j', (invalidNight) => {
    expect(readNight(fixtureDir, invalidNight)).toBeNull();
  });

  it('propagates filesystem errors other than a missing file', () => {
    const dir = runsDir();
    rmSync(join(dir, `${night}.jsonl`));
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
